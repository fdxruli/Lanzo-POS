import {
  Activity,
  AlertTriangle,
  DollarSign,
  ShoppingBag,
  Ticket,
  TrendingUp
} from 'lucide-react';
import './StatsGrid.css';
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
  return 'Sin dato';
};

const readRangeLabel = (reportData) => {
  const range = reportData?.dateRange || reportData?.date_range || reportData?.raw?.date_range || {};
  const start = readText(range, ['start', 'from', 'dateFrom', 'date_from'], '');
  const end = readText(range, ['end', 'to', 'dateTo', 'date_to'], '');
  const dateOnly = (value) => {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
  };

  if (start && end) return `Periodo Cloud: ${dateOnly(start)}–${dateOnly(end)}.`;
  if (start) return `Periodo Cloud desde ${dateOnly(start)}.`;
  if (end) return `Periodo Cloud hasta ${dateOnly(end)}.`;
  return 'Periodo Cloud predeterminado (aprox. 30 días).';
};

const readOptionalMoney = (overview, keys) => {
  const metric = readMetric(overview, keys);
  return metric.has ? formatCurrency(metric.value) : 'Sin dato';
};

export default function CloudFinalStatsGrid({
  reportData = null,
  reportSource = null,
  creditHistoryReport = null,
  scope = 'mine'
}) {
  const reportFailed = reportData?.success === false;
  const source = reportSource || reportData?.source || {};
  const cloudFinalSource = !reportFailed && isCloudFinalSource(source);
  const finalOverview = reportFailed ? {} : (reportData?.overview || reportData?.summary || reportData || {});
  const metrics = getCloudFinalDashboardMetrics(reportData, { creditHistoryReport, scope });
  const grossSales = readOptionalMoney(finalOverview, ['gross_sales_total', 'grossSalesTotal']);
  const cancelledSales = readOptionalMoney(finalOverview, ['cancelled_sales_total', 'cancelledSalesTotal']);
  const cogs = readOptionalMoney(finalOverview, ['cogs_total', 'cogsTotal']);
  const profit = readMetric(finalOverview, ['gross_profit_total', 'grossProfitTotal']);
  const grossMargin = readMetric(finalOverview, ['gross_margin_percent', 'grossMarginPercent']);
  const netSalesCount = readMetric(finalOverview, ['net_sales_count', 'netSalesCount']);
  const averageTicket = readMetric(finalOverview, ['average_ticket', 'averageTicket']);
  const profitStatus = readText(finalOverview, ['profit_status', 'profitStatus'], 'unknown');
  const stale = Boolean(source.stale || source.mode === 'cache');
  const sourceLabel = cloudFinalSource
    ? (stale ? 'Snapshot Cloud · puede estar desactualizado' : 'Cloud oficial')
    : (source.mode === 'local'
      ? 'Local · este dispositivo'
      : source.mode === 'mixed' || source.local?.includes('all')
        ? 'Respaldo local · Cloud no confirmado'
        : 'Origen no confirmado');
  const periodLabel = cloudFinalSource
    ? readRangeLabel(reportData)
    : 'Periodo Local no informado por la fuente; sin rango Cloud comparable.';
  const scopeLabel = cloudFinalSource
    ? `Alcance autorizado: usuario o dispositivo actual (${scope}).`
    : 'Alcance: datos locales de este dispositivo.';

  return (
    <div className="stats-container-wrapper">
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            <Activity size={16} /> Ventas, cobros y crédito del reporte final Cloud.
          </p>
          <small className="text-muted">
            {periodLabel} {scopeLabel}
          </small>
          <div className="card-mini-stats card-mini-stats--inline">
            <span className="mini-stat-pill">{sourceLabel}</span>
          </div>
        </div>
      </div>

      {reportFailed && (
        <div className="financial-quality-warning financial-quality-warning--compact">
          <AlertTriangle size={15} />
          <span>Cloud no confirmó este reporte. Las cifras financieras no están disponibles.</span>
        </div>
      )}

      {!reportFailed && !cloudFinalSource && (
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
            <h2 className="card-value-main">{metricDisplay(metrics.netSales, formatCurrency)}</h2>
            <div className="card-mini-stats">
              <span className="mini-stat-pill">Ventas comerciales válidas</span>
            </div>
            <small className="text-muted">Importe de ventas Cloud confirmadas, después de cancelaciones.</small>
          </div>
        </div>

        <MetricCard
          label="Cobrado"
          value={metricDisplay(metrics.collected, formatCurrency)}
          note={metrics.collected.status === 'complete'
            ? 'Pagos iniciales y abonos posteriores registrados en el periodo.'
            : 'No se puede conciliar con certeza el desglose de pagos y reversos.'}
          icon={<DollarSign size={18} className="icon-muted" />}
          warning={metrics.collected.status !== 'complete'}
        />

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
            : metrics.pendingDebt.reason === 'cloud_report_not_successful'
            ? 'No hay un reporte Cloud confirmado para consultar un saldo vigente.'
            : 'El reporte devuelve deuda de otro alcance; no se muestra como saldo de este usuario o dispositivo.'}
          icon={<AlertTriangle size={18} className="icon-muted" />}
          warning
        />

        <div className={`stat-card-modern profit-card ${profitStatus === 'incomplete' ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ganancia bruta</span>
            <h2 className="card-value-main">{profit.has ? formatCurrency(profit.value) : 'Sin dato'}</h2>
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
