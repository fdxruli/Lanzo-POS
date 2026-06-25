// src/components/dashboard/StatsGrid.jsx
import { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  DollarSign,
  Package,
  Activity,
  Ticket,
  Calendar,
  Globe,
  BarChart2,
  AlertTriangle,
  TrendingDown,
  RefreshCw
} from 'lucide-react';
import './StatsGrid.css';
import TopProducts from './TopProducts';
import TopCustomers from './TopCustomers';
import { AreaTrendChart, BarWeekdayChart } from './TrendChart';
import { reportingService } from '../../services/db/reporting';
import { normalizeFinancialNumber, summarizeFinancialSales } from '../../services/sales/financialPolicy';
import { useStatsStore } from '../../store/useStatsStore';
import { REPORT_SOURCE_MODES } from '../../services/reports/reportSourceBadges';

// Periodos disponibles
const TIME_PERIODS = {
  today: { label: 'Hoy', days: 1 },
  last7: { label: '7 días', days: 7 },
  last15: { label: '15 días', days: 15 },
  thisMonth: { label: 'Este mes', days: 'month' },
  all: { label: 'Total', days: Infinity }
};

const buildPeriodRanges = (timeRange) => {
  const now = new Date();
  const period = TIME_PERIODS[timeRange];

  let startDate = null;
  if (period.days === 1) {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period.days === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period.days !== Infinity) {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    startDate.setDate(startDate.getDate() - (period.days - 1));
  }

  let prevPeriodStart = null;
  let prevPeriodEnd = null;
  if (period.days === 1) {
    prevPeriodStart = new Date(startDate);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - 1);
    prevPeriodEnd = new Date(startDate.getTime() - 1);
  } else if (period.days === 'month') {
    prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevPeriodEnd = new Date(startDate.getTime() - 1);
  } else if (period.days !== Infinity) {
    const prevPeriodEndDate = new Date(startDate.getTime() - 1);
    prevPeriodStart = new Date(prevPeriodEndDate);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - (period.days - 1));
    prevPeriodEnd = prevPeriodEndDate;
  }

  return {
    current: startDate ? { start: startDate, end: now } : null,
    previous: prevPeriodStart ? { start: prevPeriodStart, end: prevPeriodEnd } : null
  };
};

const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const numberFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

const formatCurrency = (val) => currencyFormatter.format(Number(val || 0));

const formatCompactCurrency = (val) => {
  const value = Number(val || 0);
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
};

const formatNumber = (val) => numberFormatter.format(Number(val || 0));

const formatPercent = (val) => `${Number(val || 0).toFixed(1)}%`;

const METRIC_OPTIONS = {
  revenue: {
    label: 'Ventas',
    color: 'var(--success-color, #10b981)',
    formatter: formatCompactCurrency,
    fullFormatter: formatCurrency
  },
  profit: {
    label: 'Utilidad',
    color: 'var(--primary-color, #6366f1)',
    formatter: formatCompactCurrency,
    fullFormatter: formatCurrency
  },
  orders: {
    label: 'Pedidos',
    color: 'var(--secondary-color, #7c3aed)',
    formatter: formatNumber,
    fullFormatter: formatNumber
  },
  avgTicket: {
    label: 'Ticket',
    color: '#0ea5e9',
    formatter: formatCompactCurrency,
    fullFormatter: formatCurrency
  },
  margin: {
    label: 'Margen',
    color: '#f59e0b',
    formatter: formatPercent,
    fullFormatter: formatPercent
  },
  waste: {
    label: 'Merma',
    color: 'var(--error-color, #dc2626)',
    formatter: formatCompactCurrency,
    fullFormatter: formatCurrency
  }
};

const CLOUD_METRIC_KEYS = {
  customersTotal: [
    'customersTotal', 'customers_total', 'totalCustomers', 'total_customers',
    'customerCount', 'customer_count', 'customersCount', 'customers_count'
  ],
  customersWithDebt: [
    'customersWithDebt', 'customers_with_debt', 'debtorsCount', 'debtors_count',
    'customersDebtCount', 'customers_debt_count', 'customers_with_balance', 'customersWithBalance'
  ],
  debtTotal: [
    'debtTotal', 'debt_total', 'totalDebt', 'total_debt',
    'outstandingDebtTotal', 'outstanding_debt_total', 'customerDebtTotal', 'customer_debt_total'
  ],
  customerPaymentsTotal: [
    'customerPaymentsTotal', 'customer_payments_total', 'paymentsTotal', 'payments_total',
    'abonosTotal', 'abonos_total', 'creditPaymentsTotal', 'credit_payments_total',
    'customer_payment_total', 'customerPaymentTotal'
  ],
  cashSessionsOpen: [
    'cashSessionsOpen', 'cash_sessions_open', 'openCashSessions', 'open_cash_sessions',
    'openSessions', 'open_sessions', 'cashOpenSessions', 'cash_open_sessions', 'sessionsOpen', 'sessions_open'
  ],
  cashSessionsClosed: [
    'cashSessionsClosed', 'cash_sessions_closed', 'closedCashSessions', 'closed_cash_sessions',
    'closedSessions', 'closed_sessions', 'cashClosedSessions', 'cash_closed_sessions', 'sessionsClosed', 'sessions_closed'
  ],
  cashEntriesTotal: [
    'cashEntriesTotal', 'cash_entries_total', 'entriesTotal', 'entries_total',
    'cashInTotal', 'cash_in_total', 'incomeTotal', 'income_total', 'entradaTotal', 'entrada_total'
  ],
  cashExitsTotal: [
    'cashExitsTotal', 'cash_exits_total', 'exitsTotal', 'exits_total',
    'cashOutTotal', 'cash_out_total', 'expenseTotal', 'expense_total', 'salidaTotal', 'salida_total'
  ],
  cashPaymentsTotal: [
    'cashPaymentsTotal', 'cash_payments_total', 'cashCustomerPaymentsTotal', 'cash_customer_payments_total',
    'customerPaymentsCashTotal', 'customer_payments_cash_total', 'abonosCashTotal', 'abonos_cash_total'
  ],
  cashDifferenceTotal: [
    'cashDifferenceTotal', 'cash_difference_total', 'differenceTotal', 'difference_total',
    'closingDifferenceTotal', 'closing_difference_total', 'cashClosingDifferenceTotal', 'cash_closing_difference_total'
  ],
  productsActive: [
    'productsActive', 'products_active', 'activeProducts', 'active_products',
    'activeProductCount', 'active_product_count'
  ],
  productsOutOfStock: [
    'productsOutOfStock', 'products_out_of_stock', 'productsWithoutStock', 'products_without_stock',
    'outOfStock', 'out_of_stock', 'outOfStockProducts', 'out_of_stock_products'
  ],
  productsLowStock: [
    'productsLowStock', 'products_low_stock', 'lowStockProducts', 'low_stock_products',
    'productsWithLowStock', 'products_with_low_stock'
  ],
  inventoryValueApprox: [
    'inventoryValueApprox', 'inventory_value_approx', 'inventoryValue', 'inventory_value',
    'stockValueApprox', 'stock_value_approx', 'inventoryTotalValue', 'inventory_total_value'
  ]
};

const SOURCE_LABELS = {
  [REPORT_SOURCE_MODES.CLOUD]: 'Cloud oficial',
  [REPORT_SOURCE_MODES.MIXED]: 'Mixto',
  [REPORT_SOURCE_MODES.CACHE]: 'Último snapshot',
  [REPORT_SOURCE_MODES.LOCAL]: 'Local'
};

const getDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const getDateLabel = (dateKey) => {
  const parts = String(dateKey || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : 'Fecha invalida';
};

const summarizeWaste = (wasteLogs = []) => (
  wasteLogs.reduce((sum, log) => sum + normalizeFinancialNumber(log.lossAmount || log.amount || log.cost || 0), 0)
);

const createEmptyDayMetric = () => ({
  revenue: 0,
  profit: 0,
  confirmedRevenue: 0,
  orders: 0,
  waste: 0
});

const getMetricValue = (summary, metricKey) => {
  switch (metricKey) {
    case 'profit':
      return summary.profitConfirmed;
    case 'orders':
      return summary.orders;
    case 'avgTicket':
      return summary.avgTicket;
    case 'margin':
      return summary.marginPercent;
    case 'waste':
      return summary.totalWaste;
    case 'revenue':
    default:
      return summary.revenue;
  }
};

const getTrendPercent = (current, previous) => {
  if (previous > 0) return ((current - previous) / previous) * 100;
  if (current > 0) return 100;
  return 0;
};

const readPath = (obj, path) => {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((current, key) => (
    current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined
  ), obj);
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const uniqueObjects = (items = []) => Array.from(new Set(items.filter(Boolean)));

const getMetricFromRoots = (roots = [], keys = []) => {
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;

    for (const key of keys) {
      const rawValue = key.includes('.') ? readPath(root, key) : root[key];
      const value = toNumberOrNull(rawValue);
      if (value !== null) return { value, has: true };
    }
  }

  return { value: null, has: false };
};

const normalizeStatsGridReportData = ({ reportData, reportSource, isCloudReport, isMixedReport, isStale }) => {
  const source = reportSource || reportData?.source || reportData?.raw?.source || {};
  const mode = source.mode || (isCloudReport ? REPORT_SOURCE_MODES.CLOUD : (isMixedReport ? REPORT_SOURCE_MODES.MIXED : REPORT_SOURCE_MODES.LOCAL));
  const stale = Boolean(isStale || source.stale || mode === REPORT_SOURCE_MODES.CACHE);
  const isProReport = Boolean(
    isCloudReport ||
    isMixedReport ||
    stale ||
    mode === REPORT_SOURCE_MODES.CLOUD ||
    mode === REPORT_SOURCE_MODES.MIXED ||
    mode === REPORT_SOURCE_MODES.CACHE
  );

  const roots = uniqueObjects([
    reportData?.overview,
    reportData?.summary,
    reportData?.raw?.overview,
    reportData?.raw?.summary,
    reportData?.cash,
    reportData?.cash?.summary,
    reportData?.raw?.cash,
    reportData?.raw?.cash?.summary,
    reportData?.customerCredit,
    reportData?.customerCredit?.summary,
    reportData?.raw?.customer_credit,
    reportData?.raw?.customer_credit?.summary,
    reportData?.raw?.customerCredit,
    reportData?.raw?.customerCredit?.summary,
    reportData?.products,
    reportData?.products?.summary,
    reportData?.raw?.products,
    reportData?.raw?.products?.summary,
    reportData
  ]);

  const metrics = Object.fromEntries(
    Object.entries(CLOUD_METRIC_KEYS).map(([metricKey, aliases]) => [
      metricKey,
      getMetricFromRoots(roots, aliases)
    ])
  );

  const cloudMetricBadges = stale
    ? [
      { label: 'Último snapshot', variant: 'cache' },
      { label: 'Desactualizado', variant: 'stale' }
    ]
    : [{ label: 'Cloud oficial', variant: 'cloud' }];

  const localMetricBadges = isProReport
    ? [{ label: 'Local / este dispositivo', variant: 'local' }]
    : [];

  const salesBadges = isProReport
    ? [{ label: 'Ventas locales', variant: 'local' }]
    : [];

  const summaryBadges = isProReport
    ? [
      { label: SOURCE_LABELS[mode] || 'Mixto', variant: mode || 'mixed' },
      ...(stale ? [{ label: 'Desactualizado', variant: 'stale' }] : [])
    ]
    : [];

  return {
    mode,
    stale,
    isProReport,
    sourceLabel: SOURCE_LABELS[mode] || SOURCE_LABELS[REPORT_SOURCE_MODES.LOCAL],
    metrics,
    cloudMetricBadges,
    localMetricBadges,
    salesBadges,
    summaryBadges,
    hasReportData: Boolean(reportData),
    shouldShowCloudCards: Boolean(isProReport && reportData)
  };
};

const buildDailyMetricData = ({ sales = [], wasteLogs = [], period, now, metricKey }) => {
  const dayMap = new Map();

  const periodStart = period.days === 'month'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : (period.days === Infinity
      ? null
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period.days - 1)));

  if (periodStart !== null) {
    const currentDate = new Date(periodStart);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period.days === 1) {
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      dayMap.set(getDateKey(yesterday), createEmptyDayMetric());
    }

    while (currentDate <= today) {
      dayMap.set(getDateKey(currentDate), createEmptyDayMetric());
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  sales.forEach((sale) => {
    const dateKey = getDateKey(sale.timestamp);
    if (!dateKey) return;
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, createEmptyDayMetric());

    const dayMetric = dayMap.get(dateKey);
    const financialSummary = summarizeFinancialSales([sale]);
    dayMetric.revenue += financialSummary.totalRevenue;
    dayMetric.profit += financialSummary.confirmedProfit;
    dayMetric.confirmedRevenue += financialSummary.confirmedRevenue;
    dayMetric.orders += 1;
  });

  wasteLogs.forEach((log) => {
    const dateKey = getDateKey(log.timestamp || log.date || log.createdAt);
    if (!dateKey) return;
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, createEmptyDayMetric());
    dayMap.get(dateKey).waste += summarizeWaste([log]);
  });

  return Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, value]) => {
      let metricValue = value.revenue;
      if (metricKey === 'profit') metricValue = value.profit;
      if (metricKey === 'orders') metricValue = value.orders;
      if (metricKey === 'avgTicket') metricValue = value.orders > 0 ? value.revenue / value.orders : 0;
      if (metricKey === 'margin') metricValue = value.confirmedRevenue > 0 ? (value.profit / value.confirmedRevenue) * 100 : 0;
      if (metricKey === 'waste') metricValue = value.waste;

      return {
        name: getDateLabel(dateKey),
        value: metricValue
      };
    });
};

export default function StatsGrid({
  stats = {},
  customers = [],
  reportRefreshKey = 0,
  activeRubros = [],
  reportData = null,
  reportSource = null,
  isCloudReport = false,
  isMixedReport = false,
  isStale = false
}) {
  const [timeRange, setTimeRange] = useState('today');
  const [selectedMetric, setSelectedMetric] = useState('revenue');
  const [filteredSales, setFilteredSales] = useState([]);
  const [prevPeriodSales, setPrevPeriodSales] = useState([]);
  const [filteredWasteLogs, setFilteredWasteLogs] = useState([]);
  const [prevPeriodWasteLogs, setPrevPeriodWasteLogs] = useState([]);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const forceRecalculate = useStatsStore((state) => state.forceRecalculate);

  const reportContext = useMemo(() => normalizeStatsGridReportData({
    reportData,
    reportSource,
    isCloudReport,
    isMixedReport,
    isStale
  }), [reportData, reportSource, isCloudReport, isMixedReport, isStale]);

  const renderSourceBadges = (badges = []) => {
    if (!badges.length) return null;

    return (
      <div className="card-mini-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {badges.map((badge) => (
          <span key={`${badge.variant}-${badge.label}`} className="mini-stat-pill" title={badge.title || badge.label}>
            {badge.label}
          </span>
        ))}
      </div>
    );
  };

  const renderCloudMetricCard = ({ key, label, metric, formatter = formatNumber, note, badges = reportContext.cloudMetricBadges }) => (
    <div key={key} className="stat-card-modern small-card">
      <div className="card-header-small">
        <span className="card-label">{label}</span>
        <Activity size={18} className="icon-muted" />
      </div>
      <div className="card-value-small">{metric?.has ? formatter(metric.value) : 'Sin dato'}</div>
      <small className="text-muted">{note}</small>
      {renderSourceBadges(badges)}
    </div>
  );

  const handleRecalculateReports = async () => {
    setIsRecalculating(true);
    try {
      await forceRecalculate();
      setLocalRefreshKey(Date.now());
    } catch (error) {
      console.error('Error recalculando reportes', error);
    } finally {
      setIsRecalculating(false);
    }
  };

  useEffect(() => {
    async function loadPeriodSales() {
      try {
        const ranges = buildPeriodRanges(timeRange);
        const [currentReport, previousReport] = await Promise.all([
          reportingService.getDashboardReport({
            rangoFechas: ranges.current,
            rubros: activeRubros,
            incluirCanceladas: false,
            incluirMermas: true,
            incluirProductos: false
          }),
          ranges.previous
            ? reportingService.getDashboardReport({
              rangoFechas: ranges.previous,
              rubros: activeRubros,
              incluirCanceladas: false,
              incluirMermas: true,
              incluirProductos: false
            })
            : Promise.resolve({ sales: [], wasteLogs: [] })
        ]);

        setFilteredSales(currentReport.sales || []);
        setPrevPeriodSales(previousReport.sales || []);
        setFilteredWasteLogs(currentReport.wasteLogs || []);
        setPrevPeriodWasteLogs(previousReport.wasteLogs || []);

      } catch (err) {
        console.error('Error loading period sales', err);
      }
    }
    loadPeriodSales();
  }, [activeRubros, localRefreshKey, reportRefreshKey, timeRange]);

  // Calcular métricas para el periodo seleccionado
  const metrics = useMemo(() => {
    const now = new Date();
    const period = TIME_PERIODS[timeRange];
    const financialSummary = summarizeFinancialSales(filteredSales);
    const revenue = financialSummary.totalRevenue;
    const unreliableProfit = financialSummary.unreliableProfitDueToMissingCosts;
    const profitConfirmed = financialSummary.confirmedProfit;
    const confirmedRevenue = financialSummary.confirmedRevenue;
    const unconfirmedRevenue = financialSummary.unconfirmedRevenue;
    const orders = filteredSales.length;
    const items = financialSummary.itemsSold;
    const hasMissingCosts = financialSummary.hasMissingCosts;
    const totalWaste = summarizeWaste(filteredWasteLogs);
    const totalProfit = profitConfirmed;
    const avgTicket = orders > 0 ? revenue / orders : 0;
    const marginPercent = financialSummary.confirmedMarginPct;
    const selectedMetricConfig = METRIC_OPTIONS[selectedMetric];
    const currentSummary = {
      revenue,
      profitConfirmed,
      orders,
      avgTicket,
      marginPercent,
      totalWaste
    };
    const prevFinancialSummary = summarizeFinancialSales(prevPeriodSales);
    const prevRevenue = prevFinancialSummary.totalRevenue;
    const prevOrders = prevPeriodSales.length;
    const prevSummary = {
      revenue: prevRevenue,
      profitConfirmed: prevFinancialSummary.confirmedProfit,
      orders: prevOrders,
      avgTicket: prevOrders > 0 ? prevRevenue / prevOrders : 0,
      marginPercent: prevFinancialSummary.confirmedMarginPct,
      totalWaste: summarizeWaste(prevPeriodWasteLogs)
    };
    const selectedMetricValue = getMetricValue(currentSummary, selectedMetric);
    const previousMetricValue = getMetricValue(prevSummary, selectedMetric);
    const metricTrend = period.days === Infinity
      ? null
      : getTrendPercent(selectedMetricValue, previousMetricValue);
    const revenueTrend = period.days === Infinity
      ? null
      : getTrendPercent(revenue, prevRevenue);
    const metricDailyData = buildDailyMetricData({
      sales: filteredSales,
      wasteLogs: filteredWasteLogs,
      period,
      now,
      metricKey: selectedMetric
    });

    const cloudInventoryMetric = reportContext.metrics.inventoryValueApprox;
    const useCloudInventory = Boolean(reportContext.isProReport && cloudInventoryMetric?.has);
    const localInventoryValue = stats?.inventoryValue ?? 0;

    return {
      revenue,
      profitConfirmed,
      unreliableProfit,
      totalProfit,
      orders,
      items,
      avgTicket,
      marginPercent,
      totalWaste,
      coveragePercent: financialSummary.reportReliabilityPct,
      missingCostRevenuePct: financialSummary.missingCostRevenuePct,
      qualityStatus: financialSummary.qualityStatus,
      shouldWarnFinancialQuality: financialSummary.shouldWarn,
      shouldBlockProfitAnalysis: financialSummary.shouldBlockProfitAnalysis,
      inventory: useCloudInventory ? cloudInventoryMetric.value : localInventoryValue,
      inventorySource: useCloudInventory ? 'cloud' : 'local',
      inventoryBadges: useCloudInventory ? reportContext.cloudMetricBadges : reportContext.localMetricBadges,
      hasMissingCosts,
      revenueTrend,
      metricTrend,
      selectedMetricValue,
      selectedMetricLabel: selectedMetricConfig.label,
      selectedMetricColor: selectedMetricConfig.color,
      selectedMetricFormatter: selectedMetricConfig.formatter,
      selectedMetricFullFormatter: selectedMetricConfig.fullFormatter,
      dailyRevenue: metricDailyData,
      evolutionData: metricDailyData,
      confirmedRevenue,
      unconfirmedRevenue,
      filteredSales
    };
  }, [filteredSales, filteredWasteLogs, prevPeriodSales, prevPeriodWasteLogs, selectedMetric, stats, timeRange, reportContext]);

  const cloudMetrics = reportContext.metrics;
  const cashSessionsMetric = {
    has: Boolean(cloudMetrics.cashSessionsOpen?.has || cloudMetrics.cashSessionsClosed?.has),
    value: `${formatNumber(cloudMetrics.cashSessionsOpen?.value || 0)} / ${formatNumber(cloudMetrics.cashSessionsClosed?.value || 0)}`
  };
  const cashFlowMetric = {
    has: Boolean(cloudMetrics.cashEntriesTotal?.has || cloudMetrics.cashExitsTotal?.has),
    value: `${formatCompactCurrency(cloudMetrics.cashEntriesTotal?.value || 0)} / ${formatCompactCurrency(cloudMetrics.cashExitsTotal?.value || 0)}`
  };
  const stockAlertMetric = {
    has: Boolean(cloudMetrics.productsOutOfStock?.has || cloudMetrics.productsLowStock?.has),
    value: `${formatNumber(cloudMetrics.productsOutOfStock?.value || 0)} / ${formatNumber(cloudMetrics.productsLowStock?.value || 0)}`
  };

  return (
    <div className="stats-container-wrapper">
      {/* Header con controles */}
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            <BarChart2 size={16} />
            {TIME_PERIODS[timeRange].label === 'Hoy'
              ? ' Mostrando solo las ventas de HOY.'
              : ` Mostrando últimos ${TIME_PERIODS[timeRange].label}.`}
          </p>
          {renderSourceBadges(reportContext.summaryBadges)}
        </div>

        <div className="stats-controls-stack">
          {/* Selector de periodo - Mobile first: scroll horizontal */}
          <div className="time-filter-scroll">
            {Object.entries(TIME_PERIODS).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                className={`filter-pill ${timeRange === key ? 'active' : ''}`}
                onClick={() => setTimeRange(key)}
                title={`Ver últimos ${label}`}
              >
                {label === 'Hoy' && <Calendar size={14} />}
                {label === 'Total' && <Globe size={14} />}
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="recalc-report-button"
            onClick={handleRecalculateReports}
            disabled={isRecalculating}
          >
            <RefreshCw size={15} className={isRecalculating ? 'spin-icon' : ''} />
            {isRecalculating ? 'Recalculando...' : 'Recalcular reportes'}
          </button>
        </div>
      </div>

      {/* Gráfica de evolución temporal */}
      {metrics.evolutionData.length > 0 && (
        <div className="stats-evolution-card">
          <div className="evolution-header">
            <div className="evolution-title">
              <Activity size={18} />
              <span>{`Tendencia de ${metrics.selectedMetricLabel}`}</span>
              <strong className="evolution-metric-value">
                {metrics.selectedMetricFullFormatter(metrics.selectedMetricValue)}
              </strong>
            </div>
            {metrics.metricTrend !== null && (
              <div className={`evolution-trend ${metrics.metricTrend >= 0 ? 'positive' : 'negative'}`}>
                {metrics.metricTrend >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                <span>{`${metrics.metricTrend >= 0 ? '+' : ''}${metrics.metricTrend.toFixed(1)}%`}</span>
              </div>
            )}
          </div>
          <div className="chart-metric-controls">
            <span className="chart-metric-label">Métrica de gráfica</span>
            <div className="metric-filter-scroll" aria-label="Metrica de grafica">
              {Object.entries(METRIC_OPTIONS).map(([key, { label }]) => (
                <button
                  key={key}
                  type="button"
                  className={`metric-pill ${selectedMetric === key ? 'active' : ''}`}
                  onClick={() => setSelectedMetric(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <AreaTrendChart
            data={metrics.evolutionData}
            height={200}
            color={metrics.selectedMetricColor}
            valueFormatter={metrics.selectedMetricFormatter}
          />
          {renderSourceBadges(reportContext.salesBadges)}
        </div>
      )}

      {/* Grid de métricas principales */}
      <div className="stats-grid-modern">
        {/* TARJETA 1: INGRESOS */}
        <div className="stat-card-modern revenue-card">
          <div className="card-icon-wrapper green">
            <DollarSign size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ventas</span>
            <h2 className="card-value-main">{formatCurrency(metrics.revenue || 0)}</h2>
            {metrics.revenueTrend !== null && (
              <div className={`card-trend ${metrics.revenueTrend >= 0 ? 'positive' : 'negative'}`}>
                {metrics.revenueTrend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <span>{`${metrics.revenueTrend >= 0 ? '+' : ''}${metrics.revenueTrend.toFixed(1)}% vs periodo anterior`}</span>
              </div>
            )}
            {renderSourceBadges(reportContext.salesBadges)}
          </div>
        </div>

        {/* TARJETA 2: UTILIDAD */}
        <div className={`stat-card-modern profit-card ${metrics.shouldWarnFinancialQuality ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Utilidad Confirmada</span>
            <h2 className="card-value-main">{formatCurrency(metrics.profitConfirmed || 0)}</h2>

            {metrics.shouldWarnFinancialQuality ? (
              <div className="financial-quality-warning">
                <AlertTriangle size={14} />
                <span>
                  {metrics.shouldBlockProfitAnalysis
                    ? 'Utilidad no definitiva: demasiadas ventas sin costo.'
                    : 'Utilidad con advertencia por costos faltantes.'}
                </span>
              </div>
            ) : (
              <div className="card-mini-stats">
                <span className="mini-stat-pill">
                  {`Margen: `}<strong>{`${metrics.marginPercent.toFixed(1)}%`}</strong>
                </span>
              </div>
            )}
            <small className="financial-quality-text">
              {`Calidad del reporte financiero: ${metrics.coveragePercent.toFixed(1)}% confiable`}
            </small>
            {renderSourceBadges(reportContext.salesBadges)}
          </div>
        </div>

        {/* TARJETA 3: UTILIDAD NO CONFIABLE */}
        <div className={`stat-card-modern small-card ${metrics.hasMissingCosts ? 'card-warning-state' : ''}`}>
          <div className="card-header-small">
            <span className="card-label">Utilidad no confiable</span>
            <AlertTriangle size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{formatCurrency(metrics.unreliableProfit || 0)}</div>
          <small className="text-muted">
            {`${metrics.missingCostRevenuePct.toFixed(1)}% de ventas sin costo`}
          </small>
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* TARJETA 4: CONFIABILIDAD */}
        <div className={`stat-card-modern small-card ${metrics.shouldWarnFinancialQuality ? 'card-warning-state' : ''}`}>
          <div className="card-header-small">
            <span className="card-label">Confiabilidad financiera</span>
            <Activity size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{`${metrics.coveragePercent.toFixed(1)}%`}</div>
          <div className="reliability-meter" aria-hidden="true">
            <div
              className={`reliability-meter-fill ${metrics.qualityStatus}`}
              style={{ width: `${Math.max(0, Math.min(100, metrics.coveragePercent))}%` }}
            />
          </div>
          <small className="text-muted">
            {metrics.hasMissingCosts
              ? `${formatCurrency(metrics.unconfirmedRevenue)} sin costo`
              : 'Costos completos en el periodo'}
          </small>
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* TARJETA 5: PEDIDOS */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Pedidos</span>
            <ShoppingBag size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{metrics.orders || 0}</div>
          <small className="text-muted">Tickets cobrados</small>
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* TARJETA 6: TICKET PROMEDIO */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Ticket Promedio</span>
            <Ticket size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{formatCurrency(metrics.avgTicket)}</div>
          <small className="text-muted">Gasto por cliente</small>
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* TARJETA 7: PRODUCTOS VENDIDOS */}
        <div className="stat-card-modern small-card">
          <div className="card-header-small">
            <span className="card-label">Prod. Vendidos</span>
            <Package size={18} className="icon-muted" />
          </div>
          <div className="card-value-small">{metrics.items || 0}</div>
          <small className="text-muted">Unidades entregadas</small>
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* TARJETA 8: INVENTARIO */}
        <div className={`stat-card-modern inventory-card ${metrics.inventory === null ? 'card-error-state' : ''}`}>
          <div className="inventory-content">
            <div className="inventory-text-group">
              <span className="card-label">Dinero en Mercancía</span>
              {metrics.inventory === null ? (
                <div className="inventory-error-group">
                  <h3 className="inventory-value error-text">No disponible</h3>
                  <span className="error-message-inline small">
                    <AlertTriangle size={14} /> Error de cálculo
                  </span>
                </div>
              ) : (
                <h3 className="inventory-value">{formatCurrency(metrics.inventory)}</h3>
              )}
            </div>
            <div className="inventory-icon">
              <Package size={32} strokeWidth={1.5} className={metrics.inventory === null ? 'icon-error' : 'icon-primary'} />
            </div>
          </div>
          {metrics.inventory !== null && (
            <div className="inventory-bar-container">
              <div className="inventory-bar" style={{ width: '100%' }}></div>
            </div>
          )}
          <small className={`inventory-footer-text ${metrics.inventory === null ? 'error-text-light' : 'text-muted'}`}>
            {metrics.inventory === null
              ? 'Cálculo abortado para prevenir daños.'
              : metrics.inventorySource === 'cloud'
                ? 'Valor aproximado de stock cloud'
                : 'Valor actual de tu stock'}
          </small>
          {renderSourceBadges(metrics.inventoryBadges)}
        </div>

        {reportContext.shouldShowCloudCards && (
          <>
            {renderCloudMetricCard({
              key: 'customers-total',
              label: 'Clientes totales',
              metric: cloudMetrics.customersTotal,
              note: 'Directorio de clientes'
            })}
            {renderCloudMetricCard({
              key: 'customers-debt',
              label: 'Clientes con deuda',
              metric: cloudMetrics.customersWithDebt,
              note: 'Crédito / abonos'
            })}
            {renderCloudMetricCard({
              key: 'debt-total',
              label: 'Deuda total',
              metric: cloudMetrics.debtTotal,
              formatter: formatCurrency,
              note: 'Saldo pendiente oficial'
            })}
            {renderCloudMetricCard({
              key: 'payments-total',
              label: 'Abonos periodo',
              metric: cloudMetrics.customerPaymentsTotal,
              formatter: formatCurrency,
              note: 'Pagos registrados'
            })}
            {renderCloudMetricCard({
              key: 'cash-sessions',
              label: 'Cajas',
              metric: cashSessionsMetric,
              formatter: (value) => value,
              note: 'Abiertas / cerradas'
            })}
            {renderCloudMetricCard({
              key: 'cash-flow',
              label: 'Caja entradas/salidas',
              metric: cashFlowMetric,
              formatter: (value) => value,
              note: 'Entradas / salidas'
            })}
            {renderCloudMetricCard({
              key: 'cash-payments',
              label: 'Abonos en caja',
              metric: cloudMetrics.cashPaymentsTotal,
              formatter: formatCurrency,
              note: 'Abonos reflejados en caja'
            })}
            {renderCloudMetricCard({
              key: 'cash-difference',
              label: 'Diferencias cierre',
              metric: cloudMetrics.cashDifferenceTotal,
              formatter: formatCurrency,
              note: 'Diferencia acumulada'
            })}
            {renderCloudMetricCard({
              key: 'products-active',
              label: 'Productos activos',
              metric: cloudMetrics.productsActive,
              note: 'Catálogo cloud'
            })}
            {renderCloudMetricCard({
              key: 'stock-alerts',
              label: 'Alertas de stock',
              metric: stockAlertMetric,
              formatter: (value) => value,
              note: 'Sin stock / stock bajo'
            })}
          </>
        )}
      </div>

      {/* Sección de gráficas y datos adicionales */}
      <div className="stats-insights-section" style={{ alignItems: 'flex-start' }}>
        {/* Gráfica por fecha real */}
        {metrics.dailyRevenue.length > 0 && (
          <div className="stats-insight-card" style={{ width: '100%' }}>
            <div className="insight-header">
              <Calendar size={18} />
              <h4>{`${metrics.selectedMetricLabel} por fecha`}</h4>
            </div>
            <div style={{ marginTop: '10px' }}>
              <BarWeekdayChart
                data={metrics.dailyRevenue}
                height={260}
                valueFormatter={metrics.selectedMetricFormatter}
              />
            </div>
            {renderSourceBadges(reportContext.salesBadges)}
          </div>
        )}

        {/* Productos más vendidos — filteredSales respeta el periodo y excluye abiertas/canceladas */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopProducts sales={metrics.filteredSales} limit={5} />
          {renderSourceBadges(reportContext.salesBadges)}
        </div>

        {/* Clientes frecuentes — filteredSales respeta el periodo y excluye abiertas/canceladas */}
        <div className="stats-insight-card" style={{ width: '100%' }}>
          <TopCustomers sales={metrics.filteredSales} customers={customers} limit={5} />
          {renderSourceBadges(reportContext.salesBadges)}
        </div>
      </div>
    </div>
  );
}
