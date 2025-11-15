// src/components/layout/Layout.jsx
import React, { useEffect } from 'react'; // 1. Importa useEffect
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';
// 2. Importa el nuevo store
import { useDashboardStore } from '../../store/useDashboardStore'; 

function Layout() {
  // 3. Obtén la acción de carga
  const loadAllData = useDashboardStore((state) => state.loadAllData);

  // 4. Llama a la acción UNA VEZ cuando el Layout se monte
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return (
    <>
      <Navbar />
    
      <Ticker /> 

      <main className="main-container">
        <Outlet />
      </main>

      <MessageModal />
    </>
  );
}

export default Layout;