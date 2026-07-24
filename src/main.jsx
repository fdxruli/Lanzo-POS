import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom';
import { publicStoreRoutes } from './router/publicStoreRoutes';
import { isPublicStorePath } from './router/isPublicStorePath';
import { preparePublicStoreDocument } from './router/preparePublicStoreDocument';
import { installAdminPwaDocument } from './pwa/adminPwaDocument';
import { startAdminInstallPromptCapture } from './pwa/adminInstallPrompt';
import { startAdminServiceWorker } from './pwa/adminServiceWorker';
import { updateExistingAdminWorkerOnPublicRoute } from './pwa/publicRouteWorkerUpdate';
import './index.css';
import './styles/design-tokens.css';
import './styles/ui-button.css';
import './styles/ui-modal.css';
import './styles/ui-card.css';
import './styles/ui-alert.css';
import './styles/ui-badge.css';
import './styles/ui-shell.css';
import './styles/ui-tabs.css';

const rootElement = document.getElementById('root');

function Thrower({ error }) {
  throw error;
}

function renderPublicStore() {
  const router = createBrowserRouter(publicStoreRoutes);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}

async function renderPosApplication() {
  const [
    { default: App },
    { GoogleOAuthProvider },
    { storageManager },
    { default: Logger },
    { default: ErrorBoundary },
    { cleanupDevelopmentServiceWorkers },
    { startPosSyncAutoBootstrap },
    { installMobileZoomGuard },
    { installDevConsoleCapture },
  ] = await Promise.all([
    import('./App.jsx'),
    import('@react-oauth/google'),
    import('./services/storageManager'),
    import('./services/Logger'),
    import('./components/common/ErrorBoundary'),
    import('./services/devServiceWorkerCleanup'),
    import('./services/sync/posSyncBootstrapAutoCoordinator'),
    import('./services/mobileZoomGuard'),
    import('./services/devConsoleCapture'),
  ]);

  installDevConsoleCapture();
  installMobileZoomGuard();

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
      errorElement: <RouteErrorFallback />,
    },
  ]);

  const canContinueBoot = await cleanupDevelopmentServiceWorkers();
  if (!canContinueBoot) return;

  try {
    Logger.info('🚀 Boot: Inicializando StorageManager...');
    const conditions = await storageManager.initialize();

    if (conditions.isVolatile) {
      Logger.warn(
        '⚠️ BOOT WARNING: Almacenamiento en modo volátil (Best-Effort)\n'
        + 'Tus datos de venta pueden perderse si el SO o navegador libera memoria.\n'
        + `Recomendación: ${conditions.recommendation.join(' | ')}`
      );
    }

    if (conditions.isCritical) {
      Logger.error(
        '🔴 BOOT CRITICAL: Almacenamiento crítico (>90% lleno)\n'
        + 'Sincroniza inmediatamente o libera espacio.'
      );
    }

    Logger.info('✅ Boot: StorageManager listo', {
      persistenceState: conditions.persistenceState,
      quotaPercent: conditions.quota?.percentUsed,
    });
  } catch (error) {
    Logger.error('❌ Boot: Error crítico en StorageManager', error);
  }

  startPosSyncAutoBootstrap();

  const DevConsole = (await import('./components/debug/DevConsole')).default;

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <>
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
          <ErrorBoundary>
            <RouterProvider router={router} />
          </ErrorBoundary>
        </GoogleOAuthProvider>
        {DevConsole ? <DevConsole /> : null}
      </>
    </React.StrictMode>
  );
}

if (isPublicStorePath(window.location.pathname)) {
  preparePublicStoreDocument();
  updateExistingAdminWorkerOnPublicRoute();
  renderPublicStore();
} else {
  if (!import.meta.env.DEV) {
    installAdminPwaDocument();
  }
  startAdminInstallPromptCapture();
  if (!import.meta.env.DEV) {
    startAdminServiceWorker();
  }
  renderPosApplication().catch((error) => {
    console.error('No se pudo iniciar Lanzo POS.', error);
    ReactDOM.createRoot(rootElement).render(
      <main className="public-store-shell public-store-shell--centered" role="alert">
        <section className="public-store-state public-store-state--card">
          <h1>No se pudo iniciar Lanzo POS</h1>
          <p>Recarga la página para intentarlo nuevamente.</p>
          <button type="button" className="ui-button ui-button--primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </section>
      </main>
    );
  });
}
