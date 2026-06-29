import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import './styles/design-tokens.css';
import './styles/ui-button.css';
import './styles/ui-modal.css';
import './styles/ui-card.css';
import './styles/ui-alert.css';
import './styles/ui-badge.css';
import './styles/ui-shell.css';
import './styles/ui-tabs.css';
import { storageManager } from './services/storageManager';
import Logger from './services/Logger';
import ErrorBoundary from './components/common/ErrorBoundary';
import { cleanupDevelopmentServiceWorkers } from './services/devServiceWorkerCleanup';
import { startPosSyncAutoBootstrap } from './services/sync/posSyncBootstrapAutoCoordinator';
import { installMobileZoomGuard } from './services/mobileZoomGuard';

installMobileZoomGuard();

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

/**
 * INICIALIZACIÓN CRÍTICA: StorageManager debe ejecutarse ANTES de que
 * React monte cualquier componente, para asegurar que la PWA sabe
 * si puede persisitr datos antes de que se haga la primer escritura a Dexie
 */
(async () => {
  const canContinueBoot = await cleanupDevelopmentServiceWorkers();
  if (!canContinueBoot) return;

  try {
    Logger.info('🚀 Boot: Inicializando StorageManager...');
    const conditions = await storageManager.initialize();

    if (conditions.isVolatile) {
      Logger.warn(
        '⚠️ BOOT WARNING: Almacenamiento en modo volátil (Best-Effort)\n' +
        'Tus datos de venta pueden perderse si el SO o navegador libera memoria.\n' +
        'Recomendación: ' + conditions.recommendation.join(' | ')
      );
    }

    if (conditions.isCritical) {
      Logger.error(
        '🔴 BOOT CRITICAL: Almacenamiento crítico (>90% lleno)\n' +
        'Sincroniza inmediatamente o libera espacio.'
      );
    }

    Logger.info('✅ Boot: StorageManager listo', {
      persistenceState: conditions.persistenceState,
      quotaPercent: conditions.quota?.percentUsed,
    });
  } catch (err) {
    Logger.error('❌ Boot: Error crítico en StorageManager', err);
    // No bloquear el boot, solo registrar
  }

  startPosSyncAutoBootstrap();

  // Ahora renderizar React
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
      </GoogleOAuthProvider>
    </React.StrictMode>
  );
})();