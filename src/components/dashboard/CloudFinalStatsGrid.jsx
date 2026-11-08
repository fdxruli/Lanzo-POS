import {
  Activity,
  AlertTriangle,
  DollarSign,
  ShoppingBag,
  Ticket,
  TrendingUp
} from 'lucide-react';
import './StatsGrid.css';
import { CLOUD_STATS_PERIODS, cloudReportMatchesRange, describeCloudStatsRange } from '../../services/reports/dashboardPeriodRange';
import {
  getCloudFinalDashboardMetrics,
  isCloudFinalSource
} from '../../services/reports/cloudFinalDashboardMetrics';

const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const numberFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

const formatCurrency = (value) => currencyFormatter.format(value);
const formatNumber = (value) => numberFormatter.format(value);
const formatPercent = (value) => `${value.toFixed(1)}%`;

const readMetric = (obj, keys = []) => {
  for (const key of keys) {
    const raw = obj?.[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return { has: true, value };
  }
  return { has: false, value: null };
};

const readText = (obj, keys = [], fallback = '') => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return fallback;
};

const getProfitNote = (profitStatus) => {
  const status = String(profitStatus || '').toLowerCase();
  if (status === 'definitive') return 'Utilidad definitiva';
  if (status === 'estimated') return 'Utilidad estimada';
  if (status === 'incomplete') return 'Costos incompletos';
  return 'Utilidad calculada';
};

const MetricCard = ({ label, value, note, icon = <Activity size={18} className="icon-muted" />, warning = false }) => (
  <div className={`stat-card-modern small-card ${warning ? 'card-warning-state' : ''}`}>
    <div className="card-header-small">
      <span className="card-label">{label}</span>
      {icon}
    </div>
    <div className="card-value-small">{value}</div>
    {note && <small className="text-muted">{note}</small>}
  </div>
);

const metricDisplay = (metric, formatter) => {
  if (metric.status === 'complete') return formatter(metric.value);
  if (metric.status === 'incomplete') return 'Incompleto';
  return 'No disponible';
};

const readOptionalMoney = (overview, keys) => {
  const metric = readMetric(overview, keys);
  return metric.has ? formatCurrency(metric.value) : 'Sin dato';
};

export default function CloudFinalStatsGrid({
  reportData = null,
  reportSource = null,
  creditHistoryReport = null,
  scope = 'mine',
  period = 'today',
  onPeriodChange = () => {},
  requestedRange = null,
  isLoading = false
}) {
  const reportFailed = reportData?.success === false;
  const source = reportSource || reportData?.source || {};
  const cloudFinalSource = !reportFailed && isCloudFinalSource(source);
  const rangeMatches = cloudReportMatchesRange(reportData, requestedRange);
  const verifiedReport = !isLoading && !reportFailed && cloudFinalSource && rangeMatches ? reportData : null;
  const finalOverview = verifiedReport ? (verifiedReport.overview || verifiedReport.summary || verifiedReport) : {};
  const metrics = getCloudFinalDashboardMetrics(verifiedReport, { creditHistoryReport, scope });
  const grossSales = readOptionalMoney(finalOverview, ['gross_sales_total', 'grossSalesTotal']);
  const cancelledSales = readOptionalMoney(finalOverview, ['cancelled_sales_total', 'cancelledSalesTotal']);
  const cogs = readOptionalMoney(finalOverview, ['cogs_total', 'cogsTotal']);
  const profit = readMetric(finalOverview, ['gross_profit_total', 'grossProfitTotal']);
  const grossMargin = readMetric(finalOverview, ['gross_margin_percent', 'grossMarginPercent']);
  const netSalesCount = readMetric(finalOverview, ['net_sales_count', 'netSalesCount']);
  const averageTicket = readMetric(finalOverview, ['average_ticket', 'averageTicket']);
  const profitStatus = readText(finalOverview, ['profit_status', 'profitStatus'], 'unknown');
  const stale = Boolean(source.stale || source.mode === 'cache');
  const sourceLabel = isLoading ? 'Actualizando' : cloudFinalSource
    ? (stale ? 'Snapshot Cloud · puede estar desactualizado' : 'Cloud oficial')
    : (source.mode === 'local'
      ? 'Local · este dispositivo'
      : source.mode === 'mixed' || source.local?.includes('all')
        ? 'Respaldo local · Cloud no confirmado'
        : 'Origen no confirmado');
  const periodLabel = `Fechas: ${describeCloudStatsRange(requestedRange)} (zona horaria de este dispositivo).`;
  const reportedRange = reportData?.dateRange || reportData?.date_range || reportData?.raw?.date_range || {};
  const reportedFrom = reportedRange.date_from || reportedRange.start || reportedRange.from || reportedRange.dateFrom;
  const reportedTo = reportedRange.date_to || reportedRange.end || reportedRange.to || reportedRange.dateTo;
  const receivedRangeLabel = Number.isFinite(Date.parse(reportedFrom)) && Number.isFinite(Date.parse(reportedTo))
    ? describeCloudStatsRange({ dateFrom: reportedFrom, dateTo: reportedTo })
    : 'no informado';
  const scopeLabel = `Alcance consultado: ${scope === 'mine' ? 'usuario o dispositivo actual' : 'licencia autorizada'}.`;

  return (
    <div className="stats-container-wrapper">
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            <Activity size={16} /> Ventas y cobros del período seleccionado.
          </p>
          <small className="text-muted">
            {periodLabel} {scopeLabel}
          </small>
          <div className="card-mini-stats card-mini-stats--inline">
            <span className="mini-stat-pill">{sourceLabel}</span>
          </div>
        </div>
        <div className="stats-controls-stack">
          <div className="time-filter-scroll" role="group" aria-label="Período de estadísticas Cloud">
            {CLOUD_STATS_PERIODS.map(({ key, label }) => (
              <button key={key} type="button" className={`filter-pill ${period === key ? 'active' : ''}`}
                aria-pressed={period === key} onClick={() => onPeriodChange(key)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <p className="text-muted" role="status">Consultando estadísticas de {CLOUD_STATS_PERIODS.find(({ key }) => key === period)?.label || 'Cloud'}…</p>}
      {!isLoading && cloudFinalSource && !rangeMatches && (
        <div className="financial-quality-warning financial-quality-warning--compact" role="status">
          <AlertTriangle size={15} /><span>El rango recibido ({receivedRangeLabel}) no coincide con el seleccionado. No se muestran importes de otro período.</span>
        </div>
      )}

      {!isLoading && reportFailed && (
        <div className="financial-quality-warning financial-quality-warning--compact">
          <AlertTriangle size={15} />
          <span>Cloud no confirmó este reporte. Las cifras financieras no están disponibles.</span>
        </div>
      )}

      {!isLoading && !reportFailed && !cloudFinalSource && (
        <div className="financial-quality-warning financial-quality-warning--compact">
          <AlertTriangle size={15} />
          <span>Cloud no confirmó este reporte. No se muestran cifras locales como ventas o cobros Cloud.</span>
        </div>
      )}

      <div className="stats-grid-modern">
        <div className="stat-card-modern revenue-card">
          <div className="card-icon-wrapper green">
            <DollarSign size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ventas netas</span>
            <h2 className="card-value-main">{isLoading ? 'Cargando' : metricDisplay(metrics.netSales, formatCurrency)}</h2>
            <div className="card-mini-stats">
              <span className="mini-stat-pill">Ventas comerciales válidas</span>
            </div>
            <small className="text-muted">Importe de ventas Cloud confirmadas, después de cancelaciones.</small>
          </div>
        </div>

        <div className={`stat-card-modern revenue-card stats-primary-card ${metrics.collected.status === 'incomplete' ? 'card-warning-state' : ''}`}>
          <div className="card-content">
            <span className="card-label">Cobrado</span>
            <h2 className="card-value-main">{isLoading ? 'Cargando' : metricDisplay(metrics.collected, formatCurrency)}</h2>
            <small className="text-muted">Pagos iniciales y abonos registrados en este período.</small>
          </div>
        </div>

        <MetricCard
          label="Vendido a crédito"
          value={metricDisplay(metrics.creditGenerated, formatCurrency)}
          note={metrics.creditGenerated.status === 'complete'
            ? 'Porción que quedó fiada al realizar las ventas del periodo.'
            : metrics.creditGenerated.reason === 'cloud_sales_history_is_paged'
              ? 'El reporte tiene más ventas de las que caben en el historial cargado; falta el desglose completo.'
              : metrics.creditGenerated.reason === 'cloud_sales_history_not_available'
                ? 'No hay un historial Cloud confirmado completo para separar el crédito del periodo.'
              : metrics.creditGenerated.reason === 'cloud_sales_history_scope_mismatch'
                ? 'El historial Cloud disponible tiene otro alcance; no se mezclan cifras de usuarios o dispositivos.'
                : 'No se puede conciliar con certeza el crédito, el periodo y sus reversos.'}
          icon={<Ticket size={18} className="icon-muted" />}
          warning={metrics.creditGenerated.status !== 'complete'}
        />

        <MetricCard
          label="Pendiente por cobrar"
          value={metricDisplay(metrics.pendingDebt, formatCurrency)}
          note={!cloudFinalSource
            ? 'No hay un reporte Cloud oficial confirmado para este periodo y alcance.'
            : 'Saldo actual no disponible para el alcance de este usuario o dispositivo.'}
          icon={<AlertTriangle size={18} className="icon-muted" />}
        />

        <div className={`stat-card-modern profit-card ${profitStatus === 'incomplete' ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ganancia bruta</span>
            <h2 className="card-value-main">{isLoading ? 'Cargando' : profitStatus === 'incomplete' ? 'Incompleto' : profit.has ? formatCurrency(profit.value) : 'No disponible'}</h2>
            <div className="card-mini-stats">
              <span className="mini-stat-pill">Margen: <strong>{grossMargin.has ? formatPercent(grossMargin.value) : 'Sin dato'}</strong></span>
            </div>
            <small className="text-muted">{getProfitNote(profitStatus)}</small>
          </div>
        </div>

        <MetricCard
          label="Ventas"
          value={netSalesCount.has ? formatNumber(netSalesCount.value) : 'Sin dato'}
          note="Ventas cerradas Cloud"
          icon={<ShoppingBag size={18} className="icon-muted" />}
        />

        <MetricCard
          label="Ticket promedio"
          value={averageTicket.has ? formatCurrency(averageTicket.value) : 'Sin dato'}
          note="Promedio por venta neta"
          icon={<Ticket size={18} className="icon-muted" />}
        />

        <MetricCard label="Ventas brutas" value={grossSales} note="Antes de cancelaciones" />
        <MetricCard label="Canceladas" value={cancelledSales} note="No inflan ventas netas" />
        <MetricCard label="Costo de ventas" value={cogs} note="Costo de productos vendidos" />
      </div>
    </div>
  );
}
