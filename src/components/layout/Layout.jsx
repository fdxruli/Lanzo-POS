// src/components/layout/Layout.jsx
import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import { useStatsStore } from '../../store/useStatsStore';
import { useSalesStore } from '../../store/useSalesStore';
import { useProductStore } from '../../store/useProductStore';
// 1. IMPORTAR TOASTER
import { Toaster } from 'react-hot-toast'; 
import './Layout.css';

function Layout() {
  const loadStats = useStatsStore(state => state.loadStats);
  const loadProducts = useProductStore(state => state.loadInitialProducts);
  const loadSales = useSalesStore(state => state.loadRecentSales);

  useEffect(() => {
    // Disparamos todo en paralelo
    console.log("🚀 Inicializando Stores modulares...");
    loadStats();
    loadProducts();
    loadSales();
  }, []);

  return (
    <div className="app-layout">
      {/* 2. AGREGAR EL COMPONENTE TOASTER AQUÍ */}
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
    </div>
  );
}

export default Layout;