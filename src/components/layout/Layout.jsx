import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import DataSafetyModal from '../common/DataSafetyModal';
import BackupReminder from '../common/BackupRemider';
import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useProductStore } from '../../store/useProductStore';
import { Toaster } from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import './Layout.css';
import Logger from '../../services/Logger';
import { GLOBAL_ALERT } from '../../config/botContext';
import { lazy, Suspense } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
const AssistantBot = lazy(() => import('../common/AssistantBot'));

function Layout() {
  const loadStats = useStatsStore(state => state.loadStats);
  const loadProducts = useProductStore(state => state.loadInitialProducts);
  const loadSales = useSalesStore(state => state.loadRecentSales);

  const reconcileOrphanedOrders = useOrderStore(state => state.reconcileOrphanedOrders);

  const licenseDetails = useAppStore(state => state.licenseDetails);
  const initializeApp = useAppStore(state => state.initializeApp);

  const showAssistantBot = useAppStore(state => state.showAssistantBot);

  const location = useLocation();

  useEffect(() => {
    // Restablece el scroll del documento principal
    window.scrollTo(0, 0);

    // Si tu CSS hace que el scroll ocurra dentro de un contenedor específico 
    // en lugar del body, también restablecemos el scroll de ese contenedor:
    const contentWrapper = document.querySelector('.content-wrapper');
    const pageContainer = document.querySelector('.page-container');

    if (contentWrapper) contentWrapper.scrollTo(0, 0);
    if (pageContainer) pageContainer.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const initializeData = async () => {
      Logger.log("🚀 Inicializando Stores modulares y auditoría...");

      // A. PRIMERO: Ejecutar el recolector de basura de inventario
      try {
        const result = await reconcileOrphanedOrders();
        if (result?.count > 0) {
          Logger.log(`🧹 Se liberó el inventario de ${result.count} órdenes abandonadas.`);
        }
      } catch (error) {
        Logger.error("Fallo durante la reconciliación de órdenes:", error);
      }

      // B. DESPUÉS: Cargar la información a la UI (ahora con el stock real)
      loadStats();
      loadProducts();
      loadSales();
    };

    initializeData();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (licenseDetails?.expiresAt) {
        const now = new Date();
        const expires = new Date(licenseDetails.expiresAt);
        if (now > expires) {
          Logger.log("🕒 El tiempo de licencia ha expirado. Re-verificando estado...");
          initializeApp();
        }
      }
    }, 60000);

    return () => clearInterval(intervalId);
  }, [licenseDetails, initializeApp]);

  return (
    <div className="app-layout">
      <Toaster
        position="top-center"
        containerStyle={{
          zIndex: 99999999, // Un número ridículamente alto para asegurar que gane siempre
          top: 20 // Opcional: para que no quede pegado al borde exacto si lo deseas
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

      <div className="content-wrapper">
        <Ticker />
        <div className="page-container">
          <Outlet />
        </div>
      </div>

      {/* Modales Globales */}
      <MessageModal />
      <DataSafetyModal />
      <BackupReminder />

      {(showAssistantBot || (GLOBAL_ALERT && GLOBAL_ALERT.active && !localStorage.getItem(`lanzo_alert_${GLOBAL_ALERT.id}`))) && (
        <Suspense fallback={null}>
          <AssistantBot />
        </Suspense>
      )}

    </div>
  );
}

export default Layout;
