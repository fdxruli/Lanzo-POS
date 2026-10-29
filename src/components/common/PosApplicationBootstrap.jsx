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
  getActorCheckoutOwnerships,
  getPendingActorOperations
} from '../../services/auth/actorOperationalHandoff';
import {
  buildAdminBootSupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';
import { getSafeIncidentCode, INCIDENT_CATEGORY } from '../../services/diagnostics/incidentDiagnostics';
import { createRecoveryContextGuard } from '../../services/diagnostics/recoveryContext';

let initialPreparationPromise = null;
let readyRuntimePromise = null;
let readyRuntimeActivated = false;

const ADMIN_DEBUG_CONSOLE_VALID_PATHS = Object.freeze([
  '/',
  '/renovacion-urgente',
  '/caja',
  '/pedidos',
  '/pedidos-online',
  '/productos',
  '/clientes',
  '/ventas',
  '/agentes-ia',
  '/portal-online',
  '/configuracion',
  '/acerca-de',
]);

const normalizeAdminDebugPath = (pathname) => {
  const rawPath = typeof pathname === 'string' ? pathname : '/';
  let decodedPath = rawPath.split(/[?#]/, 1)[0] || '/';

  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Treat malformed encoded paths as unmatched.
  }

  return decodedPath.replace(/\/+$/, '').toLowerCase() || '/';
};

// Keep this list in sync with ADMIN_VALID_ROUTE_PATHS in adminRoutePaths.js.
export const isAdminNotFoundPathForDebugConsole = (pathname) => (
  !ADMIN_DEBUG_CONSOLE_VALID_PATHS.includes(normalizeAdminDebugPath(pathname))
);



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
    { createBrowserRouter, RouterProvider, useRouteError, useLocation },
    { default: ErrorBoundary },
    { startPosSyncAutoBootstrap },
    { installProductStoreRecoveryGuard },
    { installMobileZoomGuard },
    { installDevConsoleCapture },
    { default: DevConsole },
    { storageManager },
    { setAdminServiceWorkerReloadGuard },
    { getActorCheckoutOwnerships, getPendingActorOperations }
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
    import('../../services/storageManager'),
    import('../../pwa/adminServiceWorker'),
    import('../../services/auth/actorOperationalHandoff')
  ]);

  function Thrower({ error }) {
    throw error;
  }

  function RouteErrorFallback() {
    const error = useRouteError();
    return (
      <ErrorBoundary recoverySurface="application">
        <Thrower error={error} />
      </ErrorBoundary>
    );
  }

  function PosReadyRoute() {
    const { pathname } = useLocation();

    return (
      <>
        <App />
        {DevConsole ? (
          <ErrorBoundary>
            <DevConsole isSuppressed={isAdminNotFoundPathForDebugConsole(pathname)} />
          </ErrorBoundary>
        ) : null}
      </>
    );
  }

  const router = createBrowserRouter([
    {
      path: '*',
      element: <PosReadyRoute />,
      errorElement: <RouteErrorFallback />
    }
  ]);

  function PosReadyApplication() {
    return (
      <>
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
          <ErrorBoundary recoverySurface="application">
            <RouterProvider router={router} />
          </ErrorBoundary>
        </GoogleOAuthProvider>
      </>
    );
  }

  return {
    ReadyApplication: PosReadyApplication,
    activate: () => {
      setAdminServiceWorkerReloadGuard(() => (
        getActorCheckoutOwnerships().length === 0
        && getPendingActorOperations().length === 0
      ));
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

// Import/preparation alone never calls runtime.activate and must not mount App:
// App's ready effects (license realtime/credit autoheal) are commercial effects.
export const preparePosReadyRuntime = (loadReadyRuntime = loadPosReadyRuntime) => {
  if (!readyRuntimePromise) {
    // Database preflight has completed before this function is reached. Lock
    // tenant-owned Dexie/runtime caches before importing App and its stores.
    initializeLocalTenantGuard('ready_runtime_loading');
    readyRuntimePromise = Promise.resolve().then(loadReadyRuntime);
  }

  return readyRuntimePromise;
};

// Existing commercial entrypoint keeps its default activation and ordering.
export const activatePosReadyRuntime = (loadReadyRuntime = loadPosReadyRuntime) => (
  preparePosReadyRuntime(loadReadyRuntime).then((runtime) => {
    if (!readyRuntimeActivated) {
      runtime.activate?.();
      readyRuntimeActivated = true;
    }
    return runtime;
  })
);

export const getAdminBootErrorCode = (error) => {
  let candidate = 'ADMIN_RUNTIME_INITIALIZATION_FAILED';
  try {
    candidate = error?.code
      || (/\bTENANT_RUNTIME_NOT_READY\b/.test(error?.message || '')
        ? 'TENANT_RUNTIME_NOT_READY'
        : candidate);
  } catch {
    // A malformed error object must not break the startup recovery screen.
  }
  return getSafeIncidentCode({ code: candidate }, INCIDENT_CATEGORY.UNKNOWN);
};

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
  isOnline,
  assetRecoveryEnabled = true,
  canRetryStart = true
}) => {
  const assetFailure = error && classifyAdminBootError(error) === 'asset_load_failure';
  const code = error ? getAdminBootErrorCode(error) : null;
  const recoveryState = isRecovering
    ? 'Recuperación en curso'
    : error
      ? 'Requiere una acción'
      : 'Preparando inicio';

  return (
  <main
    className="app-boot-recovery"
    role={error ? 'alert' : 'status'}
    aria-live={error ? 'assertive' : 'polite'}
  >
    <section className="app-boot-recovery__card">
      <h1>
        {isRecovering
          ? 'Comprobando la recuperación de Lanzo POS…'
          : error
            ? assetFailure ? 'No pudimos cargar esta versión de Lanzo POS' : 'No pudimos iniciar Lanzo POS'
            : 'Preparando Lanzo POS...'}
      </h1>
      <p>
        {isRecovering
          ? 'Estamos verificando los archivos instalados. Mantén esta pestaña abierta.'
          : error
            ? assetFailure
              ? 'La preparación local terminó, pero los archivos de esta sección no pudieron cargarse. La actualización sólo se iniciará si la sesión, la conexión y el estado operativo lo permiten.'
              : 'Lanzo no pudo completar su inicio. Esta pantalla no ejecutó una limpieza de datos y no puede confirmar el estado de operaciones pendientes.'
            : 'La base local está lista. Estamos cargando el entorno administrativo.'}
      </p>
      {!isOnline && error && (
        <p className="ui-alert ui-alert--warning" role="status">
          Estás sin conexión. Se conservará la versión instalada; no se iniciará una actualización.
        </p>
      )}
      {error && !isRecovering && (
        assetFailure ? (
          <>
            {supportActionError && <p className="ui-alert ui-alert--warning" role="status">{supportActionError}</p>}
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={onAssetRecovery}
              disabled={!assetRecoveryEnabled || isRecovering || !isOnline}
              aria-describedby={!assetRecoveryEnabled || !isOnline ? 'admin-asset-recovery-disabled' : undefined}
            >
              Actualizar archivos de Lanzo POS
            </button>
            {(!assetRecoveryEnabled || !isOnline) && (
              <p
                className="app-boot-recovery__note"
                id="admin-asset-recovery-disabled"
                role="status"
              >
                {!isOnline
                  ? 'Estás sin conexión. La versión instalada se conserva hasta que la red esté disponible.'
                  : 'La recuperación está pausada porque la sesión o una operación activa requiere verificación.'}
              </p>
            )}
          </>
        ) : (
          <>
            {supportActionError && <p className="ui-alert ui-alert--danger" role="alert">{supportActionError}</p>}
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={onRetryStart}
              disabled={!canRetryStart}
              aria-describedby={!canRetryStart ? 'admin-start-retry-disabled' : undefined}
            >
                <RotateCw size={18} aria-hidden="true" />
                Reintentar inicio
            </button>
            {!canRetryStart && (
              <p className="app-boot-recovery__note" id="admin-start-retry-disabled" role="status">
                No podemos confirmar que sea seguro reiniciar ahora. Verifica cualquier operación pendiente y solicita soporte si continúa bloqueado.
              </p>
            )}
          </>
        )
      )}
      {error && !isRecovering && (
        <details className="app-boot-recovery__support">
          <summary>Detalles del problema y opciones de soporte</summary>
          <div className="app-boot-recovery__details">
            {code && <p><strong>Código técnico:</strong> {code}</p>}
            <p><strong>Tipo:</strong> {assetFailure ? 'Carga de archivos' : 'Inicio de la aplicación'}</p>
            <p><strong>Fecha y hora:</strong> {new Date().toLocaleString('es-MX')}</p>
            <p><strong>Versión:</strong> {import.meta.env.VITE_APP_VERSION || 'No disponible'}</p>
            <p><strong>Conexión:</strong> {isOnline ? 'En línea' : 'Sin conexión'}</p>
            <p><strong>Estado:</strong> {recoveryState}</p>
          </div>
          <div className="app-boot-recovery__actions">
            <button type="button" className="ui-button ui-button--secondary" onClick={onSendSupport}>
              <Mail size={18} aria-hidden="true" />
              Abrir correo de soporte
            </button>
            <button type="button" className="ui-button ui-button--secondary" onClick={onCopySupport}>
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
            </button>
          </div>
          <p className="app-boot-recovery__note">
            Se abrirá tu aplicación de correo. Revisa y envía el mensaje cuando estés listo.
          </p>
        </details>
      )}
      {error && (
        <p className="app-boot-recovery__note">
          Si una operación quedó pendiente, verifica su resultado antes de intentarlo de nuevo.
        </p>
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
  createContextGuard = createRecoveryContextGuard,
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
  const runtimeRecoveryContextGuardRef = useRef(null);

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
    const isContextCurrent = createContextGuard();
    runtimeRecoveryContextGuardRef.current = isContextCurrent;
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
        if (!isContextCurrent()) {
          setIsRecoveringRuntime(false);
          setSupportActionError('La sesión o el tenant cambió durante el inicio. Reabre Lanzo desde el contexto vigente; no repetiremos la recuperación anterior.');
          return;
        }

        setIsRecoveringRuntime(true);
        try {
          const result = await recoverStartup({ error, isContextCurrent });
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
    createContextGuard,
    loadReadyRuntime,
    recoverStartup,
    recovery.status
  ]);

  const retryAssetReadyRuntimeRecovery = async () => {
    if (!readyRuntimeError || isRecoveringRuntime) return;
    const isContextCurrent = runtimeRecoveryContextGuardRef.current;
    if (!isContextCurrent?.()) {
      setSupportActionError('La sesión o el tenant cambió durante el inicio. Reabre Lanzo desde el contexto vigente; no repetiremos la recuperación anterior.');
      return;
    }

    setIsRecoveringRuntime(true);
    try {
      const result = await recoverStartup({
        error: readyRuntimeError,
        force: true,
        isContextCurrent
      });
      if (result?.status !== 'reloading') setIsRecoveringRuntime(false);
    } catch (recoveryError) {
      Logger.error('[Boot] No se pudo forzar la recuperación del runtime administrativo.', recoveryError);
      setIsRecoveringRuntime(false);
    }
  };

  const canRetryAdministrativeStart = () => {
    try {
      return runtimeRecoveryContextGuardRef.current?.() === true
        && getActorCheckoutOwnerships().length === 0
        && getPendingActorOperations().length === 0;
    } catch {
      return false;
    }
  };

  const retryAdministrativeStart = () => {
    if (!canRetryAdministrativeStart()) {
      setSupportActionError('No podemos confirmar que sea seguro reiniciar ahora. Verifica cualquier operación pendiente y solicita soporte si continúa bloqueado.');
      return;
    }
    setSupportActionError('');
    reloadPage();
  };

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
          assetRecoveryEnabled={runtimeRecoveryContextGuardRef.current?.() !== false}
            canRetryStart={canRetryAdministrativeStart()}
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
