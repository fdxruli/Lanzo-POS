/**
 * Actualizaciones de productos con transaccionalidad atómica.
 * 
 * FASE 3: Transaccionalidad Atómica en Purgas
 * Separar la intención del usuario de la ejecución en la base de datos es una 
 * falla de diseño crítica. La UI debe enviar la intención y Dexie debe ejecutarla 
 * dentro del scope de una sola transacción ACID.
 */

import { db, STORES } from './dexie';
import { buildBatchPayload } from '../../utils/buildBatchPayload';
import Logger from '../Logger';

/**
 * Tipos de intención soportados
 * @typedef {'MAINTAIN'|'PURGE_BATCHES'|'ARCHIVE_BATCHES'} UpdateIntent
 */

/**
 * Actualiza un producto y sus lotes de forma atómica.
 * 
 * El payload puede incluir `_intent` para operaciones especiales:
 * - 'MAINTAIN': Actualización normal del producto (default)
 * - 'PURGE_BATCHES': Cambió de STRICT a NONE, purgar fechas de lotes
 * - 'ARCHIVE_BATCHES': Archivar lotes vencidos
 * 
 * @param {string} id - ID del producto
 * @param {Object} data - Datos de actualización
 * @param {UpdateIntent} [data._intent='MAINTAIN'] - Intención de la operación
 * @returns {Promise<Object>} Resultado de la operación
 * @throws {Error} Si la transacción falla
 * 
 * @example
 * // Cambiar modo de caducidad y purgar fechas
 * await updateProduct(productId, {
 *   expirationMode: 'NONE',
 *   _intent: 'PURGE_BATCHES'
 * });
 */
export const updateProduct = async (id, data) => {
    if (!id) {
        throw new Error('ID de producto requerido');
    }

    const { _intent = 'MAINTAIN', ...productData } = data;

    return await db.transaction('rw', 
        [db.products, db.product_batches], 
        async () => {
            // 1. Obtener producto actual para comparaciones
            const currentProduct = await db.table(STORES.MENU).get(id);
            if (!currentProduct) {
                throw new Error(`Producto ${id} no encontrado`);
            }

            let batchOperationResult = null;

            // 2. Ejecutar intención antes de actualizar el producto
            if (_intent === 'PURGE_BATCHES') {
                // Modificación en masa atómica. Si esto falla, el producto NO se actualiza.
                batchOperationResult = await executePurgeBatchExpirations(id);
            } else if (_intent === 'ARCHIVE_BATCHES') {
                batchOperationResult = await executeArchiveExpiredBatches(id);
            }

            // 3. Actualizar el producto
            const updatedProduct = {
                ...currentProduct,
                ...productData,
                updatedAt: new Date().toISOString()
            };

            await db.table(STORES.MENU).put(updatedProduct);

            Logger.info(`[updateProduct] Producto ${id} actualizado. Intent: ${_intent}`, {
                batchOperation: batchOperationResult
            });

            return {
                success: true,
                productId: id,
                intent: _intent,
                batchOperation: batchOperationResult,
                product: updatedProduct
            };
        }
    );
};

/**
 * Ejecuta la purga de fechas de caducidad de todos los lotes de un producto.
 * Usado cuando el usuario cambia el modo de caducidad a 'NONE'.
 * 
 * @private
 * @param {string} productId - ID del producto
 * @returns {Promise<Object>} Resultado de la operación
 */
const executePurgeBatchExpirations = async (productId) => {
    const batches = await db.table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .toArray();

    let updatedCount = 0;
    const updatedBatchIds = [];

    for (const batch of batches) {
        // Solo actualizar si tiene fechas que purgar
        if (batch.expiryDate || batch.alertTargetDate || batch.shelfLifeValue) {
            const updatedBatch = {
                ...batch,
                expiryDate: null,
                alertTargetDate: null,
                alertType: null,
                shelfLifeValue: null,
                shelfLifeUnit: null,
                trackingMode: 'NONE',
                updatedAt: new Date().toISOString()
            };

            await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);
            updatedCount++;
            updatedBatchIds.push(batch.id);
        }
    }

    Logger.info(`[PURGE_BATCHES] Purgadas fechas de ${updatedCount} lotes para producto ${productId}`);

    return {
        operation: 'PURGE_BATCHES',
        updatedCount,
        updatedBatchIds
    };
};

/**
 * Archiva lotes vencidos de un producto.
 * 
 * @private
 * @param {string} productId - ID del producto
 * @returns {Promise<Object>} Resultado de la operación
 */
const executeArchiveExpiredBatches = async (productId) => {
    const now = new Date().toISOString();
    
    const batches = await db.table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .toArray();

    let archivedCount = 0;
    const archivedBatchIds = [];

    for (const batch of batches) {
        const expiryDate = batch.expiryDate || batch.alertTargetDate;
        
        // Archivar si tiene fecha de caducidad pasada
        if (expiryDate && expiryDate < now && batch.isActive !== false) {
            const updatedBatch = {
                ...batch,
                isActive: false,
                status: 'expired',
                archivedAt: now,
                archivedReason: 'Vencido automáticamente',
                updatedAt: now
            };

            await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);
            archivedCount++;
            archivedBatchIds.push(batch.id);
        }
    }

    Logger.info(`[ARCHIVE_BATCHES] Archivados ${archivedCount} lotes vencidos para producto ${productId}`);

    return {
        operation: 'ARCHIVE_BATCHES',
        archivedCount,
        archivedBatchIds
    };
};

/**
 * Wrapper seguro para actualización de productos.
 * Captura errores y retorna objeto estandarizado.
 * 
 * @param {string} id - ID del producto
 * @param {Object} data - Datos de actualización
 * @returns {Promise<{success: boolean, error?: Error, data?: Object}>}
 */
export const updateProductSafe = async (id, data) => {
    try {
        const result = await updateProduct(id, data);
        return { success: true, data: result };
    } catch (error) {
        Logger.error('[updateProductSafe] Error:', error);
        return { 
            success: false, 
            error,
            message: error.message 
        };
    }
};

/**
 * Actualiza múltiples productos con el mismo modo de caducidad.
 * Útil para migraciones masivas.
 * 
 * @param {Array<string>} productIds - IDs de productos a actualizar
 * @param {Object} changes - Cambios a aplicar
 * @param {Object} options - Opciones
 * @param {number} options.batchSize - Tamaño de lote para procesamiento
 * @returns {Promise<Object>} Resumen de la operación
 */
export const bulkUpdateProducts = async (productIds, changes, options = {}) => {
    const { batchSize = 50 } = options;
    const results = {
        success: [],
        failed: [],
        total: productIds.length
    };

    // Procesar en lotes para no bloquear el hilo principal
    for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (id) => {
            try {
                const result = await updateProduct(id, changes);
                results.success.push({ id, ...result });
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }));

        // Dar chance al event loop entre lotes
        if (i + batchSize < productIds.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    Logger.info(`[bulkUpdateProducts] Completado: ${results.success.length}/${results.total} éxitos`);

    return results;
};
