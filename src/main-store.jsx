import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { publicStoreRoutes } from './router/publicStoreRoutes';
import { preparePublicStoreDocument } from './router/preparePublicStoreDocument';
import { recoverFromPublicChunkError } from './utils/publicChunkRecovery';
import './index.css';
import './styles/design-tokens.css';
import './styles/buttons.css';
import './styles/ui-card.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('No se encontró el contenedor de la tienda pública.');
}

preparePublicStoreDocument();

const handlePublicRuntimeError = (event) => {
  recoverFromPublicChunkError(event.error || event.reason || event);
};
window.addEventListener('error', handlePublicRuntimeError);
window.addEventListener('unhandledrejection', handlePublicRuntimeError);

const router = createBrowserRouter(publicStoreRoutes);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
