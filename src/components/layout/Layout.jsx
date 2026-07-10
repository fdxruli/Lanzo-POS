import { lazy, Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import DataSafetyModal from '../common/DataSafetyModal';
import EcommerceOrdersRuntime from '../ecommerce/orders/EcommerceOrdersRuntime';
import EcommerceOrdersNavShortcut from '../ecommerce/orders/EcommerceOrdersNavShortcut';
import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';
import { GLOBAL_ALERT } from '../../config/botContext';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import './Layout.css';

const AssistantBot = lazy(() => import('../common/AssistantBot'));

function Layout() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const loadProducts = useProductStore((state) => state.loadInitialProducts);
  const loadSales = useSalesStore((state) => state.loadRecentSales);
  const reconcileOrphanedOrders = useActiveOrders((state) => state.reconcileOrphanedOrders);
  const showAssistantBot = useAppStore((state) => state.showAssistantBot);
  const showTicker = useAppStore((state) => state.showTicker);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const { pathname } = useLocation();
  const isPosPage = pathname === '/';
  const isAboutPage = pathname === '/acerca-de';

  const isLicenseCritical = (
    licenseStatus === 'grace_period' ||
    licenseStatus === 'expired' ||
    licenseStatus === 'locked_renewal'
  );
  const shouldShowTicker = !isAboutPage && (showTicker || isLicenseCritical);

  useEffect(() => {
    window.scrollTo(0, 0);
    const contentWrapper = document.querySelector('.content-wrapper');
    const pageContainer = document.querySelector('.page-container');
    if (contentWrapper) contentWrapper.scrollTo(0, 0);
    if (pageContainer) pageContainer.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    const initializeData = async () => {
      Logger.log('🚀 Inicializando stores modulares y auditoría...');

      try {
        const result = await reconcileOrphanedOrders();
        if (result?.count > 0) {
          Logger.warn(`${result.count} órdenes inactivas requieren revisión manual.`);
        }
        if (result?.recovered > 0) {
          Logger.warn(`${result.recovered} órdenes ocultas se restauraron al listado de mesas.`);
        }
        if (result?.repairedBatchParents > 0) {
          Logger.warn(`${result.repairedBatchParents} productos se resincronizaron desde sus lotes.`);
        }
      } catch (error) {
        Logger.error('Fallo durante la reconciliación de órdenes:', error);
      }

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
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
            borderRadius: '8px',
            fontSize: '1rem'
          },
          success: {
            style: { background: 'var(--success-color)', color: 'white' },
            iconTheme: { primary: 'white', secondary: 'var(--success-color)' }
          },
          error: {
            style: { background: 'var(--error-color)', color: 'white' },
            iconTheme: { primary: 'white', secondary: 'var(--error-color)' }
          }
        }}
      />

      <Navbar />
      <EcommerceOrdersRuntime />
      <EcommerceOrdersNavShortcut />

      <div className={`content-wrapper ${isPosPage ? 'content-wrapper--pos' : ''}`.trim()}>
        {shouldShowTicker && <Ticker />}
        <div className={`page-container ${isPosPage ? 'page-container-pos' : ''} ${pathname.startsWith('/clientes') ? 'page-container-customers' : ''}`.trim()}>
          <Outlet />
        </div>
      </div>

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
