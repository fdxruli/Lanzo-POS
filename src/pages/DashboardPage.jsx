// src/pages/DashboardPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
import { loadData, STORES } from '../services/database';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';

export default function DashboardPage() {
  const [customers, setCustomers] = useState([]);
  const [activeTab, setActiveTab] = useState('stats');
  const navigate = useNavigate();
  const features = useFeatureConfig();

  // 1. ESTADÍSTICAS
  const stats = useStatsStore((state) => state.stats);
  const loadStats = useStatsStore((state) => state.loadStats); // IMPORTANTE: Traemos la acción de carga
  const isStatsLoading = useStatsStore((state) => state.isLoading);

  // 2. VENTAS Y MERMAS
  const sales = useSalesStore((state) => state.sales);
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales); // IMPORTANTE: Traemos la acción
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
      console.error("Error cargando clientes:", error);
      setCustomers([]);
    }
  };

  // --- EFECTO DE CARGA INICIAL (LA SOLUCIÓN AL "DESCONECTADO") ---
  useEffect(() => {
    // Al entrar a la página, forzamos la recarga de estadísticas y ventas
    console.log("🔄 Actualizando Dashboard...");
    loadStats();
    loadRecentSales();
    loadCustomers();
  }, []); // Se ejecuta solo al montar el componente

  // Cargar papelera solo si entramos a esa pestaña
  useEffect(() => {
    if (activeTab === 'history') loadRecycleBin();
  }, [activeTab, loadRecycleBin]);

  if (isStatsLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem' }}>
        <div className="spinner-loader"></div>
        <p style={{ marginTop: '1rem', color: '#666' }}>Analizando ventas e inventario...</p>
      </div>
    );
  }

  return (
    <>
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

      {/* PESTAÑA: ESTADÍSTICAS */}
      {activeTab === 'stats' && (
        <StatsGrid stats={stats} />
      )}

      {/* PESTAÑA: HISTORIAL Y PAPELERA */}
      {activeTab === 'history' && (
        <>
          <div className="data-warning-banner">
            <span className="data-warning-icon">💾</span>
            <div>
              <strong>Importante: Tus datos viven en este dispositivo.</strong>
              <p style={{ margin: '4px 0 0 0' }}>
                Lanzo POS guarda toda la información en el navegador. Si borras el historial o las "cookies", podrías perder tus registros.
                <br />
                Te recomendamos hacer una <strong>Copia de Seguridad</strong> semanalmente.
                <button
                  onClick={() => navigate('/productos')}
                  style={{
                    background: 'none',
                    border: 'none',
                    textDecoration: 'underline',
                    color: 'inherit',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: '5px'
                  }}
                >
                  Ir a Respaldar ahora →
                </button>
              </p>
            </div>
          </div>
          <div className="dashboard-grid-condensed">
            <SalesHistory sales={sales} onDeleteSale={deleteSale} />
            <RecycleBin items={deletedItems} onRestoreItem={restoreItem} />
          </div>
        </>
      )}

      {/* PESTAÑA: CONSEJOS */}
      {activeTab === 'tips' && (
        <BusinessTips sales={sales} menu={menu} customers={customers} />
      )}

      {/* PESTAÑA: MERMAS */}
      {activeTab === 'waste' && features.hasWaste && (
        <WasteHistory logs={wasteLogs} />
      )}
    </>
  );
}