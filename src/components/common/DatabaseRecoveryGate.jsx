import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Database, Mail, RefreshCw, RotateCw } from 'lucide-react';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import {
  getLocalDatabaseActivityRevision,
  getLocalDatabaseActivitySnapshot,
  subscribeLocalDatabaseActivity,
  retryLocalDatabaseRecovery
} from '../../services/db/databaseRuntime';
import {
  buildDatabaseRecoverySupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';
import { getSafeIncidentCode, INCIDENT_CATEGORY } from '../../services/diagnostics/incidentDiagnostics';

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

const useLocalDatabaseActivityRevision = () => useSyncExternalStore(
  subscribeLocalDatabaseActivity,
  getLocalDatabaseActivityRevision,
  getLocalDatabaseActivityRevision
);

const RESTART_BUSY_REASONS = new Set([
  'local_database_active',
  'write_active',
  'business_operation_active',
  'checkout_active',
  'backup_active',
  'sync_active',
  'draft_active',
  'bootstrap_active'
]);

const RESTART_BLOCKER_COPY = Object.freeze({
  local_database_active: 'El navegador todavía mantiene una solicitud de IndexedDB activa o una preparación local en curso. Espera a que termine.',
  write_active: 'Hay cambios locales guardándose. Espera a que terminen.',
  business_operation_active: 'Hay una operación del negocio en curso.',
  checkout_active: 'Hay un cobro u otra operación comercial en curso.',
  backup_active: 'Hay un respaldo o restauración en curso.',
  sync_active: 'Hay una sincronización en curso.',
  draft_active: 'Hay cambios locales o una operación pendiente. Resuélvela antes de reiniciar.',
  bootstrap_active: 'Lanzo todavía está completando una operación de inicio.',
  context_unverified: 'No se pudo confirmar que la base local corresponda al negocio activo.',
  context_changed: 'La sesión o el negocio cambió desde que ocurrió el error.',
  restart_unverified: 'No se pudo confirmar que este error permita reiniciar de forma segura.',
  safety_unverified: 'No se pudo confirmar que sea seguro reiniciar en este momento.'
});

const SAFE_FAILURE_PHASE_COPY = Object.freeze({
  runtime_resolution: 'Resolución del runtime local',
  database_resolution: 'Resolución de la base local',
  database_state_check: 'Comprobación del estado de Dexie',
  dexie_open: 'Apertura de Dexie',
  ready_confirmation: 'Confirmación de preparación',
  startup_interrupted: 'Preparación inicial interrumpida',
  unknown: 'No determinada'
});
const NOOP_SUBSCRIBE = () => () => {};

const BLOCKING_STATUSES = new Set([
  DATABASE_RECOVERY_STATUS.IDLE,
  DATABASE_RECOVERY_STATUS.CHECKING,
  DATABASE_RECOVERY_STATUS.MIGRATING,
  DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
  DATABASE_RECOVERY_STATUS.FAILED
]);

const SAFE_MIGRATION_PHASES = new Set([
  'backup_starting',
  'backup_complete',
  'rebuild_starting',
  'rebuild_complete',
  'restore_invalid_backup_entry',
  'restore_collision',
  'validation_failed'
]);

const describeRecovery = (state, hasActiveNativeRequest, hasActivePreparation) => {
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
      body: 'La comprobación no pudo abrir la base local. Esta instalación no puede acceder a ella de forma segura.',
      advice: 'No borres los datos de la aplicación. Actualiza Lanzo o envía el diagnóstico a soporte para que podamos revisar tu instalación.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'TENANT_DIRECTORY_CORRUPT') {
    return {
      title: 'El almacenamiento local de este tenant no puede abrirse de forma segura',
      body: 'Lanzo detectó que no puede localizar de forma segura la base local de este tenant. Esta comprobación no ejecutó una limpieza de datos.',
      advice: 'No crees ni restablezcas una base local. Puedes reintentar o enviar el diagnóstico a soporte para una revisión segura.',
      icon: 'warning'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.MIGRATING) {
    return {
      title: 'Preparando una actualización de la base local...',
      body: 'Lanzo está comprobando y preparando la base local. No cierres esta pestaña durante el proceso.',
      icon: 'database'
    };
  }

  if (state.errorCode === 'DB_BLOCKED') {
    return {
      title: 'Cierra las demás pestañas de Lanzo',
      body: 'La base local está siendo usada por otra pestaña o ventana. Lanzo esperará a que se cierre la conexión bloqueante antes de continuar; el estado de las operaciones locales debe verificarse al volver a abrir.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_OPEN_TIMEOUT') {
    return {
      title: 'La apertura de la base local tardó demasiado',
      body: hasActiveNativeRequest
        ? 'El navegador todavía mantiene una solicitud activa. Espera a que termine antes de intentar otra recuperación.'
        : 'La solicitud anterior ya terminó. Puedes reintentar la recuperación de forma segura o recargar Lanzo.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_TIMEOUT') {
    return {
      title: 'La apertura de la base local no terminó',
      body: hasActiveNativeRequest
        ? 'El navegador todavía mantiene una solicitud de IndexedDB activa. No reintentes ni reinicies Lanzo mientras siga activa.'
        : hasActivePreparation
          ? 'La preparación anterior sigue pendiente. Espera a que termine antes de reiniciar Lanzo o iniciar otra recuperación.'
          : 'Lanzo no pudo confirmar que el almacenamiento local esté disponible. El acceso sigue bloqueado para proteger tus datos.',
      advice: 'No borres los datos del navegador. Copia el diagnóstico y solicita una revisión antes de intentar otra recuperación.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_OPERATION_FAILED') {
    const restartBlockerCopy = RESTART_BLOCKER_COPY[state.restartBlockReason]
      || RESTART_BLOCKER_COPY.safety_unverified;
    if (RESTART_BUSY_REASONS.has(state.restartBlockReason)) {
      return {
        title: 'No se pudo comprobar la base local',
        body: 'Todavía existe una operación local en curso. Espera a que termine antes de reiniciar Lanzo.',
        advice: restartBlockerCopy,
        icon: 'warning',
        restartState: 'busy'
      };
    }
    if (state.restartBlockReason) {
      return {
        title: 'No se pudo comprobar la base local',
        body: 'No se puede confirmar que sea seguro reiniciar en este momento. El acceso permanece bloqueado.',
        advice: restartBlockerCopy,
        icon: 'warning',
        restartState: 'unverified'
      };
    }
    return {
      title: 'No se pudo comprobar la base local',
      body: 'Lanzo no pudo completar la comprobación de los datos locales. Puedes reiniciar la aplicación para intentar abrirla nuevamente.',
      advice: 'No borres los datos del navegador. Reiniciar Lanzo no elimina el almacenamiento local.',
      icon: 'warning',
      restartState: 'available'
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
      body: 'Detectamos un esquema local que requiere migración. Mantén esta pestaña abierta durante el proceso y verifica ventas, inventario y movimientos antes de continuar operando.',
      icon: 'database'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.FAILED) {
    return {
      title: 'La recuperación automática no pudo completarse',
      body: 'La recuperación no pudo confirmar el estado completo de la base local. Mantén esta instalación sin operar y solicita una revisión técnica con el código de diagnóstico mostrado.',
      icon: 'warning'
    };
  }

  return {
    title: 'La base local necesita recuperación',
    body: 'El flujo no ejecuta un vaciado general de la base local. Su estado debe verificarse antes de continuar; cierra otras pestañas de Lanzo y reintenta.',
    icon: 'warning'
  };
};

const MigrationDetails = ({ migration }) => {
  const phase = SAFE_MIGRATION_PHASES.has(migration?.phase) ? migration.phase : null;
  if (!phase) return null;

  return (
    <div className="app-boot-recovery__details" aria-label="Progreso de migración">
      <p><strong>Fase:</strong> {phase}</p>
    </div>
  );
};

export default function DatabaseRecoveryGate({
  children,
  reloadPage = () => window.location.reload(),
  openSupportMailto = (url) => { window.location.href = url; },
  getRestartBlockReason = () => 'safety_unverified',
  subscribeRestartSafety = NOOP_SUBSCRIBE
}) {
  const recovery = useDatabaseRecoveryState();
  useLocalDatabaseActivityRevision();
  const databaseActivity = getLocalDatabaseActivitySnapshot();
  const restartBlockReason = useSyncExternalStore(
    subscribeRestartSafety,
    () => {
      if (recovery.errorCode !== 'DB_OPERATION_FAILED') return null;
      try {
        const reason = getRestartBlockReason(recovery.failure?.id);
        return reason === null ? null : typeof reason === 'string' ? reason : 'safety_unverified';
      } catch {
        return 'safety_unverified';
      }
    },
    () => recovery.errorCode === 'DB_OPERATION_FAILED' ? 'safety_unverified' : null
  );
  const [retrying, setRetrying] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartActionBlockReason, setRestartActionBlockReason] = useState(null);
  const [retryError, setRetryError] = useState('');
  const [supportActionError, setSupportActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isOnline, setIsOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const retryPromiseRef = useRef(null);
  const restartStartedRef = useRef(false);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    setRestartActionBlockReason(null);
  }, [restartBlockReason]);

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

  const hasActiveNativeRequest = databaseActivity.hasActiveNativeRequest;
  const hasActivePreparation = databaseActivity.preparationActive
    || databaseActivity.preflightActive
    || databaseActivity.migrationActive;
  const operationActive = retrying || isRestarting || hasActiveNativeRequest || hasActivePreparation;
  const effectiveRestartBlockReason = restartActionBlockReason || restartBlockReason;
  const copy = describeRecovery({ ...recovery, restartBlockReason: effectiveRestartBlockReason }, hasActiveNativeRequest, hasActivePreparation);
  const canRetry = (
    recovery.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    || (
      recovery.status === DATABASE_RECOVERY_STATUS.FAILED
      && recovery.errorCode === 'DB_BROWSER_STORAGE_UNAVAILABLE'
    )
  )
    && recovery.isRetryable !== false
    && recovery.errorCode !== 'DB_BLOCKED';
  const isDatabaseOperationFailed = recovery.status === DATABASE_RECOVERY_STATUS.FAILED
    && recovery.errorCode === 'DB_OPERATION_FAILED';
  const canReload = !operationActive && (
    recovery.errorCode === 'DB_OPEN_TIMEOUT'
    || recovery.errorCode === 'TENANT_DIRECTORY_CORRUPT'
    || (isDatabaseOperationFailed && effectiveRestartBlockReason === null)
  );

  const sendSupportReport = () => {
    if (!supportReport) return;
    const safeCode = getSafeIncidentCode({ code: recovery.errorCode }, INCIDENT_CATEGORY.INDEXEDDB);
    openSupportMailto(buildSupportMailtoUrl({
      subject: `[Soporte Lanzo POS] Recuperación local - ${safeCode}`,
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
    .catch(() => {
        const safeCode = getSafeIncidentCode({ code: recovery.errorCode }, INCIDENT_CATEGORY.INDEXEDDB);
        setRetryError(`No se pudo completar el reintento. No podemos confirmar el estado final de la base local. Solicita revisión con el código ${safeCode}.`);
      })
      .finally(() => {
        retryPromiseRef.current = null;
        setRetrying(false);
      });

    retryPromiseRef.current = operation;
    return operation;
  };

  const restartAfterOperationFailure = () => {
    if (restartStartedRef.current || !isDatabaseOperationFailed) return;
    let finalBlockReason = 'safety_unverified';
    try {
      finalBlockReason = getRestartBlockReason(recovery.failure?.id);
    } catch {
      finalBlockReason = 'safety_unverified';
    }
    if (finalBlockReason !== null) {
      const safeReason = typeof finalBlockReason === 'string' && RESTART_BLOCKER_COPY[finalBlockReason]
        ? finalBlockReason
        : 'safety_unverified';
      setRestartActionBlockReason(safeReason);
      return;
    }

    restartStartedRef.current = true;
    setRestartActionBlockReason(null);
    setIsRestarting(true);
    reloadPage();
  };

  const isChecking = recovery.status === DATABASE_RECOVERY_STATUS.IDLE
    || recovery.status === DATABASE_RECOVERY_STATUS.CHECKING
    || recovery.status === DATABASE_RECOVERY_STATUS.MIGRATING;
  const statusLabel = isChecking
    ? 'Comprobando almacenamiento local'
    : retrying
      ? 'Recuperación en curso'
      : isRestarting
        ? 'Reiniciando Lanzo'
      : recovery.status === DATABASE_RECOVERY_STATUS.READY
        ? 'Verificación completada'
        : 'Requiere revisión';

  return (
    <main
      className="app-boot-recovery"
      role={isChecking ? 'status' : 'alert'}
      aria-live={isChecking ? 'polite' : 'assertive'}
    >
      <section className="app-boot-recovery__card">
        {copy.icon === 'warning'
          ? <AlertTriangle size={40} aria-hidden="true" />
          : <Database size={40} aria-hidden="true" />}
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {copy.advice && <p>{copy.advice}</p>}
        <MigrationDetails migration={recovery.migration} />
        {retryError && (
          <div className="ui-alert ui-alert--danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            {retryError}
          </div>
        )}
        {supportActionError && (
          <p className="ui-alert ui-alert--warning" role="status">
            {supportActionError}
          </p>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && !isOnline && (
          <p className="ui-alert ui-alert--warning" role="status">
            Estás sin conexión. El resultado completo de la base no puede verificarse ahora. Puedes copiar el diagnóstico y enviarlo después.
          </p>
        )}
        <div className="app-boot-recovery__actions">
          {canRetry && (
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={retry}
              disabled={operationActive}
              aria-describedby={operationActive ? 'database-recovery-disabled-reason' : undefined}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {retrying ? 'Reintentando recuperación…' : 'Reintentar recuperación'}
            </button>
          )}
          {canReload && (
            <button
              type="button"
              className={`ui-button ${isDatabaseOperationFailed ? 'ui-button--primary' : 'ui-button--secondary'}`}
              onClick={isDatabaseOperationFailed ? restartAfterOperationFailure : reloadPage}
              disabled={isRestarting}
            >
              <RotateCw size={18} aria-hidden="true" />
              {isRestarting ? 'Reiniciando Lanzo…' : 'Reiniciar Lanzo'}
            </button>
          )}
          {isDatabaseOperationFailed && (
            <>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={sendSupportReport}
              >
                <Mail size={18} aria-hidden="true" />
                Contactar a soporte
              </button>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => { void copySupportReport(); }}
              >
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
              </button>
            </>
          )}
          {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && !canRetry && !isDatabaseOperationFailed && (
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={sendSupportReport}
            >
              <Mail size={18} aria-hidden="true" />
              Abrir correo de soporte
            </button>
          )}
        </div>
        {operationActive && canRetry && (
          <p className="app-boot-recovery__note" id="database-recovery-disabled-reason" role="status">
            La recuperación espera a que termine la solicitud activa del navegador.
          </p>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <details className="app-boot-recovery__support">
            <summary>Detalles del problema</summary>
            <div className="app-boot-recovery__details">
              {recovery.errorCode && (
                <p><strong>Código técnico:</strong> {getSafeIncidentCode({ code: recovery.errorCode }, INCIDENT_CATEGORY.INDEXEDDB)}</p>
              )}
              {recovery.failure && (
                <>
                  <p><strong>Fase:</strong> {SAFE_FAILURE_PHASE_COPY[recovery.failure.phase] || SAFE_FAILURE_PHASE_COPY.unknown}</p>
                  <p><strong>Tipo técnico:</strong> {recovery.failure.errorType}</p>
                  {Number.isFinite(recovery.failure.durationMs) && (
                    <p><strong>Duración aproximada:</strong> {recovery.failure.durationMs} ms</p>
                  )}
                  <p><strong>Solicitud nativa:</strong> {recovery.failure.nativeRequestState}</p>
                </>
              )}
              {Number.isFinite(recovery.detectedNativeVersion) && (
                <p><strong>Versión local detectada:</strong> {recovery.detectedNativeVersion}</p>
              )}
              {Number.isFinite(recovery.expectedNativeVersion) && (
                <p><strong>Versión compatible:</strong> {recovery.expectedNativeVersion}</p>
              )}
              <p><strong>Conexión:</strong> {isOnline ? 'En línea' : 'Sin conexión'}</p>
              <p><strong>Estado de recuperación:</strong> {statusLabel}</p>
            </div>
            {canRetry && (
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={sendSupportReport}
              >
                <Mail size={18} aria-hidden="true" />
                Abrir correo de soporte
              </button>
            )}
            {!isDatabaseOperationFailed && (
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => { void copySupportReport(); }}
              >
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
              </button>
            )}
            <p className="app-boot-recovery__note">
              El botón de correo abre tu aplicación de correo; revisa y envía el mensaje cuando estés listo.
            </p>
          </details>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <p className="app-boot-recovery__note">
            Este flujo no elimina la base local. Aun así, Lanzo no puede confirmar el estado completo si la verificación falla.
          </p>
        )}
      </section>
    </main>
  );
}
