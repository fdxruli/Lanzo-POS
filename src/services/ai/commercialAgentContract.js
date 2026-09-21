export const COMMERCIAL_AGENT_KEYS = Object.freeze({
  SALES_PROFITABILITY: 'salesProfitability',
  ECOMMERCE: 'ecommerce'
});

export const COMMERCIAL_AGENT_INTENTS = Object.freeze([
  'explain_change',
  'product_risk',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity',
  'store_health',
  'order_funnel',
  'catalog_health'
]);

export const COMMERCIAL_AGENT_RESPONSE_VERSION = 1;
export const FEATURE_NOT_READY = 'FEATURE_NOT_READY';

const VALID_AGENT_KEYS = new Set(Object.values(COMMERCIAL_AGENT_KEYS));
const VALID_INTENTS = new Set(COMMERCIAL_AGENT_INTENTS);
const VALID_RESPONSE_STATUSES = new Set(['completed', 'incomplete', 'not_ready', 'error']);
const VALID_SOURCES = new Set(['cloud', 'local', 'mixed']);
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
  threadId: request.threadId === null || request.threadId === undefined
    ? null
    : String(request.threadId).trim() || null,
  period: isRecord(request.period) ? { ...request.period } : null,
  scope: isRecord(request.scope) ? { ...request.scope } : null,
  requestedAction: request.requestedAction === null || request.requestedAction === undefined
    ? null
    : (typeof request.requestedAction === 'string' ? request.requestedAction.trim() : request.requestedAction)
});

export const validateCommercialAgentRequest = (request = {}) => {
  const normalized = normalizeCommercialAgentRequest(request);

  if (!isCommercialAgentKey(normalized.agentKey)) return invalid('INVALID_AGENT_KEY', { request: normalized });
  if (!isCommercialAgentIntent(normalized.intent)) return invalid('INVALID_INTENT', { request: normalized });
  if (!normalized.question) return invalid('QUESTION_REQUIRED', { request: normalized });
  if (hasForbiddenContent(normalized.question)) return invalid('UNSAFE_QUESTION', { request: normalized });
  if (normalized.requestedAction !== null && typeof normalized.requestedAction !== 'string') {
    return invalid('INVALID_REQUESTED_ACTION', { request: normalized });
  }
  if (hasForbiddenContent(normalized.period) || hasForbiddenContent(normalized.scope)) {
    return invalid('UNSAFE_CONTEXT', { request: normalized });
  }

  return { valid: true, request: normalized };
};

export const createFeatureNotReadyResponse = ({ agentKey, intent } = {}) => ({
  version: COMMERCIAL_AGENT_RESPONSE_VERSION,
  agentKey,
  status: 'not_ready',
  answer: 'Esta capacidad se preparará en una siguiente fase.',
  facts: [],
  calculations: [],
  assumptions: [],
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
  if (typeof response.answer !== 'string') return invalid('ANSWER_REQUIRED');
  if (!VALID_SOURCES.has(response.source)) return invalid('INVALID_RESPONSE_SOURCE');
  if (!isRecord(response.coverage)) return invalid('COVERAGE_OBJECT_REQUIRED');

  for (const field of ARRAY_RESPONSE_FIELDS) {
    if (!Array.isArray(response[field])) return invalid('RESPONSE_ARRAY_REQUIRED', { field });
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
