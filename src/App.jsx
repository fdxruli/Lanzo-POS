// src/App.jsx
import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';

// 1. Importa los componentes de página y de inicio
import Layout from './components/layout/Layout';
import WelcomeModal from './components/common/WelcomeModal';
import SetupModal from './components/common/SetupModal';
import PosPage from './pages/PosPage';
import CajaPage from './pages/CajaPage';
import ProductsPage from './pages/ProductsPage';
import CustomersPage from './pages/CustomersPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import DonationPage from './pages/DonationPage';

function App() {
  
  // 2. Conectamos al store
  const appStatus = useAppStore((state) => state.appStatus);
  const initializeApp = useAppStore((state) => state.initializeApp);

  // 3. Inicializamos la app (cargamos licencia, etc.) UNA SOLA VEZ
  // Esto reemplaza tu 'initializeLicense' de app.js
  useEffect(() => {
    initializeApp();
  }, [initializeApp]); // Se ejecuta 1 vez al cargar

  // 4. El "Guardia" (Renderizado condicional)
  // Revisa el estado de la app y decide qué mostrar
  switch (appStatus) {
    case 'loading':
      // Muestra un loader (reusamos tu CSS)
      return (
        <div id="app-loader" style={{ display: 'flex' }}>
          <div className="loader-spinner"></div>
        </div>
      );
      
    case 'unauthenticated':
      // No hay licencia, mostrar el modal de bienvenida
      return <WelcomeModal />;
      
    case 'setup_required':
      // Hay licencia, pero no perfil, mostrar el modal de configuración
      return <SetupModal />;
      
    case 'ready':
      // ¡Todo listo! Muestra la aplicación principal con sus rutas
      return (
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<PosPage />} />
            <Route path="caja" element={<CajaPage />} />
            <Route path="productos" element={<ProductsPage />} />
            <Route path="clientes" element={<CustomersPage />} />
            <Route path="ventas" element={<DashboardPage />} />
            <Route path="configuracion" element={<SettingsPage />} />
            <Route path="donar" element={<DonationPage />} />
          </Route>
        </Routes>
      );
      
    default:
      // Fallback por si algo sale mal
      return <div>Error al cargar la aplicación.</div>;
  }
}

export default App;