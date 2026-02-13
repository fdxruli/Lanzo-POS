import { db, STORES } from './dexie';
import { generalRepository } from './general';
import { productsRepository } from './products';
import { salesRepository } from './sales';
import { DatabaseError, DB_ERROR_CODES } from './utils';
import { fixStockInconsistencies, rebuildDailyStats } from '../maintenance';
import { layawayRepository } from './layaways';
import { create } from 'zustand';

// ============================================================
// EXPORTACIÓN DE CONSTANTES Y CLASES (Compatibilidad 100%)
// ============================================================
export { db, STORES, DB_ERROR_CODES, DatabaseError };

// ============================================================
// FUNCIONES DE INICIALIZACIÓN
// ============================================================

export const initDB = async () => {
    // Dexie abre la conexión automáticamente al primer uso (Lazy),
    // pero mantenemos esta función por compatibilidad.
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
// El código antiguo espera { success: true } o { success: false, error }.
// Los nuevos repositorios lanzan excepciones. Aquí hacemos el puente.
// ============================================================

async function safeExecute(operation) {
    try {
        const result = await operation();
        return result ? { success: true, ...result } : { success: true };
    } catch (error) {
        // Obtenemos el mensaje legible
        const errorMessage = error.message || 'Error desconocido';

        // Si ya es un error formateado por nuestros repositorios
        if (error.name === 'DatabaseError') {
            return {
                success: false,
                error,
                message: errorMessage // <--- AGREGA ESTO PARA COMPATIBILIDAD
            };
        }

        // Si es un error desconocido
        const dbError = new DatabaseError(DB_ERROR_CODES.UNKNOWN, errorMessage);
        return {
            success: false,
            error: dbError,
            message: errorMessage // <--- AGREGA ESTO
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
}
// ============================================================
// ALIAS DIRECTOS (Lecturas y Búsquedas)
// ============================================================

// CRUD Básico
export const loadData = async (storeName, key = null) => {
    try {
        // 1. Re-intentar abrir si está cerrada (Dexie usualmente auto-abre, 
        // pero si se llamó close() explícitamente, hay que reabrir).
        if (!db.isOpen()) {
            await db.open();
        }

        return key
            ? await generalRepository.getById(storeName, key)
            : await generalRepository.getAll(storeName);

    } catch (error) {
        // 2. Si definitivamente está cerrada o cerrándose, devolvemos null 
        // para no romper la UI.
        if (error.name === 'DatabaseClosedError') {
            console.warn(`[DB] Lectura omitida en ${storeName}: La base de datos está cerrada.`);
            return null;
        }
        throw error; // Otros errores sí los lanzamos
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

// Productos e Inventario
export const searchProductByBarcode = productsRepository.searchByBarcode;
export const searchProductsInDB = productsRepository.searchProducts; // Alias para compatibilidad
export const searchProductBySKU = productsRepository.searchProductBySKU;
export const getExpiringBatchesInRange = productsRepository.getExpiringBatches;

// Ventas
export const getOrdersSince = salesRepository.getOrdersSince;

// Papelera
export const recycleData = (sourceStore, trashStore, key, reason) =>
    generalRepository.recycle(sourceStore, trashStore, key, reason);


// ============================================================
// FUNCIONES ESPECIALES (Migradas manualmente aquí)
// ============================================================

/**
 * Paginación manual para tablas grandes
 */
export const loadDataPaginated = async (storeName, { limit = 50, offset = 0, indexName = null, direction = 'next' } = {}) => {
    let collection = db.table(storeName);

    // Si hay ordenamiento por índice
    if (indexName) {
        collection = collection.orderBy(indexName);
        if (direction === 'prev') collection = collection.reverse();
    }

    return await collection.offset(offset).limit(limit).toArray();
};

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
            // 1. Borrar categoría
            await db.table(STORES.CATEGORIES).delete(categoryId);

            // 2. Buscar productos afectados y quitarles la categoría
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
        console.error("Error saving image:", e); // <--- Usa tu Logger aquí
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
 * Recuperación de transacciones (Stub)
 * Dexie maneja la integridad automáticamente, pero dejamos esto
 * para limpiar logs viejos si es necesario.
 */
export const recoverPendingTransactions = async () => {
    try {
        // Buscar logs viejos con PENDING
        const cutoff = Date.now() - 60000; // 1 minuto atrás
        const pending = await db.table(STORES.TRANSACTION_LOG)
            .where('status').equals('PENDING')
            .filter(log => new Date(log.timestamp).getTime() < cutoff)
            .toArray();

        // Marcar como fallidas
        for (const log of pending) {
            await db.table(STORES.TRANSACTION_LOG).update(log.id, {
                status: 'FAILED',
                reason: 'Stale transaction'
            });
        }
    } catch (error) {
        Logger.warn('Recovery skipped:', error);
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

    // Usamos transacción para mover datos a un JSON en memoria y borrarlos
    return await db.transaction('rw', [db.table(STORES.SALES)], async () => {
        const oldSales = await db.table(STORES.SALES)
            .where('timestamp').below(isoCutoff)
            .toArray();

        if (oldSales.length > 0) {
            // Borrar de la BD
            const idsToDelete = oldSales.map(s => s.id);
            await db.table(STORES.SALES).bulkDelete(idsToDelete);
        }

        return oldSales; // Devolvemos para que la UI los guarde en un archivo
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
            onChunk(chunkString);

            offset += CHUNK_SIZE;
        }
    }

};

export const maintenanceTools = {
    fixStock: fixStockInconsistencies,
    rebuildStats: rebuildDailyStats
};