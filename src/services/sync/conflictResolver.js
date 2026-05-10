/**
 * 🛡️ Conflict Resolution Engine
 * 
 * Previene Race Conditions: Valida que los cambios locales no sean
 * sobrescritos silenciosamente por versiones remotas desactualizadas.
 * 
 * Regla Principal: LOCAL WINS si hay cambios sin sincronizar
 */

import { loadData, saveData, STORES } from '../database';
import Logger from '../Logger';

class ConflictResolver {
    /**
     * ✅ Valida si es seguro aplicar cambios remotos
     * Retorna:
     * - { safe: true } = OK aplicar cambios
     * - { safe: false, reason, needsReconciliation: true } = BLOQUEADO, hay conflicto
     */
    async validateRemoteSync(remoteData, localTimestamp, storeName) {
        try {
            // Leer estado de sincronización local
            const syncStatus = await loadData(
                STORES.SYNC_CACHE,
                `pending_sync_${storeName}`
            );

            // Si NO hay cambios pendientes, es seguro sincronizar
            if (!syncStatus || !syncStatus.hasPendingChanges) {
                return {
                    safe: true,
                    source: 'remote',
                    timestamp: localTimestamp
                };
            }

            // ⚠️ HAY CAMBIOS PENDIENTES
            // Aplicar estrategia de reconciliación
            const lastSuccessfulSync = syncStatus.lastSuccessfulSyncAt
                ? new Date(syncStatus.lastSuccessfulSyncAt).getTime()
                : 0;

            const remoteTimestamp = new Date(remoteData.updatedAt || remoteData.timestamp).getTime();

            Logger.warn(
                `⚠️ Conflicto de sincronización detectado en ${storeName}`,
                {
                    hasLocalPending: syncStatus.hasPendingChanges,
                    localModifiedAt: syncStatus.lastModifiedAt,
                    remoteTimestamp: new Date(remoteTimestamp).toISOString(),
                    lastSuccessfulSync: new Date(lastSuccessfulSync).toISOString()
                }
            );

            // REGLA CRÍTICA: Si hay cambios locales sin sincronizar,
            // NO permitir que versión remota más vieja sobrescriba
            return {
                safe: false,
                reason: 'PENDING_LOCAL_CHANGES',
                needsReconciliation: true,
                conflictData: {
                    localPendingSince: syncStatus.changedAt || syncStatus.lastModifiedAt,
                    remoteVersion: remoteTimestamp,
                    recommendedAction: 'MERGE_OR_RETRY'
                }
            };
        } catch (error) {
            Logger.error('Error en validación de conflicto:', error);
            // Ante duda, bloqueamos (fail-safe)
            return {
                safe: false,
                reason: 'VALIDATION_ERROR',
                needsReconciliation: true
            };
        }
    }

    /**
     * 🔄 Reconcilia datos cuando hay conflicto
     * Preserva cambios locales y aplica cambios remotos sin conflicto
     */
    async reconcileInventory(localData, remoteData, storeName) {
        try {
            const syncStatus = await loadData(
                STORES.SYNC_CACHE,
                `pending_sync_${storeName}`
            );

            if (!syncStatus || !syncStatus.hasPendingChanges) {
                // Sin conflictos, retornar remoto
                return { merged: remoteData, hasConflicts: false };
            }

            // Extraer cambios locales pendientes
            const localPending = syncStatus.pendingChanges || {};
            
            // Estrategia MERGE:
            // 1. Empezar con datos remotos (frescos del servidor)
            // 2. Aplicar cambios locales pendientes (tienen prioridad)
            const merged = {
                ...remoteData,
                ...localPending,
                // Sellos de tiempo: marcar que fue reconciliado
                lastReconciliation: new Date().toISOString(),
                lastLocalModification: syncStatus.lastModifiedAt,
                hasUnresolvedConflicts: syncStatus.manualResolutionRequired || false
            };

            Logger.info(
                `✅ Reconciliación completada para ${storeName}`,
                { 
                    appliedLocalChanges: Object.keys(localPending).length,
                    timestamp: merged.lastReconciliation 
                }
            );

            return {
                merged,
                hasConflicts: syncStatus.manualResolutionRequired || false,
                appliedChanges: localPending
            };
        } catch (error) {
            Logger.error('Error reconciliando datos:', error);
            // En caso de error, retornar local (preservar datos)
            return {
                merged: localData,
                hasConflicts: true,
                error: error.message
            };
        }
    }

    /**
     * 📝 Registra cambios pendientes para tracking
     */
    async markAsPendingSync(storeName, changeData, reason) {
        try {
            const syncStatus = {
                hasPendingChanges: true,
                pendingChanges: changeData,
                lastModifiedAt: new Date().toISOString(),
                changedAt: new Date().toISOString(),
                reason, // 'SALE_FAILED', 'NETWORK_ERROR', etc.
                needsManualReview: reason === 'CRITICAL_MISMATCH',
                manualResolutionRequired: false,
                retryCount: 0
            };

            await saveData(
                STORES.SYNC_CACHE,
                {
                    key: `pending_sync_${storeName}`,
                    value: syncStatus
                }
            );

            Logger.info(`📌 Cambios marcados como pendientes: ${storeName}`, syncStatus);
        } catch (error) {
            Logger.error('Error marcando cambios como pendientes:', error);
        }
    }

    /**
     * ✅ Limpia flag de cambios pendientes después de sincronización exitosa
     */
    async clearPendingSync(storeName) {
        try {
            await saveData(
                STORES.SYNC_CACHE,
                {
                    key: `pending_sync_${storeName}`,
                    value: {
                        hasPendingChanges: false,
                        lastSuccessfulSyncAt: new Date().toISOString(),
                        pendingChanges: null
                    }
                }
            );

            Logger.info(`✅ Cambios pendientes resueltos para: ${storeName}`);
        } catch (error) {
            Logger.error('Error limpiando cambios pendientes:', error);
        }
    }

    /**
     * 🔍 Detecta inconsistencias críticas (stock, inventario)
     * Retorna array de problemas encontrados
     */
    async detectCriticalMismatches(localData, remoteData) {
        const mismatches = [];

        // Comparar niveles de stock si es aplicable
        if (localData.stock !== undefined && remoteData.stock !== undefined) {
            const diff = Math.abs(localData.stock - remoteData.stock);
            if (diff > 0) {
                mismatches.push({
                    type: 'STOCK_MISMATCH',
                    local: localData.stock,
                    remote: remoteData.stock,
                    difference: localData.stock - remoteData.stock,
                    recommendation: localData.stock > remoteData.stock
                        ? 'LOCAL_HIGHER_PRESERVE'
                        : 'INVESTIGATE_DATA_LOSS'
                });
            }
        }

        // Comparar totales/sumas si existe
        if (localData.total !== undefined && remoteData.total !== undefined) {
            if (localData.total !== remoteData.total) {
                mismatches.push({
                    type: 'TOTAL_MISMATCH',
                    local: localData.total,
                    remote: remoteData.total,
                    recommendation: 'REQUIRES_MANUAL_REVIEW'
                });
            }
        }

        if (mismatches.length > 0) {
            Logger.error('🚨 Inconsistencias críticas detectadas:', mismatches);
        }

        return mismatches;
    }

    /**
     * 📊 Genera reporte de conflictos para auditoría
     */
    async generateConflictReport(storeName, conflict, resolution) {
        const report = {
            id: `conflict_${Date.now()}`,
            timestamp: new Date().toISOString(),
            storeName,
            conflict,
            resolution,
            status: resolution.safe ? 'RESOLVED' : 'PENDING'
        };

        try {
            // Guardar en historial para auditoría
            await saveData(STORES.SYNC_CACHE, {
                key: `conflict_report_${report.id}`,
                value: report
            });
        } catch (error) {
            Logger.warn('No se pudo guardar reporte de conflicto:', error);
        }

        return report;
    }
}

export const conflictResolver = new ConflictResolver();
