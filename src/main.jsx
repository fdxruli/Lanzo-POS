import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AdminStartupRecoveryScreen from './components/common/AdminStartupRecoveryScreen';
import { publicStoreRoutes } from './router/publicStoreRoutes';
import { isPublicStorePath } from './router/isPublicStorePath';
import { preparePublicStoreDocument } from './router/preparePublicStoreDocument';
import { installAdminPwaDocument } from './pwa/adminPwaDocument';
import { startAdminInstallPromptCapture } from './pwa/adminInstallPrompt';
import { startAdminServiceWorker } from './pwa/adminServiceWorker';
import { startAdminServiceWorkerUpdateMonitor } from './pwa/adminServiceWorkerUpdateMonitor';
import {
  isRecoverableAdminStartupError,
  recoverAdminStartup,
} from './pwa/adminStartupRecovery';
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
let startupRecoveryRoot = null;

function renderPublicStore() {
  const router = createBrowserRouter(publicStoreRoutes);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}

function renderStartupRecoveryScreen({ mode, onRetry }) {
  if (!startupRecoveryRoot) startupRecoveryRoot = ReactDOM.createRoot(rootElement);
  startupRecoveryRoot.render(
    <React.StrictMode>
      <AdminStartupRecoveryScreen mode={mode} onRetry={onRetry} />
    </React.StrictMode>
  );
}

async function renderPosApplication() {
  // databaseRuntime debe cargarse primero para registrar v24/v30 y parchear
  // db.open() antes de cualquier import del App o de stores de negocio.
  const [
    databaseRuntime,
    { default: PosApplicationBootstrap }
  ] = await Promise.all([
    import('./services/db/databaseRuntime'),
    import('./components/common/PosApplicationBootstrap')
  ]);

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PosApplicationBootstrap databaseRuntime={databaseRuntime} />
    </React.StrictMode>
  );
}

async function handlePosStartupFailure(error) {
  console.error('No se pudo iniciar Lanzo POS.', error);
  const recoverableVersionError = isRecoverableAdminStartupError(error);

  const retryRecovery = async () => {
    renderStartupRecoveryScreen({ mode: 'recovering' });
    try {
      await recoverAdminStartup({ error, force: true });
    } catch (recoveryError) {
      console.error('No se pudo recuperar la versión instalada de Lanzo POS.', recoveryError);
      renderStartupRecoveryScreen({ mode: 'updateError', onRetry: retryRecovery });
    }
  };

  if (!recoverableVersionError) {
    renderStartupRecoveryScreen({ mode: 'startupError', onRetry: retryRecovery });
    return;
  }

  renderStartupRecoveryScreen({ mode: 'recovering' });
  try {
    const recovery = await recoverAdminStartup({ error });
    if (recovery.status === 'reloading') return;
  } catch (recoveryError) {
    console.error('Falló la recuperación automática de Lanzo POS.', recoveryError);
  }

  renderStartupRecoveryScreen({ mode: 'updateError', onRetry: retryRecovery });
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
    startAdminServiceWorkerUpdateMonitor();
  }
  renderPosApplication().catch(handlePosStartupFailure);
}
