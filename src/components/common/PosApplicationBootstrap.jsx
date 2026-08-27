import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, Mail, RotateCw } from 'lucide-react';
import DatabaseRecoveryGate from './DatabaseRecoveryGate';
import Logger from '../../services/Logger';
import { cleanupDevelopmentServiceWorkers as defaultCleanupDevelopmentServiceWorkers } from '../../services/devServiceWorkerCleanup';
import {
  completeAdminStartupRecovery,
  isRecoverableAdminStartupError,
  recoverAdminStartup
} from '../../pwa/adminStartupRecovery';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import {
  initializeLocalTenantGuard,
  resetLocalTenantGuardForTests
} from '../../services/tenant/localTenantGuard';
import { getTenantRuntimeReadiness } from '../../services/db/tenantRuntimeRouter';
import {
  buildAdminBootSupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';

let initialPreparationPromise = null;
let readyRuntimePromise = null;
let readyRuntimeActivated = false;

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

export const runStorageManagerBestEffort = (storageManager) => {
  if (!storageManager?.initialize) return;

  Promise.resolve(storageManager.initialize())
    .then((conditions) => {
      if (conditions?.isVolatile) {
        const isExpectedBestEffort = conditions.persistenceState === 'denied'
          && conditions.canStart !== false;
        const log = isExpectedBestEffort ? Logger.info : Logger.warn;
        log('[Boot] Almacenamiento local en modo best-effort.', {
          persistenceState: conditions.persistenceState,
          recommendation: conditions.recommendation || []
        });
      }
      if (conditions?.isCritical) {
        Logger.error('[Boot] Almacenamiento crítico.', {
          quotaPercent: conditions?.quota?.percentUsed
        });
      }
    })
    .catch((error) => {
      Logger.warn('[Boot] StorageManager no pudo completar la comprobación best-effort.', {
        message: error?.message || 'unknown'
      });
    });
};

export const loadPosReadyRuntime = async () => {
  const [
    { default: App },
    { GoogleOAuthProvider },
    { createBrowserRouter, RouterProvider, useRouteError },
    { default: ErrorBoundary },
    { startPosSyncAutoBootstrap },
    { installProductStoreRecoveryGuard },
    { installMobileZoomGuard },
    { installDevConsoleCapture },
    { default: DevConsole },
    { storageManager }
  ] = await Promise.all([
    import('../../App.jsx'),
    import('@react-oauth/google'),
    import('react-router-dom'),
    import('./ErrorBoundary'),
    import('../../services/sync/posSyncBootstrapAutoCoordinator'),
    import('../../store/productStoreRecoveryGuard'),
    import('../../services/mobileZoomGuard'),
    import('../../services/devConsoleCapture'),
    import('../debug/DevConsole'),
    import('../../services/storageManager')
  ]);

  function Thrower({ error }) {
    throw error;
  }

  function RouteErrorFallback() {
    const error = useRouteError();
    return (
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>
    );
  }

  const router = createBrowserRouter([
    {
      path: '*',
      element: <App />,
      errorElement: <RouteErrorFallback />
    }
  ]);

  function PosReadyApplication() {
    return (
      <>
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
          <ErrorBoundary>
            <RouterProvider router={router} />
          </ErrorBoundary>
        </GoogleOAuthProvider>
        {DevConsole ? <DevConsole /> : null}
      </>
    );
  }

  return {
    ReadyApplication: PosReadyApplication,
    activate: () => {
      installDevConsoleCapture();
      installMobileZoomGuard();
      installProductStoreRecoveryGuard();
      startPosSyncAutoBootstrap();
      runStorageManagerBestEffort(storageManager);
    }
  };
};

export const startInitialDatabasePreparation = ({
  databaseRuntime,
  cleanupDevelopmentServiceWorkers = defaultCleanupDevelopmentServiceWorkers
}) => {
  if (initialPreparationPromise) return initialPreparationPromise;

  initialPreparationPromise = (async () => {
    let canContinueBoot = true;
    try {
      canContinueBoot = await cleanupDevelopmentServiceWorkers();
    } catch (error) {
      Logger.warn('[Boot] La limpieza de service workers de desarrollo falló sin bloquear el preflight.', {
        message: error?.message || 'unknown'
      });
    }

    if (canContinueBoot === false) {
      return { ready: false, interruptedForCleanup: true };
    }

    return databaseRuntime.prepareLocalDatabase();
  })();

  return initialPreparationPromise;
};

export const activatePosReadyRuntime = (loadReadyRuntime = loadPosReadyRuntime) => {
  if (!readyRuntimePromise) {
    // Database preflight has completed before this function is reached. Lock
    // tenant-owned Dexie/runtime caches before importing App and its stores.
    initializeLocalTenantGuard('ready_runtime_loading');
    readyRuntimePromise = Promise.resolve().then(loadReadyRuntime);
  }

  return readyRuntimePromise.then((runtime) => {
    if (!readyRuntimeActivated) {
      runtime.activate?.();
      readyRuntimeActivated = true;
    }
    return runtime;
  });
};

export const getAdminBootErrorCode = (error) => (
  error?.code
  || (/\bTENANT_RUNTIME_NOT_READY\b/.test(error?.message || '')
    ? 'TENANT_RUNTIME_NOT_READY'
    : 'ADMIN_RUNTIME_INITIALIZATION_FAILED')
);

export const classifyAdminBootError = (error) => (
  isRecoverableAdminStartupError(error) ? 'asset_load_failure' : 'application_runtime'
);

const ReadyRuntimeLoading = ({
  error,
  isRecovering,
  onAssetRecovery,
  onRetryStart,
  onSendSupport,
  onCopySupport,
  copied,
  supportActionError,
  isOnline
}) => {
  const assetFailure = error && classifyAdminBootError(error) === 'asset_load_failure';
  const code = error ? getAdminBootErrorCode(error) : null;

  return (
  <main className="app-boot-recovery" role={error ? 'alert' : 'status'} aria-live="polite">
    <section className="app-boot-recovery__card">
      <h1>
        {isRecovering
          ? 'Actualizando Lanzo POS...'
          : error
            ? assetFailure ? 'No se pudo cargar Lanzo POS' : 'No se pudo iniciar Lanzo POS'
            : 'Preparando Lanzo POS...'}
      </h1>
      <p>
        {isRecovering
          ? 'Estamos reemplazando los archivos anteriores por la versión más reciente.'
          : error
            ? assetFailure
              ? 'La base local está lista, pero los archivos administrativos no pudieron cargarse. Actualiza para recuperar el sistema.'
              : 'La base local está protegida, pero Lanzo no pudo completar el inicio de la aplicación. Tus datos locales no se han eliminado.'
            : 'La base local está lista. Estamos cargando el entorno administrativo.'}
      </p>
      {code && !assetFailure && <p><strong>Código:</strong> {code}</p>}
      {error && !isRecovering && (
        assetFailure ? (
          <button type="button" className="ui-button ui-button--primary" onClick={onAssetRecovery}>
            Actualizar Lanzo POS
          </button>
        ) : (
          <>
            {!isOnline && (
              <p className="ui-alert ui-alert--warning" role="status">
                Estás sin conexión. Tus datos locales siguen preservados; puedes copiar el diagnóstico y enviarlo después.
              </p>
            )}
            {supportActionError && <p className="ui-alert ui-alert--danger" role="alert">{supportActionError}</p>}
            <div className="app-boot-recovery__actions">
              <button type="button" className="ui-button ui-button--primary" onClick={onRetryStart}>
                <RotateCw size={18} aria-hidden="true" />
                Reintentar inicio
              </button>
              <button type="button" className="ui-button ui-button--secondary" onClick={onSendSupport}>
                <Mail size={18} aria-hidden="true" />
                Enviar reporte a soporte
              </button>
              <button type="button" className="ui-button ui-button--secondary" onClick={onCopySupport}>
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
              </button>
            </div>
          </>
        )
      )}
    </section>
  </main>
  );
};

export default function PosApplicationBootstrap({
  databaseRuntime,
  cleanupDevelopmentServiceWorkers = defaultCleanupDevelopmentServiceWorkers,
  loadReadyRuntime = loadPosReadyRuntime,
  recoverStartup = recoverAdminStartup,
  completeStartupRecovery = completeAdminStartupRecovery,
  reloadPage = () => window.location.reload(),
  openSupportMailto = (url) => { window.location.href = url; }
}) {
  const recovery = useDatabaseRecoveryState();
  const [ReadyApplication, setReadyApplication] = useState(null);
  const [readyRuntimeError, setReadyRuntimeError] = useState(null);
  const [isRecoveringRuntime, setIsRecoveringRuntime] = useState(false);
  const [supportActionError, setSupportActionError] = useState('');
  const [copiedSupportReport, setCopiedSupportReport] = useState(false);
  const [isOnline, setIsOnline] = useState(() => globalThis.navigator?.onLine !== false);
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

  const supportReport = useMemo(() => {
    if (!readyRuntimeError || classifyAdminBootError(readyRuntimeError) === 'asset_load_failure') return null;
    const readiness = getTenantRuntimeReadiness();
    return buildAdminBootSupportReport({
      errorCode: getAdminBootErrorCode(readyRuntimeError),
      message: readyRuntimeError?.message,
      classification: classifyAdminBootError(readyRuntimeError),
      stage: 'ready_runtime_loading',
      databaseRecoveryStatus: recovery.status,
      tenantRuntimeReady: readiness.ready,
      assetRecoveryAttempted: false,
      assetRecoveryResult: 'No intentada para error de runtime'
    }, { online: isOnline });
  }, [isOnline, readyRuntimeError, recovery.status]);

  useEffect(() => {
    let active = true;

    startInitialDatabasePreparation({
      databaseRuntime,
      cleanupDevelopmentServiceWorkers
    }).catch((error) => {
      if (!active) return;
      Logger.warn('[Boot] La preparación local quedó dentro del recovery shell.', {
        code: error?.code || 'DB_RECOVERY_REQUIRED'
      });
    });

    return () => {
      active = false;
    };
  }, [cleanupDevelopmentServiceWorkers, databaseRuntime]);

  useEffect(() => {
    if (recovery.status !== DATABASE_RECOVERY_STATUS.READY || ReadyApplication) return undefined;

    let active = true;
    activatePosReadyRuntime(loadReadyRuntime)
      .then((runtime) => {
        if (!active) return;
        completeStartupRecovery();
        setReadyApplication(() => runtime.ReadyApplication);
        setReadyRuntimeError(null);
        setIsRecoveringRuntime(false);
      })
      .catch(async (error) => {
        if (!active) return;
        Logger.error('[Boot] No se pudo cargar el runtime administrativo después de READY.', error);
        setReadyRuntimeError(error);
        setSupportActionError('');
        setCopiedSupportReport(false);

        if (!isRecoverableAdminStartupError(error)) return;

        setIsRecoveringRuntime(true);
        try {
          const result = await recoverStartup({ error });
          if (!active) return;
          if (result?.status !== 'reloading') setIsRecoveringRuntime(false);
        } catch (recoveryError) {
          if (!active) return;
          Logger.error('[Boot] Falló la recuperación del runtime administrativo.', recoveryError);
          setIsRecoveringRuntime(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    ReadyApplication,
    completeStartupRecovery,
    loadReadyRuntime,
    recoverStartup,
    recovery.status
  ]);

  const retryAssetReadyRuntimeRecovery = async () => {
    if (!readyRuntimeError || isRecoveringRuntime) return;

    setIsRecoveringRuntime(true);
    try {
      const result = await recoverStartup({
        error: readyRuntimeError,
        force: true
      });
      if (result?.status !== 'reloading') setIsRecoveringRuntime(false);
    } catch (recoveryError) {
      Logger.error('[Boot] No se pudo forzar la recuperación del runtime administrativo.', recoveryError);
      setIsRecoveringRuntime(false);
    }
  };

  const retryAdministrativeStart = () => reloadPage();

  const sendSupportReport = () => {
    if (!supportReport) return;
    openSupportMailto(buildSupportMailtoUrl({
      subject: `[Soporte Lanzo POS] Error de inicio - ${getAdminBootErrorCode(readyRuntimeError)}`,
      body: supportReport
    }));
  };

  const copySupportReport = async () => {
    if (!supportReport) return;
    setSupportActionError('');
    const copied = await copyTextToClipboard(supportReport);
    if (!copied) {
      setSupportActionError('No se pudo copiar el diagnóstico automáticamente. Intenta nuevamente desde un navegador compatible.');
      return;
    }
    setCopiedSupportReport(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedSupportReport(false), 3_000);
  };

  return (
    <DatabaseRecoveryGate>
      {ReadyApplication
        ? <ReadyApplication />
        : (
          <ReadyRuntimeLoading
            error={readyRuntimeError}
            isRecovering={isRecoveringRuntime}
            onAssetRecovery={retryAssetReadyRuntimeRecovery}
            onRetryStart={retryAdministrativeStart}
            onSendSupport={sendSupportReport}
            onCopySupport={() => { void copySupportReport(); }}
            copied={copiedSupportReport}
            supportActionError={supportActionError}
            isOnline={isOnline}
          />
        )}
    </DatabaseRecoveryGate>
  );
}

export const resetPosApplicationBootstrapForTests = () => {
  initialPreparationPromise = null;
  readyRuntimePromise = null;
  readyRuntimeActivated = false;
  resetLocalTenantGuardForTests();
};
