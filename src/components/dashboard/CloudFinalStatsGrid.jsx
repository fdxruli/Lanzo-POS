import {
  Activity,
  AlertTriangle,
  DollarSign,
  ShoppingBag,
  Ticket,
  TrendingUp
} from 'lucide-react';
import './StatsGrid.css';
import { REPORT_SOURCE_MODES } from '../../services/reports/reportSourceBadges';

const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const numberFormatter = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

const formatCurrency = (value) => currencyFormatter.format(Number(value || 0));
const formatNumber = (value) => numberFormatter.format(Number(value || 0));
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

const readMetric = (obj, keys = [], fallback = 0) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return Number(value) || 0;
  }
  return fallback;
};

const readText = (obj, keys = [], fallback = '') => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return fallback;
};

const buildFinalBadges = (source = {}) => {
  if (source.mode === REPORT_SOURCE_MODES.CACHE || source.stale) {
    return [
      { label: 'Último snapshot cloud final', variant: 'cache' },
      { label: 'Desactualizado', variant: 'stale' }
    ];
  }

  return [{ label: 'Cloud oficial final', variant: 'cloud_final' }];
};

const getProfitNote = (profitStatus) => {
  const status = String(profitStatus || '').toLowerCase();
  if (status === 'definitive') return 'Utilidad definitiva';
  if (status === 'estimated') return 'Utilidad estimada';
  if (status === 'incomplete') return 'Costos incompletos';
  return 'Utilidad cloud final';
};

const MetricCard = ({ label, value, formatter = formatCurrency, note, icon = <Activity size={18} className="icon-muted" />, badges = [] }) => (
  <div className="stat-card-modern small-card">
    <div className="card-header-small">
      <span className="card-label">{label}</span>
      {icon}
    </div>
    <div className="card-value-small">{formatter(value)}</div>
    {note && <small className="text-muted">{note}</small>}
    {badges.length > 0 && (
      <div className="card-mini-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {badges.map((badge) => (
          <span key={`${badge.variant}-${badge.label}`} className="mini-stat-pill">
            {badge.label}
          </span>
        ))}
      </div>
    )}
  </div>
);

export default function CloudFinalStatsGrid({ reportData = null, reportSource = null }) {
  const finalOverview = reportData?.overview || reportData?.summary || reportData || {};
  const source = reportSource || reportData?.source || {};
  const badges = buildFinalBadges(source);

  const netSalesTotal = readMetric(finalOverview, ['net_sales_total', 'netSalesTotal']);
  const grossSalesTotal = readMetric(finalOverview, ['gross_sales_total', 'grossSalesTotal']);
  const cancelledSalesTotal = readMetric(finalOverview, ['cancelled_sales_total', 'cancelledSalesTotal']);
  const cogsTotal = readMetric(finalOverview, ['cogs_total', 'cogsTotal']);
  const grossProfitTotal = readMetric(finalOverview, ['gross_profit_total', 'grossProfitTotal']);
  const grossMarginPercent = readMetric(finalOverview, ['gross_margin_percent', 'grossMarginPercent']);
  const netSalesCount = readMetric(finalOverview, ['net_sales_count', 'netSalesCount']);
  const averageTicket = readMetric(finalOverview, ['average_ticket', 'averageTicket']);
  const profitStatus = readText(finalOverview, ['profit_status', 'profitStatus'], 'unknown');

  const requiredMetrics = [
    ['net_sales_total', netSalesTotal],
    ['gross_sales_total', grossSalesTotal],
    ['cancelled_sales_total', cancelledSalesTotal],
    ['cogs_total', cogsTotal],
    ['gross_profit_total', grossProfitTotal],
    ['gross_margin_percent', grossMarginPercent],
    ['net_sales_count', netSalesCount],
    ['average_ticket', averageTicket]
  ];
  const missingRequiredMetrics = requiredMetrics
    .filter(([key]) => finalOverview?.[key] === undefined && finalOverview?.[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] === undefined)
    .map(([key]) => key);

  return (
    <div className="stats-container-wrapper">
      <div className="stats-header-controls">
        <div className="stats-header-title">
          <h3>Resumen de Negocio</h3>
          <p className="stats-subtitle">
            <Activity size={16} /> Reporte oficial final desde ventas cloud. No mezcla ventas locales/Dexie.
          </p>
          <div className="card-mini-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {badges.map((badge) => (
              <span key={`${badge.variant}-${badge.label}`} className="mini-stat-pill">
                {badge.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {missingRequiredMetrics.length > 0 && (
        <div className="financial-quality-warning" style={{ marginBottom: '0.75rem' }}>
          <AlertTriangle size={15} />
          <span>
            Faltan métricas cloud finales ({missingRequiredMetrics.slice(0, 4).join(', ')}). Se muestran en 0 para no romper la UI.
          </span>
        </div>
      )}

      <div className="stats-grid-modern">
        <div className="stat-card-modern revenue-card">
          <div className="card-icon-wrapper green">
            <DollarSign size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Ventas netas</span>
            <h2 className="card-value-main">{formatCurrency(netSalesTotal)}</h2>
            <div className="card-mini-stats">
              <span className="mini-stat-pill">Excluye canceladas</span>
            </div>
            <small className="text-muted">Fuente oficial Supabase</small>
          </div>
        </div>

        <div className={`stat-card-modern profit-card ${profitStatus === 'incomplete' ? 'card-warning-state' : ''}`}>
          <div className="card-icon-wrapper purple">
            <TrendingUp size={24} />
          </div>
          <div className="card-content">
            <span className="card-label">Utilidad</span>
            <h2 className="card-value-main">{formatCurrency(grossProfitTotal)}</h2>
            <div className="card-mini-stats">
              <span className="mini-stat-pill">Margen: <strong>{formatPercent(grossMarginPercent)}</strong></span>
            </div>
            <small className="text-muted">{getProfitNote(profitStatus)}</small>
          </div>
        </div>

        <MetricCard
          label="Ventas"
          value={netSalesCount}
          formatter={formatNumber}
          note="Ventas cerradas"
          icon={<ShoppingBag size={18} className="icon-muted" />}
          badges={badges}
        />

        <MetricCard
          label="Ticket promedio"
          value={averageTicket}
          formatter={formatCurrency}
          note="Promedio neto cloud"
          icon={<Ticket size={18} className="icon-muted" />}
          badges={badges}
        />

        <MetricCard label="Ventas brutas" value={grossSalesTotal} note="Antes de cancelaciones" badges={badges} />
        <MetricCard label="Canceladas" value={cancelledSalesTotal} note="No inflan ventas netas" badges={badges} />
        <MetricCard label="COGS" value={cogsTotal} note="Costo de venta" badges={badges} />
        <MetricCard label="Margen" value={grossMarginPercent} formatter={formatPercent} note={getProfitNote(profitStatus)} badges={badges} />
      </div>
    </div>
  );
}
