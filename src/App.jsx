// src/App.jsx
import React, { useEffect, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';

// --- COMPONENTES CRÍTICOS (Eager Loading) ---
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import SetupModal from './components/common/SetupModal';

// --- FUNCIÓN "LAZY" INTELIGENTE ---
const lazyRetry = (importFn) => {
  return lazy(async () => {
    try {
      const component = await importFn();
      window.sessionStorage.removeItem('retry-lazy-refreshed');
      return component;
    } catch (error) {
      const hasRefreshed = window.sessionStorage.getItem('retry-lazy-refreshed');
      if (!hasRefreshed) {
        window.sessionStorage.setItem('retry-lazy-refreshed', 'true');
        window.location.reload(); 
        return new Promise(() => {}); 
      }
      throw error;
    }
  });
};

const PosPage = lazyRetry(() => import('./pages/PosPage'));
const CajaPage = lazyRetry(() => import('./pages/CajaPage'));
const OrdersPage = lazyRetry(() => import('./pages/OrderPage'));
const ProductsPage = lazyRetry(() => import('./pages/ProductsPage'));
const CustomersPage = lazyRetry(() => import('./pages/CustomersPage'));
const DashboardPage = lazyRetry(() => import('./pages/DashboardPage'));
const SettingsPage = lazyRetry(() => import('./pages/SettingsPage'));
const AboutPage = lazyRetry(() => import('./pages/AboutPage'));

const PageLoader = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '50vh', gap: '1rem' }}>
    <div className="loader-spinner"></div>
    <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Cargando módulo...</p>
  </div>
);

function App() {
  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);
  
  // Traemos ambas acciones: Iniciar y Detener
  const startRealtimeSecurity = useAppStore((state) => state.startRealtimeSecurity);
  const stopRealtimeSecurity = useAppStore((state) => state.stopRealtimeSecurity);

  useEffect(() => {
    initializeApp();
  }, []);

  // REFACTORIZADO: Control robusto del ciclo de vida de la suscripción
  useEffect(() => {
    let isMounted = true;

    if (appStatus === 'ready') {
      startRealtimeSecurity();
    }

    // CLEANUP FUNCTION: Se ejecuta al desmontar o cambiar appStatus
    return () => {
      isMounted = false;
      // Detiene la escucha para liberar memoria y sockets
      stopRealtimeSecurity();
    };
  }, [appStatus, startRealtimeSecurity, stopRealtimeSecurity]);

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
        <Suspense fallback={<Layout><PageLoader /></Layout>}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Suspense fallback={<PageLoader />}><PosPage /></Suspense>} />
              <Route path="caja" element={<Suspense fallback={<PageLoader />}><CajaPage /></Suspense>} />
              <Route path='pedidos' element={<Suspense fallback={<PageLoader />}><OrdersPage /></Suspense>} />
              <Route path="productos" element={<Suspense fallback={<PageLoader />}><ProductsPage /></Suspense>} />
              <Route path="clientes" element={<Suspense fallback={<PageLoader />}><CustomersPage /></Suspense>} />
              <Route path="ventas" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
              <Route path="configuracion" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
              <Route path="acerca-de" element={<Suspense fallback={<PageLoader />}><AboutPage /></Suspense>} />
            </Route>
          </Routes>
        </Suspense>
      );

    default:
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;