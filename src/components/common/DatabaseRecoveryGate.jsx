import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Database, Mail, RefreshCw, RotateCw } from 'lucide-react';
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
import {
  buildDatabaseRecoverySupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';

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

  if (state.errorCode === 'DB_UNSUPPORTED_NATIVE_VERSION') {
    return {
      title: 'Esta versión de Lanzo no puede abrir tu base local',
      body: 'Tus datos permanecen guardados. Esta base fue utilizada por una versión más reciente de Lanzo y esta instalación no puede abrirla de forma segura.',
      advice: 'No borres los datos de la aplicación. Actualiza Lanzo o envía el diagnóstico a soporte para que podamos revisar tu instalación.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'TENANT_DIRECTORY_CORRUPT') {
    return {
      title: 'El almacenamiento local de este tenant no puede abrirse de forma segura',
      body: 'Lanzo detectó una referencia local sin su base física correspondiente. No se eliminó ningún dato local.',
      advice: 'No crees ni restablezcas una base local. Puedes reintentar o enviar el diagnóstico a soporte para una revisión segura.',
      icon: 'warning'
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

  if (state.errorCode === 'DB_BROWSER_STORAGE_UNAVAILABLE') {
    return {
      title: 'No se pudo abrir el almacenamiento local del navegador',
      body: 'Lanzo requiere IndexedDB para operar de forma segura. El sistema permanece bloqueado para proteger los datos del negocio.',
      advice: 'Cierra otras pestañas de Lanzo y vuelve a intentar. No borres los datos del navegador ni dependas de otorgar almacenamiento persistente para resolver este diagnóstico.',
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
  reloadPage = () => window.location.reload(),
  openSupportMailto = (url) => { window.location.href = url; }
}) {
  const recovery = useDatabaseRecoveryState();
  const nativeOperations = useNativeDatabaseOperationState();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [supportActionError, setSupportActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isOnline, setIsOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const retryPromiseRef = useRef(null);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(globalThis.navigator?.onLine !== false);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const supportReport = useMemo(() => (recovery.status === DATABASE_RECOVERY_STATUS.FAILED
    ? buildDatabaseRecoverySupportReport(recovery, { online: isOnline })
    : null), [recovery, isOnline]);

  if (!BLOCKING_STATUSES.has(recovery.status)) return children;

  const hasActiveNativeRequest = nativeOperations.length > 0;
  const copy = describeRecovery(recovery, hasActiveNativeRequest);
  const operationActive = retrying
    || hasActiveNativeRequest
    || isLocalDatabasePreparationActive();
  const canRetry = (
    recovery.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    || (
      recovery.status === DATABASE_RECOVERY_STATUS.FAILED
      && recovery.errorCode === 'DB_BROWSER_STORAGE_UNAVAILABLE'
    )
  )
    && recovery.isRetryable !== false
    && recovery.errorCode !== 'DB_BLOCKED';
  const canReload = recovery.errorCode === 'DB_OPEN_TIMEOUT'
    || recovery.errorCode === 'TENANT_DIRECTORY_CORRUPT';

  const sendSupportReport = () => {
    if (!supportReport) return;
    openSupportMailto(buildSupportMailtoUrl({
      subject: `[Soporte Lanzo POS] Recuperación local - ${recovery.errorCode || 'sin-código'}`,
      body: supportReport
    }));
  };

  const copySupportReport = async () => {
    if (!supportReport) return;
    setSupportActionError('');
    const copiedSuccessfully = await copyTextToClipboard(supportReport);
    if (!copiedSuccessfully) {
      setSupportActionError('No se pudo copiar el diagnóstico automáticamente. Intenta nuevamente desde un navegador compatible.');
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 3_000);
  };

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
        {copy.advice && <p>{copy.advice}</p>}
        {recovery.affectedStores?.length > 0 && (
          <p><strong>Stores afectados:</strong> {recovery.affectedStores.join(', ')}</p>
        )}
        <MigrationDetails migration={recovery.migration} />
        {recovery.errorCode && recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <p><strong>Código:</strong> {recovery.errorCode}</p>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED
          && Number.isFinite(recovery.detectedNativeVersion) && (
            <p><strong>Versión local detectada:</strong> {recovery.detectedNativeVersion}</p>
          )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED
          && Number.isFinite(recovery.expectedNativeVersion) && (
            <p><strong>Versión compatible con esta instalación:</strong> {recovery.expectedNativeVersion}</p>
          )}
        {retryError && (
          <div className="ui-alert ui-alert--danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {retryError}
          </div>
        )}
        {supportActionError && (
          <div className="ui-alert ui-alert--danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {supportActionError}
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
          <>
            {!isOnline && (
              <p className="ui-alert ui-alert--warning" role="status">
                Estás sin conexión. Tus datos siguen guardados. Puedes copiar el diagnóstico ahora y enviarlo a soporte cuando recuperes conexión.
              </p>
            )}
            <div className="app-boot-recovery__actions">
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={sendSupportReport}
              >
                <Mail size={18} aria-hidden="true" />
                Enviar reporte a soporte
              </button>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => { void copySupportReport(); }}
              >
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
              </button>
            </div>
          </>
        )}
        <p className="app-boot-recovery__note">
          Lanzo no borrará tus datos durante esta recuperación.
        </p>
      </section>
    </main>
  );
}
