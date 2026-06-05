/**
 * Construcción de payload para lotes con validación estricta.
 * 
 * FASE 2: Fechas Estrictas, UTC y Determinismo
 * Cerrar la vulnerabilidad de undefined y rechazar inputs vacíos mágicos.
 */

import { parseStrictCalendarDate } from './dateUtils';

/**
 * Construye un payload válido para un lote de producto.
 * 
 * Reglas de negocio:
 * - En modo STRICT, la fecha de caducidad es obligatoria
 * - Las fechas se normalizan a UTC sin conversiones de zona horaria
 * - Los campos undefined se convierten a null para mantener índices sanos
 * - shelfLifeValue solo se incluye si es un número positivo válido
 * 
 * @param {Object} input - Datos de entrada del lote
 * @param {string} input.trackingMode - Modo de seguimiento: 'STRICT', 'SHELF_LIFE', 'NONE'
 * @param {string} input.expiryDate - Fecha de caducidad (YYYY-MM-DD)
 * @param {number} input.shelfLifeValue - Valor de vida útil (días/meses)
 * @param {string} input.shelfLifeUnit - Unidad: 'days', 'months', 'years'
 * @param {string} input.productId - ID del producto padre
 * @param {string} input.sku - SKU del lote
 * @param {number} input.stock - Cantidad en stock
 * @param {number} input.cost - Costo unitario
 * @param {number} input.price - Precio de venta
 * @param {Object} input.attributes - Atributos de variante
 * @param {string} input.location - Ubicación física
 * @param {string} input.notes - Notas adicionales
 * @param {string} input.supplier - Proveedor
 * @param {boolean} input.trackStock - Si rastrea stock
 * @param {boolean} input.isActive - Si el lote está activo
 * @param {boolean} input.updateGlobalPrice - Si actualiza precio global
 * 
 * @returns {Object} Payload normalizado y validado
 * @throws {Error} Si hay violaciones de reglas de negocio
 */
export const buildBatchPayload = (input) => {
    if (!input || typeof input !== 'object') {
        throw new Error("Input inválido: se requiere un objeto de datos");
    }

    // Validación: En modo STRICT, la fecha de caducidad es obligatoria
    if (input.trackingMode === 'STRICT' && !input.expiryDate) {
        throw new Error("La fecha de caducidad es obligatoria en modo STRICT. Operación rechazada.");
    }

    // Normalizar shelfLifeValue: solo incluir si es número positivo válido
    const normalizedShelfLifeValue = (
        input.trackingMode === 'STRICT' &&
        typeof input.shelfLifeValue === 'number' &&
        !Number.isNaN(input.shelfLifeValue) &&
        input.shelfLifeValue > 0
    ) ? input.shelfLifeValue : null;

    // Normalizar shelfLifeUnit
    const normalizedShelfLifeUnit = (
        normalizedShelfLifeValue !== null &&
        ['days', 'months', 'years'].includes(input.shelfLifeUnit)
    ) ? input.shelfLifeUnit : null;

    // Parsear fecha estrictamente (evita conversiones de zona horaria)
    let normalizedExpiryDate = null;
    if (input.trackingMode === 'STRICT' && input.expiryDate) {
        normalizedExpiryDate = parseStrictCalendarDate(input.expiryDate);
    }

    // Campos numéricos con valores por defecto seguros
    const normalizedStock = Math.max(0, Number(input.stock) || 0);
    const normalizedCost = Math.max(0, Number(input.cost) || 0);
    const normalizedPrice = Math.max(0, Number(input.price) || 0);
    const normalizedCommittedStock = Math.max(0, Number(input.committedStock) || 0);

    // Normalizar strings (undefined -> null para índices sanos)
    const normalizeString = (value) => {
        if (value === undefined || value === null) return null;
        const str = String(value).trim();
        return str.length > 0 ? str : null;
    };

    // Construir payload normalizado
    const payload = {
        // Identificación
        id: input.id || `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId: normalizeString(input.productId),
        
        // Datos de inventario
        stock: normalizedStock,
        committedStock: normalizedCommittedStock,
        cost: normalizedCost,
        price: normalizedPrice,
        
        // Identificación de lote
        sku: normalizeString(input.sku),
        manufacturerBatchId: normalizeString(input.manufacturerBatchId),
        
        // Fechas y caducidad (FASE 2: UTC determinista)
        trackingMode: input.trackingMode || 'NONE',
        expiryDate: normalizedExpiryDate,
        shelfLifeValue: normalizedShelfLifeValue,
        shelfLifeUnit: normalizedShelfLifeUnit,
        
        // Alertas (derivadas de expiryDate si existe)
        alertTargetDate: normalizedExpiryDate,
        alertType: normalizedExpiryDate ? 'CADUCIDAD_LEGAL' : null,
        
        // Atributos de variante
        attributes: input.attributes && Object.keys(input.attributes).length > 0 
            ? input.attributes 
            : null,
        
        // Metadata
        location: normalizeString(input.location),
        notes: normalizeString(input.notes),
        supplier: normalizeString(input.supplier),
        
        // Flags de control
        trackStock: input.trackStock !== false,
        isActive: input.isActive !== false,
        status: input.isActive !== false ? 'active' : 'inactive',
        isArchived: input.isArchived === true,
        updateGlobalPrice: input.updateGlobalPrice === true,
        
        // Timestamps
        createdAt: input.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Validaciones cruzadas post-normalización
    if (payload.trackingMode === 'STRICT' && !payload.expiryDate) {
        throw new Error("NORMALIZATION_ERROR: La fecha de caducidad se perdió durante la normalización");
    }

    if (!payload.productId) {
        throw new Error("VALIDATION_ERROR: productId es obligatorio");
    }

    return payload;
};

/**
 * Actualiza un payload de lote existente respetando reglas de transición.
 * 
 * @param {Object} existing - Lote existente en la base de datos
 * @param {Object} updates - Cambios a aplicar
 * @returns {Object} Payload fusionado y validado
 */
export const updateBatchPayload = (existing, updates) => {
    if (!existing || !existing.id) {
        throw new Error("Se requiere el lote existente para actualizar");
    }

    // Fusionar datos existentes con actualizaciones
    const mergedInput = {
        ...existing,
        ...updates,
        // Preservar campos inmutables
        id: existing.id,
        productId: existing.productId,
        createdAt: existing.createdAt
    };

    // Si se está cambiando de modo STRICT a NONE, purgar fechas
    if (existing.trackingMode === 'STRICT' && updates.trackingMode === 'NONE') {
        mergedInput.expiryDate = null;
        mergedInput.shelfLifeValue = null;
        mergedInput.shelfLifeUnit = null;
        mergedInput.alertTargetDate = null;
        mergedInput.alertType = null;
    }

    return buildBatchPayload(mergedInput);
};
