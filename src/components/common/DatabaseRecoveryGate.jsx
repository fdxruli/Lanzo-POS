import { useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Database, RefreshCw, RotateCw } from 'lucide-react';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import {
  getActiveNativeOpenOperations,
  subscribeNativeOpenOperations
} from '../../services/db/indexedDbPreflight';
import {
  isLocalDatabasePreparationActive,
  retryLocalDatabaseRecovery
} from '../../services/db/databaseRuntime';

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

export const useNativeDatabaseOperationState = () => useSyncExternalStore(
  subscribeNativeOpenOperations,
  getActiveNativeOpenOperations,
  getActiveNativeOpenOperations
);

const BLOCKING_STATUSES = new Set([
  DATABASE_RECOVERY_STATUS.IDLE,
  DATABASE_RECOVERY_STATUS.CHECKING,
  DATABASE_RECOVERY_STATUS.MIGRATING,
  DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
  DATABASE_RECOVERY_STATUS.FAILED
]);

const describeRecovery = (state, hasActiveNativeRequest) => {
  if (
    state.status === DATABASE_RECOVERY_STATUS.IDLE
    || state.status === DATABASE_RECOVERY_STATUS.CHECKING
  ) {
    return {
      title: 'Comprobando la base local...',
      body: 'Lanzo está verificando que la base local pueda abrirse de forma segura.',
      icon: 'database'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.MIGRATING) {
    return {
      title: 'Actualizando la base local de forma segura...',
      body: 'La migración está preservando tus ventas y movimientos. No cierres esta pestaña durante el proceso.',
      icon: 'database'
    };
  }

  if (state.errorCode === 'DB_BLOCKED') {
    return {
      title: 'Cierra las demás pestañas de Lanzo',
      body: 'La base local está siendo usada por otra pestaña o ventana. Tus datos no se eliminarán. La operación continuará cuando se cierre la conexión bloqueante.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_OPEN_TIMEOUT') {
    return {
      title: 'La apertura de la base local tardó demasiado',
      body: hasActiveNativeRequest
        ? 'El navegador todavía mantiene una solicitud activa. Espera a que termine o recarga Lanzo para volver a intentarlo de forma segura.'
        : 'La solicitud anterior ya terminó. Puedes reintentar la recuperación de forma segura o recargar Lanzo.',
      icon: 'warning'
    };
  }

  if (
    state.errorCode === 'DB_PRIMARY_KEY_MISMATCH'
    || state.errorCode === 'DB_CLOSED_AFTER_STRUCTURAL_ERROR'
    || state.requiresMigration
  ) {
    return {
      title: 'Actualización segura de la base local',
      body: 'Detectamos un esquema local antiguo. Lanzo preparará una migración segura conservando ventas, productos y movimientos. Los respaldos técnicos se mantendrán en este hotfix.',
      icon: 'database'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.FAILED) {
    return {
      title: 'La recuperación automática no pudo completarse',
      body: 'La base local se conservó sin borrarse. Mantén esta instalación y solicita una revisión técnica con el código de diagnóstico mostrado.',
      icon: 'warning'
    };
  }

  return {
    title: 'La base local necesita recuperación',
    body: 'Tus datos no serán eliminados automáticamente. Reintenta después de cerrar otras pestañas de Lanzo.',
    icon: 'warning'
  };
};

const MigrationDetails = ({ migration }) => {
  if (!migration) return null;
  const stores = [...new Set([
    ...Object.keys(migration.sourceCounts || {}),
    ...Object.keys(migration.targetCounts || {})
  ])];

  return (
    <div className="app-boot-recovery__details" aria-label="Progreso de migración">
      {migration.phase && <p><strong>Fase:</strong> {migration.phase}</p>}
      {stores.length > 0 && <p><strong>Stores:</strong> {stores.join(', ')}</p>}
      {Object.keys(migration.sourceCounts || {}).length > 0 && (
        <p><strong>Origen:</strong> {JSON.stringify(migration.sourceCounts)}</p>
      )}
      {Object.keys(migration.targetCounts || {}).length > 0 && (
        <p><strong>Destino:</strong> {JSON.stringify(migration.targetCounts)}</p>
      )}
    </div>
  );
};

export default function DatabaseRecoveryGate({
  children,
  reloadPage = () => window.location.reload()
}) {
  const recovery = useDatabaseRecoveryState();
  const nativeOperations = useNativeDatabaseOperationState();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const retryPromiseRef = useRef(null);

  if (!BLOCKING_STATUSES.has(recovery.status)) return children;

  const hasActiveNativeRequest = nativeOperations.length > 0;
  const copy = describeRecovery(recovery, hasActiveNativeRequest);
  const operationActive = retrying
    || hasActiveNativeRequest
    || isLocalDatabasePreparationActive();
  const canRetry = recovery.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    && recovery.isRetryable !== false
    && recovery.errorCode !== 'DB_BLOCKED';
  const canReload = recovery.errorCode === 'DB_OPEN_TIMEOUT';

  const retry = () => {
    if (retryPromiseRef.current) return retryPromiseRef.current;

    setRetrying(true);
    setRetryError('');
    const operation = retryLocalDatabaseRecovery()
      .then(() => {
        const finalState = getDatabaseRecoveryState();
        if (finalState.status !== DATABASE_RECOVERY_STATUS.READY) {
          throw new Error('La base local no alcanzó un estado seguro después del reintento.');
        }
        reloadPage();
      })
      .catch((error) => {
        setRetryError(
          error?.message
          || 'No se pudo completar la recuperación. Cierra otras pestañas y vuelve a intentarlo.'
        );
      })
      .finally(() => {
        retryPromiseRef.current = null;
        setRetrying(false);
      });

    retryPromiseRef.current = operation;
    return operation;
  };

  return (
    <main className="app-boot-recovery" role="alert" aria-live="assertive">
      <section className="app-boot-recovery__card">
        {copy.icon === 'warning'
          ? <AlertTriangle size={44} aria-hidden="true" />
          : <Database size={44} aria-hidden="true" />}
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {recovery.affectedStores?.length > 0 && (
          <p><strong>Stores afectados:</strong> {recovery.affectedStores.join(', ')}</p>
        )}
        <MigrationDetails migration={recovery.migration} />
        {recovery.errorCode && recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <p><strong>Código:</strong> {recovery.errorCode}</p>
        )}
        {retryError && (
          <div className="ui-alert ui-alert--danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {retryError}
          </div>
        )}
        {canRetry && (
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={retry}
            disabled={operationActive}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {retrying ? 'Reintentando...' : 'Reintentar recuperación'}
          </button>
        )}
        {canReload && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={reloadPage}
          >
            <RotateCw size={18} aria-hidden="true" />
            Recargar Lanzo
          </button>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <p className="ui-alert ui-alert--warning">
            La versión local no puede repararse automáticamente con seguridad. Conserva esta base y solicita una revisión técnica.
          </p>
        )}
        <p className="app-boot-recovery__note">
          Lanzo no borrará IndexedDB, localStorage, cachés ni credenciales durante esta recuperación.
        </p>
      </section>
    </main>
  );
}
