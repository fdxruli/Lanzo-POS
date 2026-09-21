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
import DiagnosticLimitations from './DiagnosticLimitations';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  DIAGNOSTIC_DATE_RANGES,
  DIAGNOSTIC_TYPES,
  formatDiagnosticPeriodLabel
} from '../../services/diagnostics/diagnosticCalculations';
import {
  buildDiagnosticViewModel,
  formatCurrency,
  formatNumber,
  formatPercentage
} from '../../utils/diagnostics/diagnosticPresentation';
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

const TYPE_ICONS = {
  info: AlertCircle,
  warning: AlertTriangle,
  critical: XCircle
};

const MetricCard = memo(({ label, displayValue }) => (
  <div className="opdiag-metric-card">
    <span className="opdiag-metric-label">{label}</span>
    <strong className="opdiag-metric-value">{displayValue}</strong>
  </div>
));

MetricCard.displayName = 'MetricCard';

const DiagnosticFinding = memo(({ finding, onNavigate }) => {
  const Icon = TYPE_ICONS[finding.severity] || CheckCircle2;
  const handleNavigate = () => {
    if (finding.actionRoute && onNavigate) onNavigate(finding.actionRoute);
  };

  return (
    <article className={`opdiag-finding opdiag-finding--${finding.severity}`}>
      <div className="opdiag-finding-icon" aria-hidden="true"><Icon size={18} /></div>
      <div className="opdiag-finding-body">
        <div className="opdiag-finding-heading">
          <div>
            <span className="opdiag-severity">{finding.severityLabel}</span>
            <h4>{finding.title}</h4>
          </div>
          {finding.actionRoute && (
            <button type="button" className="opdiag-action" onClick={handleNavigate}>
              {finding.actionLabel || 'Revisar'} <ExternalLink size={14} />
            </button>
          )}
        </div>
        <p>{finding.description}</p>
        {finding.details.length > 0 && (
          <dl className="opdiag-finding-details">
            {finding.details.map((item, index) => (
              <div key={`${item.label}-${index}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
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

const EmptyState = ({ description }) => (
  <div className="opdiag-state">
    <CheckCircle2 size={28} />
    <strong>Sin datos suficientes</strong>
    <span>{description}</span>
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

const PAYMENT_METHOD_LABELS = {
  cash: 'Efectivo',
  efectivo: 'Efectivo',
  card: 'Tarjeta',
  tarjeta: 'Tarjeta',
  credit: 'Crédito',
  credito: 'Crédito',
  fiado: 'Fiado',
  transfer: 'Transferencia',
  transferencia: 'Transferencia'
};

const formatPaymentMethod = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return PAYMENT_METHOD_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'No especificado');
};

const formatHour = (value) => {
  const hour = Number(value);
  return Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59` : 'Horario no disponible';
};

const getTopRows = (rows, limit = 3) => rows
  .filter((row) => row && typeof row === 'object')
  .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.revenue || 0) - (a.revenue || 0))
  .slice(0, limit);

const DiagnosticBreakdowns = memo(({ diagnosticType, viewModel }) => {
  const { breakdowns, currency } = viewModel;
  if (diagnosticType === DIAGNOSTIC_TYPES.FINANCIAL) {
    const days = Object.entries(breakdowns.byDay).map(([day, data]) => ({ day, ...data }));
    const hours = Object.entries(breakdowns.byHour).map(([hour, data]) => ({ hour, ...data }));
    const hasFinancialBreakdown = breakdowns.paymentMethods.length > 0
      || breakdowns.topProducts.length > 0
      || days.length > 0
      || hours.length > 0;
    if (!hasFinancialBreakdown) return null;

    return (
      <section className="opdiag-breakdowns" aria-label="Desglose financiero">
        <div className="opdiag-section-heading"><h3>Comportamiento de ventas</h3><span>Resumen del periodo</span></div>
        <div className="opdiag-breakdown-grid">
          {breakdowns.paymentMethods.length > 0 && (
            <div className="opdiag-breakdown-card">
              <h4>Métodos de pago</h4>
              {breakdowns.paymentMethods.slice(0, 5).map((row) => (
                <div className="opdiag-breakdown-row" key={row.method}>
                  <span>{formatPaymentMethod(row.method)}</span>
                  <strong>{formatCurrency(row.revenue, currency)} <small>{formatPercentage(row.percentage)}</small></strong>
                </div>
              ))}
            </div>
          )}
          {(days.length > 0 || hours.length > 0) && (
            <div className="opdiag-breakdown-card">
              <h4>Días y horarios con mayor actividad</h4>
              {getTopRows(days, 2).map((row) => (
                <div className="opdiag-breakdown-row" key={`day-${row.day}`}>
                  <span>{row.day}</span><strong>{formatNumber(row.count)} ventas</strong>
                </div>
              ))}
              {getTopRows(hours, 2).map((row) => (
                <div className="opdiag-breakdown-row" key={`hour-${row.hour}`}>
                  <span>{formatHour(row.hour)}</span><strong>{formatNumber(row.count)} ventas</strong>
                </div>
              ))}
            </div>
          )}
          {breakdowns.topProducts.length > 0 && (
            <div className="opdiag-breakdown-card">
              <h4>Productos con mayor contribución</h4>
              {breakdowns.topProducts.slice(0, 5).map((row) => (
                <div className="opdiag-breakdown-row" key={row.id || row.name}>
                  <span>{row.name || 'Producto sin nombre'}</span>
                  <strong>{formatCurrency(row.revenue, currency)} <small>{formatNumber(row.quantity, 2)} u.</small></strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (diagnosticType === DIAGNOSTIC_TYPES.INVENTORY && breakdowns.capitalByProduct.length > 0) {
    return (
      <section className="opdiag-breakdowns" aria-label="Detalle de inventario">
        <div className="opdiag-section-heading"><h3>Capital detenido por producto</h3><span>Valor con costos disponibles</span></div>
        <div className="opdiag-breakdown-card opdiag-breakdown-card--wide">
          {breakdowns.capitalByProduct.slice(0, 10).map((row) => (
            <div className="opdiag-breakdown-row" key={row.id || row.name}>
              <span>{row.name || 'Producto sin nombre'}</span><strong>{formatCurrency(row.value, currency)}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
});

DiagnosticBreakdowns.displayName = 'DiagnosticBreakdowns';

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
  const currency = companyProfile?.currency || companyProfile?.currency_code || companyProfile?.currencyCode || 'MXN';

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
  const activeViewModel = useMemo(() => buildDiagnosticViewModel({
    diagnostic: activeDiagnostic,
    diagnosticType,
    rangeLabel: formatDiagnosticPeriodLabel(dateRange),
    timezone,
    currency,
    sales,
    products: menu,
    customers
  }), [activeDiagnostic, currency, customers, dateRange, diagnosticType, menu, sales, timezone]);

  const handleNavigate = useCallback((route) => {
    if (onNavigate) {
      onNavigate(route);
      return;
    }
    if (typeof window !== 'undefined') window.location.href = route;
  }, [onNavigate]);

  const handleRefresh = useCallback(() => setRefreshKey((current) => current + 1), []);
  const hasNoData = activeDiagnostic && (
    diagnosticType === DIAGNOSTIC_TYPES.INVENTORY
      ? activeViewModel.coverage.productsAnalyzed === 0
      : diagnosticType === DIAGNOSTIC_TYPES.CUSTOMERS
        ? activeViewModel.coverage.customersAnalyzed === 0 && activeViewModel.coverage.salesAnalyzed === 0
        : activeViewModel.coverage.salesAnalyzed === 0
  );
  const reportWarning = reportData?.source?.stale
    ? 'El reporte cloud disponible es un snapshot; los detalles locales pueden estar más actualizados.'
    : null;

  return (
    <section className="operational-diagnostics opdiag-shell" aria-label="Diagnóstico operativo">
      <header className="opdiag-header">
        <div>
          <span className="opdiag-kicker">Lectura determinística del negocio</span>
          <h2>Diagnóstico operativo</h2>
          <p>Resultados calculados con fórmulas y datos históricos del sistema.</p>
        </div>
        <div className="opdiag-header-meta">
          <span className="opdiag-source-badge"><Database size={14} />{activeDiagnostic ? activeViewModel.sourceLabel : 'Fuente: preparando datos'}</span>
          <span className="opdiag-period-badge"><Clock3 size={14} />{activeDiagnostic ? activeViewModel.periodLabel : formatDiagnosticPeriodLabel(dateRange)} · {timezone}</span>
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
        <div><ActiveIcon size={20} /><div><h3>{activeViewModel.title}</h3><p className="opdiag-active-subtitle">{activeViewModel.subtitle}</p><span>{activeDiagnostic ? activeViewModel.periodLabel : `Periodo: ${formatDiagnosticPeriodLabel(dateRange)}`}</span></div></div>
        <span className={`opdiag-severity-badge opdiag-severity-badge--${activeViewModel.severity}`}><CheckCircle2 size={14} /> Nivel: {activeViewModel.severityLabel}</span>
      </div>

      {activeState.isLoading && <LoadingState />}
      {!activeState.isLoading && activeState.error && <ErrorState message={activeState.error} onRetry={handleRefresh} />}
      {!activeState.isLoading && !activeState.error && activeDiagnostic && (
        <>
          <div className="opdiag-metrics" aria-label="Métricas del diagnóstico">
            {activeViewModel.kpis.map((metric) => (
              <MetricCard key={metric.key} label={metric.label} displayValue={metric.displayValue} />
            ))}
          </div>

          <div className="opdiag-coverage">
            <span><strong>Datos analizados:</strong> {activeViewModel.coverage.summary}</span>
          </div>

          <DiagnosticLimitations limitations={activeViewModel.limitations} reportWarning={reportWarning} />

          <DiagnosticBreakdowns diagnosticType={diagnosticType} viewModel={activeViewModel} />

          {hasNoData ? <EmptyState description={activeViewModel.emptyDescription} /> : (
            <section className="opdiag-findings" aria-label="Hallazgos del diagnóstico">
              <div className="opdiag-section-heading"><h3>Hallazgos y acciones</h3><span>{activeViewModel.findings.length} hallazgo(s)</span></div>
              {activeViewModel.findings.length > 0
                ? activeViewModel.findings.map((finding) => <DiagnosticFinding key={finding.id} finding={finding} onNavigate={handleNavigate} />)
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
        <span><Clock3 size={13} /> Cálculo de solo lectura · {activeDiagnostic?.generatedAt && Number.isFinite(new Date(activeDiagnostic.generatedAt).getTime()) ? new Date(activeDiagnostic.generatedAt).toLocaleTimeString('es-MX') : 'pendiente'}</span>
        <span>{activeState.period?.timezone || timezone}</span>
      </footer>
    </section>
  );
}
