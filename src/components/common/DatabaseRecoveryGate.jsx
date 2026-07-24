import { useSyncExternalStore, useState } from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import { retryLocalDatabaseRecovery } from '../../services/db/databaseRuntime';

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

const describeRecovery = (state) => {
  if (state.errorCode === 'DB_BLOCKED') {
    return {
      title: 'Cierra las demás pestañas de Lanzo',
      body: 'La base local está siendo usada por otra pestaña o ventana. Tus datos no se eliminarán. Cierra las demás pestañas y vuelve a intentarlo.'
    };
  }

  if (
    state.errorCode === 'DB_PRIMARY_KEY_MISMATCH'
    || state.errorCode === 'DB_CLOSED_AFTER_STRUCTURAL_ERROR'
    || state.requiresMigration
  ) {
    return {
      title: 'Actualización segura de la base local',
      body: 'Detectamos un esquema local antiguo. Lanzo preparará una migración segura conservando ventas, productos y movimientos. Los respaldos técnicos se mantendrán en este hotfix.'
    };
  }

  return {
    title: 'La base local necesita recuperación',
    body: 'Tus datos no serán eliminados automáticamente. Reintenta después de cerrar otras pestañas de Lanzo.'
  };
};

export default function DatabaseRecoveryGate({ children }) {
  const recovery = useDatabaseRecoveryState();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');

  const shouldBlock = recovery.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    || recovery.status === DATABASE_RECOVERY_STATUS.FAILED;

  if (!shouldBlock) return children;

  const copy = describeRecovery(recovery);
  const canRetry = recovery.isRetryable !== false;

  const retry = async () => {
    setRetrying(true);
    setRetryError('');
    try {
      await retryLocalDatabaseRecovery();
      window.location.reload();
    } catch (error) {
      setRetryError(error?.message || 'No se pudo completar la recuperación. Cierra otras pestañas y vuelve a intentarlo.');
      setRetrying(false);
    }
  };

  return (
    <main className="app-boot-recovery" role="alert" aria-live="assertive">
      <section className="app-boot-recovery__card">
        <Database size={44} aria-hidden="true" />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {recovery.affectedStores?.length > 0 && (
          <p><strong>Stores afectados:</strong> {recovery.affectedStores.join(', ')}</p>
        )}
        {retryError && (
          <div className="ui-alert ui-alert--danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {retryError}
          </div>
        )}
        {canRetry ? (
          <button type="button" className="ui-button ui-button--primary" onClick={retry} disabled={retrying}>
            <RefreshCw size={18} aria-hidden="true" />
            {retrying ? 'Reintentando...' : 'Reintentar recuperación'}
          </button>
        ) : (
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
