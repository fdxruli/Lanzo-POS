/**
 * Actualizaciones de productos con transaccionalidad atómica.
 * 
 * FASE 3: Transaccionalidad Atómica en Purgas
 * Separar la intención del usuario de la ejecución en la base de datos es una 
 * falla de diseño crítica. La UI debe enviar la intención y Dexie debe ejecutarla 
 * dentro del scope de una sola transacción ACID.
 */

import { db, STORES } from './dexie';
import { DatabaseError, DB_ERROR_CODES } from './utils';
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

    // FASE 4: Generar timestamp unificado para toda la operación
    const unifiedTimestamp = new Date().toISOString();

    // Guardia: Verificar que la BD esté abierta
    if (!db.isOpen()) {
        throw new DatabaseError(
            DB_ERROR_CODES.CONNECTION_CLOSED, 
            'Base de datos cerrada al iniciar transacción de actualización'
        );
    }

    return await db.transaction('rw', 
        [
            db.table(STORES.MENU),
            db.table(STORES.PRODUCT_BATCHES)
        ], 
        async () => {
            // 1. Obtener producto actual para comparaciones
            const currentProduct = await db.table(STORES.MENU).get(id);
            if (!currentProduct) {
                throw new Error(`Producto ${id} no encontrado`);
            }

            let batchOperationResult = null;

            // 2. Ejecutar intención PRIMERO (si falla, producto NO se actualiza)
            if (_intent === 'PURGE_BATCHES') {
                // Validación de seguridad: Solo permitir si realmente cambia a NONE
                const targetMode = productData.expirationMode;
                const currentMode = currentProduct.expirationMode;
                
                if (targetMode !== 'NONE' && currentMode !== 'NONE') {
                    throw new Error(
                        'Intent PURGE_BATCHES requiere expirationMode: NONE '
                        + `(recibido: ${targetMode}, actual: ${currentMode})`
                    );
                }
                
                // Ejecutar purga atómica con timestamp unificado
                batchOperationResult = await executePurgeBatchExpirations(
                    id, 
                    unifiedTimestamp
                );
                
                // Verificación: Si no se purgó nada pero había lotes con fechas, es warning
                if (batchOperationResult.updatedCount === 0) {
                    const batchesWithDates = await db.table(STORES.PRODUCT_BATCHES)
                        .where('productId').equals(id)
                        .filter(b => b.expiryDate !== null && b.expiryDate !== undefined)
                        .count();
                    
                    if (batchesWithDates > 0) {
                        console.warn(
                            `[PURGE] No se purgaron lotes pero existen ${batchesWithDates} con fechas`
                        );
                    }
                }
            } else if (_intent === 'ARCHIVE_BATCHES') {
                batchOperationResult = await executeArchiveExpiredBatches(id, unifiedTimestamp);
            }

            // 3. ACTUALIZAR PRODUCTO PADRE (solo si llegamos aquí = lotes OK)
            const updatedProduct = {
                ...currentProduct,
                ...productData,
                updatedAt: unifiedTimestamp // ← Timestamp unificado
            };

            await db.table(STORES.MENU).put(updatedProduct);

            // 4. LOG DE AUDITORÍA (dentro de la misma transacción)
            Logger.info(`[ATOMIC UPDATE] Producto ${id}`, {
                intent: _intent,
                batchOperation: batchOperationResult,
                timestamp: unifiedTimestamp
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
 * FASE 4: Ahora acepta timestamp unificado directo para consistencia en transacciones.
 * 
 * @private
 * @param {string} productId - ID del producto
 * @param {string} unifiedTimestamp - Timestamp unificado para toda la operación
 * @returns {Promise<Object>} Resultado de la operación
 */
const executePurgeBatchExpirations = async (productId, unifiedTimestamp) => {
    const batches = await db.table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .toArray();

    let updatedCount = 0;
    const updatedBatchIds = [];

    for (const batch of batches) {
        // FASE 4: Solo actualizar si tiene fechas que purgar
        // Usar null explícito (no undefined) para preservar índices compuestos
        if (batch.expiryDate || batch.alertTargetDate || batch.shelfLifeValue) {
            const updatedBatch = {
                ...batch,
                expiryDate: null,           // ← null explícito para índices
                alertTargetDate: null,
                alertType: null,
                shelfLifeValue: null,
                shelfLifeUnit: null,
                trackingMode: 'NONE',
                updatedAt: unifiedTimestamp // ← Timestamp unificado
            };

            await db.table(STORES.PRODUCT_BATCHES).put(updatedBatch);
            updatedCount++;
            updatedBatchIds.push(batch.id);
        }
    }

    Logger.info(
        `[PURGE_BATCHES] Purgadas fechas de ${updatedCount} lotes para producto ${productId}`
    );

    return {
        operation: 'PURGE_BATCHES',
        updatedCount,
        updatedBatchIds,
        productId,
        timestamp: unifiedTimestamp
    };
};

/**
 * Archiva lotes vencidos de un producto.
 * 
 * @private
 * @param {string} productId - ID del producto
 * @param {string} unifiedTimestamp - Timestamp unificado para operación
 * @returns {Promise<Object>} Resultado de la operación
 */
const executeArchiveExpiredBatches = async (productId, unifiedTimestamp) => {
    const now = unifiedTimestamp || new Date().toISOString();
    
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

    Logger.info(
        `[ARCHIVE_BATCHES] Archivados ${archivedCount} lotes vencidos para producto ${productId}`
    );

    return {
        operation: 'ARCHIVE_BATCHES',
        archivedCount,
        archivedBatchIds,
        productId,
        timestamp: now
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

    Logger.info(
        `[bulkUpdateProducts] Completado: ${results.success.length}/${results.total} éxitos`
    );

    return results;
};
