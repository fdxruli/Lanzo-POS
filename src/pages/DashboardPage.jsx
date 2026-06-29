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
import CloudFinalStatsGrid from '../components/dashboard/CloudFinalStatsGrid';
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
import { reportsRepository, REPORT_SYNC_UPDATED_EVENT } from '../services/reports/reportsRepository';
import {
  getReportSourceLabel,
  isCloudFinalReportSource,
  REPORT_SOURCE_MODES
} from '../services/reports/reportSourceBadges';
import { showConfirmModal, showMessageModal } from '../services/utils';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';
import { Save, BarChart3, Trash2, ArrowRight } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../services/sales/cancelSaleCore';

const SALES_HISTORY_PAGE_SIZE = 50;

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

const ReportSourceBanner = ({ source }) => {
  if (!source) return null;

  const isMixed = source.mode === REPORT_SOURCE_MODES.MIXED;
  const isCache = source.mode === REPORT_SOURCE_MODES.CACHE || source.stale;
  const isCloudFinal = isCloudFinalReportSource(source);
  const warnings = Array.isArray(source.warnings) ? source.warnings : [];

  return (
    <div className={`ui-alert ui-alert--warning data-warning-banner report-source-banner report-source-banner--${source.mode || 'local'}`}>
      <span className="ui-alert__icon data-warning-icon">
        <Save size={22} strokeWidth={1.5} />
      </span>
      <div className="ui-alert__content">
        <strong className="ui-alert__title">{getReportSourceLabel(source)}</strong>
        <p className="ui-alert__text">
          {isCloudFinal && isCache
            ? 'Sin conexion o servicio no disponible: se muestra el ultimo snapshot cloud final guardado. Ventas netas, utilidad e historial siguen separados de ventas locales.'
            : isCloudFinal
              ? 'Modo PRO cloud final: ventas, caja, inventario, credito, cancelaciones y utilidad vienen de Supabase como fuente oficial.'
              : isMixed
                ? 'Modo PRO cloud: caja, abonos, clientes y productos usan datos cloud oficiales. Ventas, utilidad real, historial y mermas siguen usando datos locales de este dispositivo hasta activar ventas cloud.'
                : isCache
                  ? 'Sin conexion o servicio no disponible: se muestra el ultimo snapshot cloud guardado. Puede estar desactualizado.'
                  : 'Reporte local de este dispositivo.'}
        </p>
        {warnings.length > 0 && (
          <small>{warnings.slice(0, 2).join(' ')}</small>
        )}
      </div>
    </div>
  );
};

export default function DashboardPage() {
  const [customers, setCustomers] = useState([]);
  const [reportingData, setReportingData] = useState({
    sales: [],
    wasteLogs: [],
    menu: [],
    overviewReport: null,
    reportSource: null,
    salesHistory: [],
    salesHistorySource: null,
    salesHistoryHasMore: false,
    salesHistoryTotalCount: 0,
    usesRepositorySalesHistory: false,
    isLoading: true,
    refreshKey: 0
  });
  const [activeTab, setActiveTab] = useState('stats');
  const [saleToCancel, setSaleToCancel] = useState(null);
  const [salesFinalHistoryPageIndex, setSalesFinalHistoryPageIndex] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const features = useFeatureConfig();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const dashboardReportMode = useMemo(() => reportsRepository.getReportMode(), [licenseDetails]);
  const canUseAIAgents = useMemo(() => hasAIAgentsEntitlement(licenseDetails), [licenseDetails]);

  // 1. ESTADISTICAS
  const stats = useStatsStore((state) => state.stats);
  const loadStats = useStatsStore((state) => state.loadStats);
  const isStatsLoading = useStatsStore((state) => state.isLoading);

  // 2. VENTAS Y MERMAS
  const sales = useSalesStore((state) => state.sales);
  const loadRecentSales = useSalesStore((state) => state.loadRecentSales);
  const fetchSalesPage = useSalesStore((state) => state.fetchSalesPage);
  const hasMoreSales = useSalesStore((state) => state.hasMoreSales);
  const currentSalesPageIndex = useSalesStore((state) => state.currentSalesPageIndex);
  const isSalesLoading = useSalesStore((state) => state.isSalesLoading);
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

  const loadCustomers = useCallback(async () => {
    try {
      const customersData = await loadData(STORES.CUSTOMERS);
      setCustomers(customersData || []);
    } catch (error) {
      Logger.error('Error cargando clientes:', error);
      setCustomers([]);
    }
  }, []);

  const loadDashboardReporting = useCallback(async () => {
    setReportingData((current) => ({ ...current, isLoading: true }));

    try {
      const shouldLoadFinalHistory = Boolean(dashboardReportMode.cloudSalesFinal);
      const historyOffset = salesFinalHistoryPageIndex * SALES_HISTORY_PAGE_SIZE;
      const salesFinalHistoryPromise = shouldLoadFinalHistory
        ? reportsRepository.getSalesFinalHistory({
          scope: 'mine',
          limit: SALES_HISTORY_PAGE_SIZE,
          offset: historyOffset
        })
        : Promise.resolve(null);

      const [localReportResult, cloudOverviewResult, salesFinalHistoryResult] = await Promise.allSettled([
        reportingService.getDashboardReport({
          rangoFechas: null,
          rubros: features.activeRubros,
          incluirCanceladas: false,
          incluirMermas: true,
          incluirProductos: true
        }),
        reportsRepository.getOverviewReport({
          rubros: features.activeRubros,
          scope: 'mine'
        }),
        salesFinalHistoryPromise
      ]);

      const localReport = localReportResult.status === 'fulfilled'
        ? localReportResult.value
        : { sales: [], wasteLogs: [], menu: [] };
      const overviewReport = cloudOverviewResult.status === 'fulfilled'
        ? cloudOverviewResult.value
        : null;
      const salesHistoryReport = salesFinalHistoryResult.status === 'fulfilled'
        ? salesFinalHistoryResult.value
        : null;

      if (localReportResult.status === 'rejected') {
        Logger.error('Error cargando datos locales del dashboard:', localReportResult.reason);
      }
      if (cloudOverviewResult.status === 'rejected') {
        Logger.warn('No se pudo cargar reporte cloud/hibrido:', cloudOverviewResult.reason);
      }
      if (salesFinalHistoryResult.status === 'rejected') {
        Logger.warn('No se pudo cargar historial final cloud:', salesFinalHistoryResult.reason);
      }

      const repositoryHistoryRows = salesHistoryReport?.sales || salesHistoryReport?.rows || [];
      const usesRepositorySalesHistory = Boolean(shouldLoadFinalHistory && salesHistoryReport);
      const effectiveSalesHistory = usesRepositorySalesHistory
        ? repositoryHistoryRows
        : (localReport.sales || []);

      setReportingData({
        sales: localReport.sales || [],
        wasteLogs: localReport.wasteLogs || [],
        menu: localReport.menu || [],
        overviewReport,
        reportSource: overviewReport?.source || null,
        salesHistory: effectiveSalesHistory,
        salesHistorySource: salesHistoryReport?.source || overviewReport?.source || null,
        salesHistoryHasMore: Boolean(salesHistoryReport?.hasMore || salesHistoryReport?.has_more),
        salesHistoryTotalCount: Number(salesHistoryReport?.totalCount || salesHistoryReport?.total_count || effectiveSalesHistory.length || 0),
        usesRepositorySalesHistory,
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
  }, [dashboardReportMode, features.activeRubros, salesFinalHistoryPageIndex]);

  useEffect(() => {
    Logger.log('Actualizando Dashboard...');
    loadStats();
    loadRecentSales();
    loadDashboardReporting();
    loadCustomers();
  }, [loadDashboardReporting, loadRecentSales, loadStats, loadCustomers]);

  useEffect(() => {
    const refreshReportSources = () => {
      if (dashboardReportMode.cloudSalesFinal) setSalesFinalHistoryPageIndex(0);
      loadDashboardReporting();
      loadCustomers();
      loadStats();
    };

    const events = [
      REPORT_SYNC_UPDATED_EVENT,
      'lanzo:customers-sync-updated',
      'lanzo:customer-credit-sync-updated',
      'lanzo:cash-sync-updated',
      'lanzo:products-sync-updated',
      'lanzo:sales-sync-updated'
    ];

    events.forEach((eventName) => window.addEventListener(eventName, refreshReportSources));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, refreshReportSources));
  }, [dashboardReportMode.cloudSalesFinal, loadDashboardReporting, loadCustomers, loadStats]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const tabMap = {
      stats: 'stats',
      tips: 'tips',
      restock: 'restock',
      history: 'history',
      expiration: 'expiration',
      waste: 'waste'
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
    if (!(await showConfirmModal('Mover esta venta cancelada a la papelera?', {
      title: 'Mover a papelera',
      confirmButtonText: 'Si, mover',
      cancelButtonText: 'Cancelar'
    }))) return;
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
    const result = await deleteSale(saleToCancel.id || saleToCancel.cloudSaleId || saleToCancel.timestamp, {
      restoreStock,
      dispositionPlan,
      reason,
      allowWaste: features.hasWaste,
      saleOverride: saleToCancel
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

  const handleSalesHistoryNext = () => {
    if (reportingData.usesRepositorySalesHistory) {
      if (!reportingData.salesHistoryHasMore) return;
      setSalesFinalHistoryPageIndex((current) => current + 1);
      return;
    }

    fetchSalesPage('next');
  };

  const handleSalesHistoryPrev = () => {
    if (reportingData.usesRepositorySalesHistory) {
      setSalesFinalHistoryPageIndex((current) => Math.max(0, current - 1));
      return;
    }

    fetchSalesPage('prev');
  };

  useEffect(() => {
    if (activeTab === 'history') loadRecycleBin();
  }, [activeTab, loadRecycleBin]);

  if (isStatsLoading) {
    return (
      <div className="ui-loading-state loading-container">
        <div className="ui-spinner spinner-loader"></div>
        <p>Analizando ventas e inventario...</p>
      </div>
    );
  }

  const statsSource = reportingData.reportSource;
  const statsIsCloudFinal = isCloudFinalReportSource(statsSource);
  const historySource = reportingData.salesHistorySource || reportingData.reportSource;
  const historyIsCloudFinal = isCloudFinalReportSource(historySource);
  const historyRows = reportingData.usesRepositorySalesHistory ? reportingData.salesHistory : sales;
  const historyHasMore = reportingData.usesRepositorySalesHistory ? reportingData.salesHistoryHasMore : hasMoreSales;
  const historyPageIndex = reportingData.usesRepositorySalesHistory ? salesFinalHistoryPageIndex : currentSalesPageIndex;
  const historyIsLoading = reportingData.usesRepositorySalesHistory ? reportingData.isLoading : isSalesLoading;

  return (
    <>
      <main className="ui-page dashboard-page" aria-label="Dashboard">
      <header className="ui-page__header dashboard-page__header" aria-label="Fuente del reporte">
        <div className="ui-section__actions dashboard-page__actions">
          {statsSource && (
            <span className={`ui-badge ${statsIsCloudFinal ? 'ui-badge--success' : 'ui-badge--info'}`}>
              {getReportSourceLabel(statsSource)}
            </span>
          )}
        </div>
      </header>

      <section className="ui-section dashboard-tabs-section" aria-label="Secciones del dashboard">
      <div className="tabs-container dashboard-tabs" id="sales-tabs">
        <button className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => handleTabChange('stats')}>Estadisticas Clave</button>
        <button className={`tab-btn ${activeTab === 'tips' ? 'active' : ''}`} onClick={() => handleTabChange('tips')}>Consejos Lan</button>
        <button className={`tab-btn ${activeTab === 'restock' ? 'active' : ''}`} onClick={() => handleTabChange('restock')}>Reabastecimiento</button>
        <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => handleTabChange('history')}>Historial y Papelera</button>
        <button className={`tab-btn ${activeTab === 'expiration' ? 'active' : ''}`} onClick={() => handleTabChange('expiration')}>Caducidad</button>
        {features.hasWaste && (
          <button className={`tab-btn dashboard-tab-danger ${activeTab === 'waste' ? 'active' : ''}`} onClick={() => handleTabChange('waste')}>Mermas</button>
        )}
      </div>
      </section>

      <ReportSourceBanner source={reportingData.reportSource} />

      {activeTab === 'stats' && (
        <section className="ui-section dashboard-section dashboard-section--stats" aria-label="Estadisticas principales">
          {statsIsCloudFinal ? (
            <CloudFinalStatsGrid
              reportData={reportingData.overviewReport}
              reportSource={reportingData.reportSource}
            />
          ) : (
            <StatsGrid
              stats={stats}
              customers={customers}
              reportRefreshKey={reportingData.refreshKey}
              activeRubros={features.activeRubros}
              reportData={reportingData.overviewReport}
              reportSource={reportingData.reportSource}
              isCloudReport={reportingData.reportSource?.mode === REPORT_SOURCE_MODES.CLOUD}
              isMixedReport={reportingData.reportSource?.mode === REPORT_SOURCE_MODES.MIXED}
              isStale={Boolean(reportingData.reportSource?.stale)}
            />
          )}
        </section>
      )}

      {activeTab === 'restock' && (
        <section className="ui-section dashboard-section dashboard-section--restock" aria-label="Reabastecimiento">
          <RestockSuggestions reportData={reportingData.overviewReport} reportSource={reportingData.reportSource} />
        </section>
      )}

      {activeTab === 'history' && (
        <section className="ui-section tab-content fade-in dashboard-section dashboard-section--history">
          <div className="ui-alert ui-alert--warning data-warning-banner">
            <span className="ui-alert__icon data-warning-icon"><Save size={24} strokeWidth={1.5} /></span>
            <div className="ui-alert__content">
              <strong className="ui-alert__title">
                {historyIsCloudFinal
                  ? 'Historial cloud final oficial.'
                  : reportingData.usesRepositorySalesHistory
                    ? 'Historial local no oficial de este dispositivo.'
                    : 'Importante: historial de ventas local.'}
              </strong>
              <p className="ui-alert__text">
                {historyIsCloudFinal
                  ? 'Las ventas se leen desde Supabase usando pos_get_sales_final_history. No se mezclan con ventas locales/Dexie.'
                  : reportingData.usesRepositorySalesHistory
                    ? 'Sin snapshot cloud final disponible o sin conexión: se muestra historial local no oficial de este dispositivo.'
                    : 'Las ventas e historial se leen desde este dispositivo. Caja, abonos y credito pueden venir de cloud en PRO.'}
                {!historyIsCloudFinal && (
                  <button onClick={() => navigate('/settings')} className="ui-button ui-button--ghost ui-button--sm link-button">
                    Ir a Respaldar ahora <ArrowRight size={16} />
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="history-layout-grid">
            <section className="ui-card dashboard-panel history-panel">
              <div className="ui-card__header panel-header">
                <h3><BarChart3 size={20} /> Historial de Movimientos</h3>
                <span className="panel-subtitle">
                  {historyIsCloudFinal
                    ? `Ventas finales cloud${reportingData.salesHistoryTotalCount ? ` (${reportingData.salesHistoryTotalCount})` : ''}`
                    : 'Registro de ventas recientes'}
                </span>
              </div>
              <div className="panel-body">
                <SalesHistory
                  sales={historyRows}
                  onDeleteSale={handleDeleteSale}
                  onArchiveSale={handleArchiveCancelledSale}
                  onNext={handleSalesHistoryNext}
                  onPrev={handleSalesHistoryPrev}
                  hasMore={historyHasMore}
                  currentPageIndex={historyPageIndex}
                  isLoading={historyIsLoading}
                  source={historySource}
                  reportSource={historySource}
                  isCloudFinal={historyIsCloudFinal}
                />
              </div>
            </section>

            <section className="ui-card dashboard-panel recycle-panel">
              <div className="ui-card__header panel-header danger-theme">
                <h3><Trash2 size={20} /> Papelera</h3>
                <span className="panel-subtitle">Elementos eliminados</span>
              </div>
              <div className="panel-body"><RecycleBin /></div>
            </section>
          </div>
        </section>
      )}

      {activeTab === 'tips' && (
        <section className="ui-section dashboard-section dashboard-section--tips" aria-label="Consejos y diagnosticos">
          {canUseAIAgents ? (
            <OperationalDiagnostics sales={analyticsSales} menu={analyticsMenu} customers={customers} wasteLogs={analyticsWasteLogs} reportData={reportingData.overviewReport} reportSource={reportingData.reportSource} />
          ) : (
            <BusinessTips sales={analyticsSales} menu={analyticsMenu} customers={customers} wasteLogs={analyticsWasteLogs} activeRubros={features.activeRubros} reportData={reportingData.overviewReport} reportSource={reportingData.reportSource} onNavigate={(route) => navigate(route)} />
          )}
        </section>
      )}

      {activeTab === 'expiration' && (
        <section className="ui-section dashboard-section dashboard-section--expiration" aria-label="Alertas de caducidad">
          <ExpirationAlert reportData={reportingData.overviewReport} reportSource={reportingData.reportSource} />
        </section>
      )}

      {activeTab === 'waste' && features.hasWaste && (
        <section className="ui-section dashboard-section dashboard-section--waste" aria-label="Historial de mermas">
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
            reportSource={reportingData.reportSource}
          />
        </section>
      )}

      </main>

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
