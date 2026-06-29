/**
 * Motor de Asignación Puro para Deducciones de Lotes.
 * 
 * FASE 4: Consistencia Contable (Single Source of Truth para Lotes)
 * El Kiosco no puede calcular el costo usando la función A mientras la base de 
 * datos descuenta lotes usando la función B. Esta función pura retorna un plan 
 * de deducción exacto que debe ser usado tanto en UI como en persistencia.
 *
 * FASE CAD.1: los productos STRICT no pueden vender lotes vencidos.
 */

import { isBatchExpiredForSale } from '../utils/dateUtils';

/**
 * Estrategia de selección de lotes
 * @typedef {'FEFO'|'FIFO'|'STRICT'|'SHELF_LIFE'} BatchSelectionMode
 */

const EPSILON = 0.0001;

const createInventoryStrategyError = (code, message, metadata = {}) => {
    const error = new Error(message);
    error.code = code;
    error.metadata = metadata;
    return error;
};

const isActiveBatch = (batch) => batch?.isActive !== false && batch?.status !== 'inactive';

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
            const leftExp = left.alertTargetDate || left.expiryDate;
            const rightExp = right.alertTargetDate || right.expiryDate;
            
            if (leftExp && rightExp) {
                const leftTime = new Date(leftExp).getTime();
                const rightTime = new Date(rightExp).getTime();
                if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
                    return leftTime - rightTime;
                }
            }
            
            if (leftExp || rightExp) {
                return leftExp ? -1 : 1;
            }
        }
        
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
    const committed = Number(batch.committedStock ?? batch.committed_stock) || 0;
    return Math.max(0, stock - committed);
};

const splitEligibleBatches = (availableBatches = [], options = {}) => {
    const {
        product = null,
        excludeExpiredStrict = true,
        now = new Date()
    } = options || {};

    const activeStockBatches = availableBatches.filter((batch) => isActiveBatch(batch) && getAvailableStock(batch) > 0);

    if (!excludeExpiredStrict || (product?.expirationMode || product?.expiration_mode) !== 'STRICT') {
        return {
            eligibleBatches: activeStockBatches,
            expiredStrictBatches: []
        };
    }

    const expiredStrictBatches = activeStockBatches.filter((batch) => isBatchExpiredForSale(batch, product, now));
    const eligibleBatches = activeStockBatches.filter((batch) => !isBatchExpiredForSale(batch, product, now));

    return { eligibleBatches, expiredStrictBatches };
};

const sumAvailableStock = (batches = []) => batches.reduce((sum, batch) => sum + getAvailableStock(batch), 0);

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
 * @param {Object} options Opciones CAD.1
 * @returns {Object} Plan de deducciones
 * @throws {Error} Si no hay stock suficiente
 */
export const calculateBatchDeductions = (requestedQty, availableBatches, mode = 'FEFO', options = {}) => {
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        throw createInventoryStrategyError('INVALID_BATCH_REQUEST_QUANTITY', `Cantidad solicitada inválida: ${requestedQty}`);
    }
    
    if (!Array.isArray(availableBatches)) {
        throw createInventoryStrategyError('INVALID_BATCH_LIST', 'availableBatches debe ser un array');
    }

    const { eligibleBatches, expiredStrictBatches } = splitEligibleBatches(availableBatches, options);
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
            unitCost,
            productId: batch.productId ?? batch.product_id
        });
        
        totalCost += deductQty * unitCost;
        remaining -= deductQty;
    }

    if (remaining > EPSILON) {
        const availableTotal = sumAvailableStock(eligibleBatches);
        const expiredAvailableTotal = sumAvailableStock(expiredStrictBatches);
        const product = options?.product || null;
        const code = expiredAvailableTotal > 0 ? 'INSUFFICIENT_NON_EXPIRED_STOCK' : 'INSUFFICIENT_BATCH_STOCK';
        const message = expiredAvailableTotal > 0
            ? 'No hay stock vigente suficiente para completar la venta. Revisa los lotes vencidos en Caducidad.'
            : `Stock insuficiente para el cálculo de lote. Solicitado: ${requestedQty}, Disponible: ${availableTotal}, Faltante: ${remaining}`;

        throw createInventoryStrategyError(code, message, {
            productId: product?.id,
            productName: product?.name,
            requestedQuantity: requestedQty,
            availableQuantity: availableTotal,
            expiredAvailableQuantity: expiredAvailableTotal,
            remainingQuantity: remaining
        });
    }

    return {
        deductions,
        totalCost: Math.round(totalCost * 100) / 100,
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
 * @param {Object} optionsByProduct - Opciones por productId
 * @returns {Map<string, Object>} Planes de deducción por producto
 */
export const calculateMultiProductDeductions = (items, batchesByProduct, strategies = {}, optionsByProduct = {}) => {
    const results = new Map();
    const errors = [];

    for (const item of items) {
        const productId = item.productId || item.id;
        const quantity = Number(item.quantity) || 0;
        
        if (quantity <= 0) continue;
        
        const batches = batchesByProduct.get(productId) || [];
        const mode = strategies[productId] || 'FEFO';
        
        try {
            const plan = calculateBatchDeductions(quantity, batches, mode, optionsByProduct[productId] || {});
            results.set(productId, plan);
        } catch (error) {
            errors.push({
                productId,
                productName: item.name,
                error: error.message,
                code: error.code
            });
        }
    }

    if (errors.length > 0) {
        const errorMsg = errors.map(e => `${e.productName}: ${e.error}`).join('; ');
        const error = createInventoryStrategyError(errors[0]?.code || 'BATCH_DEDUCTION_ERRORS', `Errores en cálculo de deducciones: ${errorMsg}`, { errors });
        throw error;
    }

    return results;
};

/**
 * Valida si hay stock suficiente sin calcular el plan completo.
 * Útil para validaciones previas a la venta.
 * 
 * @param {number} requestedQty - Cantidad solicitada
 * @param {Array} availableBatches - Lotes disponibles
 * @param {Object} options Opciones CAD.1
 * @returns {Object} Resultado de validación
 */
export const validateBatchAvailability = (requestedQty, availableBatches, options = {}) => {
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        return { ok: false, error: 'Cantidad inválida', code: 'INVALID_BATCH_REQUEST_QUANTITY' };
    }

    const { eligibleBatches, expiredStrictBatches } = splitEligibleBatches(availableBatches, options);
    const availableStock = sumAvailableStock(eligibleBatches);
    const expiredAvailableStock = sumAvailableStock(expiredStrictBatches);

    if (availableStock < requestedQty) {
        const hasExpiredBlockedStock = expiredAvailableStock > 0;
        return {
            ok: false,
            code: hasExpiredBlockedStock ? 'INSUFFICIENT_NON_EXPIRED_STOCK' : 'INSUFFICIENT_BATCH_STOCK',
            error: hasExpiredBlockedStock
                ? 'No hay stock vigente suficiente para completar la venta. Revisa los lotes vencidos en Caducidad.'
                : `Stock insuficiente: ${availableStock} disponible, ${requestedQty} solicitado`,
            available: availableStock,
            expiredAvailable: expiredAvailableStock,
            requested: requestedQty,
            deficit: requestedQty - availableStock
        };
    }

    return {
        ok: true,
        available: availableStock,
        expiredAvailable: expiredAvailableStock,
        requested: requestedQty
    };
};

/**
 * Calcula el costo promedio ponderado basado en un plan de deducciones.
 * 
 * @param {Object} plan - Plan de deducciones
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
