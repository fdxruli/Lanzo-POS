/**
 * Hook para ejecutar migraciones en segundo plano usando Web Workers.
 * 
 * FASE 5: Migración Segura y Eliminación de Memory Scans
 * Este hook permite ejecutar la migración de activeStockStatus sin bloquear
 * la interfaz de usuario.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Logger from '../services/Logger';
import { DB_NAME } from '../config/dbConfig';

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
        stores = ['menu', 'product_batches'],
        batchSize = 500,
        onComplete,
        onError
    } = options;

    const workerRef = useRef(null);
    
    const [state, setState] = useState({
        isRunning: false,
        isComplete: false,
        totalProcessed: 0,
        storeProgress: {},
        currentStore: null,
        error: null,
        duration: 0
    });

    // Inicializar worker
    useEffect(() => {
        // Crear worker
        const worker = new Worker(
            new URL('../workers/migration.worker.js', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (event) => {
            const { type, ...data } = event.data;

            switch (type) {
                case 'STORE_START':
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
                    setState(prev => ({
                        ...prev,
                        isRunning: false,
                        isComplete: true,
                        duration: data.results?.duration || 0
                    }));
                    Logger.info('[MigrationWorker] Migración completada:', data.results);
                    onComplete?.(data.results);
                    break;

                case 'ERROR':
                    setState(prev => ({
                        ...prev,
                        isRunning: false,
                        error: data.error
                    }));
                    Logger.error('[MigrationWorker] Error:', data.error);
                    onError?.(data.error);
                    break;

                case 'STOPPING':
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
            Logger.error('[MigrationWorker] Worker error:', error);
            setState(prev => ({
                ...prev,
                isRunning: false,
                error: error.message
            }));
            onError?.(error.message);
        };

        workerRef.current = worker;

        // Auto-start si está configurado
        if (autoStart) {
            startMigration();
        }

        // Cleanup
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);

    /**
     * Inicia la migración.
     */
    const startMigration = useCallback(() => {
        if (!workerRef.current || state.isRunning) return;

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
                dbName: DB_NAME,
                stores,
                batchSize
            }
        });
    }, [state.isRunning, stores, batchSize]);

    /**
     * Detiene la migración.
     */
    const stopMigration = useCallback(() => {
        if (!workerRef.current || !state.isRunning) return;

        workerRef.current.postMessage({ type: 'STOP' });
    }, [state.isRunning]);

    /**
     * Reinicia el estado de la migración.
     */
    const resetMigration = useCallback(() => {
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
