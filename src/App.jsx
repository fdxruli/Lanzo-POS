// src/App.jsx
import React, { useEffect, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import ErrorBoundary from './components/common/ErrorBoundary';
import NavigationGuard from './components/common/NavigationGuard';

// --- COMPONENTES CRÍTICOS (Eager Loading) ---
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import SetupModal from './components/common/SetupModal';
import { useSalesStore } from './store/useSalesStore';
import { useSingleInstance } from './hooks/useSingleInstance';

// --- FUNCIÓN "LAZY" INTELIGENTE ---
const lazyRetry = (importFn) => {
  return lazy(async () => {
    try {
      const component = await importFn();
      // Si tuvo éxito, limpiamos marcas de error previo
      window.sessionStorage.removeItem('retry-lazy-refreshed');
      return component;
    } catch (error) {
      // 1. Si no hay internet, NO recargues la página (bucle de muerte)
      if (!navigator.onLine) {
        throw new Error("No hay conexión a internet para cargar este módulo.");
      }

      // 2. Si es un error de red y ya intentamos recargar una vez, no lo hagas de nuevo
      const hasRefreshed = window.sessionStorage.getItem('retry-lazy-refreshed');

      if (!hasRefreshed) {
        console.log("Error de carga detectado, intentando recargar sesión...");
        window.sessionStorage.setItem('retry-lazy-refreshed', 'true');
        window.location.reload();
        // Retornamos promesa vacía para esperar el reload
        return new Promise(() => { });
      }

      // Si ya recargamos y sigue fallando, lanzamos el error para que lo atrape el ErrorBoundary
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
  const isDuplicate = useSingleInstance();
  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);

  // Traemos ambas acciones: Iniciar y Detener
  const startRealtimeSecurity = useAppStore((state) => state.startRealtimeSecurity);
  const stopRealtimeSecurity = useAppStore((state) => state.stopRealtimeSecurity);

  useEffect(() => {
    initializeApp();
  }, []);

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

  useEffect(() => {
    const handleVisibilityChange = async () => {
      // Si el usuario vuelve a la pestaña y está "visible"
      if (document.visibilityState === 'visible') {
        console.log("👁️ Pestaña activa: Reiniciando conexiones...");

        // 1. Forzar reconexión de BD si se cerró
        try {
          // Importa 'initDB' de database.js y llámalo aquí
          // await initDB(); 
        } catch (e) { console.warn("Reconexión BD:", e); }

        // 2. Si usas Supabase Realtime, reinicia la suscripción
        // stopRealtimeSecurity();
        // startRealtimeSecurity();

        // 3. Opcional: Forzar un repintado ligero si se siente trabado
        // (Un simple cambio de estado dummy puede reactivar React)
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  if (isDuplicate) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px'
      }}>
        <h1 style={{ fontSize: '3rem' }}>⛔</h1>
        <h2>Aplicación ya abierta</h2>
        <p>Lanzo POS ya está abierto en otra pestaña o ventana.</p>
        <p>Por seguridad de tus datos, usa solo una pestaña a la vez.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reintentar (si ya cerraste la otra)
        </button>
      </div>
    );
  }

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
          <NavigationGuard />
          <ErrorBoundary>
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
          </ErrorBoundary>
        </Suspense>
      );

    default:
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;