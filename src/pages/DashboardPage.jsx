// src/pages/DashboardPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Logger from '../services/Logger';

// --- STORES ---
import { useStatsStore } from '../store/useStatsStore';
import { useSalesStore } from '../store/useSalesStore';
import { useRecycleBinStore } from '../store/useRecycleBinStore';
import { useProductStore } from '../store/useProductStore';

// --- COMPONENTES ---
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import WasteHistory from '../components/dashboard/WasteHistory';
import RestockSuggestions from '../components/dashboard/RestockSuggestion';
import ExpirationAlert from '../components/dashboard/ExpirationAlert';

import { loadData, STORES } from '../services/database';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';

export default function DashboardPage() {
  const [customers, setCustomers] = useState([]);
  const [activeTab, setActiveTab] = useState('stats');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const features = useFeatureConfig();

  // 1. ESTADÍSTICAS
  const stats = useStatsStore((state) => state.stats);
  const loadStats = useStatsStore((state) => state.loadStats);
  const isStatsLoading = useStatsStore((state) => state.isLoading);

  // 2. VENTAS Y MERMAS
  const sales = useSalesStore((state) => state.sales);
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales);
  const deleteSale = useSalesStore((state) => state.deleteSale);
  const wasteLogs = useSalesStore((state) => state.wasteLogs);

  // 3. PRODUCTOS
  const menu = useProductStore((state) => state.menu);

  // 4. PAPELERA
  const loadRecycleBin = useRecycleBinStore(state => state.loadRecycleBin);
  const deletedItems = useRecycleBinStore(state => state.deletedItems);
  const restoreItem = useRecycleBinStore(state => state.restoreItem);

  const loadCustomers = async () => {
    try {
      const customersData = await loadData(STORES.CUSTOMERS);
      setCustomers(customersData || []);
    } catch (error) {
      Logger.error("Error cargando clientes:", error);
      setCustomers([]);
    }
  };

  useEffect(() => {
    Logger.log("🔄 Actualizando Dashboard...");
    loadStats();
    loadRecentSales();
    loadCustomers();
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    // Mapeo de URL a estado interno
    const tabMap = {
        'stats': 'stats',
        'tips': 'tips',
        'restock': 'restock',
        'history': 'history',
        'expiration': 'expiration',
        'waste': 'waste'
    };

    if (tabParam && tabMap[tabParam]) {
        setActiveTab(tabMap[tabParam]);
    }
}, [searchParams]);


const handleTabChange = (tabKey) => {
    if (tabKey === 'stats') {
        setSearchParams({}); // Limpia la URL para la vista por defecto
    } else {
        setSearchParams({ tab: tabKey });
    }
};

  useEffect(() => {
    if (activeTab === 'history') loadRecycleBin();
  }, [activeTab, loadRecycleBin]);

  if (isStatsLoading) {
    return (
      <div className="loading-container">
        <div className="spinner-loader"></div>
        <p>Analizando ventas e inventario...</p>
      </div>
    );
  }

  return (
    <>
      {/* --- PESTAÑAS DE NAVEGACIÓN --- */}
      <div className="tabs-container" id="sales-tabs">
        <button
          className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => handleTabChange('stats')}
        >
          Estadísticas Clave
        </button>

        <button
          className={`tab-btn ${activeTab === 'tips' ? 'active' : ''}`}
          onClick={() => handleTabChange('tips')}
        >
          Consejos Lan
        </button>

        {features.hasMinMax && (
          <button
            className={`tab-btn ${activeTab === 'restock' ? 'active' : ''}`}
            onClick={() => handleTabChange('restock')}
          >
            Reabastecimiento
          </button>
        )}

        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => handleTabChange('history')}
        >
          Historial y Papelera
        </button>

        <button
          className={`tab-btn ${activeTab === 'expiration' ? 'active' : ''}`}
          onClick={() => handleTabChange('expiration')}
        >
          Caducidad
        </button>

        {features.hasWaste && (
          <button
            className={`tab-btn ${activeTab === 'waste' ? 'active' : ''}`}
            onClick={() => handleTabChange('waste')}
            style={{ color: activeTab === 'waste' ? 'var(--error-color)' : '' }}
          >
            Mermas
          </button>
        )}
      </div>

      {/* --- CONTENIDO DE LAS PESTAÑAS --- */}

      {/* 1. ESTADÍSTICAS */}
      {activeTab === 'stats' && (
        <StatsGrid stats={stats} />
      )}

      {/* 2. REABASTECIMIENTO */}
      {activeTab === 'restock' && (
        <RestockSuggestions />
      )}

      {/* 3. HISTORIAL Y PAPELERA (MEJORADO) */}
      {activeTab === 'history' && (
        <div className="tab-content fade-in">
          {/* Banner de Advertencia */}
          <div className="data-warning-banner">
            <span className="data-warning-icon">💾</span>
            <div>
              <strong>Importante: Tus datos viven en este dispositivo.</strong>
              <p>
                Te recomendamos hacer una <strong>Copia de Seguridad</strong> semanalmente.
                <button
                  onClick={() => navigate('/settings')}
                  className="link-button"
                >
                  Ir a Respaldar ahora →
                </button>
              </p>
            </div>
          </div>

          {/* Grid Principal: Historial (Izquierda) + Papelera (Derecha) */}
          <div className="history-layout-grid">

            {/* Sección Principal: Historial */}
            <section className="dashboard-panel history-panel">
              <div className="panel-header">
                <h3>📊 Historial de Movimientos</h3>
                <span className="panel-subtitle">Registro de ventas recientes</span>
              </div>
              <div className="panel-body">
                <SalesHistory sales={sales} onDeleteSale={deleteSale} />
              </div>
            </section>

            {/* Sección Lateral: Papelera */}
            <section className="dashboard-panel recycle-panel">
              <div className="panel-header danger-theme">
                <h3>🗑️ Papelera</h3>
                <span className="panel-subtitle">Elementos eliminados</span>
              </div>
              <div className="panel-body">
                <RecycleBin items={deletedItems} onRestoreItem={restoreItem} />
              </div>
            </section>

          </div>
        </div>
      )}

      {/* 4. CONSEJOS */}
      {activeTab === 'tips' && (
        <BusinessTips sales={sales} menu={menu} customers={customers} />
      )}

      {/* 5. CADUCIDAD */}
      {activeTab === 'expiration' && (
        <ExpirationAlert />
      )}

      {/* 6. MERMAS */}
      {activeTab === 'waste' && features.hasWaste && (
        <WasteHistory logs={wasteLogs} />
      )}
    </>
  );
}