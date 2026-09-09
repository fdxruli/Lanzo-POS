import { formatCurrencyMXN } from './formatCurrencyMXN';

const CODE_LABELS = {
  'coverage_incomplete': 'Análisis realizado con cobertura parcial',
  'provider_payload_limit': 'Límite de datos enviados al análisis',
  'impact_desc': 'Priorizados por mayor impacto',
  'stock_priority': 'Priorizados por riesgo de desabasto',
  'stock_asc': 'Ordenados de menor a mayor existencia',
  'revenue_desc': 'Priorizados por mayores ventas',
  'common.dataQuality': 'Calidad de datos',
  'inventory.stockRisk': 'Riesgo de inventario',
  'operations.wasteImpact': 'Impacto de mermas',
  'retail.marginRisk': 'Riesgo de margen',
  'products': 'Módulo Productos',
  'openai-compatible': 'DeepSeek',
  inventoryAlerts: 'Riesgo de inventario',
  outOfStockProducts: 'Productos agotados',
  lowStockProducts: 'Productos con bajo stock',
  potentialDeadStock: 'Candidatos a stock muerto',
  deadStockTotalTiedCapital: 'Capital inmovilizado',
  wasteStats: 'Resumen de mermas',
  wasteTransactions: 'Movimientos de merma',
  totalWasteLoss: 'Pérdida total por mermas',
  localDetails: 'Detalles locales',
  'Local details': 'Detalles locales',
  local_details: 'Detalles locales',
  topProducts: 'Productos principales',
  'Top products': 'Productos principales',
  top_products: 'Productos principales',
  menuStats: 'Resumen del menú',
  coverage: 'Cobertura de datos',
  factsTotal: 'Datos totales',
  factsIncluded: 'Datos incluidos',
  factsOmitted: 'Datos omitidos',
  'json-recovery-fallback': 'Respuesta recuperada',
  structured_json: 'Respuesta estructurada',
  UNPARSEABLE_RESPONSE: 'Respuesta con formato no legible',
  finish_reason: 'Motivo de finalización',
  provider_response_status: 'Estado de respuesta',
  prompt_cache_hit_tokens: 'Tokens reutilizados',
  prompt_cache_miss_tokens: 'Tokens nuevos',
  request_id: 'Identificador de solicitud',
  provider_request_id: 'Identificador técnico del proveedor',
  protocol: 'Protocolo técnico',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  danger: 'Alta',
  warning: 'Media',
  info: 'Informativa',
  success: 'Correcta',
  inventoryAuditor: 'Auditor de inventario',
  financialAnalyst: 'Analista financiero'
};

const normalizeCode = value => String(value || '').trim().toLowerCase();
const HIDDEN_DISPLAY_KEYS = new Set(['id', 'key', 'route', 'path', 'url', 'tool', 'toolid', 'tool_id', 'permission', 'permissions', 'headers', 'metadata']);
const formatBusinessCurrency = value => formatCurrencyMXN(value, '');

const getMappedLabel = value => {
  const normalized = normalizeCode(value);
  const entry = Object.entries(CODE_LABELS).find(([key]) => normalizeCode(key) === normalized);
  return entry?.[1] || null;
};

export const formatFallbackInternalLabel = (value = '') => String(value)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/[./]+/g, ' / ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('es-MX')
  .replace(/^./, letter => letter.toUpperCase());

export const translateAIReportCode = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return fallback || String(value);
  const text = value.trim();
  if (!text) return fallback;
  return getMappedLabel(text) || formatFallbackInternalLabel(text) || fallback;
};

export const getSeverityLabel = (value, fallback = 'Informativa') => {
  const normalized = normalizeCode(value);
  const labels = {
    success: 'Correcta',
    info: 'Informativa',
    warning: 'Alerta',
    danger: 'Alta',
    high: 'Alta',
    medium: 'Media',
    low: 'Baja'
  };
  return labels[normalized] || (value ? translateAIReportCode(value) : fallback);
};

export const getPriorityLabel = (value, fallback = 'Media') => {
  const normalized = normalizeCode(value);
  return {
    high: 'Alta',
    medium: 'Media',
    low: 'Baja'
  }[normalized] || (value ? translateAIReportCode(value) : fallback);
};

export const getActionTypeLabel = (value, fallback = 'Manual') => {
  const normalized = normalizeCode(value);
  return {
    navigate: 'Navegación',
    review: 'Revisión',
    draft: 'Borrador guiado',
    checklist: 'Lista de verificación',
    manual: 'Manual'
  }[normalized] || (value ? translateAIReportCode(value) : fallback);
};

export const getModuleLabel = value => {
  const translated = translateAIReportCode(value, 'este módulo');
  return translated.replace(/^Módulo\s+/i, '') || 'este módulo';
};

const ROUTE_MODULES = {
  productos: 'Productos',
  product: 'Productos',
  inventory: 'Inventario',
  inventario: 'Inventario',
  ventas: 'Ventas',
  sales: 'Ventas',
  compras: 'Compras',
  purchases: 'Compras',
  mermas: 'Mermas',
  waste: 'Mermas',
  reportes: 'Reportes',
  reports: 'Reportes'
};

export const getRouteLabel = (route, fallback = 'Abrir el módulo correspondiente') => {
  if (!route) return fallback;
  const path = String(route).trim().replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  const moduleKey = path.split('/').filter(Boolean)[0]?.toLowerCase();
  const moduleLabel = ROUTE_MODULES[moduleKey] || getModuleLabel(moduleKey || path);
  return moduleLabel && moduleLabel !== 'este módulo'
    ? `Ir al módulo ${moduleLabel}`
    : fallback;
};

export const getToolReferenceLabel = (value, fallback = 'Fuente de datos del sistema') => {
  if (!value) return fallback;
  return translateAIReportCode(value, fallback);
};

export const getCoverageReasonLabel = value => {
  const normalized = normalizeCode(value);
  if (normalized === 'provider_payload_limit') return 'Se envió una cantidad limitada de datos para mantener el análisis eficiente.';
  if (normalized === 'coverage_incomplete') return 'Este análisis se realizó con una parte de los datos disponibles.';
  return translateAIReportCode(value, 'Información de cobertura no disponible');
};

export const getCoverageOrderLabel = value => {
  const normalized = normalizeCode(value);
  return {
    impact_desc: 'Elementos de mayor impacto primero.',
    stock_priority: 'Elementos con mayor riesgo de desabasto primero.',
    stock_asc: 'Elementos con menor existencia primero.',
    revenue_desc: 'Elementos con mayores ventas primero.'
  }[normalized] || translateAIReportCode(value, 'Orden de prioridad no especificado');
};

const replaceKnownCodes = text => Object.entries(CODE_LABELS)
  .sort(([left], [right]) => right.length - left.length)
  .reduce((output, [code, label]) => output.replace(new RegExp(`(?<![A-Za-z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'gi'), label), text);

const replaceUnknownCodes = text => text.replace(/\b[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+\b|\b[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b/g, token => formatFallbackInternalLabel(token));

const humanizePathAssignment = text => text
  .replace(/(?:outOfStockProducts)\.total\s*=\s*([\d.,]+)/gi, 'Productos agotados: $1')
  .replace(/(?:lowStockProducts)\.total\s*=\s*([\d.,]+)/gi, 'Productos con bajo stock: $1')
  .replace(/(?:potentialDeadStock)\.total\s*=\s*([\d.,]+)/gi, 'Candidatos a stock muerto: $1')
  .replace(/deadStockTotalTiedCapital\s*=\s*([\d.,]+)/gi, (_match, value) => `Capital inmovilizado: ${formatBusinessCurrency(value)}`)
  .replace(/(?:wasteStats\.)?totalWasteLoss\s*=\s*([\d.,]+)/gi, (_match, value) => `Pérdida total por mermas: ${formatBusinessCurrency(value)}`)
  .replace(/(?:wasteStats\.)?wasteTransactions\s*=\s*([\d.,]+)/gi, 'Movimientos de merma: $1')
  .replace(/\b(?:outOfStockProducts|lowStockProducts|potentialDeadStock)\.(?:items|total)\b/gi, match => {
    const key = match.split('.')[0];
    return translateAIReportCode(key);
  });

const humanizePermissionAndRoute = text => text
  .replace(/(?:Permiso requerido|Permiso necesario|required permission)\s*:\s*([\w.-]+)/gi, (_match, permission) => `Módulo necesario: ${getModuleLabel(permission)}`)
  .replace(/(?:Ruta|route|path)\s*:\s*(\/[\w/-]+)/gi, (_match, route) => getRouteLabel(route))
  .replace(/(^|[\s(])\/(productos|product|inventory|inventario|ventas|sales|compras|purchases|mermas|waste|reportes|reports)(?=[\s),.;!?]|$)/gi, (_match, prefix, route) => `${prefix}${getRouteLabel(`/${route}`)}`);

export const humanizeAIReportText = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return humanizeAIReportValue(value, fallback);

  const text = value.trim();
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return humanizeAIReportValue(parsed, fallback);
  } catch {
    // Keep the original sentence and apply the safe text substitutions below.
  }

  return replaceUnknownCodes(replaceKnownCodes(humanizePermissionAndRoute(humanizePathAssignment(text))))
    .replace(/\s{2,}/g, ' ')
    .trim();
};

export const humanizeAIReportValue = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return humanizeAIReportText(value, fallback);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => humanizeAIReportValue(item)).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, nestedValue]) => {
        if (HIDDEN_DISPLAY_KEYS.has(normalizeCode(key).replace(/[-_]/g, ''))) return [];
        const label = translateAIReportCode(key, 'Dato');
        const normalizedKey = normalizeCode(key);
        const readableValue = ['deadstocktotaltiedcapital', 'totalwasteloss'].includes(normalizedKey)
          ? formatBusinessCurrency(nestedValue)
          : humanizeAIReportValue(nestedValue);
        return readableValue ? [`${label}: ${readableValue}`] : [];
      })
      .join('\n');
  }
  return fallback;
};

export const getCollectionLabel = (path = []) => {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  const mapped = [...keys].reverse().map(key => getMappedLabel(key)).find(Boolean);
  return mapped || (keys.length > 0 ? keys.map(key => translateAIReportCode(key)).join(' / ') : 'Cobertura general');
};

export const getProviderModelLabel = (metadata = {}) => {
  const provider = metadata?.provider;
  const model = metadata?.model;
  if (normalizeCode(provider) === 'openai-compatible' || normalizeCode(model).includes('deepseek')) return 'DeepSeek';
  if (model) return humanizeAIReportText(model);
  if (provider) return getToolReferenceLabel(provider, 'Modelo no especificado');
  return '';
};

export const getResponseTimeLabel = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return humanizeAIReportText(value);
  return `${numeric.toLocaleString('es-MX')} ms`;
};

export const AI_REPORT_LABELS = Object.freeze({ ...CODE_LABELS });

export default AI_REPORT_LABELS;
