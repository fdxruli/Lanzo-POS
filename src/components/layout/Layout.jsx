//
import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import DataSafetyModal from '../common/DataSafetyModal';
import BackupReminder from '../common/BackupRemider';

import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useProductStore } from '../../store/useProductStore';
import { Toaster } from 'react-hot-toast'; 
// 1. IMPORTAR APP STORE
import { useAppStore } from '../../store/useAppStore'; 
import './Layout.css';

function Layout() {
  const loadStats = useStatsStore(state => state.loadStats);
  const loadProducts = useProductStore(state => state.loadInitialProducts);
  const loadSales = useSalesStore(state => state.loadRecentSales);

  // 2. OBTENER DATOS DEL STORE
  const licenseDetails = useAppStore(state => state.licenseDetails);
  const initializeApp = useAppStore(state => state.initializeApp);

  useEffect(() => {
    console.log("🚀 Inicializando Stores modulares...");
    loadStats();
    loadProducts();
    loadSales();
  }, []);

  // 3. NUEVO: INTERVALO DE VERIFICACIÓN (CADA 1 MINUTO)
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Si la licencia es válida y tiene fecha de expiración...
      if (licenseDetails?.valid && licenseDetails?.expires_at) {
        const now = new Date();
        const expires = new Date(licenseDetails.expires_at);
        
        // ...y el momento actual acaba de superar la fecha de vencimiento
        if (now > expires) {
           console.log("🕒 El tiempo de licencia ha expirado. Re-verificando estado...");
           // Forzamos al store a re-evaluar. 
           // Gracias al Paso 1, esto activará el modo gracia en vez de bloquear.
           initializeApp(); 
        }
      }
    }, 60000); // 60,000 ms = 1 minuto

    return () => clearInterval(intervalId);
  }, [licenseDetails, initializeApp]);

  return (
    <div className="app-layout">
      {/* ... (El resto del JSX se mantiene igual) ... */}
      <Toaster 
        position="top-center"
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
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      <MessageModal />
      <DataSafetyModal />
      <BackupReminder />
      
    </div>
  );
}

export default Layout;