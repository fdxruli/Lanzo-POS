/**
 * 🚧 Middleware rediseñado para sincronización masiva segura y no bloqueante.
 */
import { evaluator } from '../BackupRiskEvaluator';

class SyncMiddleware {
    constructor() {
        this.syncInProgress = new Map();
    }

    async safeSync(storeName, remoteDataArray, dbInstance) {
        if (this.syncInProgress.has(storeName)) {
            return { success: false, reason: 'SYNC_IN_PROGRESS' };
        }

        this.syncInProgress.set(storeName, true);
        const CHUNK_SIZE = 200; // Ajustable según la complejidad del objeto
        const safeToApply = [];
        const conflicts = [];

        try {
            // Procesamiento particionado para no asfixiar el Event Loop
            for (let i = 0; i < remoteDataArray.length; i += CHUNK_SIZE) {
                const chunk = remoteDataArray.slice(i, i + CHUNK_SIZE);
                
                // 1. Extraer IDs del chunk remoto
                const remoteIds = chunk.map(record => record.id);

                // 2. UNA sola consulta a IndexedDB por chunk
                // Se asume que dbInstance es tu instancia de Dexie (db)
                const localRecords = await dbInstance.table(storeName).bulkGet(remoteIds);

                // 3. Conciliación estrictamente SÍNCRONA en memoria
                for (let j = 0; j < chunk.length; j++) {
                    const remoteRecord = chunk[j];
                    const localRecord = localRecords[j]; // bulkGet mantiene el orden

                    // Regla de resolución (ejemplo: gana el más reciente basado en updatedAt)
                    if (!localRecord) {
                        // No existe localmente, es seguro insertar
                        safeToApply.push(remoteRecord);
                    } else {
                        const remoteTime = new Date(remoteRecord.updatedAt || 0).getTime();
                        const localTime = new Date(localRecord.updatedAt || 0).getTime();

                        if (remoteTime >= localTime) {
                            safeToApply.push(remoteRecord);
                        } else {
                            // El dato local es más reciente. Se marca como conflicto
                            // o simplemente se ignora la sobrescritura.
                            conflicts.push({ remote: remoteRecord, local: localRecord });
                        }
                    }
                }

                // 4. Oxigenación del Hilo Principal (Ceder control a React/Navegador)
                // Esto previene que la pestaña se congele (ANR - App Not Responding)
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // 5. Aplicar los cambios validados en UNA sola transacción de escritura
            if (safeToApply.length > 0) {
                await dbInstance.table(storeName).bulkPut(safeToApply);
            }

            // Notificar al evaluador tras sincronización masiva de tablas críticas
            if (['sales', 'menu', 'customers'].includes(storeName)) {
                evaluator.ping();
            }

            return {
                success: true,
                applied: safeToApply.length,
                conflicts: conflicts.length
            };

        } catch (error) {
            console.error(`Error crítico en safeSync(${storeName}):`, error);
            return { success: false, error: error.message };
        } finally {
            this.syncInProgress.delete(storeName);
        }
    }
}

export const syncMiddleware = new SyncMiddleware();
