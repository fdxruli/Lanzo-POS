import {
    PRICE_DRIFT_TOLERANCE,
    TOTAL_DRIFT_TOLERANCE
} from './constants';

export const normalizeAndValidatePricing = async ({
    itemsToProcess,
    total,
    loadData,
    queryBatchesByProductIdAndActive,
    STORES,
    calculatePricingDetails,
    Logger
}) => {
    // 1. Instanciamos la Caché Local
    const productCache = new Map();

    // 2. Función Helper para obtener producto (Carga o devuelve caché)
    const ensureProductInCache = async (id) => {
        if (productCache.has(id)) return; // Ya existe, no hacer nada

        const realProduct = await loadData(STORES.MENU, id);
        if (realProduct) {
            // Si maneja lotes, cargamos sus lotes activos también
            if (realProduct.batchManagement?.enabled) {
                const activeBatches = await queryBatchesByProductIdAndActive(id, true);
                realProduct.activeBatches = activeBatches || [];
            }
            productCache.set(id, realProduct);
        }
    };

    // 3. Pre-carga Paralela (OPTIMIZACIÓN CLAVE) ⚡
    // Identificamos IDs únicos y los cargamos todos a la vez usando Promise.all
    // Esto es mucho más rápido que cargar uno por uno dentro del bucle.
    const uniqueIds = [...new Set(itemsToProcess.map(i => i.parentId || i.id))];
    await Promise.all(uniqueIds.map(id => ensureProductInCache(id)));

    let securityViolation = false;
    let calculatedRealTotal = 0;

    // 4. Memoria Temporal (Aislamiento de Estado)
    // Registramos los valores autorizados sin tocar el carrito original todavía.
    const authorizedValues = new Map();

    // 5. FASE 1: Validación Estricta (Solo lectura)
    itemsToProcess.forEach((item) => {
        const realId = item.parentId || item.id;
        const dbProduct = productCache.get(realId);

        if (!dbProduct) {
            throw new Error(`SEGURIDAD: El producto "${item.name}" (ID: ${realId}) no existe en la BD.`);
        }

        // CORRECCIÓN: Extraemos la verdad absoluta
        const pricing = calculatePricingDetails(dbProduct, item.quantity);
        const authoritativePrice = pricing.unitPrice;
        const exactLineTotal = pricing.exactTotal; 

        const priceDifference = Math.abs(authoritativePrice - parseFloat(item.price));

        if (priceDifference > PRICE_DRIFT_TOLERANCE) {
            Logger?.warn(`🛑 ATAQUE DETECTADO: "${item.name}" venía con $${item.price}, real es $${authoritativePrice}.`);
            securityViolation = true;
        }

        const authoritativeCost = parseFloat(dbProduct.cost) || 0;
        
        // CORRECCIÓN: Sumamos el importe absoluto del bloque. Cero multiplicaciones.
        calculatedRealTotal += exactLineTotal;

        authorizedValues.set(item.id, {
            price: authoritativePrice,
            cost: authoritativeCost,
            exactTotal: exactLineTotal // Guardamos para la Fase 3
        });
    });

    // 6. FASE 2: Decisión de Seguridad
    const totalDifference = Math.abs(calculatedRealTotal - parseFloat(total));

    if (securityViolation || totalDifference > TOTAL_DRIFT_TOLERANCE) {
        // El error se lanza AQUÍ, antes de haber mutado un solo byte de los datos originales.
        // Si la venta se bloquea, el estado del carrito de la UI permanece inmaculado.
        throw new Error(`⛔ ALERTA DE SEGURIDAD CRÍTICA ⛔\n\nSe detectó una inconsistencia en los precios (Posible manipulación).\n\nTotal Esperado: $${total}\nTotal Real Calculado: $${calculatedRealTotal.toFixed(2)}\n\nLa venta ha sido bloqueada por seguridad. Por favor recarga el carrito.`);
    }

    // 7. FASE 3: Aplicación Segura (Mutación Controlada)
    // Solo llegamos a esta línea si la validación completa fue exitosa. 
    // Ahora es seguro preparar los items para la base de datos.
    itemsToProcess.forEach((item) => {
        const safeData = authorizedValues.get(item.id);
        if (safeData) {
            item.price = safeData.price;
            item.cost = safeData.cost;
            item.exactTotal = safeData.exactTotal; // Inyección de la fuente de la verdad
        }
    });
};
