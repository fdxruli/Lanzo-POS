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
import { getSafeIncidentCode, INCIDENT_CATEGORY } from '../../services/diagnostics/incidentDiagnostics';
import { captureIncident } from '../../services/diagnostics/incidentCapture';
import IncidentReportEntry from './IncidentReportEntry';

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

const SAFE_MIGRATION_PHASES = new Set([
  'backup_starting',
  'backup_complete',
  'rebuild_starting',
  'rebuild_complete',
  'restore_invalid_backup_entry',
  'restore_collision',
  'validation_failed'
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
  openSupportMailto = (url) => { window.location.href = url; }
}) {
  const recovery = useDatabaseRecoveryState();
  const nativeOperations = useNativeDatabaseOperationState();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [supportActionError, setSupportActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [incidentRecord, setIncidentRecord] = useState(null);
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

  useEffect(() => {
    if (recovery.status !== DATABASE_RECOVERY_STATUS.FAILED) {
      setIncidentRecord(null);
      return;
    }
    setIncidentRecord(captureIncident(
      Object.assign(new Error('IndexedDB recovery requires review'), { code: recovery.errorCode }),
      {
        source: 'indexeddb',
        category: 'indexeddb',
        severity: 'critical_blocker',
        recoveryStatus: 'failed'
      }
    ));
  }, [recovery.status, recovery.errorCode]);

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
  const canReload = !hasActiveNativeRequest && (
    recovery.errorCode === 'DB_OPEN_TIMEOUT'
    || recovery.errorCode === 'TENANT_DIRECTORY_CORRUPT'
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

  const isChecking = recovery.status === DATABASE_RECOVERY_STATUS.IDLE
    || recovery.status === DATABASE_RECOVERY_STATUS.CHECKING
    || recovery.status === DATABASE_RECOVERY_STATUS.MIGRATING;
  const statusLabel = isChecking
    ? 'Comprobando almacenamiento local'
    : retrying
      ? 'Recuperación en curso'
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
              className="ui-button ui-button--secondary"
              onClick={reloadPage}
            >
              <RotateCw size={18} aria-hidden="true" />
              Reiniciar Lanzo
            </button>
          )}
          {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && !canRetry && (
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
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={() => { void copySupportReport(); }}
            >
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
            </button>
            <p className="app-boot-recovery__note">
              El botón de correo abre tu aplicación de correo; revisa y envía el mensaje cuando estés listo.
            </p>
          </details>
        )}
        {recovery.status === DATABASE_RECOVERY_STATUS.FAILED && (
          <IncidentReportEntry incident={incidentRecord} />
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
