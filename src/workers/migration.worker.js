/**
 * Web Worker para migración segura en segundo plano.
 * 
 * FASE 5: Migración Segura y Eliminación de Memory Scans
 * Aplicar la migración por fragmentos usando "Lazy Evaluation" en lectura.
 * Al mantener los hooks de la Fase 1, cada vez que un producto viejo sea 
 * editado o vendido, adquirirá instantáneamente el atributo activeStockStatus.
 * Este worker aplica un cursor asíncrono con Limit(500) para poblar 
 * activeStockStatus en el background hasta finalizar.
 */

/* eslint-disable no-restricted-globals */

// Estado del worker
let isRunning = false;
let shouldStop = false;

/**
 * Procesa un lote de registros para agregar activeStockStatus.
 * 
 * @param {IDBDatabase} db - Instancia de base de datos
 * @param {string} storeName - Nombre de la tabla
 * @param {number} offset - Offset para paginación
 * @param {number} limit - Tamaño del lote
 * @returns {Promise<{processed: number, hasMore: boolean}>}
 */
const processBatch = async (db, storeName, offset, limit) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        
        const recordsToUpdate = [];
        let processed = 0;
        
        // Abrir cursor para iterar eficientemente
        const request = store.openCursor();
        let skipped = 0;
        let targetOffset = offset;
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            
            if (!cursor) {
                // Fin de la tabla
                resolve({ 
                    processed, 
                    hasMore: false,
                    nextOffset: offset + processed 
                });
                return;
            }
            
            // Saltar hasta el offset deseado
            if (skipped < targetOffset) {
                skipped++;
                cursor.continue();
                return;
            }
            
            // Procesar hasta el límite
            if (processed >= limit) {
                resolve({ 
                    processed, 
                    hasMore: true,
                    nextOffset: offset + processed 
                });
                return;
            }
            
            const record = cursor.value;
            
            // Verificar si ya tiene activeStockStatus
            if (record.activeStockStatus === undefined || record.activeStockStatus === null) {
                // Calcular activeStockStatus
                const isActive = record.isActive !== false;
                const hasStock = Number(record.stock) > 0;
                record.activeStockStatus = (isActive && hasStock) ? 1 : 0;
                
                // Actualizar el registro
                const updateRequest = cursor.update(record);
                updateRequest.onerror = () => {
                    console.error(`[MigrationWorker] Error actualizando ${record.id}`);
                };
                
                processed++;
            }
            
            cursor.continue();
        };
        
        request.onerror = () => {
            reject(new Error(`Error al abrir cursor en ${storeName}`));
        };
    });
};

/**
 * Ejecuta la migración completa en lotes.
 * 
 * @param {Object} config - Configuración de la migración
 * @param {string} config.dbName - Nombre de la base de datos
 * @param {number} config.version - Versión de la base de datos
 * @param {Array<string>} config.stores - Tablas a migrar
 * @param {number} config.batchSize - Tamaño de cada lote
 * @param {number} config.delayBetweenBatches - Delay en ms entre lotes
 */
const runMigration = async (config) => {
    const { 
        dbName, 
        version = 19, 
        stores = ['menu', 'product_batches'], 
        batchSize = 500,
        delayBetweenBatches = 10 
    } = config;
    
    isRunning = true;
    shouldStop = false;
    
    try {
        // Abrir conexión a IndexedDB
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, version);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('No se pudo abrir la base de datos'));
        });
        
        const results = {
            totalProcessed: 0,
            stores: {},
            startTime: Date.now(),
            endTime: null,
            error: null
        };
        
        // Procesar cada tabla
        for (const storeName of stores) {
            if (shouldStop) break;
            
            let offset = 0;
            let hasMore = true;
            let storeProcessed = 0;
            
            self.postMessage({
                type: 'STORE_START',
                store: storeName
            });
            
            while (hasMore && !shouldStop) {
                const batchResult = await processBatch(db, storeName, offset, batchSize);
                
                storeProcessed += batchResult.processed;
                offset = batchResult.nextOffset;
                hasMore = batchResult.hasMore;
                
                // Reportar progreso
                self.postMessage({
                    type: 'PROGRESS',
                    store: storeName,
                    processed: storeProcessed,
                    currentBatch: batchResult.processed
                });
                
                // Delay para no bloquear el hilo principal
                if (hasMore && delayBetweenBatches > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                }
            }
            
            results.stores[storeName] = storeProcessed;
            results.totalProcessed += storeProcessed;
            
            self.postMessage({
                type: 'STORE_COMPLETE',
                store: storeName,
                processed: storeProcessed
            });
        }
        
        results.endTime = Date.now();
        results.duration = results.endTime - results.startTime;
        
        // Cerrar conexión
        db.close();
        
        self.postMessage({
            type: 'COMPLETE',
            results
        });
        
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    } finally {
        isRunning = false;
    }
};

// Manejador de mensajes
self.onmessage = (event) => {
    const { type, payload } = event.data;
    
    switch (type) {
        case 'START':
            if (isRunning) {
                self.postMessage({
                    type: 'ERROR',
                    error: 'Ya hay una migración en curso'
                });
                return;
            }
            runMigration(payload);
            break;
            
        case 'STOP':
            shouldStop = true;
            self.postMessage({
                type: 'STOPPING'
            });
            break;
            
        case 'STATUS':
            self.postMessage({
                type: 'STATUS',
                isRunning
            });
            break;
            
        default:
            self.postMessage({
                type: 'ERROR',
                error: `Tipo de mensaje desconocido: ${type}`
            });
    }
};

export default {};
