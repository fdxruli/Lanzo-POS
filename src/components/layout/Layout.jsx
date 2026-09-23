import { lazy, Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import DataSafetyModal from '../common/DataSafetyModal';
import EcommerceOrdersRuntime from '../ecommerce/orders/EcommerceOrdersRuntime';
import EcommercePublishedStockAlertRuntime from '../ecommerce/EcommercePublishedStockAlertRuntime';
import EcommerceCatalogSyncRuntime from '../ecommerce/EcommerceCatalogSyncRuntime';
import LocalInventoryOperationalAlertsRuntime from '../inventory/LocalInventoryOperationalAlertsRuntime';
import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useInventoryCatalogStore } from '../../store/useInventoryCatalogStore';
import { useAppStore } from '../../store/useAppStore';
import { useOrderStore } from '../../store/useOrderStore';
import Logger from '../../services/Logger';
import {
  GLOBAL_ALERT,
  hasAcknowledgedGlobalAlert,
  isGlobalAlertEligible,
} from '../../config/botContext';
import {
  hasAcknowledgedDataSafety,
  isDataSafetyModalEligible,
} from '../../utils/noticePolicy';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { db, STORES } from '../../services/db/dexie';
import { getAvailableStock } from '../../services/db/utils';
import { getSortedBatchesForProduct } from '../../services/sales/inventoryFlow';
import { isCommercialVariantProduct } from '../../services/products/commercialVariants';
import {
  registerActorOperationalActiveOrders,
  registerActorOperationalOrderStore
} from '../../services/auth/actorOperationalHandoff';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import './Layout.css';

registerActorOperationalActiveOrders({ useActiveOrders, db, STORES });
registerActorOperationalOrderStore({
  useOrderStore,
  useActiveOrders,
  db,
  STORES,
  getAvailableStock,
  getSortedBatchesForProduct,
  isCommercialVariantProduct
});

const AssistantBot = lazy(() => import('../common/AssistantBot'));

function Layout() {
  const loadStats = useStatsStore((state) => state.loadStats);
  const loadProducts = useInventoryCatalogStore((state) => state.loadInitialProducts);
  const loadSales = useSalesStore((state) => state.loadRecentSales);
  const reconcileOrphanedOrders = useActiveOrders((state) => state.reconcileOrphanedOrders);
  const showAssistantBot = useAppStore((state) => state.showAssistantBot);
  const showTicker = useAppStore((state) => state.showTicker);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const actorRuntime = useActorRuntimeSnapshot();
  const canReadReports = canReadSalesReports(actorRuntime);
  const { pathname } = useLocation();
  const [noticeRevision, setNoticeRevision] = useState(0);
  const isPosPage = pathname === '/';
  const isAboutPage = pathname === '/acerca-de';

  const isLicenseCritical = (
    licenseStatus === 'grace_period' ||
    licenseStatus === 'expired' ||
    licenseStatus === 'locked_renewal'
  );
  const shouldShowTicker = !isAboutPage && (showTicker || isLicenseCritical);
  const dataSafetyEligible = isDataSafetyModalEligible({
    licenseDetails,
    currentDeviceRole,
    currentStaffUser,
    acknowledged: hasAcknowledgedDataSafety(),
  });
  const globalAlertEligible = !dataSafetyEligible && isGlobalAlertEligible(GLOBAL_ALERT, {
    licenseDetails,
    acknowledged: hasAcknowledgedGlobalAlert(GLOBAL_ALERT),
  });

  useEffect(() => {
    const handleDataSafetyAcknowledged = () => setNoticeRevision((revision) => revision + 1);
    window.addEventListener('lanzo-data-safety-acknowledged', handleDataSafetyAcknowledged);
    return () => window.removeEventListener('lanzo-data-safety-acknowledged', handleDataSafetyAcknowledged);
  }, []);

  // La lectura de localStorage anterior a este punto es deliberada: sólo
  // recalcula la política de avisos después del evento de acknowledgment.
  void noticeRevision;

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

      loadProducts();
    };

    initializeData();
  }, [loadProducts, reconcileOrphanedOrders]);

  useEffect(() => {
    if (!canReadReports) return;
    loadStats();
    loadSales();
  }, [canReadReports, loadSales, loadStats]);

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

      <LocalInventoryOperationalAlertsRuntime />
      <Navbar />
      <EcommerceOrdersRuntime />
      <EcommercePublishedStockAlertRuntime />
      <EcommerceCatalogSyncRuntime />

      <div className={`content-wrapper ${isPosPage ? 'content-wrapper--pos' : ''}`.trim()}>
        {shouldShowTicker && <Ticker />}
        <div className={`page-container ${isPosPage ? 'page-container-pos' : ''} ${pathname.startsWith('/clientes') ? 'page-container-customers' : ''}`.trim()}>
          <Outlet />
        </div>
      </div>

      <MessageModal />
      <DataSafetyModal />

      {((canReadReports && showAssistantBot) || globalAlertEligible) && (
        <Suspense fallback={null}>
          <AssistantBot
            key={actorRuntime.generation}
            reportsAllowed={canReadReports}
            globalAlertEligible={globalAlertEligible}
          />
        </Suspense>
      )}
    </div>
  );
}

export default Layout;
