/**
 * Motor de Asignación Puro para Deducciones de Lotes.
 * 
 * FASE 4: Consistencia Contable (Single Source of Truth para Lotes)
 * El Kiosco no puede calcular el costo usando la función A mientras la base de 
 * datos descuenta lotes usando la función B. Esta función pura retorna un plan 
 * de deducción exacto que debe ser usado tanto en UI como en persistencia.
 */

/**
 * Estrategia de selección de lotes
 * @typedef {'FEFO'|'FIFO'} BatchSelectionMode
 */

/**
 * Plan de deducción de un lote
 * @typedef {Object} BatchDeduction
 * @property {string} batchId - ID del lote
 * @property {number} qty - Cantidad a deducir
 * @property {number} unitCost - Costo unitario del lote
 * @property {string} productId - ID del producto padre
 */

/**
 * Resultado del cálculo de deducciones
 * @typedef {Object} DeductionPlan
 * @property {BatchDeduction[]} deductions - Array de deducciones por lote
 * @property {number} totalCost - Costo total calculado
 * @property {number} remainingQty - Cantidad restante no cubierta (0 si éxito)
 */

/**
 * Ordena lotes según la estrategia de selección.
 * FEFO: First Expired, First Out (por fecha de caducidad)
 * FIFO: First In, First Out (por fecha de creación)
 * 
 * @private
 * @param {Array} batches - Lotes disponibles
 * @param {BatchSelectionMode} mode - Modo de selección
 * @returns {Array} Lotes ordenados
 */
const sortBatchesByStrategy = (batches, mode) => {
    const isFEFO = mode === 'FEFO' || mode === 'STRICT' || mode === 'SHELF_LIFE';

    return [...batches].sort((left, right) => {
        if (isFEFO) {
            // FEFO: Priorizar por fecha de caducidad (más cercana primero)
            const leftExp = left.alertTargetDate || left.expiryDate;
            const rightExp = right.alertTargetDate || right.expiryDate;
            
            if (leftExp && rightExp) {
                const leftTime = new Date(leftExp).getTime();
                const rightTime = new Date(rightExp).getTime();
                if (leftTime !== rightTime) {
                    return leftTime - rightTime;
                }
            }
            
            // Si solo uno tiene fecha de caducidad, ese va primero
            if (leftExp || rightExp) {
                return leftExp ? -1 : 1;
            }
        }
        
        // FIFO: Por fecha de creación (más antiguo primero)
        const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return leftCreated - rightCreated;
    });
};

/**
 * Calcula el stock disponible real de un lote (stock - committedStock).
 * 
 * @private
 * @param {Object} batch - Lote a evaluar
 * @returns {number} Stock disponible
 */
const getAvailableStock = (batch) => {
    if (!batch) return 0;
    const stock = Number(batch.stock) || 0;
    const committed = Number(batch.committedStock) || 0;
    return Math.max(0, stock - committed);
};

/**
 * Función pura sin side-effects. Retorna un plan de deducción exacto.
 * 
 * CRÍTICO: Esta función NO modifica los lotes. Solo calcula cuánto se 
 * debe deducir de cada uno. La ejecución real debe hacerse atómicamente 
 * en la base de datos usando este plan exacto.
 * 
 * @param {number} requestedQty - Cantidad solicitada
 * @param {Array} availableBatches - Lotes disponibles con stock
 * @param {BatchSelectionMode} mode - Modo de selección ('FEFO' o 'FIFO')
 * @returns {DeductionPlan} Plan de deducciones
 * @throws {Error} Si no hay stock suficiente
 * 
 * @example
 * const plan = calculateBatchDeductions(10, batches, 'FEFO');
 * // plan = {
 * //   deductions: [
 * //     { batchId: 'batch-1', qty: 5, unitCost: 10.50, productId: 'prod-1' },
 * //     { batchId: 'batch-2', qty: 5, unitCost: 11.00, productId: 'prod-1' }
 * //   ],
 * //   totalCost: 107.50,
 * //   remainingQty: 0
 * // }
 */
export const calculateBatchDeductions = (requestedQty, availableBatches, mode = 'FEFO') => {
    // Validaciones de entrada
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        throw new Error(`Cantidad solicitada inválida: ${requestedQty}`);
    }
    
    if (!Array.isArray(availableBatches)) {
        throw new Error("availableBatches debe ser un array");
    }

    // Filtrar solo lotes activos con stock disponible
    const eligibleBatches = availableBatches.filter(batch => {
        const isActive = batch.isActive !== false && batch.status !== 'inactive';
        const hasStock = getAvailableStock(batch) > 0;
        return isActive && hasStock;
    });

    // Ordenar según estrategia
    const sortedBatches = sortBatchesByStrategy(eligibleBatches, mode);

    let remaining = requestedQty;
    const deductions = [];
    let totalCost = 0;

    for (const batch of sortedBatches) {
        if (remaining <= 0) break;
        
        const availableStock = getAvailableStock(batch);
        if (availableStock <= 0) continue;

        const deductQty = Math.min(availableStock, remaining);
        const unitCost = Number(batch.cost) || 0;
        
        deductions.push({
            batchId: batch.id,
            qty: deductQty,
            unitCost: unitCost,
            productId: batch.productId
        });
        
        totalCost += deductQty * unitCost;
        remaining -= deductQty;
    }

    // Si quedó cantidad por cubrir, lanzar error
    if (remaining > 0.0001) {
        const availableTotal = eligibleBatches.reduce(
            (sum, b) => sum + getAvailableStock(b), 0
        );
        throw new Error(
            `Stock insuficiente para el cálculo de lote. ` +
            `Solicitado: ${requestedQty}, Disponible: ${availableTotal}, ` +
            `Faltante: ${remaining}`
        );
    }

    return {
        deductions,
        totalCost: Math.round(totalCost * 100) / 100, // Redondear a 2 decimales
        remainingQty: 0
    };
};

/**
 * Calcula deducciones para múltiples productos en una sola operación.
 * Útil para tickets de venta con múltiples ítems.
 * 
 * @param {Array} items - Ítems a procesar
 * @param {Map<string, Array>} batchesByProduct - Mapa de productId -> lotes
 * @param {Object} strategies - Mapa de productId -> modo de selección
 * @returns {Map<string, DeductionPlan>} Planes de deducción por producto
 */
export const calculateMultiProductDeductions = (items, batchesByProduct, strategies = {}) => {
    const results = new Map();
    const errors = [];

    for (const item of items) {
        const productId = item.productId || item.id;
        const quantity = Number(item.quantity) || 0;
        
        if (quantity <= 0) continue;
        
        const batches = batchesByProduct.get(productId) || [];
        const mode = strategies[productId] || 'FEFO';
        
        try {
            const plan = calculateBatchDeductions(quantity, batches, mode);
            results.set(productId, plan);
        } catch (error) {
            errors.push({
                productId,
                productName: item.name,
                error: error.message
            });
        }
    }

    if (errors.length > 0) {
        const errorMsg = errors.map(e => `${e.productName}: ${e.error}`).join('; ');
        throw new Error(`Errores en cálculo de deducciones: ${errorMsg}`);
    }

    return results;
};

/**
 * Valida si hay stock suficiente sin calcular el plan completo.
 * Útil para validaciones previas a la venta.
 * 
 * @param {number} requestedQty - Cantidad solicitada
 * @param {Array} availableBatches - Lotes disponibles
 * @returns {Object} Resultado de validación
 */
export const validateBatchAvailability = (requestedQty, availableBatches) => {
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        return { ok: false, error: 'Cantidad inválida' };
    }

    const availableStock = availableBatches
        .filter(b => b.isActive !== false)
        .reduce((sum, b) => sum + getAvailableStock(b), 0);

    if (availableStock < requestedQty) {
        return {
            ok: false,
            error: `Stock insuficiente: ${availableStock} disponible, ${requestedQty} solicitado`,
            available: availableStock,
            requested: requestedQty,
            deficit: requestedQty - availableStock
        };
    }

    return {
        ok: true,
        available: availableStock,
        requested: requestedQty
    };
};

/**
 * Calcula el costo promedio ponderado basado en un plan de deducciones.
 * 
 * @param {DeductionPlan} plan - Plan de deducciones
 * @returns {number} Costo promedio unitario
 */
export const calculateWeightedAverageCost = (plan) => {
    if (!plan || !plan.deductions || plan.deductions.length === 0) {
        return 0;
    }
    
    const totalQty = plan.deductions.reduce((sum, d) => sum + d.qty, 0);
    if (totalQty === 0) return 0;
    
    return plan.totalCost / totalQty;
};
