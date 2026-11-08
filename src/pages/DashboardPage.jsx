import { usePublishBotScreen } from '../hooks/useBotScreenContext';
// src/pages/DashboardPage.jsx
import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Logger from '../services/Logger';

// --- STORES ---
import { useStatsStore } from '../store/useStatsStore';
import { useSalesStore } from '../store/useSalesStore';
import { useRecycleBinStore } from '../store/useRecycleBinStore';
import { useInventoryCatalogStore } from '../store/useInventoryCatalogStore';
import { useAppStore } from '../store/useAppStore';

// --- COMPONENTES ---
import StatsGrid from '../components/dashboard/StatsGrid';
import CloudFinalStatsGrid from '../components/dashboard/CloudFinalStatsGrid';
import SalesHistory from '../components/dashboard/SalesHistory';
import RecycleBin from '../components/dashboard/RecycleBin';
import OperationalDiagnostics from '../components/dashboard/OperationalDiagnostics';
import WasteHistory from '../components/dashboard/WasteHistory';
import RestockSuggestions from '../components/dashboard/RestockSuggestion';
import ExpirationAlert from '../components/dashboard/ExpirationAlert';
import SaleCancellationModal from '../components/dashboard/SaleCancellationModal';

import { loadData, STORES } from '../services/database';
import { reportingService } from '../services/db/reporting';
import { reportsRepository, REPORT_SYNC_UPDATED_EVENT } from '../services/reports/reportsRepository';
import {
  isCloudFinalReportSource,
  REPORT_SOURCE_MODES
} from '../services/reports/reportSourceBadges';
import { showConfirmModal, showMessageModal } from '../services/utils';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import './DashboardPage.css';
import { BarChart3, Trash2 } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../services/sales/cancelSaleCore';
import {
  canPerformRefunds,
  getSalesFinalHistoryScope,
  getSalesActorIdentity
} from '../services/auth/salesPermissionPolicy';
import { captureRefundsActorHandle } from '../services/auth/refundsActorAuthorization';
import { useActorRuntimeSnapshot } from '../services/auth/useActorRuntimeSnapshot';
import { readAIReportUiState, writeAIReportUiState } from '../utils/aiReportUiState';
import { getLicenseKeyFromDetails } from '../services/sync/syncConstants';

const SALES_HISTORY_PAGE_SIZE = 50;

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
    overviewReport: null,
    reportSource: null,
    salesHistory: [],
    creditHistoryReport: null,
    creditHistoryAttempted: false,
    salesHistorySource: null,
    salesHistoryHasMore: false,
    salesHistoryTotalCount: null,
    salesHistoryDateRange: null,
    salesHistoryScope: null,
    salesHistoryContextKey: null,
    salesHistoryError: null,
    usesRepositorySalesHistory: false,
    salesHistoryIsLoading: false,
    isLoading: true,
    refreshKey: 0
  });
  const [activeTab, setActiveTab] = useState(() => readAIReportUiState().activeTab || 'stats');
  usePublishBotScreen('/ventas', activeTab);
  const [hasCompletedInitialStatsLoad, setHasCompletedInitialStatsLoad] = useState(false);
  const [saleToCancel, setSaleToCancel] = useState(null);
  const [salesFinalHistoryPageIndex, setSalesFinalHistoryPageIndex] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const features = useFeatureConfig();
  const actorRuntime = useActorRuntimeSnapshot();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const canManageRefunds = canPerformRefunds(actorRuntime);
  const salesActorIdentity = getSalesActorIdentity(actorRuntime);
  const salesFinalHistoryScope = getSalesFinalHistoryScope(actorRuntime);
  const salesHistoryContextKey = JSON.stringify([
    licenseKey || 'local',
    salesActorIdentity || 'no-actor',
    salesFinalHistoryScope,
    actorRuntime?.tenant?.opaqueId || null,
    actorRuntime?.deviceRef || null,
    actorRuntime?.generation ?? null
  ]);
  const dashboardReportMode = useMemo(() => reportsRepository.getReportMode(licenseDetails), [licenseDetails]);

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
  const menu = useInventoryCatalogStore((state) => state.menu);
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
    const shouldLoadFinalHistory = Boolean(dashboardReportMode.cloudSalesFinal);
    setReportingData((current) => ({
      ...current,
      isLoading: true,
      creditHistoryReport: null,
      creditHistoryAttempted: false,
      usesRepositorySalesHistory: shouldLoadFinalHistory,
      salesHistoryIsLoading: shouldLoadFinalHistory,
      salesHistory: shouldLoadFinalHistory ? [] : current.salesHistory,
      salesHistorySource: shouldLoadFinalHistory ? null : current.salesHistorySource,
      salesHistoryTotalCount: shouldLoadFinalHistory ? null : current.salesHistoryTotalCount,
      salesHistoryDateRange: shouldLoadFinalHistory ? null : current.salesHistoryDateRange,
      salesHistoryScope: shouldLoadFinalHistory ? null : current.salesHistoryScope,
      salesHistoryContextKey: shouldLoadFinalHistory ? null : salesHistoryContextKey,
      salesHistoryError: null
    }));

    try {
      const [localReportResult, cloudOverviewResult] = await Promise.allSettled([
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
        })
      ]);

      const localReport = localReportResult.status === 'fulfilled'
        ? localReportResult.value
        : { sales: [], wasteLogs: [], menu: [] };
      const overviewReport = cloudOverviewResult.status === 'fulfilled'
        ? cloudOverviewResult.value
        : null;
      const reportDateRange = overviewReport?.dateRange
        || overviewReport?.date_range
        || overviewReport?.raw?.date_range
        || {};
      const dateFrom = reportDateRange.date_from || reportDateRange.start || reportDateRange.from || null;
      const dateTo = reportDateRange.date_to || reportDateRange.end || reportDateRange.to || null;
      const shouldLoadCreditHistory = shouldLoadFinalHistory
        && Boolean(salesActorIdentity)
        && overviewReport?.success !== false
        && overviewReport?.source?.mode === REPORT_SOURCE_MODES.CLOUD_FINAL
        && overviewReport?.source?.stale === false;
      const creditHistoryResult = (await Promise.allSettled([
        shouldLoadCreditHistory
          ? reportsRepository.getSalesFinalHistory({
            scope: 'mine',
            limit: SALES_HISTORY_PAGE_SIZE,
            offset: 0,
            ...(dateFrom && dateTo ? { dateFrom, dateTo } : {})
          }, { cacheContextKey: salesHistoryContextKey })
          : Promise.resolve(null)
      ]))[0];
      const creditHistoryReport = creditHistoryResult.status === 'fulfilled'
        ? creditHistoryResult.value
        : null;

      if (localReportResult.status === 'rejected') {
        Logger.error('Error cargando datos locales del dashboard:', localReportResult.reason);
      }
      if (cloudOverviewResult.status === 'rejected') {
        Logger.warn('No se pudo cargar reporte cloud/hibrido:', cloudOverviewResult.reason);
      }
      if (creditHistoryResult.status === 'rejected') {
        Logger.warn('No se pudo cargar historial Cloud para conciliar crédito:', creditHistoryResult.reason);
      }

      setReportingData((current) => ({
        ...current,
        sales: localReport.sales || [],
        wasteLogs: localReport.wasteLogs || [],
        menu: localReport.menu || [],
        overviewReport,
        reportSource: overviewReport?.source || null,
        salesHistorySource: shouldLoadFinalHistory
          ? null
          : { mode: REPORT_SOURCE_MODES.LOCAL, local: ['sales'], warnings: ['Ventas cargadas desde este dispositivo.'] },
        salesHistoryContextKey: shouldLoadFinalHistory ? null : salesHistoryContextKey,
        salesHistoryError: null,
        creditHistoryReport,
        creditHistoryAttempted: shouldLoadCreditHistory,
        usesRepositorySalesHistory: shouldLoadFinalHistory,
        salesHistoryIsLoading: shouldLoadFinalHistory,
        isLoading: false,
        refreshKey: Date.now()
      }));
    } catch (error) {
      Logger.error('Error cargando reporte analitico del dashboard:', error);
      setReportingData((current) => ({
        ...current,
        isLoading: false,
        salesHistoryIsLoading: Boolean(dashboardReportMode.cloudSalesFinal),
        refreshKey: Date.now()
      }));
    }
  }, [dashboardReportMode, features.activeRubros, salesActorIdentity, salesHistoryContextKey]);

  useEffect(() => {
    if (!dashboardReportMode.cloudSalesFinal || reportingData.isLoading) return undefined;

    let isActive = true;
    const reportDateRange = reportingData.overviewReport?.dateRange
      || reportingData.overviewReport?.date_range
      || reportingData.overviewReport?.raw?.date_range
      || {};
    const dateFrom = reportDateRange.date_from || reportDateRange.start || reportDateRange.from || null;
    const dateTo = reportDateRange.date_to || reportDateRange.end || reportDateRange.to || null;
    const offset = salesFinalHistoryPageIndex * SALES_HISTORY_PAGE_SIZE;

    const applySalesHistory = (salesHistoryReport) => {
      const rows = salesHistoryReport?.sales || salesHistoryReport?.rows || [];
      const rawTotalCount =
        salesHistoryReport?.totalCount
        ?? salesHistoryReport?.total_count
        ?? null;
      const parsedTotalCount = rawTotalCount === null || rawTotalCount === '' ? Number.NaN : Number(rawTotalCount);
      const totalCount = Number.isFinite(parsedTotalCount) && parsedTotalCount >= rows.length
        ? parsedTotalCount
        : null;
      setReportingData((current) => ({
        ...current,
        salesHistory: rows,
        salesHistorySource: salesHistoryReport?.source || current.reportSource || null,
        salesHistoryHasMore: Boolean(salesHistoryReport?.hasMore || salesHistoryReport?.has_more),
        salesHistoryTotalCount: totalCount,
        salesHistoryDateRange: salesHistoryReport?.dateRange
          || salesHistoryReport?.date_range
          || (dateFrom && dateTo ? { dateFrom, dateTo } : null),
        salesHistoryScope: salesHistoryReport?.scope || salesFinalHistoryScope,
        salesHistoryContextKey,
        salesHistoryError: null,
        usesRepositorySalesHistory: true,
        salesHistoryIsLoading: false
      }));
    };

    setReportingData((current) => ({
      ...current,
      salesHistory: current.salesHistoryContextKey === salesHistoryContextKey ? current.salesHistory : [],
      salesHistoryTotalCount: current.salesHistoryContextKey === salesHistoryContextKey ? current.salesHistoryTotalCount : null,
      salesHistoryHasMore: current.salesHistoryContextKey === salesHistoryContextKey ? current.salesHistoryHasMore : false,
      salesHistoryIsLoading: true,
      salesHistoryError: null
    }));
    reportsRepository.getSalesFinalHistory({
      scope: salesFinalHistoryScope,
      limit: SALES_HISTORY_PAGE_SIZE,
      offset,
      ...(dateFrom && dateTo ? { dateFrom, dateTo } : {})
    }, { cacheContextKey: salesHistoryContextKey }).then((salesHistoryReport) => {
      if (isActive) applySalesHistory(salesHistoryReport);
    }).catch((error) => {
      Logger.warn('No se pudo cargar historial final cloud:', error);
      if (!isActive) return;
      setReportingData((current) => ({
        ...current,
        salesHistory: [],
        salesHistorySource: null,
        salesHistoryTotalCount: null,
        salesHistoryDateRange: null,
        salesHistoryScope: salesFinalHistoryScope,
        salesHistoryContextKey,
        salesHistoryError: 'No se pudo cargar este historial. Intenta actualizar la página.',
        usesRepositorySalesHistory: true,
        salesHistoryHasMore: false,
        salesHistoryIsLoading: false
      }));
    });

    return () => { isActive = false; };
  }, [
    dashboardReportMode.cloudSalesFinal,
    reportingData.isLoading,
    reportingData.refreshKey,
    reportingData.overviewReport,
    salesFinalHistoryPageIndex,
    salesFinalHistoryScope,
    salesHistoryContextKey
  ]);

  useLayoutEffect(() => {
    setSalesFinalHistoryPageIndex(0);
  }, [salesHistoryContextKey]);

  useEffect(() => {
    Logger.log('Actualizando Dashboard...');
    let isActive = true;
    const markInitialStatsLoadComplete = () => {
      if (isActive) setHasCompletedInitialStatsLoad(true);
    };

    Promise.resolve().then(loadStats).then(markInitialStatsLoadComplete, markInitialStatsLoadComplete);
    loadRecentSales();
    loadDashboardReporting();
    loadCustomers();

    return () => {
      isActive = false;
    };
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

    const nextTab = tabParam && tabMap[tabParam]
      ? tabMap[tabParam]
      : readAIReportUiState().activeTab || 'stats';
    setActiveTab(nextTab);
    writeAIReportUiState({ activeTab: nextTab });
  }, [searchParams]);

  const handleTabChange = (tabKey) => {
    writeAIReportUiState({ activeTab: tabKey });
    if (tabKey === 'stats') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: tabKey });
    }
  };

  const handleDeleteSale = (sale) => {
    if (!canManageRefunds || !salesActorIdentity) return;
    try {
      setSaleToCancel({
        sale,
        actorHandle: captureRefundsActorHandle(),
        actorIdentity: salesActorIdentity
      });
    } catch {
      showMessageModal('No tienes permiso vigente para cancelar o reembolsar ventas.', null, { type: 'error' });
    }
  };

  const handleArchiveCancelledSale = async (sale) => {
    if (!canManageRefunds) return;
    let actorHandle;
    try {
      actorHandle = captureRefundsActorHandle();
    } catch {
      showMessageModal('No tienes permiso vigente para archivar ventas canceladas.', null, { type: 'error' });
      return;
    }
    if (!(await showConfirmModal('Mover esta venta cancelada a la papelera?', {
      title: 'Mover a papelera',
      confirmButtonText: 'Si, mover',
      cancelButtonText: 'Cancelar'
    }))) return;
    const result = await archiveCancelledSale(sale.id, { actorHandle });
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

  const handleConfirmCancellation = async ({ dispositionPlan, reason, refunds }) => {
    if (!saleToCancel || !canManageRefunds || saleToCancel.actorIdentity !== salesActorIdentity) return;
    const sale = saleToCancel.sale;

    const restoreStock = dispositionPlan.some(
      (entry) => entry.action === CANCELLATION_ACTIONS.RESTOCK
    );
    const result = await deleteSale(sale.id || sale.cloudSaleId || sale.timestamp, {
      restoreStock,
      dispositionPlan,
      reason,
      refunds,
      allowWaste: features.hasWaste,
      saleOverride: sale,
      actorHandle: saleToCancel.actorHandle
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
    setSaleToCancel((current) => (
      current
      && canManageRefunds
      && current.actorIdentity === salesActorIdentity
        ? current
        : null
    ));
  }, [canManageRefunds, salesActorIdentity]);

  const handleSalesHistoryNext = () => {
    if (reportingData.usesRepositorySalesHistory) {
      if (!reportingData.salesHistoryHasMore || reportingData.salesHistoryIsLoading) return;
      setReportingData((current) => ({ ...current, salesHistoryIsLoading: true, salesHistoryError: null }));
      setSalesFinalHistoryPageIndex((current) => current + 1);
      return;
    }

    fetchSalesPage('next');
  };

  const handleSalesHistoryPrev = () => {
    if (reportingData.usesRepositorySalesHistory) {
      if (salesFinalHistoryPageIndex === 0 || reportingData.salesHistoryIsLoading) return;
      setReportingData((current) => ({ ...current, salesHistoryIsLoading: true, salesHistoryError: null }));
      setSalesFinalHistoryPageIndex((current) => Math.max(0, current - 1));
      return;
    }

    fetchSalesPage('prev');
  };

  useEffect(() => {
    if (activeTab === 'history') loadRecycleBin();
  }, [activeTab, loadRecycleBin]);

  if (isStatsLoading && !hasCompletedInitialStatsLoad) {
    return (
      <div className="ui-loading-state loading-container">
        <div className="ui-spinner spinner-loader"></div>
        <p>Analizando ventas e inventario...</p>
      </div>
    );
  }

  const statsSource = reportingData.reportSource;
  const statsIsCloudFinal = isCloudFinalReportSource(statsSource);
  const historyContextMatches = reportingData.salesHistoryContextKey === salesHistoryContextKey;
  const historySource = dashboardReportMode.cloudSalesFinal
    ? (historyContextMatches ? reportingData.salesHistorySource : null)
    : (reportingData.salesHistorySource || {
      mode: REPORT_SOURCE_MODES.LOCAL,
      local: ['sales'],
      warnings: ['Ventas cargadas desde este dispositivo.']
    });
  const historyIsCloudFinal = isCloudFinalReportSource(historySource);
  const historyUsesRepository = dashboardReportMode.cloudSalesFinal;
  const historyRows = historyUsesRepository
    ? (historyContextMatches ? reportingData.salesHistory : [])
    : sales;
  const historyHasMore = historyUsesRepository
    ? (historyContextMatches && reportingData.salesHistoryHasMore)
    : hasMoreSales;
  const historyPageIndex = historyUsesRepository
    ? (historyContextMatches ? salesFinalHistoryPageIndex : 0)
    : currentSalesPageIndex;
  const historyIsLoading = historyUsesRepository
    ? (reportingData.salesHistoryIsLoading || !historyContextMatches)
    : isSalesLoading;
  const historyTotalCount = historyUsesRepository && historyContextMatches
    ? reportingData.salesHistoryTotalCount
    : null;
  const historyDateRange = historyUsesRepository && historyContextMatches
    ? reportingData.salesHistoryDateRange
    : null;
  const historyScope = historyUsesRepository && historyContextMatches
    ? reportingData.salesHistoryScope
    : null;

  return (
    <>
      <main className="ui-page dashboard-page" aria-label="Dashboard">
      <section className="ui-section dashboard-tabs-section" aria-label="Secciones del dashboard">
      <div className="tabs-container dashboard-tabs" id="sales-tabs">
        <button type="button" className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => handleTabChange('stats')}>Estadisticas Clave</button>
        <button type="button" className={`tab-btn ${activeTab === 'tips' ? 'active' : ''}`} onClick={() => handleTabChange('tips')}>Consejos Lan</button>
        <button type="button" className={`tab-btn ${activeTab === 'restock' ? 'active' : ''}`} onClick={() => handleTabChange('restock')}>Reabastecimiento</button>
        <button type="button" className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => handleTabChange('history')}>Historial y Papelera</button>
        <button type="button" className={`tab-btn ${activeTab === 'expiration' ? 'active' : ''}`} onClick={() => handleTabChange('expiration')}>Caducidad</button>
        {features.hasWaste && (
          <button type="button" className={`tab-btn dashboard-tab-danger ${activeTab === 'waste' ? 'active' : ''}`} onClick={() => handleTabChange('waste')}>Mermas</button>
        )}
      </div>
      </section>

      {activeTab === 'stats' && (
        <section className="ui-section dashboard-section dashboard-section--stats" aria-label="Estadisticas principales">
          {statsIsCloudFinal ? (
            <CloudFinalStatsGrid
              reportData={reportingData.overviewReport}
              reportSource={reportingData.reportSource}
              creditHistoryReport={reportingData.creditHistoryReport}
              scope="mine"
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
          <div className="history-layout-grid">
            <section className="ui-card dashboard-panel history-panel">
              <div className="ui-card__header panel-header">
                <h3><BarChart3 size={20} /> Historial de Movimientos</h3>
                <span className="panel-subtitle">
                  {historyIsCloudFinal
                    ? `Ventas registradas${historyTotalCount !== null ? ` (${historyTotalCount})` : ''}`
                    : 'Registro de ventas recientes'}
                </span>
              </div>
              <div className="panel-body">
                <SalesHistory
                  key={salesHistoryContextKey}
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
                  totalCount={historyTotalCount}
                  queryScope={historyScope}
                  dateRange={historyDateRange}
                  error={historyUsesRepository && historyContextMatches ? reportingData.salesHistoryError : null}
                  businessName={companyProfile?.name || companyProfile?.business_name || ''}
                  canManageRefunds={canManageRefunds}
                />
              </div>
            </section>

            <section className="ui-card dashboard-panel recycle-panel">
              <div className="ui-card__header panel-header danger-theme">
                <h3><Trash2 size={20} /> Papelera</h3>
                <span className="panel-subtitle">Elementos eliminados</span>
              </div>
              <div className="panel-body"><RecycleBin canManageSaleRefunds={canManageRefunds} /></div>
            </section>
          </div>
        </section>
      )}

      {activeTab === 'tips' && (
        <section className="ui-section dashboard-section dashboard-section--tips" aria-label="Diagnóstico operativo">
          <OperationalDiagnostics
            sales={analyticsSales}
            menu={analyticsMenu}
            customers={customers}
            wasteLogs={analyticsWasteLogs}
            reportData={reportingData.overviewReport}
            reportSource={reportingData.reportSource}
            onNavigate={(route) => navigate(route)}
          />
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

      {canManageRefunds && saleToCancel?.actorIdentity === salesActorIdentity && (
        <SaleCancellationModal
          key={saleToCancel.actorIdentity}
          show
          sale={saleToCancel.sale}
          actorHandle={saleToCancel.actorHandle}
          allowWaste={features.hasWaste}
          isSubmitting={isSaleLoading}
          onClose={() => !isSaleLoading && setSaleToCancel(null)}
          onConfirm={handleConfirmCancellation}
        />
      )}
    </>
  );
}
