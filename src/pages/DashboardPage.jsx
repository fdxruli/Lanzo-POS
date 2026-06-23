// src/pages/DashboardPage.jsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Logger from '../services/Logger';

// --- STORES ---
import { useStatsStore } from '../store/useStatsStore';
import { useSalesStore } from '../store/useSalesStore';
import { useRecycleBinStore } from '../store/useRecycleBinStore';
import { useProductStore } from '../store/useProductStore';
import { useAppStore } from '../store/useAppStore';

// --- COMPONENTES ---
import StatsGrid from '../components/dashboard/StatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import BusinessTips from '../components/dashboard/BusinessTips';
import OperationalDiagnostics from '../components/dashboard/OperationalDiagnostics';
import WasteHistory from '../components/dashboard/WasteHistory';
import RestockSuggestions from '../components/dashboard/RestockSuggestion';
import ExpirationAlert from '../components/dashboard/ExpirationAlert';
import SaleCancellationModal from '../components/dashboard/SaleCancellationModal';

import { loadData, STORES } from '../services/database';
import { reportingService } from '../services/db/reporting';
import { showMessageModal } from '../services/utils';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';
import { Save, BarChart3, Trash2, ArrowRight } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../services/sales/cancelSaleCore';

const hasAIAgentsEntitlement = (licenseDetails) => {
  if (!licenseDetails?.valid) return false;

  const features = licenseDetails.features || {};
  const planCode = String(
    licenseDetails.plan_code ||
    licenseDetails.planCode ||
    licenseDetails.plan ||
    ''
  ).toLowerCase();

  return (
    features.ai_agents === true ||
    licenseDetails.ai_agents === true ||
    planCode.includes('pro')
  );
};

const buildWarningsMessage = (warnings = []) => {
  if (!warnings.length) return '';

  const preview = warnings
    .slice(0, 3)
    .map((warning, index) => `${index + 1}. ${warning.message}`)
    .join('\n');

  const tail = warnings.length > 3
    ? `\n... y ${warnings.length - 3} advertencias mas.`
    : '';

  return `\n\nAdvertencias:\n${preview}${tail}`;
};

export default function DashboardPage() {
  const [customers, setCustomers] = useState([]);
  const [reportingData, setReportingData] = useState({
    sales: [],
    wasteLogs: [],
    menu: [],
    isLoading: true,
    refreshKey: 0
  });
  const [activeTab, setActiveTab] = useState('stats');
  const [saleToCancel, setSaleToCancel] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const features = useFeatureConfig();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canUseAIAgents = useMemo(() => hasAIAgentsEntitlement(licenseDetails), [licenseDetails]);

  // 1. ESTADÍSTICAS
  const stats = useStatsStore((state) => state.stats);
  const loadStats = useStatsStore((state) => state.loadStats);
  const isStatsLoading = useStatsStore((state) => state.isLoading);

  // 2. VENTAS Y MERMAS
  const sales = useSalesStore((state) => state.sales);
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales);
  const deleteSale = useSalesStore((state) => state.deleteSale);
  const archiveCancelledSale = useSalesStore((state) => state.archiveCancelledSale);
  const isSaleLoading = useSalesStore((state) => state.isLoading);
  const wasteLogs = useSalesStore((state) => state.wasteLogs);
  const fetchWastePage = useSalesStore((state) => state.fetchWastePage);
  const hasMoreWaste = useSalesStore((state) => state.hasMoreWaste);
  const currentWastePageIndex = useSalesStore((state) => state.currentWastePageIndex);
  const isWasteLoading = useSalesStore((state) => state.isWasteLoading);

  // 3. PRODUCTOS
  const menu = useProductStore((state) => state.menu);
  const analyticsSales = reportingData.sales;
  const analyticsWasteLogs = reportingData.wasteLogs;
  const analyticsMenu = reportingData.isLoading ? menu : reportingData.menu;
  const totalWasteLoss = useMemo(
    () => analyticsWasteLogs.reduce((sum, log) => sum + (Number(log.lossAmount) || 0), 0),
    [analyticsWasteLogs]
  );

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

  const loadDashboardReporting = useCallback(async () => {
    setReportingData((current) => ({ ...current, isLoading: true }));

    try {
      const report = await reportingService.getDashboardReport({
        rangoFechas: null,
        rubros: features.activeRubros,
        incluirCanceladas: false,
        incluirMermas: true,
        incluirProductos: true
      });

      setReportingData({
        sales: report.sales || [],
        wasteLogs: report.wasteLogs || [],
        menu: report.menu || [],
        isLoading: false,
        refreshKey: Date.now()
      });
    } catch (error) {
      Logger.error('Error cargando reporte analitico del dashboard:', error);
      setReportingData((current) => ({
        ...current,
        isLoading: false,
        refreshKey: Date.now()
      }));
    }
  }, [features.activeRubros]);

  useEffect(() => {
    Logger.log("🔄 Actualizando Dashboard...");
    loadStats();
    loadRecentSales();
    loadDashboardReporting();
    loadCustomers();
  }, [loadDashboardReporting, loadRecentSales, loadStats]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
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
    } else {
      setActiveTab('stats');
    }
  }, [searchParams]);

  const handleTabChange = (tabKey) => {
    if (tabKey === 'stats') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: tabKey });
    }
  };

  const handleDeleteSale = (sale) => {
    setSaleToCancel(sale);
  };

  const handleArchiveCancelledSale = async (sale) => {
    if (!window.confirm('¿Mover esta venta cancelada a la papelera?')) return;
    const result = await archiveCancelledSale(sale.id);
    if (!result.success) {
      showMessageModal(result.message || 'No se pudo mover la venta a papelera.', null, { type: 'error' });
      return;
    }
    await Promise.all([
      loadRecycleBin(),
      loadDashboardReporting()
    ]);
    showMessageModal('Venta cancelada movida a la papelera.');
  };

  const handleConfirmCancellation = async ({ dispositionPlan, reason }) => {
    if (!saleToCancel) return;

    const restoreStock = dispositionPlan.some(
      (entry) => entry.action === CANCELLATION_ACTIONS.RESTOCK
    );
    const result = await deleteSale(saleToCancel.timestamp, {
      restoreStock,
      dispositionPlan,
      reason,
      allowWaste: features.hasWaste
    });

    if (result.success) {
      setSaleToCancel(null);
      await Promise.all([
        loadRecentSales(),
        loadDashboardReporting()
      ]);
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      if (warnings.length > 0) {
        showMessageModal(
          `Venta cancelada con advertencias.${buildWarningsMessage(warnings)}`,
          null,
          { type: 'warning' }
        );
        return;
      }

      showMessageModal('Venta cancelada y registrada en el historial.');
      return;
    }

    if (result.code === 'NOT_FOUND') {
      showMessageModal('No se encontro la venta. Intenta recargar la pagina.', null, { type: 'warning' });
      return;
    }

    if (result.code === 'ALREADY_CANCELLED') {
      setSaleToCancel(null);
      showMessageModal('La venta ya estaba cancelada.', null, { type: 'warning' });
      return;
    }

    showMessageModal(
      `Error al procesar la cancelacion: ${result.message || 'error inesperado'}`,
      null,
      { type: 'error' }
    );
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
        <StatsGrid
          stats={stats}
          customers={customers}
          reportRefreshKey={reportingData.refreshKey}
          activeRubros={features.activeRubros}
        />
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
            <span className="data-warning-icon">
              <Save size={24} strokeWidth={1.5} />
            </span>
            <div>
              <strong>Importante: Tus datos viven en este dispositivo.</strong>
              <p>
                Te recomendamos hacer una <strong>Copia de Seguridad</strong> semanalmente.
                <button
                  onClick={() => navigate('/settings')}
                  className="link-button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  Ir a Respaldar ahora <ArrowRight size={16} />
                </button>
              </p>
            </div>
          </div>

          {/* Grid Principal: Historial (Izquierda) + Papelera (Derecha) */}
          <div className="history-layout-grid">

            {/* Sección Principal: Historial */}
            <section className="dashboard-panel history-panel">
              <div className="panel-header">
                <h3><BarChart3 size={20} /> Historial de Movimientos</h3>
                <span className="panel-subtitle">Registro de ventas recientes</span>
              </div>
              <div className="panel-body">
                <SalesHistory
                  sales={sales}
                  onDeleteSale={handleDeleteSale}
                  onArchiveSale={handleArchiveCancelledSale}
                />
              </div>
            </section>

            {/* Sección Lateral: Papelera */}
            <section className="dashboard-panel recycle-panel">
              <div className="panel-header danger-theme">
                <h3><Trash2 size={20} /> Papelera</h3>
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
        canUseAIAgents ? (
          <OperationalDiagnostics
            sales={analyticsSales}
            menu={analyticsMenu}
            customers={customers}
            wasteLogs={analyticsWasteLogs}
          />
        ) : (
          <BusinessTips
            sales={analyticsSales}
            menu={analyticsMenu}
            customers={customers}
            wasteLogs={analyticsWasteLogs}
            activeRubros={features.activeRubros}
            onNavigate={(route) => navigate(route)}
          />
        )
      )}

      {/* 5. CADUCIDAD */}
      {activeTab === 'expiration' && (
        <ExpirationAlert />
      )}

      {/* 6. MERMAS */}
      {activeTab === 'waste' && features.hasWaste && (
        <WasteHistory
          logs={wasteLogs}
          totalCount={analyticsWasteLogs.length}
          totalLoss={totalWasteLoss}
          onNext={() => fetchWastePage('next')}
          onPrev={() => fetchWastePage('prev')}
          hasMoreWaste={hasMoreWaste}
          currentWastePageIndex={currentWastePageIndex}
          isWasteLoading={isWasteLoading}
          activeRubros={features.activeRubros}
        />
      )}

      <SaleCancellationModal
        show={Boolean(saleToCancel)}
        sale={saleToCancel}
        allowWaste={features.hasWaste}
        isSubmitting={isSaleLoading}
        onClose={() => !isSaleLoading && setSaleToCancel(null)}
        onConfirm={handleConfirmCancellation}
      />
    </>
  );
}
