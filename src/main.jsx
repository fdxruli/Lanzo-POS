import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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

function renderPublicStore() {
  const router = createBrowserRouter(publicStoreRoutes);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
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
