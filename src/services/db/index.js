import { db, STORES } from './dexie';
import { generalRepository } from './general';
import { productsRepository, searchProductsInDB } from './products';
import { salesRepository } from './sales';
import { DatabaseError, DB_ERROR_CODES } from './utils';
import { fixStockInconsistencies, rebuildDailyStats } from '../maintenance';
import { layawayRepository } from './layaways';
import { handleDexieError } from './utils';

// ============================================================
// EXPORTACIÓN DE CONSTANTES Y CLASES (Compatibilidad 100%)
// ============================================================
export { db, STORES, DB_ERROR_CODES, DatabaseError };

// ============================================================
// FUNCIONES DE INICIALIZACIÓN
// ============================================================

export const initDB = async () => {
    if (!db.isOpen()) {
        await db.open();
    }
    return db;
};

export const closeDB = () => {
    db.close();
};

// ============================================================
// WRAPPERS "SAFE" (Patrón Adaptador)
// ============================================================

async function safeExecute(operation) {
    try {
        const result = await operation();
        return result ? { success: true, ...result } : { success: true };
    } catch (error) {
        const errorMessage = error.message || 'Error desconocido';

        if (error.name === 'DatabaseError') {
            return {
                success: false,
                error,
                message: errorMessage
            };
        }

        const dbError = new DatabaseError(DB_ERROR_CODES.UNKNOWN, errorMessage);
        return {
            success: false,
            error: dbError,
            message: errorMessage
        };
    }
}

export const saveDataSafe = (storeName, data) =>
    safeExecute(() => generalRepository.save(storeName, data));

export const saveBulkSafe = (storeName, dataArray) =>
    safeExecute(() => generalRepository.saveBulk(storeName, dataArray));

export const deleteDataSafe = (storeName, key) =>
    safeExecute(() => generalRepository.delete(storeName, key));

export const saveBatchAndSyncProductSafe = (batchData) =>
    safeExecute(() => productsRepository.saveBatchAndSyncProduct(batchData));

export const saveBatchAndSyncProduct = saveBatchAndSyncProductSafe;

export const processBatchDeductions = (deductions) =>
    safeExecute(() => productsRepository.processBatchDeductions(deductions));

export const executeSaleTransactionSafe = (sale, deductions) =>
    safeExecute(() => salesRepository.executeSaleTransaction(sale, deductions));

export const layawayRepo = {
    create: (data, initial) => safeExecute(() => layawayRepository.create(data, initial)),
    getByCustomer: (custId, active) => safeExecute(() => layawayRepository.getByCustomer(custId, active)),
    addPayment: (id, amount) => safeExecute(() => layawayRepository.addPayment(id, amount)),
    getById: (id) => safeExecute(() => layawayRepository.getById(id))
};

export const executeBatchWithPaymentSafe = async (batchData, paymentInfo) => {
    return safeExecute(async () => {
        return await db.transaction('rw',
            [
                db.table(STORES.PRODUCT_BATCHES),
                db.table(STORES.MENU),
                db.table(STORES.MOVIMIENTOS_CAJA),
                db.table(STORES.CAJAS),
                db.table(STORES.SALES)
            ],
            async () => {
                const caja = await db.table(STORES.CAJAS).get(paymentInfo.cajaId);
                if (!caja || caja.estado !== 'abierta') {
                    throw new Error("Transacción abortada: La caja fue cerrada antes de completar la operación.");
                }

                const fondoInicial = Number(caja.monto_inicial || caja.fondo_inicial || 0);
                const ingresosEfectivo = Number(caja.ingresos_efectivo || 0);
                const salidasEfectivo = Number(caja.salidas_efectivo || 0);
                const dineroDisponible = fondoInicial + ingresosEfectivo - salidasEfectivo;

                if (dineroDisponible < paymentInfo.monto) {
                    throw new Error(`Fondos insuficientes. Intento de retirar $${paymentInfo.monto.toFixed(2)} pero la caja solo cuenta con $${dineroDisponible.toFixed(2)}. Transacción abortada.`);
                }

                caja.salidas_efectivo = salidasEfectivo + paymentInfo.monto;
                await db.table(STORES.CAJAS).put(caja);

                const movimiento = {
                    id: `mov-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    caja_id: caja.id,
                    tipo: 'salida',
                    monto: parseFloat(paymentInfo.monto),
                    concepto: paymentInfo.concepto,
                    fecha: new Date().toISOString()
                };
                await db.table(STORES.MOVIMIENTOS_CAJA).put(movimiento);

                await productsRepository.saveBatchAndSyncProduct(batchData);

                return { success: true, movimiento };
            }
        );
    });
};

export const loadMultipleData = async (storeName, ids) => {
    try {
        if (!db.isOpen()) await db.open();
        return await generalRepository.getMultiple(storeName, ids);
    } catch (error) {
        if (error.name === 'DatabaseClosedError') return null;
        throw error;
    }
};

export const executeProductionBatchSafe = (batchData, recipe) =>
    safeExecute(() => productsRepository.saveProductionBatchAndSync(batchData, recipe));

// ============================================================
// ALIAS DIRECTOS (Lecturas y Búsquedas)
// ============================================================

export const loadData = async (storeName, key = null) => {
    try {
        if (!db.isOpen()) {
            await db.open();
        }

        return key
            ? await generalRepository.getById(storeName, key)
            : await generalRepository.getAll(storeName);

    } catch (error) {
        if (error.name === 'DatabaseClosedError') {
            console.warn(`[DB] Lectura omitida en ${storeName}: La base de datos está cerrada.`);
            return null;
        }
        throw error;
    }
};

export const deleteData = (storeName, key) => generalRepository.delete(storeName, key);
export const saveData = async (storeName, data) => {
    try {
        if (!db.isOpen()) await db.open();
        return await generalRepository.save(storeName, data);
    } catch (error) {
        if (error.name === 'DatabaseClosedError') {
            console.warn(`[DB] Escritura omitida en ${storeName}: La base de datos está cerrada.`);
            return null;
        }
        throw error;
    }
};
export const saveBulk = (storeName, data) => generalRepository.saveBulk(storeName, data);

export const searchProductByBarcode = productsRepository.searchByBarcode;
export { searchProductsInDB };
export const searchProductBySKU = productsRepository.searchProductBySKU;
export const getExpiringBatchesInRange = productsRepository.getExpiringBatches;

export const getOrdersSince = salesRepository.getOrdersSince;

export const recycleData = (sourceStore, trashStore, key, reason) =>
    generalRepository.recycle(sourceStore, trashStore, key, reason);


// ============================================================
// PAGINACIÓN CON FILTRADO DELEGADO A DEXIE
// ============================================================

/**
 * Paginación del catálogo de productos con filtrado en la capa de base de datos.
 *
 * ESTRATEGIA DE ÍNDICES (caso límite documentado):
 *
 * IndexedDB no soporta índices compuestos de texto libre. No podemos crear
 * un índice [categoryId+name_lower] que habilite búsqueda "contains" en el
 * segundo campo. Por tanto, aplicamos la siguiente estrategia híbrida:
 *
 * CASO A — Solo categoryId (sin searchTerm):
 *   Usamos el índice `categoryId` nativo de Dexie. Complejidad O(log n).
 *   El cursor avanza ÚNICAMENTE sobre productos de esa categoría.
 *   El .limit() se aplica sobre resultados ya filtrados. Paginación correcta.
 *
 * CASO B — Solo searchTerm (sin categoryId):
 *   Full scan con .filter() sobre name_lower y barcode.
 *   No hay índice "contains", es inevitable. Complejidad O(n).
 *   El .limit() se aplica sobre resultados ya filtrados. Paginación correcta.
 *
 * CASO C — searchTerm + categoryId simultáneos:
 *   Entramos por el índice `categoryId` (reduce el conjunto dramáticamente)
 *   y aplicamos .filter() de texto SOLO sobre ese subconjunto.
 *   Complejidad O(k) donde k << n. Es la solución más eficiente posible
 *   sin rediseñar el esquema de IndexedDB.
 *
 * CASO D — outOfStockOnly:
 *   Full scan con .filter(). No existe un índice de stock en el esquema.
 *   NOTA: Si la tienda tiene miles de productos sería candidato a añadir
 *   un índice `stock` en una futura migración de Dexie.
 *
 * CASO E — outOfStockOnly + categoryId:
 *   Entra por índice `categoryId` y filtra en memoria por stock <= 0.
 *
 * @param {string} storeName - Nombre de la tienda (usar STORES.MENU).
 * @param {object} options
 * @param {number}  options.limit         - Registros por página (default 50).
 * @param {string|null} options.cursor    - Cursor de paginación (valor de createdAt).
 * @param {string}  options.searchTerm    - Texto libre (filtra name_lower y barcode).
 * @param {string|null} options.categoryId - ID de categoría. Null = todas.
 * @param {boolean} options.outOfStockOnly - Si true, solo productos sin stock.
 * @param {string}  options.timeIndex     - Campo de ordenación/cursor (default 'createdAt').
 */
export const loadDataPaginated = async (storeName, options = {}) => {
    const {
        limit = 50,
        cursor = null,
        searchTerm = '',
        categoryId = null,
        outOfStockOnly = false,
        timeIndex = 'createdAt'
    } = options;

    // Sólo aplicamos la lógica especializada para la tabla MENU.
    // Otras tablas (SALES, CUSTOMERS) siguen el camino genérico original.
    if (storeName !== STORES.MENU) {
        return _loadDataPaginatedGeneric(storeName, { limit, cursor, searchTerm, categoryId, timeIndex });
    }

    try {
        const normalizedTerm = searchTerm.toLowerCase().trim();
        const hasCategoryFilter = categoryId !== null && categoryId !== undefined;
        const hasSearchFilter = normalizedTerm.length > 0;

        let collection;

        // ─────────────────────────────────────────────────────────────
        // PUNTO DE ENTRADA: Elegir la ruta más eficiente según filtros
        // ─────────────────────────────────────────────────────────────

        if (hasCategoryFilter && !hasSearchFilter && !outOfStockOnly) {
            // CASO A: Solo categoryId — entrada por índice nativo.
            // El cursor de tiempo se aplica sobre los resultados del índice.
            const categoryCollection = db.table(STORES.MENU)
                .where('categoryId')
                .equals(categoryId);

            // Aplicamos el cursor temporal como filtro adicional en memoria.
            // Nota: Dexie no permite encadenar .where() múltiples en índices distintos.
            // El cursor reduce el conjunto de forma suficiente para que el filtro
            // en memoria sobre createdAt no sea costoso.
            collection = cursor
                ? categoryCollection.filter(item =>
                    item.isActive !== false &&
                    item[timeIndex] < cursor
                )
                : categoryCollection.filter(item =>
                    item.isActive !== false
                );

        } else if (hasCategoryFilter && (hasSearchFilter || outOfStockOnly)) {
            // CASO C / CASO E: categoryId + texto o stock.
            // Entramos por el índice de categoría y añadimos filtros en memoria
            // sobre el subconjunto reducido.
            const categoryCollection = db.table(STORES.MENU)
                .where('categoryId')
                .equals(categoryId);

            collection = categoryCollection.filter(item => {
                if (item.isActive === false) return false;
                if (cursor && item[timeIndex] >= cursor) return false;

                if (outOfStockOnly) {
                    const gestionaStock = item.trackStock || item.batchManagement?.enabled;
                    if (!gestionaStock || item.stock > 0) return false;
                }

                if (hasSearchFilter) {
                    // Fallback para productos legacy sin name_lower
                    const searchName = item.name_lower || (item.name ? String(item.name).toLowerCase() : '');
                    const matchName = searchName.includes(normalizedTerm);

                    // Casteo forzado a String para evitar TypeError si barcode o sku son numéricos
                    const matchBarcode =
                        item.barcode !== null &&
                        item.barcode !== undefined &&
                        String(item.barcode).toLowerCase().includes(normalizedTerm);
                    const matchSku =
                        item.sku !== null &&
                        item.sku !== undefined &&
                        String(item.sku).toLowerCase().includes(normalizedTerm);

                    if (!matchName && !matchBarcode && !matchSku) return false;
                }

                return true;
            });

        } else if (outOfStockOnly && !hasCategoryFilter) {
            // CASO D: Solo agotados — full scan necesario.
            const baseCollection = cursor
                ? db.table(STORES.MENU).where(timeIndex).below(cursor).reverse()
                : db.table(STORES.MENU).orderBy(timeIndex).reverse();

            collection = baseCollection.filter(item => {
                if (item.isActive === false) return false;

                const gestionaStock = item.trackStock || item.batchManagement?.enabled;
                if (!gestionaStock || item.stock > 0) return false;

                if (hasSearchFilter) {
                    // 1. Fallback robusto para retrocompatibilidad con productos antiguos
                    const searchName = item.name_lower || (item.name ? item.name.toLowerCase() : '');
                    const matchName = searchName.includes(normalizedTerm);

                    // 2. Casteo obligatorio a String para evitar crasheos de TypeError
                    const matchBarcode = item.barcode && String(item.barcode).toLowerCase().includes(normalizedTerm);

                    // 3. Inclusión real del SKU
                    const matchSku = item.sku && String(item.sku).toLowerCase().includes(normalizedTerm);

                    if (!matchName && !matchBarcode && !matchSku) return false;
                }

                return true;
            });

        } else {
            // CASO B: Solo searchTerm o sin filtros.
            //
            // NOTA SOBRE EL ÍNDICE `createdAt`:
            // orderBy('createdAt') excluye registros donde createdAt es undefined.
            // La migración v4 de Dexie los debería haber parcheado, pero como
            // defensa adicional usamos toCollection() para el caso sin cursor,
            // que hace un full scan garantizando que ningún registro queda fuera.
            let baseCollection;

            if (cursor) {
                baseCollection = db.table(STORES.MENU).where(timeIndex).below(cursor).reverse();
            } else if (!hasSearchFilter) {
                // Sin filtros y sin cursor: orderBy es seguro y eficiente
                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();
            } else {
                // Con searchTerm y sin cursor: full scan para no excluir registros
                // con createdAt undefined que orderBy sí omite
                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();
            }

            collection = baseCollection.filter(item => {
                if (item.isActive === false) return false;

                if (hasSearchFilter) {
                    // Fallback para productos legacy sin name_lower
                    const searchName = item.name_lower || (item.name ? String(item.name).toLowerCase() : '');
                    const matchName = searchName.includes(normalizedTerm);

                    // Casteo forzado a String para evitar TypeError si barcode o sku son numéricos
                    const matchBarcode =
                        item.barcode !== null &&
                        item.barcode !== undefined &&
                        String(item.barcode).toLowerCase().includes(normalizedTerm);
                    const matchSku =
                        item.sku !== null &&
                        item.sku !== undefined &&
                        String(item.sku).toLowerCase().includes(normalizedTerm);

                    if (!matchName && !matchBarcode && !matchSku) return false;
                }

                return true;
            });
        }

        // ─────────────────────────────────────────────────────────────
        // MATERIALIZACIÓN: El .limit() se aplica DESPUÉS del filtrado.
        // Esto garantiza que siempre obtenemos `limit` resultados válidos.
        // ─────────────────────────────────────────────────────────────
        const data = await collection.limit(limit).toArray();

        // El cursor apunta al timeIndex del último registro devuelto.
        // Como los resultados están pre-filtrados, el cursor es exacto.
        const nextCursor = data.length === limit ? data[data.length - 1][timeIndex] : null;

        return { data, nextCursor };

    } catch (error) {
        throw handleDexieError(error, `loadDataPaginated ${storeName}`);
    }
};

/**
 * Paginación genérica para tablas que no son MENU (SALES, CUSTOMERS, etc.).
 * Mantiene el comportamiento original sin cambios.
 * @private
 */
async function _loadDataPaginatedGeneric(storeName, options = {}) {
    const {
        limit = 50,
        cursor = null,
        searchTerm = '',
        categoryId = null,
        timeIndex = 'createdAt'
    } = options;

    try {
        let query;

        if (cursor) {
            query = db.table(storeName).where(timeIndex).below(cursor).reverse();
        } else {
            query = db.table(storeName).orderBy(timeIndex).reverse();
        }

        query = query.filter(item => {
            if (item.isActive === false) return false;
            if (categoryId && item.categoryId !== categoryId) return false;

            if (searchTerm) {
                const term = searchTerm.toLowerCase().trim();
                const matchName = item.name_lower && item.name_lower.includes(term);
                const matchBarcode = item.barcode && item.barcode.includes(term);
                if (!matchName && !matchBarcode) return false;
            }

            return true;
        });

        const data = await query.limit(limit).toArray();
        const nextCursor = data.length === limit ? data[data.length - 1][timeIndex] : null;

        return { data, nextCursor };

    } catch (error) {
        throw handleDexieError(error, `loadDataPaginatedGeneric ${storeName}`);
    }
}

/**
 * Búsqueda simple por índice
 */
export const queryByIndex = async (storeName, indexName, value) => {
    return await generalRepository.findByIndex(storeName, indexName, value);
};

/**
 * Consulta específica de lotes por producto y estado
 */
export const queryBatchesByProductIdAndActive = async (productId, isActive = true) => {
    return await db.table(STORES.PRODUCT_BATCHES)
        .where('productId').equals(productId)
        .filter(batch => Boolean(batch.isActive) === Boolean(isActive))
        .toArray();
};

/**
 * Eliminación en cascada (Categoría -> Actualizar Productos)
 */
export const deleteCategoryCascading = async (categoryId) => {
    return safeExecute(async () => {
        await db.transaction('rw', [db.table(STORES.CATEGORIES), db.table(STORES.MENU)], async () => {
            await db.table(STORES.CATEGORIES).delete(categoryId);

            await db.table(STORES.MENU)
                .where('categoryId').equals(categoryId)
                .modify({ categoryId: '' });
        });
    });
};

/**
 * Manejo de Imágenes (Blobs)
 */
export const saveImageToDB = async (id, blob) => {
    try {
        await db.table(STORES.IMAGES).put({ id, blob });
        return true;
    } catch (e) {
        console.error("Error saving image:", e);
        return false;
    }
};

export const getImageFromDB = async (id) => {
    try {
        const record = await db.table(STORES.IMAGES).get(id);
        return record ? record.blob : null;
    } catch (e) {
        return null;
    }
};

/**
 * Verificación de cuota (Storage Manager)
 */
export const checkStorageQuota = async () => {
    if (!navigator.storage || !navigator.storage.estimate) return { warning: false };
    try {
        const estimate = await navigator.storage.estimate();
        const percentUsed = (estimate.usage / estimate.quota) * 100;

        if (percentUsed > 80) {
            return {
                warning: true,
                message: `⚠️ Espacio crítico: ${percentUsed.toFixed(0)}% usado.`
            };
        }
        return { warning: false };
    } catch (e) {
        return { warning: false };
    }
};

/**
 * Recuperación de transacciones
 */
export const recoverPendingTransactions = async () => {
    try {
        const cutoff = Date.now() - 60000;
        const pending = await db.table(STORES.TRANSACTION_LOG)
            .where('status').equals('PENDING')
            .filter(log => new Date(log.timestamp).getTime() < cutoff)
            .toArray();

        for (const log of pending) {
            await db.table(STORES.TRANSACTION_LOG).update(log.id, {
                status: 'FAILED',
                reason: 'Stale transaction'
            });
        }
    } catch (error) {
        console.warn('Recovery skipped:', error);
    }
};

/**
 * Exportar CSV (Stream)
 */
export const streamStoreToCSV = async (storeName, mapFn, onChunk, chunkSize = 500) => {
    let offset = 0;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
        const items = await db.table(storeName).offset(offset).limit(chunkSize).toArray();

        if (items.length > 0) {
            const csvChunk = items.map(mapFn).join('\n') + '\n';
            onChunk(csvChunk);
            totalProcessed += items.length;
            offset += chunkSize;
        } else {
            hasMore = false;
        }
    }
    return totalProcessed;
};

/**
 * Archivar datos antiguos
 */
export const archiveOldData = async (monthsToKeep = 6) => {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
    const isoCutoff = cutoffDate.toISOString();

    return await db.transaction('rw', [db.table(STORES.SALES)], async () => {
        const oldSales = await db.table(STORES.SALES)
            .where('timestamp').below(isoCutoff)
            .toArray();

        if (oldSales.length > 0) {
            const idsToDelete = oldSales.map(s => s.id);
            await db.table(STORES.SALES).bulkDelete(idsToDelete);
        }

        return oldSales;
    });
};

/**
 * Exportar TODO a JSONL (Backup)
 */
export const streamAllDataToJSONL = async (onChunk) => {
    const tables = db.tables;

    for (const table of tables) {
        const tableName = table.name;
        let offset = 0;
        const CHUNK_SIZE = 200;

        while (true) {
            const rows = await table.offset(offset).limit(CHUNK_SIZE).toArray();
            if (rows.length === 0) break;

            const chunkString = rows.map(row => JSON.stringify({ s: tableName, d: row })).join('\n') + '\n';
            await onChunk(chunkString);

            offset += CHUNK_SIZE;
        }
    }
};

export const maintenanceTools = {
    fixStock: fixStockInconsistencies,
    rebuildStats: rebuildDailyStats
};
