import { useEffect, useState, useSyncExternalStore } from 'react';
import DatabaseRecoveryGate from './DatabaseRecoveryGate';
import Logger from '../../services/Logger';
import { cleanupDevelopmentServiceWorkers as defaultCleanupDevelopmentServiceWorkers } from '../../services/devServiceWorkerCleanup';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';

let initialPreparationPromise = null;
let readyRuntimePromise = null;
let readyRuntimeActivated = false;

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

const runStorageManagerBestEffort = (storageManager) => {
  if (!storageManager?.initialize) return;

  Promise.resolve(storageManager.initialize())
    .then((conditions) => {
      if (conditions?.isVolatile) {
        Logger.warn('[Boot] Almacenamiento en modo best-effort.', {
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

const ReadyRuntimeLoading = ({ error }) => (
  <main className="app-boot-recovery" role={error ? 'alert' : 'status'} aria-live="polite">
    <section className="app-boot-recovery__card">
      <h1>{error ? 'No se pudo cargar Lanzo POS' : 'Preparando Lanzo POS...'}</h1>
      <p>
        {error
          ? 'La base local está lista, pero el shell administrativo no pudo cargarse. Recarga para intentarlo nuevamente.'
          : 'La base local está lista. Estamos cargando el entorno administrativo.'}
      </p>
      {error && (
        <button
          type="button"
          className="ui-button ui-button--primary"
          onClick={() => window.location.reload()}
        >
          Recargar
        </button>
      )}
    </section>
  </main>
);

export default function PosApplicationBootstrap({
  databaseRuntime,
  cleanupDevelopmentServiceWorkers = defaultCleanupDevelopmentServiceWorkers,
  loadReadyRuntime = loadPosReadyRuntime
}) {
  const recovery = useDatabaseRecoveryState();
  const [ReadyApplication, setReadyApplication] = useState(null);
  const [readyRuntimeError, setReadyRuntimeError] = useState(null);

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
        setReadyApplication(() => runtime.ReadyApplication);
        setReadyRuntimeError(null);
      })
      .catch((error) => {
        if (!active) return;
        Logger.error('[Boot] No se pudo cargar el runtime administrativo después de READY.', error);
        setReadyRuntimeError(error);
      });

    return () => {
      active = false;
    };
  }, [ReadyApplication, loadReadyRuntime, recovery.status]);

  return (
    <DatabaseRecoveryGate>
      {ReadyApplication
        ? <ReadyApplication />
        : <ReadyRuntimeLoading error={readyRuntimeError} />}
    </DatabaseRecoveryGate>
  );
}

export const resetPosApplicationBootstrapForTests = () => {
  initialPreparationPromise = null;
  readyRuntimePromise = null;
  readyRuntimeActivated = false;
};
