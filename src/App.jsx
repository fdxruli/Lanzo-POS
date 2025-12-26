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
import ReconnectionBanner from './components/common/ReconnectionBanner';
import { useSalesStore } from './store/useSalesStore';
import { useSingleInstance } from './hooks/useSingleInstance';

// --- FUNCIÓN "LAZY" INTELIGENTE ---
const lazyRetry = (importFn) => {
  return lazy(async () => {
    try {
      const component = await importFn();
      window.sessionStorage.removeItem('retry-lazy-refreshed');
      return component;
    } catch (error) {
      // --- CÓDIGO CORREGIDO ---

      // 1. Validación estricta de conexión
      if (!navigator.onLine) {
        console.warn("Offline: No se puede cargar el módulo.");
        // Retornamos un componente "dummy" para evitar el crash
        return {
          default: () => (
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <h3>📡 Sin conexión</h3>
              <p>No se puede cargar esta sección sin internet.</p>
            </div>
          )
        };
      }

      // 2. Lógica de reintento existente
      const hasRefreshed = window.sessionStorage.getItem('retry-lazy-refreshed');
      if (!hasRefreshed) {
        window.sessionStorage.setItem('retry-lazy-refreshed', 'true');
        window.location.reload();
        return new Promise(() => { });
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
    let isReconnecting = false;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Prevenir múltiples reconexiones simultáneas
        if (isReconnecting) {
          console.log("⏳ Reconexión ya en progreso...");
          return;
        }

        isReconnecting = true;
        console.log("👁️ Pestaña activa: Reconectando sistemas...");

        try {
          // ✅ 1. Forzar reconexión de IndexedDB con retry
          const { initDB, closeDB } = await import('./services/database');
          
          // Cerrar conexión antigua si existe
          closeDB();
          await new Promise(r => setTimeout(r, 300));
          
          // Intentar reconectar con timeout
          const dbPromise = initDB();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('DB_TIMEOUT')), 5000)
          );
          
          await Promise.race([dbPromise, timeoutPromise]);
          console.log("✅ BD reconectada");
          
        } catch (e) {
          console.error("❌ Reconexión BD falló:", e);
          
          // Si falla después de múltiples intentos, recargamos
          if (e.message === 'DB_TIMEOUT' || e.name === 'InvalidStateError') {
            console.error("💥 BD irrecuperable, recargando aplicación...");
            window.location.reload();
            return;
          }
        }

        // ✅ 2. Verificar que la UI esté lista antes de continuar
        if (appStatus !== 'ready') {
          console.log("⚠️ App no está ready, saltando reconexión de servicios");
          isReconnecting = false;
          return;
        }

        // ✅ 3. Reiniciar seguridad en tiempo real (si estaba activa)
        const { licenseDetails, realtimeSubscription } = useAppStore.getState();

        if (licenseDetails?.license_key && !realtimeSubscription) {
          console.log("🔄 Reiniciando escucha de seguridad...");
          try {
            stopRealtimeSecurity();
            await new Promise(r => setTimeout(r, 500));
            startRealtimeSecurity();
          } catch (e) {
            console.warn("⚠️ Error reiniciando seguridad:", e);
          }
        }

        // ✅ 4. Revalidar licencia SOLO si llevamos más de 5 minutos inactivos
        const lastActive = sessionStorage.getItem('lanzo_last_active');
        const now = Date.now();

        if (!lastActive || (now - parseInt(lastActive)) > 300000) {
          console.log("⏰ Verificando licencia tras inactividad prolongada...");
          try {
            await useAppStore.getState().verifySessionIntegrity();
          } catch (e) {
            console.warn("⚠️ Error verificando sesión:", e);
          }
        }

        sessionStorage.setItem('lanzo_last_active', now.toString());
        isReconnecting = false;
        
      } else if (document.visibilityState === 'hidden') {
        // ✅ 5. NUEVO: Limpiar recursos al salir (opcional pero recomendado)
        console.log("🌙 Pestaña oculta: Preparando para suspensión...");
        sessionStorage.setItem('lanzo_last_active', Date.now().toString());
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    // ✅ 6. NUEVO: Manejo de eventos de navegador (Android/iOS)
    const handlePageShow = (event) => {
      // Si la página viene del caché del navegador (BFCache), forzamos reconexión
      if (event.persisted) {
        console.log("🔄 Página restaurada desde BFCache, reconectando...");
        handleVisibilityChange();
      }
    };
    
    window.addEventListener('pageshow', handlePageShow);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [appStatus, startRealtimeSecurity, stopRealtimeSecurity]);

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
          <ReconnectionBanner />
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