/**
 * Hook para ejecutar migraciones en segundo plano usando Web Workers.
 * 
 * FASE 5: Migración Segura y Eliminación de Memory Scans
 * Este hook permite ejecutar la migración de activeStockStatus sin bloquear
 * la interfaz de usuario.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Logger from '../services/Logger';
import {
    LOCAL_TENANT_STATUS,
    localTenantAccessController
} from '../services/tenant/localTenantPolicy';
import {
    captureActiveTenantWorkerContext,
    isActiveTenantWorkerContext
} from '../services/tenant/tenantWorkerContext';

const DEFAULT_MIGRATION_STORES = ['menu', 'product_batches'];

/**
 * Estado de la migración
 * @typedef {Object} MigrationState
 * @property {boolean} isRunning - Si la migración está en curso
 * @property {boolean} isComplete - Si la migración completó
 * @property {number} totalProcessed - Total de registros procesados
 * @property {Object} storeProgress - Progreso por tabla
 * @property {string|null} currentStore - Tabla actualmente en proceso
 * @property {string|null} error - Error si ocurrió
 * @property {number} duration - Duración en ms
 */

/**
 * Hook para gestionar la migración en segundo plano.
 * 
 * @param {Object} options - Opciones de configuración
 * @param {boolean} options.autoStart - Iniciar automáticamente al montar
 * @param {Array<string>} options.stores - Tablas a migrar
 * @param {number} options.batchSize - Tamaño de lote
 * @param {Function} options.onComplete - Callback al completar
 * @param {Function} options.onError - Callback al ocurrir error
 * @returns {Object} Estado y controles de la migración
 * 
 * @example
 * const { start, stop, isRunning, progress } = useMigrationWorker({
 *   autoStart: true,
 *   onComplete: (results) => console.log('Migración completada:', results)
 * });
 */
export const useMigrationWorker = (options = {}) => {
    const {
        autoStart = false,
        stores = DEFAULT_MIGRATION_STORES,
        batchSize = 500,
        onComplete,
        onError
    } = options;

    const workerRef = useRef(null);
    const isRunningRef = useRef(false);
    const configRef = useRef({ stores, batchSize });
    const callbacksRef = useRef({ onComplete, onError });
    const workerContextRef = useRef(null);
    
    const [state, setState] = useState({
        isRunning: false,
        isComplete: false,
        totalProcessed: 0,
        storeProgress: {},
        currentStore: null,
        error: null,
        duration: 0
    });

    useEffect(() => {
        configRef.current = { stores, batchSize };
    }, [stores, batchSize]);

    useEffect(() => {
        callbacksRef.current = { onComplete, onError };
    }, [onComplete, onError]);

    const startMigration = useCallback(() => {
        if (!workerRef.current || isRunningRef.current) return;
        const tenantState = localTenantAccessController.getState();
        if (tenantState.status !== LOCAL_TENANT_STATUS.GRANTED) {
            setState((previous) => ({
                ...previous,
                error: 'LOCAL_TENANT_ACCESS_REQUIRED'
            }));
            return;
        }

        let context;
        try {
            context = captureActiveTenantWorkerContext();
        } catch {
            setState((previous) => ({
                ...previous,
                error: 'LOCAL_TENANT_WORKER_CONTEXT_REQUIRED'
            }));
            return;
        }

        isRunningRef.current = true;
        workerContextRef.current = context;
        setState(prev => ({
            ...prev,
            isRunning: true,
            isComplete: false,
            error: null,
            totalProcessed: 0,
            storeProgress: {}
        }));

        workerRef.current.postMessage({
            type: 'START',
            payload: {
                context,
                stores: configRef.current.stores,
                batchSize: configRef.current.batchSize
            }
        });
    }, []);

    // Inicializar worker
    useEffect(() => {
        // Crear worker
        const worker = new Worker(
            new URL('../workers/migration.worker.js', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (event) => {
            const { type, ...data } = event.data;
            const acceptsResult = () => isActiveTenantWorkerContext(workerContextRef.current);

            switch (type) {
                case 'STORE_START':
                    if (!acceptsResult()) return;
                    setState(prev => ({
                        ...prev,
                        currentStore: data.store,
                        storeProgress: {
                            ...prev.storeProgress,
                            [data.store]: { processed: 0, complete: false }
                        }
                    }));
                    break;

                case 'PROGRESS':
                    if (!acceptsResult()) return;
                    setState(prev => ({
                        ...prev,
                        totalProcessed: prev.totalProcessed + data.currentBatch,
                        storeProgress: {
                            ...prev.storeProgress,
                            [data.store]: { 
                                processed: data.processed, 
                                complete: false 
                            }
                        }
                    }));
                    break;

                case 'STORE_COMPLETE':
                    if (!acceptsResult()) return;
                    setState(prev => ({
                        ...prev,
                        storeProgress: {
                            ...prev.storeProgress,
                            [data.store]: { 
                                processed: data.processed, 
                                complete: true 
                            }
                        }
                    }));
                    break;

                case 'COMPLETE':
                    isRunningRef.current = false;
                    if (!acceptsResult()) return;
                    setState(prev => ({
                        ...prev,
                        isRunning: false,
                        isComplete: true,
                        duration: data.results?.duration || 0
                    }));
                    Logger.info('[MigrationWorker] Migración completada:', data.results);
                    callbacksRef.current.onComplete?.(data.results);
                    break;

                case 'ERROR':
                    isRunningRef.current = false;
                    setState(prev => ({
                        ...prev,
                        isRunning: false,
                        error: data.error
                    }));
                    Logger.error('[MigrationWorker] Error:', data.error);
                    callbacksRef.current.onError?.(data.error);
                    break;

                case 'STOPPING':
                    isRunningRef.current = false;
                    setState(prev => ({
                        ...prev,
                        isRunning: false
                    }));
                    break;

                default:
                    break;
            }
        };

        worker.onerror = (error) => {
            isRunningRef.current = false;
            Logger.error('[MigrationWorker] Worker error:', error);
            setState(prev => ({
                ...prev,
                isRunning: false,
                error: error.message
            }));
            callbacksRef.current.onError?.(error.message);
        };

        workerRef.current = worker;

        const unsubscribeTenant = localTenantAccessController.subscribe((tenantState) => {
            if (tenantState.enabled && tenantState.status !== LOCAL_TENANT_STATUS.GRANTED) {
                worker.postMessage({ type: 'STOP' });
                workerContextRef.current = null;
            }
        });

        // Cleanup
        return () => {
            unsubscribeTenant();
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            isRunningRef.current = false;
            workerContextRef.current = null;
        };
    }, [startMigration]);

    useEffect(() => {
        if (autoStart) startMigration();
    }, [autoStart, startMigration]);

    /**
     * Detiene la migración.
     */
    const stopMigration = useCallback(() => {
        if (!workerRef.current || !isRunningRef.current) return;

        workerRef.current.postMessage({ type: 'STOP' });
    }, []);

    /**
     * Reinicia el estado de la migración.
     */
    const resetMigration = useCallback(() => {
        isRunningRef.current = false;
        setState({
            isRunning: false,
            isComplete: false,
            totalProcessed: 0,
            storeProgress: {},
            currentStore: null,
            error: null,
            duration: 0
        });
    }, []);

    return {
        ...state,
        start: startMigration,
        stop: stopMigration,
        reset: resetMigration
    };
};

export default useMigrationWorker;
