const DEFAULT_LOCALE = 'es-MX';
const DEFAULT_CURRENCY = 'MXN';
const FALLBACK_TEXT = 'No disponible';

const SEVERITY_PRIORITY = Object.freeze({ info: 1, warning: 2, critical: 3 });

const METRIC_CONFIG = Object.freeze({
  inventory: [
    ['productsWithoutStock', 'Productos sin stock', 'number'],
    ['lowStock', 'Productos con stock bajo', 'number'],
    ['committedStock', 'Stock comprometido', 'number'],
    ['productsWithoutMovement', 'Productos sin movimiento', 'number'],
    ['capitalDetained', 'Capital detenido', 'currency'],
    ['wasteAmount', 'Mermas', 'currency'],
    ['expiringLots', 'Próximos a caducar', 'number'],
    ['productsAtRisk', 'Riesgo operativo', 'number']
  ],
  financial: [
    ['netSales', 'Ventas netas', 'currency'],
    ['salesCount', 'Número de ventas', 'number'],
    ['averageTicket', 'Ticket promedio', 'currency'],
    ['costOfSales', 'Costo de venta', 'currency'],
    ['grossProfit', 'Utilidad bruta', 'currency'],
    ['grossMargin', 'Margen bruto', 'percent'],
    ['discounts', 'Descuentos', 'currency'],
    ['itemsSold', 'Productos vendidos', 'number']
  ],
  customers: [
    ['registeredCustomers', 'Clientes registrados', 'number'],
    ['activeCustomers', 'Clientes activos', 'number'],
    ['recurrentCustomers', 'Clientes recurrentes', 'number'],
    ['purchaseFrequency', 'Frecuencia de compra', 'decimal'],
    ['averageTicket', 'Ticket promedio', 'currency'],
    ['totalDebt', 'Deuda total', 'currency'],
    ['customersWithoutRecentActivity', 'Clientes inactivos', 'number'],
    ['anonymousSales', 'Ventas anónimas', 'number']
  ]
});

const DIAGNOSTIC_COPY = Object.freeze({
  inventory: {
    title: 'Diagnóstico de inventario',
    subtitle: 'Identifica faltantes, inmovilizados, mermas y riesgos de caducidad.',
    empty: 'No hay productos disponibles para analizar inventario.'
  },
  financial: {
    title: 'Diagnóstico financiero',
    subtitle: 'Resume ventas, costos, utilidad, descuentos y comportamiento de pago.',
    empty: 'No hay ventas cerradas en el periodo seleccionado.'
  },
  customers: {
    title: 'Diagnóstico de clientes',
    subtitle: 'Muestra actividad, recurrencia, frecuencia de compra y saldos pendientes.',
    empty: 'No hay clientes o ventas vinculadas para analizar.'
  }
});

const SOURCE_COPY = Object.freeze({
  cloud: {
    sourceType: 'cloud',
    sourceLabel: 'Datos cloud consolidados',
    description: 'Información consolidada desde la nube.'
  },
  local: {
    sourceType: 'local',
    sourceLabel: 'Datos locales de este dispositivo',
    description: 'Información disponible en este dispositivo.'
  },
  mixed: {
    sourceType: 'mixed',
    sourceLabel: 'Datos mixtos: cloud + información local complementaria',
    description: 'La nube se complementa con información local.'
  }
});

const SEVERITY_COPY = Object.freeze({
  info: 'Informativo',
  warning: 'Atención',
  critical: 'Crítico'
});

const isFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'object') return false;
  const numeric = Number(value);
  return Number.isFinite(numeric);
};

const safeNumber = (value, fallback = null) => (isFiniteNumber(value) ? Number(value) : fallback);

const safeCurrencyCode = (currency) => {
  const normalized = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_CURRENCY;
};

export const formatNumber = (value, maximumFractionDigits = 0) => {
  const numeric = safeNumber(value);
  if (numeric === null) return FALLBACK_TEXT;
  return numeric.toLocaleString(DEFAULT_LOCALE, {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits > 0 && !Number.isInteger(numeric) ? 0 : undefined
  });
};

export const formatCurrency = (value, currency = DEFAULT_CURRENCY) => {
  const numeric = safeNumber(value);
  if (numeric === null) return FALLBACK_TEXT;
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: 'currency',
      currency: safeCurrencyCode(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numeric);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numeric);
  }
};

export const formatPercentage = (value, maximumFractionDigits = 1) => {
  const numeric = safeNumber(value);
  return numeric === null
    ? FALLBACK_TEXT
    : `${numeric.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: maximumFractionDigits,
      maximumFractionDigits
    })}%`;
};

export const formatDate = (value, timezone = 'America/Mexico_City') => {
  if (!value) return FALLBACK_TEXT;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return FALLBACK_TEXT;
  try {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timezone
    }).format(date);
  } catch {
    return FALLBACK_TEXT;
  }
};

export const formatDuration = (value) => {
  const numeric = safeNumber(value);
  if (numeric === null) return FALLBACK_TEXT;
  const rounded = Math.max(0, Math.round(numeric));
  if (rounded < 60) return `${formatNumber(rounded)} ${rounded === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes === 0
    ? `${formatNumber(hours)} ${hours === 1 ? 'hora' : 'horas'}`
    : `${formatNumber(hours)} h ${formatNumber(minutes)} min`;
};

export const formatSeverity = (severity) => SEVERITY_COPY[severity] || SEVERITY_COPY.info;

const pluralize = (value, singular, plural = `${singular}s`) => `${formatNumber(value)} ${safeNumber(value) === 1 ? singular : plural}`;

const periodEnd = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() - 1);
};

const formatPeriodLabel = (period, rangeLabel, timezone) => {
  const from = formatDate(period?.from, timezone);
  const to = formatDate(periodEnd(period?.to), timezone);
  if (from === FALLBACK_TEXT) return rangeLabel || 'Periodo seleccionado';
  if (to === FALLBACK_TEXT || from === to) return `${rangeLabel || 'Periodo seleccionado'} · ${from}`;
  return `${rangeLabel || 'Periodo seleccionado'} · ${from} – ${to}`;
};

const getPeriodDays = (period) => {
  const from = new Date(period?.from);
  const to = new Date(period?.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
};

const humanizeMissingField = (field) => {
  const value = String(field || '').toLowerCase();
  if (value.startsWith('cost:')) return 'costo de producto';
  if (value.includes('unit_cost')) return 'costos unitarios';
  if (value.includes('committed_stock')) return 'stock comprometido';
  if (value.includes('min_stock')) return 'stock mínimo';
  if (value.includes('waste_amount')) return 'importe de merma';
  if (value.includes('customers.id')) return 'identificador de cliente';
  if (value.includes('stock')) return 'existencias';
  return 'información complementaria';
};

export const formatMissingFields = (fields = []) => Array.from(new Set(
  (Array.isArray(fields) ? fields : []).map(humanizeMissingField)
));

const formatRisk = (severity) => {
  if (severity === 'critical') return 'Alto';
  if (severity === 'warning') return 'Medio';
  return 'Bajo';
};

const detail = (label, value) => ({ label, value: value ?? FALLBACK_TEXT });

const formatEvidenceDetails = ({ diagnosticType, finding, currency, timezone }) => {
  const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
  const rows = [];
  const add = (label, value) => rows.push(detail(label, value));

  evidence.slice(0, 5).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (diagnosticType === 'inventory') {
      add('Producto', item.name || item.productName || 'Producto sin nombre');
      if (item.stock !== undefined) add('Stock actual', formatNumber(item.stock));
      if (item.availableStock !== undefined) add('Disponible', formatNumber(item.availableStock));
      if (item.minStock !== undefined) add('Mínimo configurado', formatNumber(item.minStock));
      if (item.committedStock !== undefined) add('Comprometido', formatNumber(item.committedStock));
      if (item.daysUntilExpiry !== undefined) add('Días para caducar', formatNumber(item.daysUntilExpiry));
      if (item.expiryDate) add('Fecha de caducidad', formatDate(item.expiryDate, timezone));
      if (item.value !== undefined) add('Valor estimado', formatCurrency(item.value, currency));
      if (item.amount !== undefined) add('Merma registrada', formatCurrency(item.amount, currency));
      if (item.records !== undefined) add('Registros', formatNumber(item.records));
      if (item.products !== undefined) add('Productos afectados', formatNumber(item.products));
      if (item.stock !== undefined && item.minStock !== undefined) add('Riesgo', formatRisk(finding.severity));
      return;
    }
    if (diagnosticType === 'financial') {
      if (item.name) add('Producto', item.name);
      if (item.quantity !== undefined) add('Unidades vendidas', formatNumber(item.quantity, 2));
      if (item.revenue !== undefined) add('Venta neta', formatCurrency(item.revenue, currency));
      if (item.missingCostRevenue !== undefined) add('Venta sin costo confirmado', formatCurrency(item.missingCostRevenue, currency));
      if (item.missingCostItems !== undefined) add('Unidades sin costo', formatNumber(item.missingCostItems, 2));
      return;
    }
    if (item.recurrentCustomers !== undefined) add('Clientes recurrentes', formatNumber(item.recurrentCustomers));
    if (item.activeCustomers !== undefined) add('Clientes activos', formatNumber(item.activeCustomers));
    if (item.customers !== undefined) add('Clientes sin actividad', formatNumber(item.customers));
    if (item.totalDebt !== undefined) add('Deuda registrada', formatCurrency(item.totalDebt, currency));
    if (item.pendingBalance !== undefined) add('Pendientes del periodo', formatCurrency(item.pendingBalance, currency));
  });

  return rows;
};

const humanizeFindingDescription = ({ finding, currency }) => {
  const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
  const first = evidence[0] || {};
  if (finding?.id === 'inventory-waste') {
    return `Se registraron ${formatCurrency(first.amount, currency)} en mermas durante el periodo.`;
  }
  if (finding?.id === 'financial-missing-costs') {
    return `Faltan costos para ${formatNumber(first.missingCostItems, 2)} unidades. La utilidad y el margen solo usan costos registrados.`;
  }
  if (finding?.id === 'customers-pending-balances') {
    return `La deuda registrada suma ${formatCurrency(first.totalDebt, currency)} y los pendientes del periodo suman ${formatCurrency(first.pendingBalance, currency)}.`;
  }
  return typeof finding?.description === 'string' && finding.description.trim()
    ? finding.description
    : 'No hay una explicación disponible para este hallazgo.';
};

const getOverallSeverity = (findings = []) => findings.reduce((current, item) => (
  (SEVERITY_PRIORITY[item?.severity] || 1) > (SEVERITY_PRIORITY[current] || 1) ? item.severity : current
), 'info');

const getCurrencyFromData = ({ currency, sales, products }) => currency
  || sales.find((sale) => sale?.currency)?.currency
  || products.find((product) => product?.currency)?.currency
  || DEFAULT_CURRENCY;

const buildWarnings = ({ diagnostic, diagnosticType, source }) => {
  const warnings = Array.isArray(diagnostic?.warnings) ? diagnostic.warnings.filter(Boolean) : [];
  const metrics = diagnostic?.metrics || {};
  const missingCostItems = safeNumber(metrics.missingCostItems, 0);
  if (diagnosticType === 'financial' && missingCostItems > 0) {
    warnings.unshift(`Margen no completamente calculable: faltan costos en algunos productos. La utilidad mostrada utiliza únicamente costos registrados (${formatNumber(missingCostItems, 2)} unidades sin costo).`);
  }
  if (diagnosticType === 'inventory' && source !== 'local') {
    warnings.push('La información de lotes proviene del almacenamiento local.');
  }
  if (diagnosticType === 'inventory' && (diagnostic?.coverage?.missingFields || []).some((field) => String(field).startsWith('cost:'))) {
    const missingCosts = diagnostic.coverage.missingFields.filter((field) => String(field).startsWith('cost:')).length;
    warnings.unshift(`Nota: ${formatNumber(missingCosts)} ${missingCosts === 1 ? 'producto no tiene' : 'productos no tienen'} costo registrado. El capital detenido fue calculado únicamente con costos disponibles.`);
  }
  return Array.from(new Set(warnings));
};

export const buildDiagnosticViewModel = ({
  diagnostic,
  diagnosticType,
  rangeLabel = 'Periodo seleccionado',
  timezone = 'America/Mexico_City',
  currency,
  sales = [],
  products = []
} = {}) => {
  const safeDiagnostic = diagnostic || {};
  const metrics = safeDiagnostic.metrics && typeof safeDiagnostic.metrics === 'object' ? safeDiagnostic.metrics : {};
  const coverage = safeDiagnostic.coverage && typeof safeDiagnostic.coverage === 'object' ? safeDiagnostic.coverage : {};
  const findings = Array.isArray(safeDiagnostic.findings) ? safeDiagnostic.findings : [];
  const copy = DIAGNOSTIC_COPY[diagnosticType] || DIAGNOSTIC_COPY.inventory;
  const source = SOURCE_COPY[safeDiagnostic.source] || SOURCE_COPY.local;
  const resolvedCurrency = getCurrencyFromData({ currency, sales, products });
  const period = safeDiagnostic.period || {};
  const days = getPeriodDays(period);
  const metricRows = (METRIC_CONFIG[diagnosticType] || []).map(([key, label, format]) => ({
    key,
    label,
    format,
    value: metrics[key],
    displayValue: format === 'currency'
      ? formatCurrency(metrics[key], resolvedCurrency)
      : format === 'percent'
        ? formatPercentage(metrics[key])
        : format === 'decimal'
          ? formatNumber(metrics[key], 2)
          : formatNumber(metrics[key])
  }));
  const visualFindings = findings.map((finding, index) => ({
    id: finding.id || `finding-${index}`,
    severity: SEVERITY_COPY[finding.severity] ? finding.severity : 'info',
    severityLabel: formatSeverity(finding.severity),
    title: typeof finding.title === 'string' && finding.title.trim() ? finding.title : 'Hallazgo operativo',
    description: humanizeFindingDescription({ finding, currency: resolvedCurrency }),
    details: formatEvidenceDetails({ diagnosticType, finding, currency: resolvedCurrency, timezone }),
    actionLabel: typeof finding.actionLabel === 'string' ? finding.actionLabel : null,
    actionRoute: typeof finding.actionRoute === 'string' && finding.actionRoute.startsWith('/') ? finding.actionRoute : null
  }));

  let coverageSummary;
  if (diagnosticType === 'financial') {
    coverageSummary = `${pluralize(coverage.salesAnalyzed, 'venta')} · ${pluralize(metrics.itemsSold, 'producto vendido', 'productos vendidos')} · ${pluralize(days, 'día')}`;
  } else if (diagnosticType === 'customers') {
    coverageSummary = `${pluralize(coverage.salesAnalyzed, 'venta')} · ${pluralize(coverage.customersAnalyzed, 'cliente')} · ${pluralize(days, 'día')}`;
  } else {
    coverageSummary = `${pluralize(coverage.salesAnalyzed, 'venta')} · ${pluralize(coverage.productsAnalyzed, 'producto')} · ${pluralize(days, 'día')}`;
  }

  return {
    title: copy.title,
    subtitle: copy.subtitle,
    emptyDescription: copy.empty,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    sourceDescription: source.description,
    severity: getOverallSeverity(findings),
    severityLabel: formatSeverity(getOverallSeverity(findings)),
    periodLabel: formatPeriodLabel(period, rangeLabel, timezone),
    kpis: metricRows,
    findings: visualFindings,
    actions: visualFindings
      .filter((finding) => finding.actionRoute)
      .map((finding) => ({
        id: finding.id,
        label: finding.actionLabel || 'Revisar',
        route: finding.actionRoute,
        title: finding.title
      })),
    warnings: buildWarnings({ diagnostic: safeDiagnostic, diagnosticType, source: source.sourceType }),
    coverage: {
      salesAnalyzed: safeNumber(coverage.salesAnalyzed, 0),
      productsAnalyzed: safeNumber(coverage.productsAnalyzed, 0),
      customersAnalyzed: safeNumber(coverage.customersAnalyzed, 0),
      missingFields: formatMissingFields(coverage.missingFields),
      summary: coverageSummary,
      isIncomplete: Array.isArray(coverage.missingFields) && coverage.missingFields.length > 0
    },
    breakdowns: {
      paymentMethods: Array.isArray(metrics.paymentMethods) ? metrics.paymentMethods : [],
      byDay: metrics.byDay && typeof metrics.byDay === 'object' ? metrics.byDay : {},
      byHour: metrics.byHour && typeof metrics.byHour === 'object' ? metrics.byHour : {},
      topProducts: Array.isArray(metrics.topProducts) ? metrics.topProducts : [],
      capitalByProduct: Array.isArray(metrics.capitalByProduct) ? metrics.capitalByProduct : []
    },
    currency: resolvedCurrency,
    generatedAt: safeDiagnostic.generatedAt
  };
};

export const __private__ = {
  formatPeriodLabel,
  formatEvidenceDetails,
  humanizeMissingField,
  getOverallSeverity
};
