/**
 * 🔐 Synchronization Middleware
 * 
 * Previene que pulls remotos sobrescriban cambios locales no sincronizados.
 * Intercepta y valida ANTES de hacer bulk updates desde la nube.
 */

import { conflictResolver } from './conflictResolver';
import Logger from '../Logger';

class SyncMiddleware {
    constructor() {
        this.syncInProgress = new Map(); // Prevenir race conditions
        this.validationRules = new Map();
    }

    /**
     * 🚧 Middleware: Valida ANTES de aplicar cambios remotos en bulk
     */
    async beforeBulkRemoteSync(storeName, remoteDataArray, localDataMap) {
        const conflicts = [];
        const safeToApply = [];

        Logger.info(`🔄 Iniciando validación pre-sync para ${storeName}`, {
            remoteCount: remoteDataArray?.length || 0,
            localCount: localDataMap?.size || 0
        });

        for (const remoteRecord of remoteDataArray || []) {
            const recordId = remoteRecord.id || remoteRecord.timestamp;
            const localRecord = localDataMap?.get(recordId);

            // Validar si es seguro aplicar este cambio
            const validation = await conflictResolver.validateRemoteSync(
                remoteRecord,
                localRecord?.timestamp,
                storeName
            );

            if (!validation.safe) {
                conflicts.push({
                    recordId,
                    remote: remoteRecord,
                    local: localRecord,
                    validation
                });
            } else {
                safeToApply.push(remoteRecord);
            }
        }

        return {
            canProceed: conflicts.length === 0,
            safeToApply,
            conflicts,
            requiresReconciliation: conflicts.length > 0,
            summary: {
                validated: safeToApply.length,
                blocked: conflicts.length,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * ✅ Aplica cambios validados con modo seguro
     */
    async applySafeSync(storeName, validatedData, bulkUpdateFn) {
        try {
            if (!validatedData || validatedData.length === 0) {
                Logger.warn(`No hay datos validados para sincronizar en ${storeName}`);
                return { success: true, applied: 0 };
            }

            // Ejecutar bulk update SOLO con datos validados
            const result = await bulkUpdateFn(storeName, validatedData);

            Logger.info(`✅ Sincronización segura completada para ${storeName}`, {
                applied: validatedData.length,
                result
            });

            // Marcar como sincronizado exitosamente
            await conflictResolver.clearPendingSync(storeName);

            return {
                success: true,
                applied: validatedData.length,
                result
            };
        } catch (error) {
            Logger.error(`❌ Error aplicando sync seguro en ${storeName}:`, error);
            return {
                success: false,
                error: error.message,
                applied: 0
            };
        }
    }

    /**
     * 🔀 Reconcilia conflictos preservando cambios locales
     */
    async reconcileConflicts(storeName, conflicts) {
        const reconciled = [];
        let manualReviewRequired = false;

        Logger.warn(`⚠️ Reconciliando ${conflicts.length} conflictos en ${storeName}`);

        for (const conflict of conflicts) {
            try {
                const resolution = await conflictResolver.reconcileInventory(
                    conflict.local,
                    conflict.remote,
                    storeName
                );

                if (resolution.hasConflicts) {
                    manualReviewRequired = true;
                    Logger.error(
                        `🚨 Conflicto no resuelto automáticamente: ${conflict.recordId}`,
                        resolution
                    );
                } else {
                    reconciled.push(resolution.merged);
                }

                // Generar reporte para auditoría
                await conflictResolver.generateConflictReport(storeName, conflict, resolution);
            } catch (error) {
                Logger.error(`Error reconciliando conflicto ${conflict.recordId}:`, error);
                manualReviewRequired = true;
            }
        }

        return {
            reconciled,
            manualReviewRequired,
            count: reconciled.length
        };
    }

    /**
     * 🛡️ Wrapper seguro para operaciones de sincronización
     * USO: await syncMiddleware.safeSync('INVENTORY', remoteData, bulkUpdateFn)
     */
    async safeSync(storeName, remoteData, bulkUpdateFn, localDataMap = null) {
        // Evitar syncs concurrentes del mismo store
        if (this.syncInProgress.has(storeName)) {
            Logger.warn(`⚠️ Sync ya en progreso para ${storeName}, bloqueando nueva solicitud`);
            return {
                success: false,
                reason: 'SYNC_IN_PROGRESS'
            };
        }

        this.syncInProgress.set(storeName, true);

        try {
            // 1️⃣ VALIDACIÓN: Verificar si es seguro aplicar cambios
            const validation = await this.beforeBulkRemoteSync(
                storeName,
                remoteData,
                localDataMap
            );

            Logger.info(`Validación completada: ${validation.summary.validated} OK, ${validation.summary.blocked} BLOQUEADOS`);

            // 2️⃣ APLICAR DATOS VALIDADOS
            if (validation.safeToApply.length > 0) {
                await this.applySafeSync(storeName, validation.safeToApply, bulkUpdateFn);
            }

            // 3️⃣ RECONCILIAR CONFLICTOS
            if (validation.conflicts.length > 0) {
                const reconciliation = await this.reconcileConflicts(
                    storeName,
                    validation.conflicts
                );

                if (reconciliation.reconciled.length > 0) {
                    await this.applySafeSync(storeName, reconciliation.reconciled, bulkUpdateFn);
                }

                if (reconciliation.manualReviewRequired) {
                    Logger.error(`🚨 REVISIÓN MANUAL REQUERIDA en ${storeName}`);
                }
            }

            return {
                success: true,
                summary: validation.summary,
                requiresAttention: validation.conflicts.length > 0
            };
        } catch (error) {
            Logger.error(`❌ Error crítico en safeSync(${storeName}):`, error);
            return {
                success: false,
                error: error.message,
                requiresAttention: true
            };
        } finally {
            this.syncInProgress.delete(storeName);
        }
    }

    /**
     * 📋 Registra una operación de venta local para tracking de sincronización
     */
    async registerLocalSaleChange(saleId, inventoryChanges) {
        try {
            await conflictResolver.markAsPendingSync(
                'SALES',
                {
                    saleId,
                    inventoryChanges,
                    changedBy: 'LOCAL_SALE'
                },
                'SALE_NOT_SYNCED'
            );

            Logger.info(`📌 Cambio de venta registrado para sync posterior: ${saleId}`);
        } catch (error) {
            Logger.error('Error registrando cambio local:', error);
        }
    }

    /**
     * 🔍 Verifica si hay sincronización pendiente
     */
    async hasPendingSync(storeName) {
        try {
            const { loadData, STORES } = await import('../database.js');
            const syncStatus = await loadData(
                STORES.SYNC_CACHE,
                `pending_sync_${storeName}`
            );
            return syncStatus?.hasPendingChanges || false;
        } catch (error) {
            Logger.warn('Error verificando sync pendiente:', error);
            return false;
        }
    }
}

export const syncMiddleware = new SyncMiddleware();
