// src/components/layout/Layout.jsx
import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import { useDashboardStore } from '../../store/useDashboardStore';
import './Layout.css'; // ¡Asegúrate de crear/importar este archivo CSS!

function Layout() {
  const loadAllData = useDashboardStore((state) => state.loadAllData);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return (
    <div className="app-layout">
      {/* El Navbar será el Sidebar en escritorio */}
      <Navbar />

      {/* Contenedor del contenido derecho (Ticker + Páginas) */}
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