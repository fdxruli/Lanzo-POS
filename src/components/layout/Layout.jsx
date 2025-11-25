// src/components/layout/Layout.jsx
// (Solo verifica que tengas la clase correcta en el main, si no, actualízalo)
import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
import { useDashboardStore } from '../../store/useDashboardStore';
import './Layout.css'; // Asegúrate de importar el CSS actualizado

function Layout() {
  const loadAllData = useDashboardStore((state) => state.loadAllData);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return (
    <div className="app-layout"> {/* Clase añadida para flex container */}
      <Navbar />

      <div className="content-wrapper">
        <Ticker />
        <main className="main-content"> {/* Clase corregida para coincidir con CSS */}
          <Outlet />
        </main>
      </div>

      <MessageModal />
    </div>
  );
}

export default Layout;