// src/pages/DashboardPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// --- STORES ---
import { useStatsStore } from '../store/useStatsStore';
import { useSalesStore } from '../store/useSalesStore';
import { useRecycleBinStore } from '../store/useRecycleBinStore';
import { useProductStore } from '../store/useProductStore'; // <--- FALTABA ESTE IMPORT

// --- COMPONENTES ---
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import WasteHistory from '../components/dashboard/WasteHistory';

import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('stats');
  const navigate = useNavigate();
  const features = useFeatureConfig();

  // 1. ESTADÍSTICAS (Store: useStatsStore)
  const stats = useStatsStore((state) => state.stats);
  const isStatsLoading = useStatsStore((state) => state.isLoading);

  // 2. VENTAS Y MERMAS (Store: useSalesStore)
  // Aquí faltaba extraer 'deleteSale' y 'wasteLogs'
  const sales = useSalesStore((state) => state.sales);
  const deleteSale = useSalesStore((state) => state.deleteSale); // <--- CORRECCIÓN 1
  const wasteLogs = useSalesStore((state) => state.wasteLogs);   // <--- CORRECCIÓN 2

  // 3. PRODUCTOS (Store: useProductStore)
  // Necesario para los consejos de negocio ('BusinessTips')
  const menu = useProductStore((state) => state.menu);           // <--- CORRECCIÓN 3

  // 4. PAPELERA (Store: useRecycleBinStore)
  const loadRecycleBin = useRecycleBinStore(state => state.loadRecycleBin);
  const deletedItems = useRecycleBinStore(state => state.deletedItems);
  const restoreItem = useRecycleBinStore(state => state.restoreItem);

  // Cargar papelera solo si entramos a esa pestaña
  useEffect(() => {
    if (activeTab === 'history') loadRecycleBin();
  }, [activeTab, loadRecycleBin]);

  if (isStatsLoading) {
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
                  onClick={() => navigate('/productos')} // Redirige a productos donde está el botón de exportar
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
            {/* Ahora 'deleteSale' ya existe y no dará error */}
            <SalesHistory sales={sales} onDeleteSale={deleteSale} />
            <RecycleBin items={deletedItems} onRestoreItem={restoreItem} />
          </div>
        </>
      )}

      {/* PESTAÑA: CONSEJOS (Necesita 'menu') */}
      {activeTab === 'tips' && (
        <BusinessTips sales={sales} menu={menu} />
      )}

      {/* PESTAÑA: MERMAS (Necesita 'wasteLogs') */}
      {activeTab === 'waste' && features.hasWaste && (
        <WasteHistory logs={wasteLogs} />
      )}
    </>
  );
}