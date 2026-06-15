import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { storageManager } from './services/storageManager';
import Logger from './services/Logger';

const router = createBrowserRouter([
  {
    path: '*',
    element: <App />
  }
]);

/**
 * INICIALIZACIÓN CRÍTICA: StorageManager debe ejecutarse ANTES de que
 * React monte cualquier componente, para asegurar que la PWA sabe
 * si puede persisitr datos antes de que se haga la primer escritura a Dexie
 */
(async () => {
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

  // Ahora renderizar React
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
        <RouterProvider router={router} />
      </GoogleOAuthProvider>
    </React.StrictMode>
  );
})();
