import { memo, useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  DollarSign,
  ExternalLink,
  Package,
  RefreshCw,
  Users,
  XCircle
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import useOperationalDiagnostics from '../../hooks/diagnostics/useOperationalDiagnostics';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  DIAGNOSTIC_DATE_RANGES,
  DIAGNOSTIC_TYPES,
  formatDiagnosticPeriodLabel
} from '../../services/diagnostics/diagnosticCalculations';
import './OperationalDiagnostics.css';

const EMPTY_ARRAY = [];

const DIAGNOSTIC_OPTIONS = [
  {
    id: DIAGNOSTIC_TYPES.INVENTORY,
    label: 'Diagnóstico de inventario',
    shortLabel: 'Inventario',
    description: 'Stock, compromisos, movimiento, mermas y caducidad.',
    icon: Package
  },
  {
    id: DIAGNOSTIC_TYPES.FINANCIAL,
    label: 'Diagnóstico financiero',
    shortLabel: 'Finanzas',
    description: 'Ventas netas, costos, utilidad, pagos y contribución.',
    icon: DollarSign
  },
  {
    id: DIAGNOSTIC_TYPES.CUSTOMERS,
    label: 'Diagnóstico de clientes',
    shortLabel: 'Clientes',
    description: 'Actividad, recurrencia, frecuencia y saldos pendientes.',
    icon: Users
  }
];

const PERIOD_OPTIONS = [
  { id: DIAGNOSTIC_DATE_RANGES.TODAY, label: 'Hoy' },
  { id: DIAGNOSTIC_DATE_RANGES.LAST_7_DAYS, label: 'Últimos 7 días' },
  { id: DIAGNOSTIC_DATE_RANGES.LAST_30_DAYS, label: 'Últimos 30 días' },
  { id: DIAGNOSTIC_DATE_RANGES.THIS_MONTH, label: 'Este mes' },
  { id: DIAGNOSTIC_DATE_RANGES.LAST_MONTH, label: 'Mes anterior' }
];

const METRIC_CONFIG = {
  [DIAGNOSTIC_TYPES.INVENTORY]: [
    ['productsWithoutStock', 'Sin stock', 'number'],
    ['lowStock', 'Stock bajo', 'number'],
    ['committedStock', 'Stock comprometido', 'number'],
    ['productsWithoutMovement', 'Sin movimiento', 'number'],
    ['capitalDetained', 'Capital detenido', 'currency'],
    ['wasteAmount', 'Mermas', 'currency'],
    ['expiringLots', 'Lotes por caducar', 'number'],
    ['productsAtRisk', 'Productos en riesgo', 'number']
  ],
  [DIAGNOSTIC_TYPES.FINANCIAL]: [
    ['netSales', 'Ventas netas', 'currency'],
    ['salesCount', 'Número de ventas', 'number'],
    ['averageTicket', 'Ticket promedio', 'currency'],
    ['costOfSales', 'Costo de venta', 'currency'],
    ['grossProfit', 'Utilidad bruta', 'currency'],
    ['grossMargin', 'Margen bruto', 'percent'],
    ['discounts', 'Descuentos', 'currency'],
    ['itemsSold', 'Unidades vendidas', 'number']
  ],
  [DIAGNOSTIC_TYPES.CUSTOMERS]: [
    ['registeredCustomers', 'Clientes registrados', 'number'],
    ['activeCustomers', 'Clientes activos', 'number'],
    ['recurrentCustomers', 'Clientes recurrentes', 'number'],
    ['purchaseFrequency', 'Frecuencia de compra', 'decimal'],
    ['averageTicket', 'Ticket promedio', 'currency'],
    ['pendingBalances', 'Saldos pendientes', 'currency'],
    ['totalDebt', 'Deuda total', 'currency'],
    ['customersWithoutRecentActivity', 'Sin actividad reciente', 'number']
  ]
};

const TYPE_ICONS = {
  info: AlertCircle,
  warning: AlertTriangle,
  critical: XCircle
};

const formatNumber = (value, digits = 0) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('es-MX', { maximumFractionDigits: digits });
};

const formatMetric = (value, format) => {
  if (value === null || value === undefined) return '—';
  if (format === 'currency') return `$${formatNumber(value, 2)}`;
  if (format === 'percent') return `${formatNumber(value, 2)}%`;
  if (format === 'decimal') return formatNumber(value, 2);
  return formatNumber(value);
};

const getSourceLabel = (source) => {
  if (source === 'cloud') return 'Fuente: datos cloud consolidados';
  if (source === 'mixed') return 'Fuente: datos combinados (cloud + datos locales)';
  return 'Fuente: datos locales de este dispositivo';
};

const MetricCard = memo(({ label, value, format }) => (
  <div className="opdiag-metric-card">
    <span className="opdiag-metric-label">{label}</span>
    <strong className="opdiag-metric-value">{formatMetric(value, format)}</strong>
  </div>
));

MetricCard.displayName = 'MetricCard';

const DiagnosticFinding = memo(({ finding, onNavigate }) => {
  const Icon = TYPE_ICONS[finding.severity] || CheckCircle2;
  const handleNavigate = () => {
    if (finding.actionRoute) onNavigate(finding.actionRoute);
  };

  return (
    <article className={`opdiag-finding opdiag-finding--${finding.severity}`}>
      <div className="opdiag-finding-icon" aria-hidden="true"><Icon size={18} /></div>
      <div className="opdiag-finding-body">
        <div className="opdiag-finding-heading">
          <div>
            <span className="opdiag-severity">{finding.severity}</span>
            <h4>{finding.title}</h4>
          </div>
          {finding.actionRoute && (
            <button type="button" className="opdiag-action" onClick={handleNavigate}>
              {finding.actionLabel || 'Revisar'} <ExternalLink size={14} />
            </button>
          )}
        </div>
        <p>{finding.description}</p>
        <div className="opdiag-finding-details">
          <div>
            <span>Evidencia</span>
            <code>{JSON.stringify(finding.evidence || [])}</code>
          </div>
          <div>
            <span>Fórmula utilizada</span>
            <code>{finding.formula || 'Cálculo determinístico del diagnóstico'}</code>
          </div>
        </div>
      </div>
    </article>
  );
});

DiagnosticFinding.displayName = 'DiagnosticFinding';

const LoadingState = () => (
  <div className="opdiag-state" role="status" aria-live="polite">
    <RefreshCw size={26} className="opdiag-spin" />
    <strong>Calculando diagnóstico</strong>
    <span>Usando datos de lectura del periodo seleccionado.</span>
  </div>
);

const EmptyState = ({ diagnosticType }) => (
  <div className="opdiag-state">
    <CheckCircle2 size={28} />
    <strong>Sin datos suficientes</strong>
    <span>
      {diagnosticType === DIAGNOSTIC_TYPES.INVENTORY
        ? 'No hay productos disponibles para analizar inventario.'
        : diagnosticType === DIAGNOSTIC_TYPES.FINANCIAL
          ? 'No hay ventas cerradas en el periodo seleccionado.'
          : 'No hay clientes o ventas vinculadas para analizar.'}
    </span>
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="opdiag-state opdiag-state--error" role="alert">
    <AlertCircle size={28} />
    <strong>No se pudo calcular el diagnóstico</strong>
    <span>{message}</span>
    <button type="button" className="opdiag-retry" onClick={onRetry}><RefreshCw size={15} /> Reintentar</button>
  </div>
);

export default function OperationalDiagnostics({
  onNavigate,
  sales = EMPTY_ARRAY,
  menu = EMPTY_ARRAY,
  customers = EMPTY_ARRAY,
  wasteLogs = EMPTY_ARRAY,
  reportData = null,
  reportSource = null
}) {
  const [diagnosticType, setDiagnosticType] = useState(DIAGNOSTIC_TYPES.INVENTORY);
  const [dateRange, setDateRange] = useState(DIAGNOSTIC_DATE_RANGES.LAST_7_DAYS);
  const [refreshKey, setRefreshKey] = useState(0);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const timezone = companyProfile?.timezone || companyProfile?.time_zone || DEFAULT_BUSINESS_TIMEZONE;

  const commonArgs = useMemo(() => ({
    dateRange,
    timezone,
    sales,
    menu,
    customers,
    wasteLogs,
    reportSource,
    refreshKey
  }), [customers, dateRange, menu, refreshKey, reportSource, sales, timezone, wasteLogs]);

  const inventory = useOperationalDiagnostics({ ...commonArgs, diagnosticType: DIAGNOSTIC_TYPES.INVENTORY });
  const financial = useOperationalDiagnostics({ ...commonArgs, diagnosticType: DIAGNOSTIC_TYPES.FINANCIAL });
  const customer = useOperationalDiagnostics({ ...commonArgs, diagnosticType: DIAGNOSTIC_TYPES.CUSTOMERS });
  const stateByType = { inventory, financial, customers: customer };
  const activeState = stateByType[diagnosticType];
  const activeOption = DIAGNOSTIC_OPTIONS.find((option) => option.id === diagnosticType) || DIAGNOSTIC_OPTIONS[0];
  const ActiveIcon = activeOption.icon;
  const activeDiagnostic = activeState.diagnostic;

  const handleNavigate = useCallback((route) => {
    if (onNavigate) {
      onNavigate(route);
      return;
    }
    if (typeof window !== 'undefined') window.location.href = route;
  }, [onNavigate]);

  const handleRefresh = useCallback(() => setRefreshKey((current) => current + 1), []);
  const hasNoData = activeDiagnostic && (
    activeDiagnostic.coverage.salesAnalyzed === 0
    && (diagnosticType === DIAGNOSTIC_TYPES.INVENTORY
      ? activeDiagnostic.coverage.productsAnalyzed === 0
      : diagnosticType === DIAGNOSTIC_TYPES.CUSTOMERS
        ? activeDiagnostic.coverage.customersAnalyzed === 0
        : true)
  );
  const metricRows = activeDiagnostic ? METRIC_CONFIG[diagnosticType].map(([key, label, format]) => ({
    key,
    label,
    format,
    value: activeDiagnostic.metrics[key]
  })) : [];
  const sourceText = activeDiagnostic ? getSourceLabel(activeDiagnostic.source) : 'Fuente: preparando datos';
  const reportWarning = reportData?.source?.stale ? 'El reporte cloud disponible es un snapshot; los detalles locales pueden estar más actualizados.' : null;

  return (
    <section className="operational-diagnostics opdiag-shell" aria-label="Diagnóstico operativo">
      <header className="opdiag-header">
        <div>
          <span className="opdiag-kicker">Lectura determinística del negocio</span>
          <h2>Diagnóstico operativo</h2>
          <p>Resultados calculados con fórmulas y datos históricos del sistema.</p>
        </div>
        <div className="opdiag-header-meta">
          <span className="opdiag-source-badge"><Database size={14} />{sourceText}</span>
          <span className="opdiag-period-badge"><Clock3 size={14} />{formatDiagnosticPeriodLabel(dateRange)} · {timezone}</span>
        </div>
      </header>

      <div className="opdiag-controls">
        <div className="opdiag-tabs" role="tablist" aria-label="Diagnósticos operativos">
          {DIAGNOSTIC_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = option.id === diagnosticType;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`opdiag-tab ${selected ? 'is-selected' : ''}`}
                onClick={() => setDiagnosticType(option.id)}
              >
                <Icon size={17} />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </button>
            );
          })}
        </div>
        <div className="opdiag-filter-row">
          <label className="opdiag-period-select">
            <CalendarDays size={15} />
            <span>Periodo</span>
            <select value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
              {PERIOD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" className="opdiag-refresh" onClick={handleRefresh} aria-label="Actualizar diagnóstico">
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      <div className="opdiag-active-heading">
        <div><ActiveIcon size={20} /><div><h3>{activeOption.label}</h3><span>Periodo: {formatDiagnosticPeriodLabel(dateRange)}</span></div></div>
        <span className="opdiag-readonly-badge"><CheckCircle2 size={14} /> Solo lectura</span>
      </div>

      {activeState.isLoading && <LoadingState />}
      {!activeState.isLoading && activeState.error && <ErrorState message={activeState.error} onRetry={handleRefresh} />}
      {!activeState.isLoading && !activeState.error && activeDiagnostic && (
        <>
          <div className="opdiag-metrics" aria-label="Métricas del diagnóstico">
            {metricRows.map((metric) => (
              <MetricCard key={metric.key} label={metric.label} format={metric.format} value={metric.value} />
            ))}
          </div>

          <div className="opdiag-coverage">
            <span><strong>Cobertura:</strong> {activeDiagnostic.coverage.salesAnalyzed} ventas · {activeDiagnostic.coverage.productsAnalyzed} productos · {activeDiagnostic.coverage.customersAnalyzed} clientes</span>
            {activeDiagnostic.coverage.missingFields.length > 0 && <span className="opdiag-incomplete"><AlertTriangle size={14} /> Datos incompletos: {activeDiagnostic.coverage.missingFields.slice(0, 3).join(', ')}</span>}
          </div>

          {reportWarning && <div className="opdiag-warning"><AlertTriangle size={16} />{reportWarning}</div>}
          {activeDiagnostic.warnings.map((warning) => <div className="opdiag-warning" key={warning}><AlertTriangle size={16} />{warning}</div>)}

          {hasNoData ? <EmptyState diagnosticType={diagnosticType} /> : (
            <section className="opdiag-findings" aria-label="Hallazgos del diagnóstico">
              <div className="opdiag-section-heading"><h3>Alertas y evidencia</h3><span>{activeDiagnostic.findings.length} hallazgo(s)</span></div>
              {activeDiagnostic.findings.length > 0
                ? activeDiagnostic.findings.map((finding) => <DiagnosticFinding key={finding.id} finding={finding} onNavigate={handleNavigate} />)
                : <div className="opdiag-no-findings"><CheckCircle2 size={18} /> No se detectaron alertas operativas en este periodo.</div>}
            </section>
          )}
        </>
      )}

      <aside className="opdiag-legacy-note">
        <strong>Historial IA anterior</strong>
        <span>Se conserva separado en el almacenamiento local existente y no se mezcla con estos diagnósticos.</span>
      </aside>

      <footer className="opdiag-footer">
        <span><Clock3 size={13} /> Cálculo de solo lectura · {activeDiagnostic?.generatedAt ? new Date(activeDiagnostic.generatedAt).toLocaleTimeString('es-MX') : 'pendiente'}</span>
        <span>{activeState.period?.timezone || timezone}</span>
      </footer>
    </section>
  );
}
