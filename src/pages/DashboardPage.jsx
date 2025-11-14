// src/pages/DashboardPage.jsx
import React, { useState } from 'react';
import { useDashboard } from '../hooks/useDashboard'; // 1. Importamos el Hook
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import './DashboardPage.css';

export default function DashboardPage() {
  // 2. Estado local para las pestañas
  const [activeTab, setActiveTab] = useState('stats'); // 'stats', 'history', 'tips'
  
  // 3. Llamamos al Hook para obtener toda la lógica y datos
  const { 
    isLoading, 
    stats, 
    salesHistory, 
    recycleBinItems, 
    menu, 
    deleteSale, 
    restoreItem 
  } = useDashboard();

  if (isLoading) {
    return <div>Cargando estadísticas...</div>;
  }

  // 4. Renderizamos la UI
  return (
    <>
      <h2 className="section-title">Panel de Ventas y Estadísticas</h2>
      
      {/* Lógica de Pestañas (Tabs) */}
      <div className="tabs-container" id="sales-tabs">
        <button 
          className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Estadísticas Clave
        </button>
        <button 
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Historial y Papelera
        </button>
        <button 
          className={`tab-btn ${activeTab === 'tips' ? 'active' : ''}`}
          onClick={() => setActiveTab('tips')}
        >
          Consejos para tu Negocio
        </button>
      </div>

      {/* Contenido condicional de las Pestañas */}
      
      {activeTab === 'stats' && (
        <StatsGrid stats={stats} />
      )}
      
      {activeTab === 'history' && (
        <div className="dashboard-grid-condensed">
          {/* (Aquí iría el TopProducts.jsx) */}
          <SalesHistory sales={salesHistory} onDeleteSale={deleteSale} />
          <RecycleBin items={recycleBinItems} onRestoreItem={restoreItem} />
        </div>
      )}

      {activeTab === 'tips' && (
        <BusinessTips sales={salesHistory} menu={menu} />
      )}
    </>
  );
}