export const REPORT_SOURCE_MODES = Object.freeze({
  CLOUD: 'cloud',
  CLOUD_FINAL: 'cloud_final',
  LOCAL: 'local',
  MIXED: 'mixed',
  CACHE: 'cache'
});

export const REPORT_SOURCE_LABELS = Object.freeze({
  cloud: 'Cloud oficial',
  cloud_final: 'Cloud oficial final',
  local: 'Local',
  mixed: 'Mixto',
  cache: 'Ultimo snapshot'
});

export const CLOUD_OFFICIAL_MODULES = Object.freeze(['cash', 'customer_credit', 'customers', 'products']);
export const CLOUD_FINAL_OFFICIAL_MODULES = Object.freeze(['sales', 'cash', 'customer_credit', 'customers', 'products', 'inventory', 'cancellations', 'profit']);
export const LOCAL_ONLY_MODULES = Object.freeze(['waste']);

export const DEFAULT_MIXED_WARNINGS = Object.freeze([
  'Ventas cloud finales todavia no estan activas para este plan o dispositivo.',
  'Ventas locales se mantienen separadas para no mezclar historico local con ventas cloud comprometidas.'
]);

export const DEFAULT_CLOUD_FINAL_WARNINGS = Object.freeze([
  'Reporte cloud final: ventas netas excluyen canceladas y ventas shadow/locales.',
  'La utilidad depende de costos capturados en inventario o snapshot de venta.'
]);

export const normalizeReportSource = (source = {}) => (
  source && typeof source === 'object' ? source : {}
);

export const buildReportSource = (sourceInput = {}) => {
  const {
    mode = 'local',
    official = [],
    local = [],
    warnings = [],
    stale = false,
    generatedAt = null
  } = normalizeReportSource(sourceInput);

  return {
    mode,
    official: Array.isArray(official) ? official : [],
    local: Array.isArray(local) ? local : [],
    warnings: Array.isArray(warnings) ? warnings : [],
    stale: Boolean(stale),
    generatedAt
  };
};

export const getReportSourceLabel = (source = {}) => {
  const normalizedSource = normalizeReportSource(source);
  return REPORT_SOURCE_LABELS[normalizedSource.mode] || REPORT_SOURCE_LABELS.local;
};

export const isCloudReportSource = (source = {}) => {
  const normalizedSource = normalizeReportSource(source);
  return normalizedSource.mode === REPORT_SOURCE_MODES.CLOUD || normalizedSource.mode === REPORT_SOURCE_MODES.CLOUD_FINAL;
};

export const isCloudFinalReportSource = (source = {}) => {
  const normalizedSource = normalizeReportSource(source);
  return normalizedSource.mode === REPORT_SOURCE_MODES.CLOUD_FINAL || normalizedSource.final === true;
};

export const isMixedReportSource = (source = {}) => normalizeReportSource(source).mode === REPORT_SOURCE_MODES.MIXED;
export const isCacheReportSource = (source = {}) => normalizeReportSource(source).mode === REPORT_SOURCE_MODES.CACHE;
export const isLocalReportSource = (source = {}) => normalizeReportSource(source).mode === REPORT_SOURCE_MODES.LOCAL;
