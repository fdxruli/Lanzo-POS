// src/pages/DashboardPage.jsx
import React, { useState } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import WasteHistory from '../components/dashboard/WasteHistory';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('stats');

  const features = useFeatureConfig();

  // 1. Obtenemos los datos del store
  const isLoading = useDashboardStore((state) => state.isLoading);
  const sales = useDashboardStore((state) => state.sales); // Solo las ventas recientes (paginadas)
  const menu = useDashboardStore((state) => state.menu);
  const deletedItems = useDashboardStore((state) => state.deletedItems);
  const wasteLogs = useDashboardStore((state) => state.wasteLogs);

  // 2. OBTENEMOS LAS ESTADÍSTICAS YA CALCULADAS POR EL STORE
  // En lugar de calcularlas aquí, usamos las que 'calculateStatsOnTheFly' generó.
  const stats = useDashboardStore((state) => state.stats);

  const deleteSale = useDashboardStore((state) => state.deleteSale);
  const restoreItem = useDashboardStore((state) => state.restoreItem);
  const loadRecycleBin = useDashboardStore((state) => state.loadRecycleBin);

  // Cargar papelera solo si entramos a esa pestaña
  React.useEffect(() => {
    if (activeTab === 'history') {
      loadRecycleBin();
    }
  }, [activeTab, loadRecycleBin]);

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Calculando estadísticas globales...</div>;
  }

  return (
    <>
      <h2 className="section-title">Panel de Ventas y Estadísticas</h2>

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
        {features.hasWaste && (
          <button
            className={`tab-btn ${activeTab === 'waste' ? 'active' : ''}`}
            onClick={() => setActiveTab('waste')}
            style={{ color: activeTab === 'waste' ? 'var(--error-color)' : '' }}
          >
            Mermas
          </button>
        )}
      </div>

      {/* 3. Pasamos el objeto 'stats' directo del store */}
      {activeTab === 'stats' && (
        <StatsGrid stats={stats} />
      )}

      {activeTab === 'history' && (
        <div className="dashboard-grid-condensed">
          <SalesHistory sales={sales} onDeleteSale={deleteSale} />
          <RecycleBin items={deletedItems} onRestoreItem={restoreItem} />
        </div>
      )}

      {activeTab === 'tips' && (
        <BusinessTips sales={sales} menu={menu} />
      )}

      {/* RENDERIZAR COMPONENTE DE MERMAS */}
      {activeTab === 'waste' && features.hasWaste && (
        <WasteHistory logs={wasteLogs} />
      )}
    </>
  );
}