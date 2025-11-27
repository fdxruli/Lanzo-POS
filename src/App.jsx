// src/App.jsx
import React, { useEffect, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';

// --- COMPONENTES CRÍTICOS (Eager Loading) ---
// Estos se cargan de inmediato porque son necesarios para la estructura base o modales iniciales
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import SetupModal from './components/common/SetupModal';

// Estos se descargarán solo cuando el usuario intente entrar a esa ruta
const PosPage = lazy(() => import('./pages/PosPage'));
const CajaPage = lazy(() => import('./pages/CajaPage'));
const OrdersPage = lazy(() => import('./pages/OrderPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));

// --- COMPONENTE DE CARGA (Spinner de transición entre páginas) ---
const PageLoader = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%', // Se ajusta al contenedor del Layout
    minHeight: '50vh',
    gap: '1rem'
  }}>
    <div className="loader-spinner"></div>
    <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Cargando módulo...</p>
  </div>
);

function App() {
  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);

  // Recuperamos la función de seguridad que faltaba en tu propuesta
  const startRealtimeSecurity = useAppStore((state) => state.startRealtimeSecurity);

  // 1. Inicialización de la App (Licencia y Perfil)
  useEffect(() => {
    initializeApp();
  }, []);

  // 2. Activación de Seguridad en Tiempo Real (Solo cuando la app está lista)
  useEffect(() => {
    if (appStatus === 'ready') {
      startRealtimeSecurity();
    }
  }, [appStatus, startRealtimeSecurity]);

  switch (appStatus) {
    case 'loading':
      return (
        <div id="app-loader" style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
          <div className="loader-spinner"></div>
        </div>
      );

    case 'unauthenticated':
      return <WelcomeModal />;

    case 'setup_required':
      return <SetupModal />;

    case 'ready':
      return (
        // Suspense envuelve las rutas para mostrar el PageLoader mientras se descarga el archivo JS de la página
        <Suspense fallback={<Layout><PageLoader /></Layout>}>
          <Routes>
            <Route path="/" element={<Layout />}>
              {/* El atributo 'index' indica la ruta por defecto (/) */}
              <Route index element={
                <Suspense fallback={<PageLoader />}>
                  <PosPage />
                </Suspense>
              } />

              <Route path="caja" element={
                <Suspense fallback={<PageLoader />}>
                  <CajaPage />
                </Suspense>
              } />

              <Route path='pedidos' element={
                <Suspense fallback={<PageLoader />}>
                  <OrdersPage />
                </Suspense>
              } />

              <Route path="productos" element={
                <Suspense fallback={<PageLoader />}>
                  <ProductsPage />
                </Suspense>
              } />

              <Route path="clientes" element={
                <Suspense fallback={<PageLoader />}>
                  <CustomersPage />
                </Suspense>
              } />

              <Route path="ventas" element={
                <Suspense fallback={<PageLoader />}>
                  <DashboardPage />
                </Suspense>
              } />

              <Route path="configuracion" element={
                <Suspense fallback={<PageLoader />}>
                  <SettingsPage />
                </Suspense>
              } />

              <Route path="acerca-de" element={
                <Suspense fallback={<PageLoader />}>
                  <AboutPage />
                </Suspense>
              } />
            </Route>
          </Routes>
        </Suspense>
      );

    default:
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;