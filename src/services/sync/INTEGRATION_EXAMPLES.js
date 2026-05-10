/**
 * 📋 EXAMPLE: Safe Synchronization Patterns
 * 
 * Copy these patterns into your actual files where you do:
 * - Pull from cloud
 * - Bulk update inventory
 * - Sync operations
 */

// ============================================================
// PATTERN 1: Initialize App (Prevent First-Load Overwrites)
// ============================================================
// File: src/main.jsx or src/App.jsx

export async function initializeAppWithSafeSync() {
    try {
        // 1. Cargar datos locales primero
        const localInventory = await loadData(STORES.MENU);
        const localSales = await loadData(STORES.SALES);

        // 2. Verificar si hay sync pendiente
        const hasPendingSales = await syncMiddleware.hasPendingSync(STORES.SALES);
        
        if (hasPendingSales) {
            Logger.warn('⚠️ Detectadas ventas sin sincronizar. Bloqueando pull remoto.');
            return {
                success: true,
                usingLocal: true,
                hasPending: true,
                message: 'Usando datos locales. Esperando sincronización de ventas pendientes.'
            };
        }

        // 3. Si NO hay pendiente, seguro hacer pull
        const remoteInventory = await supabaseClient
            .from('inventory')
            .select('*');

        if (remoteInventory.data) {
            // 4. Usar syncMiddleware para aplicar cambios
            const result = await syncMiddleware.safeSync(
                STORES.MENU,
                remoteInventory.data,
                saveBulk,
                new Map(localInventory.map(i => [i.id, i]))
            );

            Logger.info('App initialized with safe sync', result);
        }

        return { success: true, usingLocal: false };
    } catch (error) {
        Logger.error('Error initializing app sync:', error);
        // Fallback a datos locales
        return { success: true, usingLocal: true, error: error.message };
    }
}


// ============================================================
// PATTERN 2: Service Worker - Background Sync
// ============================================================
// File: public/service-worker.js

self.addEventListener('sync', async (event) => {
    if (event.tag === 'sync-sales') {
        event.waitUntil(
            (async () => {
                try {
                    // 1. Verificar si hay trabajo pendiente
                    const pending = await db.table('sync_cache')
                        .where('key')
                        .startsWith('pending_sync_')
                        .toArray();

                    if (pending.length === 0) {
                        console.log('✅ No hay datos pendientes de sincronizar');
                        return;
                    }

                    for (const pendingItem of pending) {
                        const storeName = pendingItem.key.replace('pending_sync_', '');
                        
                        console.log(`🔄 Sincronizando ${storeName}...`);

                        // 2. Obtener datos remotos
                        const remoteData = await fetchRemoteData(storeName);
                        
                        // 3. Validar ANTES de aplicar
                        const validation = await syncMiddleware.beforeBulkRemoteSync(
                            storeName,
                            remoteData,
                            null
                        );

                        if (validation.canProceed) {
                            // Seguro aplicar
                            await db.table(storeName).bulkPut(validation.safeToApply);
                            
                            // Limpiar flag
                            await db.table('sync_cache')
                                .update(pendingItem.key, {
                                    hasPendingChanges: false,
                                    lastSuccessfulSyncAt: new Date().toISOString()
                                });

                            console.log(`✅ ${storeName} sincronizado`);
                        } else {
                            // Hay conflictos - reconciliar
                            const reconciled = await syncMiddleware.reconcileConflicts(
                                storeName,
                                validation.conflicts
                            );

                            if (reconciled.reconciled.length > 0) {
                                await db.table(storeName).bulkPut(reconciled.reconciled);
                            }

                            if (reconciled.manualReviewRequired) {
                                console.warn(`🚨 ${storeName} requiere revisión manual`);
                                // Enviar notificación al usuario
                                self.registration.showNotification(
                                    'Conflicto de Sincronización',
                                    {
                                        body: `Se detectaron conflictos en ${storeName}. Revisa la aplicación.`,
                                        icon: '/logo.png'
                                    }
                                );
                            }
                        }
                    }
                } catch (error) {
                    console.error('❌ Error en sincronización:', error);
                    // Reintentar más tarde
                    throw error;
                }
            })()
        );
    }
});


// ============================================================
// PATTERN 3: Hook - Periodic Sync (Manual Pull)
// ============================================================
// File: src/hooks/useSyncInventory.js

import { useEffect } from 'react';
import { syncMiddleware } from '../services/sync/syncMiddleware';
import { conflictResolver } from '../services/sync/conflictResolver';

export const useSyncInventory = (intervalMs = 60000) => {
    useEffect(() => {
        const syncTimer = setInterval(async () => {
            try {
                // 1. Verificar si es seguro sincronizar
                const canSync = !(await syncMiddleware.hasPendingSync('MENU'));
                
                if (!canSync) {
                    console.log('⏳ Aguardando ventas pendientes...');
                    return;
                }

                // 2. Pull desde nube
                const { data: remoteData } = await supabaseClient
                    .from('inventory')
                    .select('*')
                    .gt('updated_at', lastSyncTime);

                if (!remoteData || remoteData.length === 0) {
                    return; // Nada nuevo
                }

                // 3. Aplicar con validación
                const result = await syncMiddleware.safeSync(
                    STORES.MENU,
                    remoteData,
                    saveBulk
                );

                if (result.success) {
                    console.log('✅ Inventario actualizado');
                    // Actualizar UI si es necesario
                    useProductStore.getState().invalidateAndReset();
                } else if (result.requiresAttention) {
                    console.warn('⚠️ Conflictos reconciliados, revisar');
                }
            } catch (error) {
                console.error('Error sincronizando inventario:', error);
            }
        }, intervalMs);

        return () => clearInterval(syncTimer);
    }, []);
};

// USO en componente:
// function MyComponent() {
//   useSyncInventory(60000); // Cada minuto
//   return <div>...</div>;
// }


// ============================================================
// PATTERN 4: Manual Sync Button (UI)
// ============================================================
// File: src/components/SyncButton.jsx

export function SyncButton() {
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState('');

    const handleSync = async () => {
        setSyncing(true);
        setMessage('Sincronizando...');

        try {
            // 1. Verificar si hay pendiente
            const pending = await syncMiddleware.hasPendingSync(STORES.SALES);
            
            if (pending) {
                setMessage('⚠️ Hay ventas sin sincronizar. Por favor espera.');
                setSyncing(false);
                return;
            }

            // 2. Pull de nube
            const { data: remoteData, error } = await supabaseClient
                .from('inventory')
                .select('*');

            if (error) throw error;

            // 3. Sync seguro
            const result = await syncMiddleware.safeSync(
                STORES.MENU,
                remoteData,
                saveBulk
            );

            if (result.success) {
                setMessage('✅ Sincronización exitosa');
            } else {
                setMessage('❌ Error en sincronización');
            }
        } catch (error) {
            setMessage(`❌ ${error.message}`);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <button onClick={handleSync} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
        </button>
    );
}


// ============================================================
// PATTERN 5: Conflict Detection & Resolution
// ============================================================
// File: src/services/conflictHandler.js

export async function detectAndResolveConflicts() {
    const conflictsFound = [];

    try {
        // 1. Buscar todos los sync caches con conflictos
        const allPending = await db.table(STORES.SYNC_CACHE)
            .where('key')
            .startsWith('pending_sync_')
            .toArray();

        for (const pending of allPending) {
            if (pending.value?.hasPendingChanges) {
                const storeName = pending.key.replace('pending_sync_', '');

                // 2. Obtener datos remotos
                const remoteData = await fetchRemoteData(storeName);

                // 3. Detectar mismatches críticos
                const mismatches = await conflictResolver.detectCriticalMismatches(
                    pending.value.pendingChanges,
                    remoteData
                );

                if (mismatches.length > 0) {
                    conflictsFound.push({
                        storeName,
                        mismatches,
                        resolution: await resolveConflict(
                            storeName,
                            pending.value.pendingChanges,
                            remoteData,
                            mismatches
                        )
                    });
                }
            }
        }

        if (conflictsFound.length > 0) {
            // Generar reporte y alertar
            Logger.error('🚨 Conflictos encontrados que requieren revisión:', conflictsFound);
            
            // Opcionalmente guardar para auditoría
            await saveData(STORES.SYNC_CACHE, {
                key: `conflicts_${Date.now()}`,
                value: conflictsFound
            });
        }

        return conflictsFound;
    } catch (error) {
        Logger.error('Error detectando conflictos:', error);
        return [];
    }
}

async function resolveConflict(storeName, local, remote, mismatches) {
    // Implementar lógica de resolución específica
    // Ejemplo: Si stock local > remoto, mantener local
    
    return mismatches.map(mismatch => ({
        ...mismatch,
        action: mismatch.recommendation,
        resolved: true,
        timestamp: new Date().toISOString()
    }));
}


// ============================================================
// PATTERN 6: Error Handling & Retry
// ============================================================
// File: src/services/syncRetry.js

export async function syncWithRetry(storeName, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
        try {
            attempt++;

            // Pull remoto
            const remoteData = await fetchRemoteData(storeName);

            // Sync seguro
            const result = await syncMiddleware.safeSync(
                storeName,
                remoteData,
                saveBulk
            );

            if (result.success) {
                Logger.info(`✅ Sync exitoso en intento ${attempt}`);
                return { success: true, attempts: attempt };
            }

            // Si falló pero no es catastrófico, reintentar
            Logger.warn(`⚠️ Intento ${attempt} falló, reintentando...`);

        } catch (error) {
            lastError = error;
            Logger.warn(`❌ Intento ${attempt} error:`, error.message);

            // Exponential backoff
            const backoffMs = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
    }

    // Agotados los reintentos
    Logger.error(`❌ Sync falló después de ${maxRetries} intentos:`, lastError);
    return {
        success: false,
        attempts: attempt,
        error: lastError?.message
    };
}


// ============================================================
// TESTING: Simular Conflictos
// ============================================================
// File: src/__tests__/syncConflict.test.js

describe('Sync Conflict Resolution', () => {
    it('should prevent overwrite when sales are pending', async () => {
        // 1. Marcar como pendiente
        await conflictResolver.markAsPendingSync(
            STORES.SALES,
            { saleId: 'TEST-001', items: 3 },
            'TEST_SCENARIO'
        );

        // 2. Intentar sync
        const result = await syncMiddleware.safeSync(
            STORES.SALES,
            [{ id: 'TEST-001', stock: 5 }], // Versión vieja
            saveBulk
        );

        // 3. Verificar que fue bloqueado o reconciliado
        expect(result.requiresAttention).toBe(true);
        // El stock local debe preservarse
    });

    it('should apply safe updates when no conflicts', async () => {
        // Sin pendientes
        const result = await syncMiddleware.safeSync(
            STORES.MENU,
            [{ id: 'PROD-001', stock: 100, price: 50 }],
            saveBulk
        );

        expect(result.success).toBe(true);
        expect(result.summary.blocked).toBe(0);
    });
});
