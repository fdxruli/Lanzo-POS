/**
 * usePersistentStorage - Hook de React para StorageManager
 * Permite que componentes reaccionen al estado de persistencia y cuota.
 *
 * isVolatile = true cuando la persistencia NO está garantizada:
 *   - 'denied'      → el navegador/usuario rechazó el permiso
 *   - 'prompt'      → permiso pendiente, aún no concedido (igual de peligroso)
 *   - 'unknown'     → no se ha verificado todavía
 *   - 'unsupported' → el navegador no soporta la Storage API
 *
 * Solo se marca isVolatile = false cuando persistenceState === 'granted'.
 *
 * Uso:
 *   const { isVolatile, isCritical, quotaPercent, requestPersistence } = usePersistentStorage();
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { storageManager } from '../services/storageManager';

export const usePersistentStorage = () => {
  const [state, setState] = useState({
    isVolatile: true, // Pesimista por defecto hasta confirmar
    isCritical: false,
    isWarning: false,
    quotaPercent: 0,
    persistenceState: 'unknown',
    recommendations: [],
    isRequestingPersistence: false,
  });

  // Evita múltiples solicitudes concurrentes
  const persistenceRequested = useRef(false);

  // Actualizar estado cuando cambia el storageManager
  const updateState = useCallback(() => {
    const managerState = storageManager.getState();

    // CORRECCIÓN CRÍTICA: Solo 'granted' significa que los datos están protegidos.
    // 'prompt', 'unknown', 'denied' y 'unsupported' son todos estados volátiles.
    const isVolatile = managerState.persistenceState !== 'granted';

    setState(prev => ({
      ...prev,
      isVolatile,
      isCritical: managerState.quotaUsage.isCritical,
      isWarning: managerState.quotaUsage.isWarning,
      quotaPercent: managerState.quotaUsage.percentUsed,
      persistenceState: managerState.persistenceState,
      recommendations: [],
    }));
  }, []);

  /**
   * Solicita persistencia manualmente (o se llama automáticamente al montar
   * si el estado es 'prompt' o 'unknown').
   * navigator.storage.persist() es silencioso en Chrome/Edge; en Firefox puede
   * requerir que el sitio esté instalado como PWA o visitado con frecuencia.
   * En Safari iOS solo funciona si la app está instalada en Home Screen.
   */
  const requestPersistence = useCallback(async () => {
    if (persistenceRequested.current) return;
    persistenceRequested.current = true;

    setState(prev => ({ ...prev, isRequestingPersistence: true }));
    try {
      await storageManager.requestPersistence();
    } finally {
      setState(prev => ({ ...prev, isRequestingPersistence: false }));
      updateState();
    }
  }, [updateState]);

  useEffect(() => {
    updateState();

    // Suscribirse a cambios del storageManager
    const unsubscribe = storageManager.subscribe(() => {
      updateState();
    });

    // Auto-solicitar persistencia solo cuando hay posibilidad de éxito.
    // NO reintentar si ya fue 'denied': el navegador recuerda el rechazo y
    // volver a llamar persist() simplemente retornará false de nuevo.
    const { persistenceState } = storageManager.getState();
    const canRequest =
      persistenceState === 'prompt' ||
      persistenceState === 'unknown';

    if (canRequest && !persistenceRequested.current) {
      requestPersistence();
    }

    return unsubscribe;
  }, [updateState, requestPersistence]);

  return { ...state, requestPersistence };
};

export default usePersistentStorage;
