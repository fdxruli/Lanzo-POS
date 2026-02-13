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
    calculateCompositePrice,
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

    // 4. Validación (Síncrona, porque ya tenemos los datos en caché)
    itemsToProcess.forEach((item) => {
        const realId = item.parentId || item.id;

        // Obtenemos directamente del mapa (Instantáneo)
        const dbProduct = productCache.get(realId);

        if (!dbProduct) {
            throw new Error(`SEGURIDAD: El producto "${item.name}" (ID: ${realId}) no existe en la BD.`);
        }

        const authoritativePrice = calculateCompositePrice(dbProduct, item.quantity);
        const priceDifference = Math.abs(authoritativePrice - parseFloat(item.price));

        if (priceDifference > PRICE_DRIFT_TOLERANCE) {
            Logger?.warn(`🛑 ATAQUE DETECTADO: "${item.name}" venía con $${item.price}, real es $${authoritativePrice}.`);
            securityViolation = true;
            item.price = authoritativePrice;
        } else {
            item.price = authoritativePrice;
        }

        item.cost = parseFloat(dbProduct.cost) || 0;
    });

    // 5. Validación del Total
    const calculatedRealTotal = itemsToProcess.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
    }, 0);

    const totalDifference = Math.abs(calculatedRealTotal - parseFloat(total));

    if (securityViolation || totalDifference > TOTAL_DRIFT_TOLERANCE) {
        throw new Error(`⛔ ALERTA DE SEGURIDAD CRÍTICA ⛔\n\nSe detectó una inconsistencia en los precios (Posible manipulación).\n\nTotal Esperado: $${total}\nTotal Real Calculado: $${calculatedRealTotal.toFixed(2)}\n\nLa venta ha sido bloqueada por seguridad. Por favor recarga el carrito.`);
    }
};