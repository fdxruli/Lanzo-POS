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
import { useAppStore } from '../../store/useAppStore';
import './Layout.css';
import Logger from '../../services/Logger';

// 1. IMPORTA EL COMPONENTE AQUÍ
import InstallPrompt from '../common/InstallPrompt'; 

function Layout() {
  const loadStats = useStatsStore(state => state.loadStats);
  const loadProducts = useProductStore(state => state.loadInitialProducts);
  const loadSales = useSalesStore(state => state.loadRecentSales);

  const licenseDetails = useAppStore(state => state.licenseDetails);
  const initializeApp = useAppStore(state => state.initializeApp);

  useEffect(() => {
    Logger.log("🚀 Inicializando Stores modulares...");
    loadStats();
    loadProducts();
    loadSales();
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

      {/* 2. AGRÉGALO AQUÍ AL FINAL (Discreto pero accesible globalmente) */}
      <InstallPrompt /> 

    </div>
  );
}

export default Layout;