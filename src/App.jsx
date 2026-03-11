// src/App.jsx
import { useEffect, lazy, Suspense, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import ErrorBoundary from './components/common/ErrorBoundary';
import NavigationGuard from './components/common/NavigationGuard';
import Logger from './services/Logger';
import { db, STORES } from './services/db/dexie';
// --- COMPONENTES CRÍTICOS (Eager Loading) ---
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import RenewalModal from './components/common/RenewalModal';
import SetupModal from './components/common/SetupModal';
import ReconnectionBanner from './components/common/ReconnectionBanner';
import ServerStatusBanner from './components/common/ServerStatusBanner';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import { useSingleInstance } from './hooks/useSingleInstance';
import TermsAndConditionsModal from './components/common/TermsAndConditionsModal';

const MAX_RETRIES = 3;
const lazyRetry = (importFn, componentName = 'Component') => {
  const componentKey = `lazy_retry_${componentName}`;

  return lazy(async () => {
    try {
      const component = await importFn();
      window.sessionStorage.removeItem(componentKey);
      return component;
    } catch (error) {
      Logger.error(`Error cargando módulo ${componentName}:`, error);

      const currentRetries = parseInt(window.sessionStorage.getItem(componentKey) || '0', 10);

      if (currentRetries < MAX_RETRIES) {
        window.sessionStorage.setItem(componentKey, (currentRetries + 1).toString());
        Logger.warn(`Reintentando carga de ${componentName} (${currentRetries + 1}/${MAX_RETRIES})...`);
        window.location.reload();
        return new Promise(() => { });
      }

      Logger.error(`Máximo de reintentos alcanzado para ${componentName}. Mostrando UI de error.`);
      window.sessionStorage.removeItem(componentKey);

      return {
        default: () => (
          <div style={{
            height: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '2rem' }}>⚠️</h2>
            <h3>Error de carga del módulo</h3>
            <p>No se pudo cargar la sección <strong>{componentName}</strong>.</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => {
                window.sessionStorage.removeItem(componentKey);
                window.location.reload();
              }}
            >
              Reintentar
            </button>
          </div>
        )
      };
    }
  });
};

const PosPage = lazyRetry(() => import('./pages/PosPage'), 'PosPage');
const CajaPage = lazyRetry(() => import('./pages/CajaPage'), 'CajaPage');
const OrdersPage = lazyRetry(() => import('./pages/OrderPage'), 'OrdersPage');
const ProductsPage = lazyRetry(() => import('./pages/ProductsPage'), 'ProductsPage');
const CustomersPage = lazyRetry(() => import('./pages/CustomersPage'), 'CustomersPage');
const DashboardPage = lazyRetry(() => import('./pages/DashboardPage'), 'DashboardPage');
const SettingsPage = lazyRetry(() => import('./pages/SettingsPage'), 'SettingsPage');
const AboutPage = lazyRetry(() => import('./pages/AboutPage'), 'AboutPage');

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
  const pendingTermsUpdate = useAppStore((state) => state.pendingTermsUpdate);
  const clearTermsNotification = () => {
    useAppStore.setState({ pendingTermsUpdate: null });
  };

  // Traemos ambas acciones: Iniciar y Detener
  const startRealtimeSecurity = useAppStore((state) => state.startRealtimeSecurity);
  const stopRealtimeSecurity = useAppStore((state) => state.stopRealtimeSecurity);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

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

  // Candado persistente fuera del ciclo de dependencias del useEffect
  const isReconnectingRef = useRef(false);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') {
        sessionStorage.setItem('lanzo_last_active', Date.now().toString());
        return;
      }

      if (isReconnectingRef.current) {
        Logger.warn("⏳ Health check ya en curso. Ignorando evento de visibilidad.");
        return;
      }

      isReconnectingRef.current = true;
      Logger.log("👁️ Pestaña activa: Verificando salud del sistema...");

      // Asumimos que la BD está sana a menos que la prueba profunda (si se ejecuta) diga lo contrario
      let dbIsHealthy = true;

      try {
        const lastCheck = parseInt(sessionStorage.getItem('lanzo_last_health_check') || '0', 10);
        const needsDeepCheck = (Date.now() - lastCheck) >= 60000;

        if (!needsDeepCheck) {
          Logger.log("⏳ Health check profundo omitido por cooldown (menos de 60s).");
        } else {
          // 1. Validar cuota de disco
          if (navigator.storage && navigator.storage.estimate) {
            const { quota, usage } = await navigator.storage.estimate();
            const usagePercentage = (usage / quota) * 100;
            if (usagePercentage > 95) {
              throw new Error(`QUOTA_CRITICAL: Almacenamiento al ${usagePercentage.toFixed(2)}%`);
            }
          }

          // 2. Validar capacidad real de ESCRITURA con control de transacciones
          await new Promise((resolve, reject) => {
            let isSettled = false;
            let timeoutId;

            // Iniciamos la transacción instanciándola para poder abortarla
            const tx = db.transaction('rw', db[STORES.SYNC_CACHE], async () => {
              await db[STORES.SYNC_CACHE].put({ key: 'health_ping', timestamp: Date.now() });
            });

            timeoutId = setTimeout(() => {
              if (isSettled) return;
              isSettled = true;

              // ABORTO EXPLÍCITO: Matamos la transacción a nivel Dexie/IndexedDB
              // Esto evita la promesa colgada en el motor subyacente
              if (tx && typeof tx.abort === 'function') {
                try { tx.abort(); } catch (e) { /* Ignorar errores de aborto */ }
              }
              reject(new Error("PING_TIMEOUT_WRITE"));
            }, 2000);

            tx.then(() => {
              if (isSettled) return;
              isSettled = true;
              clearTimeout(timeoutId);
              resolve(true);
            }).catch(error => {
              if (isSettled) return;
              isSettled = true;
              clearTimeout(timeoutId);
              reject(new Error(`TX_WRITE_ERROR: ${error.name} - ${error.message}`));
            });
          });

          Logger.log("✅ Conexión a BD verificada y con capacidad de escritura.");
          sessionStorage.setItem('lanzo_last_health_check', Date.now().toString());
        }

      } catch (error) {
        Logger.error("⚠️ FATAL: Base de datos colapsó o está corrupta.", error.message);
        dbIsHealthy = false;

        sessionStorage.removeItem('lanzo_last_health_check');

        Logger.error("Aislamiento del error: Forzando recarga de entorno.");
        window.location.reload(true);
        // Eliminado el return falaz. El control pasa al finally, 
        // pero condicionado por dbIsHealthy.

      } finally {
        // Ejecución estricta: Solo actuamos y liberamos candados si sobrevivimos al chequeo
        if (dbIsHealthy) {
          // Lectura dinámica: Evitamos el stale closure leyendo el estado en este milisegundo exacto
          const currentState = useAppStore.getState();

          if (currentState.appStatus === 'ready') {
            if (currentState.licenseDetails?.license_key && !currentState.realtimeSubscription) {
              stopRealtimeSecurity();
              startRealtimeSecurity();
            }

            const lastActive = sessionStorage.getItem('lanzo_last_active');
            const now = Date.now();
            if (!lastActive || (now - parseInt(lastActive)) > 300000) {
              currentState.verifySessionIntegrity().catch(Logger.warn);
            }
          }

          // El candado se libera ÚNICAMENTE si no estamos en proceso de recarga forzada
          isReconnectingRef.current = false;
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handlePageShow = (event) => {
      if (event.persisted && document.visibilityState === 'visible') {
        Logger.log("🔄 Restaurado desde caché, verificando...");
        handleVisibilityChange();
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [startRealtimeSecurity, stopRealtimeSecurity]);

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
      return (
        <ErrorBoundary>
          <WelcomeModal />
        </ErrorBoundary>
      );

    case 'setup_required':
      return (
        <ErrorBoundary>
          <SetupModal />
        </ErrorBoundary>
      );

    case 'locked_renewal':
      return (
        <ErrorBoundary>
          <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
            <RenewalModal />
          </div>
        </ErrorBoundary>
      );

    case 'ready':
      return (
        <>
          <ReconnectionBanner />
          <ServerStatusBanner />
          <UpdatePrompt />
          <InstallPrompt />
          <Suspense fallback={<Layout><PageLoader /></Layout>}>
            {pendingTermsUpdate && (
              <TermsAndConditionsModal
                isOpen={true}
                onClose={clearTermsNotification}
                isUpdateNotification={true}
              />
            )}
            <NavigationGuard />

            <ErrorBoundary>
              <Routes>
                <Route
                  path="/renovacion-urgente"
                  element={
                    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
                      <RenewalModal />
                    </div>
                  }
                />
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
        </>
      );

    default:
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;