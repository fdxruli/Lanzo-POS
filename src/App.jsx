// src/App.jsx
import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import SetupModal from './components/common/SetupModal';
import PosPage from './pages/PosPage';
import CajaPage from './pages/CajaPage';
import ProductsPage from './pages/ProductsPage';
import CustomersPage from './pages/CustomersPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AboutPage from './pages/AboutPage';

function App() {

  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);

  const startRealtimeSecurity = useAppStore((state) => state.startRealtimeSecurity);

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (appStatus === 'ready') {
      startRealtimeSecurity();
    }
  }, [appStatus, startRealtimeSecurity]);

  switch (appStatus) {
    case 'loading':
      return (
        <div id="app-loader" style={{ display: 'flex' }}>
          <div className="loader-spinner"></div>
        </div>
      );

    case 'unauthenticated':
      return <WelcomeModal />;

    case 'setup_required':
      return <SetupModal />;

    case 'ready':
      return (
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<PosPage />} />
            <Route path="caja" element={<CajaPage />} />
            <Route path="productos" element={<ProductsPage />} />
            <Route path="clientes" element={<CustomersPage />} />
            <Route path="ventas" element={<DashboardPage />} />
            <Route path="configuracion" element={<SettingsPage />} />
            <Route path="acerca-de" element={<AboutPage />} />
          </Route>
        </Routes>
      );

    default:
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;