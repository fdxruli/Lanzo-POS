import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import DataSafetyModal from '../common/DataSafetyModal';
import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useProductStore } from '../../store/useProductStore';
import { Toaster } from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import './Layout.css';
import Logger from '../../services/Logger';
import { GLOBAL_ALERT } from '../../config/botContext';
import { lazy, Suspense } from 'react';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
const AssistantBot = lazy(() => import('../common/AssistantBot'));

function Layout() {
  const loadStats = useStatsStore(state => state.loadStats);
  const loadProducts = useProductStore(state => state.loadInitialProducts);
  const loadSales = useSalesStore(state => state.loadRecentSales);

  const reconcileOrphanedOrders = useActiveOrders(state => state.reconcileOrphanedOrders);

  const showAssistantBot = useAppStore(state => state.showAssistantBot);
  const showTicker = useAppStore(state => state.showTicker);
  const licenseStatus = useAppStore(state => state.licenseStatus);

  const { pathname } = useLocation();
  const isPosPage = pathname === '/';
  const isAboutPage = pathname === '/acerca-de';

  const isLicenseCritical = licenseStatus === 'grace_period' || licenseStatus === 'expired' || licenseStatus === 'locked_renewal';
  const shouldShowTicker = !isAboutPage && (showTicker || isLicenseCritical);

  useEffect(() => {
    // Restablece el scroll del documento principal
    window.scrollTo(0, 0);

    // Si tu CSS hace que el scroll ocurra dentro de un contenedor especÃ­fico 
    // en lugar del body, tambiÃ©n restablecemos el scroll de ese contenedor:
    const contentWrapper = document.querySelector('.content-wrapper');
    const pageContainer = document.querySelector('.page-container');

    if (contentWrapper) contentWrapper.scrollTo(0, 0);
    if (pageContainer) pageContainer.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    const initializeData = async () => {
      Logger.log("ðŸš€ Inicializando Stores modulares y auditorÃ­a...");

      // A. PRIMERO: Ejecutar el recolector de basura de inventario
      try {
        const result = await reconcileOrphanedOrders();
        if (result?.count > 0) {
          Logger.warn(`${result.count} Ã³rdenes inactivas requieren revisiÃ³n manual.`);
        }
        if (result?.recovered > 0) {
          Logger.warn(`${result.recovered} Ã³rdenes ocultas se restauraron al listado de mesas.`);
        }
        if (result?.repairedBatchParents > 0) {
          Logger.warn(`${result.repairedBatchParents} productos se resincronizaron desde sus lotes.`);
        }
      } catch (error) {
        Logger.error("Fallo durante la reconciliaciÃ³n de Ã³rdenes:", error);
      }

      // B. DESPUÃ‰S: Cargar la informaciÃ³n a la UI (ahora con el stock real)
      loadStats();
      loadProducts();
      loadSales();
    };

    initializeData();
  }, [loadProducts, loadSales, loadStats, reconcileOrphanedOrders]);

  return (
    <div className="app-layout">
      <Toaster
        position="top-center"
        containerStyle={{
          zIndex: 'var(--z-toast)',
          top: 'max(20px, env(safe-area-inset-top, 0px))'
        }}
        // -------------------------
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
            borderRadius: '8px',
            fontSize: '1rem',
          },
          success: {
            style: { background: 'var(--success-color)', color: 'white' },
            iconTheme: { primary: 'white', secondary: 'var(--success-color)' },
          },
          error: {
            style: { background: 'var(--error-color)', color: 'white' },
            iconTheme: { primary: 'white', secondary: 'var(--error-color)' },
          },
        }}
      />

      <Navbar />

      <div className={`content-wrapper ${isPosPage ? 'content-wrapper--pos' : ''}`.trim()}>
        {shouldShowTicker && <Ticker />}
        <div className={`page-container ${isPosPage ? 'page-container-pos' : ''} ${location.pathname.startsWith('/clientes') ? 'page-container-customers' : ''}`.trim()}>
          <Outlet />
        </div>
      </div>

      {/* Modales Globales */}
      <MessageModal />
      <DataSafetyModal />

      {(showAssistantBot || (GLOBAL_ALERT && GLOBAL_ALERT.active && !localStorage.getItem(`lanzo_alert_${GLOBAL_ALERT.id}`))) && (
        <Suspense fallback={null}>
          <AssistantBot />
        </Suspense>
      )}

    </div>
  );
}

export default Layout;
