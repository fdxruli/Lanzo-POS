import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AlertTriangle, XCircle } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import ErrorBoundary from './components/common/ErrorBoundary';
import NavigationGuard from './components/common/NavigationGuard';
import Logger from './services/Logger';
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import StaffLoginModal from './components/common/StaffLoginModal';
import AdminLoginModal from './components/common/AdminLoginModal';
import AdminEnrollmentModal from './components/common/AdminEnrollmentModal';
import LicenseAccessChooser from './components/common/LicenseAccessChooser';
import LicenseChangeRequiredModal from './components/common/LicenseChangeRequiredModal';
import RenewalModal from './components/common/RenewalModal';
import SetupModal from './components/common/SetupModal';
import PermissionRoute from './components/common/PermissionRoute';
import EcommerceOrdersRoute from './components/ecommerce/orders/EcommerceOrdersRoute';
import ServerStatusBanner from './components/common/ServerStatusBanner';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import PersistenceWarningBanner from './components/common/PersistenceWarningBanner';
import BackupReminder from './components/common/BackupReminder';
import BackupRuntime from './components/common/BackupRuntime';
import { useSingleInstance } from './hooks/useSingleInstance';
import TermsAndConditionsModal from './components/common/TermsAndConditionsModal';
import { isCloudPosSyncEnabled } from './services/sync/syncConstants';
import { clearCurrentAdminRuntimeCaches } from './pwa/adminRuntimeCache';

const MAX_RETRIES = 3;
const GLOBAL_COOLDOWN_MS = 5000;

const resetAppShellCache = async () => {
  try {
    if ('caches' in window) {
      await clearCurrentAdminRuntimeCaches(window.caches);
    }
  } catch (cacheError) {
    Logger.warn('No se pudo limpiar la caché runtime administrativa:', cacheError);
  }
};

const reloadAfterLazyFailure = async (componentKey) => {
  window.sessionStorage.removeItem(componentKey);
  window.sessionStorage.removeItem('lazy_retry_last_time');
  await resetAppShellCache();
  window.location.reload();
};

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
      const lastReload = parseInt(window.sessionStorage.getItem('lazy_retry_last_time') || '0', 10);
      const now = Date.now();
      const inCooldown = (now - lastReload) < GLOBAL_COOLDOWN_MS;

      if (!navigator.onLine) {
        Logger.warn(`Sin conexión a internet. Omitiendo recarga automática para ${componentName}.`);
      } else if (inCooldown) {
        Logger.warn(`En cooldown global de recargas. Omitiendo recarga para ${componentName}.`);
      } else if (currentRetries < MAX_RETRIES) {
        window.sessionStorage.setItem(componentKey, (currentRetries + 1).toString());
        window.sessionStorage.setItem('lazy_retry_last_time', now.toString());
        Logger.warn(`Reintentando carga limpia de ${componentName} (${currentRetries + 1}/${MAX_RETRIES})...`);
        resetAppShellCache().finally(() => window.location.reload());
        return new Promise(() => {});
      }

      Logger.error(`Máximo de reintentos, sin conexión o en cooldown para ${componentName}. Mostrando UI de error.`);
      window.sessionStorage.removeItem(componentKey);

      return {
        default: () => (
          <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            textAlign: 'center'
          }}>
            <AlertTriangle size={48} className="text-yellow-500 mb-4" />
            <h3>Error de carga del módulo</h3>
            <p>No se pudo cargar la sección <strong>{componentName}</strong>.</p>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
              {!navigator.onLine
                ? 'Parece que no tienes conexión a internet.'
                : 'Puede haber una versión anterior guardada en caché. Presiona Reintentar para limpiar caché y cargar la versión nueva.'}
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => reloadAfterLazyFailure(componentKey)}
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
const EcommerceOrdersPage = lazyRetry(() => import('./pages/EcommerceOrdersPage'), 'EcommerceOrdersPage');
const ProductsPage = lazyRetry(() => import('./pages/ProductsPage'), 'ProductsPage');
const CustomersPage = lazyRetry(() => import('./pages/CustomersPage'), 'CustomersPage');
const DashboardPage = lazyRetry(() => import('./pages/DashboardPage'), 'DashboardPage');
const SettingsPage = lazyRetry(() => import('./pages/SettingsPage'), 'SettingsPage');
const EcommercePortalPage = lazyRetry(() => import('./pages/EcommercePortalPage'), 'EcommercePortalPage');
const AboutPage = lazyRetry(() => import('./pages/AboutPage'), 'AboutPage');

const PageLoader = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '50vh',
    gap: '1rem'
  }}>
    <div className="loader-spinner" />
    <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Cargando módulo...</p>
  </div>
);

function App() {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Faltan las variables de entorno de Supabase (VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY). Revisa la configuración de Vercel.');
  }

  const isDuplicate = useSingleInstance();
  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const pendingTermsUpdate = useAppStore((state) => state.pendingTermsUpdate);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const startLicenseSync = useAppStore((state) => state.startLicenseSync);
  const stopLicenseSync = useAppStore((state) => state.stopLicenseSync);
  const startNotificationRealtime = useAppStore((state) => state.startNotificationRealtime);
  const stopNotificationRealtime = useAppStore((state) => state.stopNotificationRealtime);
  const isCloudLicense = isCloudPosSyncEnabled(licenseDetails);
  const shouldMountLocalBackupRuntime = !isCloudLicense;

  const clearTermsNotification = () => {
    useAppStore.setState({ pendingTermsUpdate: null });
  };

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    if (appStatus === 'ready') {
      startLicenseSync();
      startNotificationRealtime?.();
      return () => {
        stopNotificationRealtime?.();
        stopLicenseSync();
      };
    }

    stopNotificationRealtime?.();
    stopLicenseSync();
    return undefined;
  }, [appStatus, startLicenseSync, startNotificationRealtime, stopLicenseSync, stopNotificationRealtime]);

  useEffect(() => {
    let resumeCheckTimer = null;

    const markInactive = () => {
      sessionStorage.setItem('lanzo_last_active', Date.now().toString());
    };

    const scheduleResumeCheck = (reason) => {
      if (document.visibilityState === 'hidden') return;

      if (resumeCheckTimer) {
        window.clearTimeout(resumeCheckTimer);
      }

      resumeCheckTimer = window.setTimeout(() => {
        resumeCheckTimer = null;
        useAppStore.getState().performSystemHealthCheck(reason);
      }, 250);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleResumeCheck('visibility');
      } else {
        markInactive();
      }
    };

    const handlePageShow = () => {
      scheduleResumeCheck('pageshow');
    };

    const handleWindowFocus = () => {
      scheduleResumeCheck('focus');
    };

    const handleOnline = () => {
      scheduleResumeCheck('online');
    };

    const handlePageHide = () => {
      markInactive();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('resume', handlePageShow);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      if (resumeCheckTimer) {
        window.clearTimeout(resumeCheckTimer);
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('resume', handlePageShow);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  if (isDuplicate) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '20px'
      }}>
        <XCircle size={64} className="text-red-500 mb-4" />
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
          <div className="loader-spinner" />
        </div>
      );

    case 'license_change_required':
      return (
        <ErrorBoundary>
          <LicenseChangeRequiredModal />
        </ErrorBoundary>
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

    case 'staff_login_required':
      return (
        <ErrorBoundary>
          <StaffLoginModal />
        </ErrorBoundary>
      );

    case 'license_access_required':
      return <ErrorBoundary><LicenseAccessChooser /></ErrorBoundary>;

    case 'admin_login_required':
      return <ErrorBoundary><AdminLoginModal /></ErrorBoundary>;

    case 'admin_enrollment_required':
      return <ErrorBoundary><AdminEnrollmentModal /></ErrorBoundary>;

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
          <PersistenceWarningBanner />
          {shouldMountLocalBackupRuntime && <BackupRuntime />}
          {shouldMountLocalBackupRuntime && <BackupReminder />}
          <ServerStatusBanner />
          <UpdatePrompt />
          <InstallPrompt />
          <Suspense fallback={<Layout><PageLoader /></Layout>}>
            {pendingTermsUpdate && (
              <TermsAndConditionsModal
                isOpen
                onClose={clearTermsNotification}
                isUpdateNotification
              />
            )}
            <NavigationGuard />

            <ErrorBoundary>
              <Routes>
                <Route
                  path="/renovacion-urgente"
                  element={(
                    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
                      <RenewalModal />
                    </div>
                  )}
                />
                <Route path="/" element={<Layout />}>
                  <Route index element={<PermissionRoute permission="pos"><Suspense fallback={<PageLoader />}><PosPage /></Suspense></PermissionRoute>} />
                  <Route path="caja" element={<PermissionRoute permission="cash_register"><Suspense fallback={<PageLoader />}><CajaPage /></Suspense></PermissionRoute>} />
                  <Route path="pedidos" element={<PermissionRoute permission="orders"><Suspense fallback={<PageLoader />}><OrdersPage /></Suspense></PermissionRoute>} />
                  <Route path="pedidos-online" element={<EcommerceOrdersRoute><Suspense fallback={<PageLoader />}><EcommerceOrdersPage /></Suspense></EcommerceOrdersRoute>} />
                  <Route path="productos" element={<PermissionRoute permission="products"><Suspense fallback={<PageLoader />}><ProductsPage /></Suspense></PermissionRoute>} />
                  <Route path="clientes" element={<PermissionRoute permission="customers"><Suspense fallback={<PageLoader />}><CustomersPage /></Suspense></PermissionRoute>} />
                  <Route path="ventas" element={<PermissionRoute permission="reports"><Suspense fallback={<PageLoader />}><DashboardPage /></Suspense></PermissionRoute>} />
                  <Route path="portal-online" element={<PermissionRoute permission="settings"><Suspense fallback={<PageLoader />}><EcommercePortalPage /></Suspense></PermissionRoute>} />
                  <Route path="configuracion" element={<PermissionRoute permission={['settings', 'products']}><Suspense fallback={<PageLoader />}><SettingsPage /></Suspense></PermissionRoute>} />
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
