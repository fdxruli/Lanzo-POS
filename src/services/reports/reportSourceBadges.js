export const REPORT_SOURCE_MODES = Object.freeze({
  CLOUD: 'cloud',
  LOCAL: 'local',
  MIXED: 'mixed',
  CACHE: 'cache'
});

export const REPORT_SOURCE_LABELS = Object.freeze({
  cloud: 'Cloud oficial',
  local: 'Local',
  mixed: 'Mixto',
  cache: 'Ultimo snapshot'
});

export const CLOUD_OFFICIAL_MODULES = Object.freeze(['cash', 'customer_credit', 'customers', 'products']);
export const LOCAL_ONLY_MODULES = Object.freeze(['sales', 'waste']);

export const DEFAULT_MIXED_WARNINGS = Object.freeze([
  'Ventas cloud completas todavia no estan implementadas.',
  'Ventas, utilidad real, historial y mermas siguen usando datos locales de este dispositivo.',
  'Caja, abonos, clientes y catalogo usan datos cloud oficiales cuando el dispositivo esta en linea.'
]);

export const buildReportSource = ({ mode = 'local', official = [], local = [], warnings = [], stale = false, generatedAt = null } = {}) => ({
  mode,
  official: Array.isArray(official) ? official : [],
  local: Array.isArray(local) ? local : [],
  warnings: Array.isArray(warnings) ? warnings : [],
  stale: Boolean(stale),
  generatedAt
});

export const getReportSourceLabel = (source = {}) => REPORT_SOURCE_LABELS[source.mode] || REPORT_SOURCE_LABELS.local;
export const isCloudReportSource = (source = {}) => source.mode === REPORT_SOURCE_MODES.CLOUD;
export const isMixedReportSource = (source = {}) => source.mode === REPORT_SOURCE_MODES.MIXED;
export const isCacheReportSource = (source = {}) => source.mode === REPORT_SOURCE_MODES.CACHE;
export const isLocalReportSource = (source = {}) => source.mode === REPORT_SOURCE_MODES.LOCAL;
