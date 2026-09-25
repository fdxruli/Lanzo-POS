export const COMMERCIAL_AGENT_KEYS = Object.freeze({
  SALES_PROFITABILITY: 'salesProfitability',
  ECOMMERCE: 'ecommerce'
});

export const COMMERCIAL_AGENT_INTENTS = Object.freeze([
  'profitability_summary',
  'explain_change',
  'product_risk',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity',
  'store_health',
  'order_funnel',
  'catalog_health'
]);

export const SALES_PROFITABILITY_AGENT_INTENTS = Object.freeze([
  'profitability_summary',
  'explain_change',
  'product_risk',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity'
]);

export const COMMERCIAL_AGENT_RESPONSE_VERSION = 1;
export const FEATURE_NOT_READY = 'FEATURE_NOT_READY';

const VALID_AGENT_KEYS = new Set(Object.values(COMMERCIAL_AGENT_KEYS));
const VALID_INTENTS = new Set(COMMERCIAL_AGENT_INTENTS);
const VALID_RESPONSE_STATUSES = new Set(['completed', 'incomplete', 'insufficient_data', 'out_of_scope', 'not_ready', 'error']);
const VALID_SOURCES = new Set(['cloud', 'local', 'mixed']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const ARRAY_RESPONSE_FIELDS = [
  'facts',
  'calculations',
  'assumptions',
  'limitations',
  'recommendations',
  'actionDrafts',
  'citations'
];

const FORBIDDEN_CONTENT_PATTERNS = [
  /<\/?[a-z][^>]*>/iu,
  /```/u,
  /\b(?:javascript|data|vbscript):/iu,
  /(?:^|[\s;(])(?:select|insert|update|delete|drop|alter|truncate|create|grant|revoke)\s+/iu,
  /(?:^|[\s;(])(?:import|export|require|function|class|const|let|var|eval|exec)\s*[({=]/imu
];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const SCENARIO_KEYS_BY_INTENT = Object.freeze({
  price_simulation: Object.freeze(['productName', 'newPrice', 'historicalVolume']),
  promotion_opportunity: Object.freeze(['productName', 'promotionalPrice', 'discountPercent', 'historicalVolume']),
  combo_opportunity: Object.freeze([]),
  profitability_summary: Object.freeze([]),
  product_risk: Object.freeze([]),
  explain_change: Object.freeze([])
});

const OUT_OF_SCOPE_MESSAGES = Object.freeze({
  identity: 'Soy el asistente de Ventas y Rentabilidad de Lanzo POS. Puedo ayudarte con rentabilidad, márgenes, productos problemáticos, precios, promociones y combos.',
  module: 'Esta consulta corresponde al módulo de Diagnósticos Operativos. Desde aquí puedo ayudarte únicamente con ventas y rentabilidad.',
  greeting: 'Puedo ayudarte a analizar ventas y rentabilidad de tu negocio. Prueba con una de las preguntas sugeridas.',
  unrelated: 'Puedo ayudarte a analizar ventas y rentabilidad de tu negocio. Prueba con una de las preguntas sugeridas.'
});

const normalizedQuestion = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[¿?¡!.,;:()[\]{}]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const scenarioHasValue = (value) => value !== undefined
  && value !== null
  && !(typeof value === 'string' && value.trim() === '');

const scenarioError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const normalizeScenarioNumber = (value, { minimum = null, maximum = null, positive = false } = {}) => {
  if (!scenarioHasValue(value)) return undefined;
  if (typeof value === 'boolean' || (typeof value !== 'number' && typeof value !== 'string')) {
    throw scenarioError('INVALID_SCENARIO_NUMBER');
  }
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) throw scenarioError('INVALID_SCENARIO_NUMBER');
  if (positive && numeric <= 0) throw scenarioError('SCENARIO_VALUE_MUST_BE_POSITIVE');
  if (minimum !== null && numeric < minimum) throw scenarioError('SCENARIO_VALUE_OUT_OF_RANGE');
  if (maximum !== null && numeric > maximum) throw scenarioError('SCENARIO_VALUE_OUT_OF_RANGE');
  return numeric;
};

const normalizeScenarioProductName = (value) => {
  if (!scenarioHasValue(value)) return undefined;
  if (typeof value !== 'string') throw scenarioError('INVALID_SCENARIO_PRODUCT');
  const productName = value.trim();
  if (!productName) return undefined;
  if (productName.length > 120) throw scenarioError('INVALID_SCENARIO_PRODUCT');
  return productName;
};

export const normalizeScenarioForIntent = (intent, scenario = {}) => {
  if (intent !== 'price_simulation' && intent !== 'promotion_opportunity') return {};

  if (!isRecord(scenario)) throw scenarioError('INVALID_SCENARIO');
  const source = scenario;
  const normalized = {};
  const productName = normalizeScenarioProductName(source.productName);

  if (productName) normalized.productName = productName;

  if (intent === 'price_simulation') {
    const newPrice = normalizeScenarioNumber(source.newPrice, { positive: true });
    const historicalVolume = normalizeScenarioNumber(source.historicalVolume, { minimum: 0 });
    if (newPrice !== undefined) normalized.newPrice = newPrice;
    if (historicalVolume !== undefined) normalized.historicalVolume = historicalVolume;
    return normalized;
  }

  if (intent === 'promotion_opportunity') {
    const hasPromotionalPrice = scenarioHasValue(source.promotionalPrice);
    const hasDiscountPercent = scenarioHasValue(source.discountPercent);
    if (hasPromotionalPrice && hasDiscountPercent) throw scenarioError('PROMOTION_SCENARIO_AMBIGUOUS');
    const promotionalPrice = normalizeScenarioNumber(source.promotionalPrice, { positive: true });
    const discountPercent = normalizeScenarioNumber(source.discountPercent, { minimum: 0, maximum: 100 });
    const historicalVolume = normalizeScenarioNumber(source.historicalVolume, { minimum: 0 });
    if (promotionalPrice !== undefined) normalized.promotionalPrice = promotionalPrice;
    if (discountPercent !== undefined) normalized.discountPercent = discountPercent;
    if (historicalVolume !== undefined) normalized.historicalVolume = historicalVolume;
    return normalized;
  }

  return {};
};

export const validateCommercialAgentScenario = (intent, scenario = {}) => {
  if (!isRecord(scenario)) return invalid('INVALID_SCENARIO');
  const allowedKeys = new Set(SCENARIO_KEYS_BY_INTENT[intent] || []);
  if (!Object.keys(scenario).every((key) => allowedKeys.has(key))) return invalid('INVALID_SCENARIO_KEYS');

  if (Object.prototype.hasOwnProperty.call(scenario, 'productName')) {
    if (typeof scenario.productName !== 'string' || !scenario.productName.trim() || scenario.productName.length > 120) {
      return invalid('INVALID_SCENARIO_PRODUCT');
    }
  }

  const numericFields = ['newPrice', 'promotionalPrice', 'historicalVolume', 'discountPercent'];
  for (const key of numericFields) {
    if (!Object.prototype.hasOwnProperty.call(scenario, key)) continue;
    const value = scenario[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('INVALID_SCENARIO_NUMBER');
    if (['newPrice', 'promotionalPrice'].includes(key) && value <= 0) return invalid('SCENARIO_VALUE_MUST_BE_POSITIVE');
    if (key === 'historicalVolume' && value < 0) return invalid('SCENARIO_VALUE_OUT_OF_RANGE');
    if (key === 'discountPercent' && (value < 0 || value > 100)) return invalid('SCENARIO_VALUE_OUT_OF_RANGE');
  }

  if (intent === 'promotion_opportunity'
    && Object.prototype.hasOwnProperty.call(scenario, 'promotionalPrice')
    && Object.prototype.hasOwnProperty.call(scenario, 'discountPercent')) {
    return invalid('PROMOTION_SCENARIO_AMBIGUOUS');
  }

  return { valid: true, scenario };
};

export const resolveCommercialIntent = (question = '') => {
  const text = normalizedQuestion(question);
  if (!text) return { kind: 'out_of_scope', reason: 'unrelated' };

  if (/\b(?:como te llamas|cual es tu nombre|quien eres|que puedes hacer|que sabes hacer|para que sirves)\b/u.test(text)) {
    return { kind: 'out_of_scope', reason: 'identity' };
  }
  if (/^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|que tal|saludos)$/u.test(text)) {
    return { kind: 'out_of_scope', reason: 'greeting' };
  }
  if (/\b(?:inventario|stock|existencias|clientes?|ecommerce|tienda en linea|pedidos?|catalogo)\b/u.test(text)) {
    return { kind: 'out_of_scope', reason: 'module' };
  }
  if (/\b(?:clima|tiempo hace|politic|presidente|receta|cocinar|cocina|futbol|deporte|musica|pelicula)\b/u.test(text)) {
    return { kind: 'out_of_scope', reason: 'unrelated' };
  }

  if (/\b(?:combo|combos|juntos|juntas|combinacion|combinaciones|compran juntos|tickets compartidos)\b/u.test(text)) {
    return { kind: 'supported', intent: 'combo_opportunity' };
  }
  if (/\b(?:promocion|promociones|descuento|descuentos|oferta|ofertas|rebaja|rebajas)\b/u.test(text)) {
    return { kind: 'supported', intent: 'promotion_opportunity' };
  }
  if (/\b(?:precio|precios|subir precio|subo el precio|aumentar precio|aumento el precio|ajustar precio)\b/u.test(text)) {
    return { kind: 'supported', intent: 'price_simulation' };
  }
  if (/\b(?:problematico|problematicos|problema|problemas|afectando|bajo margen|margen negativo|productos malos)\b/u.test(text)) {
    return { kind: 'supported', intent: 'product_risk' };
  }
  if (/(?:por que|porque|explica|cambio|cambio mi|cambio el|subio|bajo|variacion|comparar|periodo anterior).*(?:margen|utilidad|ganancia|rentabilidad|ventas)?/u.test(text)
    && /\b(?:margen|utilidad|ganancia|rentabilidad|ventas|costo|costos)\b/u.test(text)) {
    return { kind: 'supported', intent: 'explain_change' };
  }
  if (/\b(?:rentable|rentabilidad|utilidad|utilidades|ganancia|ganancias|gano|pierdo|perdida|perdidas|ventas|venta|vendimos|vendi|ingresos|facturacion|margen|negocio)\b/u.test(text)) {
    return { kind: 'supported', intent: 'profitability_summary' };
  }

  return { kind: 'out_of_scope', reason: 'unrelated' };
};

export const getOutOfScopeMessage = (reason) => OUT_OF_SCOPE_MESSAGES[reason] || OUT_OF_SCOPE_MESSAGES.unrelated;

export const createOutOfScopeResponse = ({ reason = 'unrelated' } = {}) => {
  const message = getOutOfScopeMessage(reason);
  return {
    version: COMMERCIAL_AGENT_RESPONSE_VERSION,
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    intent: null,
    status: 'out_of_scope',
    executiveSummary: message,
    answer: message,
    explanation: message,
    facts: [],
    calculations: [],
    assumptions: [],
    scenarios: [],
    recommendations: [],
    limitations: ['OUT_OF_SCOPE_NO_DATA_ACCESS'],
    confidence: 'high',
    source: 'local',
    coverage: { ready: false, complete: false, validSales: 0, outOfScope: true, reason },
    citations: [],
    actionDrafts: []
  };
};

const hasForbiddenContent = (value, seen = new Set()) => {
  if (typeof value === 'string') {
    return FORBIDDEN_CONTENT_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) return value.some((item) => hasForbiddenContent(item, seen));
  return Object.values(value).some((item) => hasForbiddenContent(item, seen));
};

const invalid = (code, details = {}) => ({
  valid: false,
  code,
  ...details
});

const valid = (response) => ({
  valid: true,
  response,
  ready: response.status === 'completed',
  notReady: response.status === 'not_ready'
});

export const isCommercialAgentKey = (value) => VALID_AGENT_KEYS.has(value);

export const isCommercialAgentIntent = (value) => VALID_INTENTS.has(value);

export const normalizeCommercialAgentRequest = (request = {}) => ({
  agentKey: typeof request.agentKey === 'string' ? request.agentKey.trim() : '',
  intent: typeof request.intent === 'string' ? request.intent.trim() : '',
  question: typeof request.question === 'string' ? request.question.trim() : '',
  requestKey: request.requestKey === null || request.requestKey === undefined
    ? null
    : (typeof request.requestKey === 'string' ? request.requestKey.trim() : request.requestKey),
  threadId: request.threadId === null || request.threadId === undefined
    ? null
    : String(request.threadId).trim() || null,
  period: isRecord(request.period) ? { ...request.period } : null,
  scope: isRecord(request.scope) ? { ...request.scope } : null,
  scenario: isRecord(request.scenario) ? { ...request.scenario } : {},
  context: isRecord(request.context) ? { ...request.context } : null,
  requestedAction: request.requestedAction === null || request.requestedAction === undefined
    ? null
    : (typeof request.requestedAction === 'string' ? request.requestedAction.trim() : request.requestedAction)
});

export const validateCommercialAgentRequest = (request = {}) => {
  const normalized = normalizeCommercialAgentRequest(request);

  if (!isCommercialAgentKey(normalized.agentKey)) return invalid('INVALID_AGENT_KEY', { request: normalized });
  if (!isCommercialAgentIntent(normalized.intent)) return invalid('INVALID_INTENT', { request: normalized });
  if (!normalized.question) return invalid('QUESTION_REQUIRED', { request: normalized });
  if (normalized.question.length > 1200) return invalid('QUESTION_TOO_LARGE', { request: normalized });
  if (hasForbiddenContent(normalized.question)) return invalid('UNSAFE_QUESTION', { request: normalized });
  if (normalized.requestKey !== null && (typeof normalized.requestKey !== 'string' || normalized.requestKey.length > 128)) {
    return invalid('INVALID_REQUEST_KEY', { request: normalized });
  }
  if (normalized.requestedAction !== null && typeof normalized.requestedAction !== 'string') {
    return invalid('INVALID_REQUESTED_ACTION', { request: normalized });
  }
  const scenarioValidation = validateCommercialAgentScenario(normalized.intent, normalized.scenario);
  if (!scenarioValidation.valid) return invalid(scenarioValidation.code, { request: normalized });
  if (hasForbiddenContent(normalized.period) || hasForbiddenContent(normalized.scope) || hasForbiddenContent(normalized.scenario) || hasForbiddenContent(normalized.context)) {
    return invalid('UNSAFE_CONTEXT', { request: normalized });
  }

  return { valid: true, request: normalized };
};

export const createFeatureNotReadyResponse = ({ agentKey, intent } = {}) => ({
  version: COMMERCIAL_AGENT_RESPONSE_VERSION,
  agentKey,
  status: 'not_ready',
  executiveSummary: 'Esta capacidad todavía no está disponible.',
  answer: 'Esta capacidad se preparará en una siguiente fase.',
  explanation: '',
  facts: [],
  calculations: [],
  assumptions: [],
  scenarios: [],
  limitations: [FEATURE_NOT_READY],
  recommendations: [],
  actionDrafts: [],
  source: 'local',
  coverage: {
    ready: false,
    reason: FEATURE_NOT_READY,
    intent
  },
  citations: []
});

export const validateCommercialAgentResponse = (response, { expectedAgentKey = null } = {}) => {
  if (!isRecord(response)) return invalid('RESPONSE_OBJECT_REQUIRED');
  if (response.version !== COMMERCIAL_AGENT_RESPONSE_VERSION) return invalid('UNSUPPORTED_RESPONSE_VERSION');
  if (!isCommercialAgentKey(response.agentKey)) return invalid('INVALID_AGENT_KEY');
  if (expectedAgentKey && response.agentKey !== expectedAgentKey) return invalid('AGENT_KEY_MISMATCH');
  if (!VALID_RESPONSE_STATUSES.has(response.status)) return invalid('INVALID_RESPONSE_STATUS');
  if (typeof response.answer !== 'string' && typeof response.executiveSummary !== 'string') {
    return invalid('EXECUTIVE_SUMMARY_REQUIRED');
  }
  if (!VALID_SOURCES.has(response.source)) return invalid('INVALID_RESPONSE_SOURCE');
  if (!isRecord(response.coverage)) return invalid('COVERAGE_OBJECT_REQUIRED');
  if (response.confidence !== undefined && !VALID_CONFIDENCE.has(response.confidence)) {
    return invalid('INVALID_CONFIDENCE');
  }

  for (const field of ARRAY_RESPONSE_FIELDS) {
    if (!Array.isArray(response[field])) return invalid('RESPONSE_ARRAY_REQUIRED', { field });
  }
  if (response.scenarios !== undefined && !Array.isArray(response.scenarios)) {
    return invalid('RESPONSE_ARRAY_REQUIRED', { field: 'scenarios' });
  }

  for (const item of response.calculations) {
    if (!isRecord(item)
      || typeof item.label !== 'string'
      || !Object.prototype.hasOwnProperty.call(item, 'value')
      || typeof item.formattedValue !== 'string'
      || typeof item.formula !== 'string'
      || typeof item.source !== 'string'
      || !isRecord(item.period)) {
      return invalid('CALCULATION_CONTRACT_INVALID');
    }
  }

  for (const item of response.recommendations) {
    const legacyRecommendation = isRecord(item)
      && typeof item.effort === 'string'
      && Array.isArray(item.evidence);
    const narrativeRecommendation = isRecord(item)
      && ['high', 'medium', 'low'].includes(String(item.priority))
      && Array.isArray(item.evidenceKeys);
    if (!isRecord(item)
      || typeof item.title !== 'string'
      || typeof item.explanation !== 'string'
      || typeof item.expectedImpact !== 'string'
      || (!legacyRecommendation && !narrativeRecommendation)
      || item.requiresConfirmation !== true) {
      return invalid('RECOMMENDATION_CONTRACT_INVALID');
    }
  }

  if (response.actionDrafts.length > 0) return invalid('ACTION_DRAFTS_NOT_ALLOWED');
  if (hasForbiddenContent(response)) return invalid('UNSAFE_RESPONSE_CONTENT');

  return valid(response);
};

export const parseCommercialAgentResponse = (rawResponse, options = {}) => {
  if (typeof rawResponse !== 'string' || !rawResponse.trim()) return invalid('MALFORMED_JSON');

  let parsed;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return invalid('MALFORMED_JSON');
  }

  return validateCommercialAgentResponse(parsed, options);
};

/**
 * Phase 2 deliberately resolves every future commercial capability to an
 * explicit not-ready contract. It never invokes a provider or reserves quota.
 */
export const resolveCommercialAgentRequest = (request = {}) => {
  const validation = validateCommercialAgentRequest(request);
  if (!validation.valid) return validation;

  const response = createFeatureNotReadyResponse(validation.request);
  return {
    valid: true,
    status: FEATURE_NOT_READY,
    response: valid(response)
  };
};
