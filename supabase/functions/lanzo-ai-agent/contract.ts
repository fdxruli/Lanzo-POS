export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_SYSTEM_PROMPT_CHARS = 32_000;
export const MAX_USER_PROMPT_CHARS = 96_000;
export const MAX_TOTAL_PROMPT_CHARS = 128_000;
export const MAX_COMMERCIAL_CONTEXT_BYTES = 96 * 1024;
export const MAX_COMMERCIAL_ROWS = 24;

export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_MAX_TOKENS = 2048;
export const MAX_MAX_TOKENS = 4096;

export const AGENT_TYPES = [
  'salesProfitability',
  'inventoryAuditor',
  'financialAnalyst',
  'customerStrategist',
  'unknown'
] as const;

export const COMMERCIAL_NARRATIVE_DIAGNOSTIC_CODES = [
  'AI_NARRATIVE_EMPTY',
  'AI_NARRATIVE_INVALID_JSON',
  'AI_NARRATIVE_MISSING_CONTENT',
  'AI_NARRATIVE_UNSAFE_CONTENT',
  'AI_NARRATIVE_TRUNCATED',
  'AI_NARRATIVE_PARTIAL_CONTENT',
  'AI_NARRATIVE_PROVIDER_ERROR',
  'AI_NARRATIVE_LOW_VALUE',
  'AI_NARRATIVE_UNAVAILABLE'
] as const;

export type CommercialNarrativeDiagnosticCode = typeof COMMERCIAL_NARRATIVE_DIAGNOSTIC_CODES[number];

export function isCommercialNarrativeDiagnosticCode(value: unknown): value is CommercialNarrativeDiagnosticCode {
  return typeof value === 'string'
    && (COMMERCIAL_NARRATIVE_DIAGNOSTIC_CODES as readonly string[]).includes(value);
}

export type AgentType = typeof AGENT_TYPES[number];

export type AuthPayload = {
  licenseKey: string;
  deviceFingerprint: string;
  deviceSecurityToken: string;
  staffSessionToken: string | null;
};

export type AnalysisOptions = {
  temperature: number;
  maxTokens: number;
};

export type UsageRequest = {
  kind: 'usage';
  auth: AuthPayload;
};

export type AnalysisRequest = {
  kind: 'analysis';
  auth: AuthPayload;
  agentType: AgentType;
  systemPrompt: string;
  userPrompt: string;
  options: AnalysisOptions;
};

export const COMMERCIAL_AGENT_KEYS = ['salesProfitability'] as const;
export const COMMERCIAL_AGENT_INTENTS = [
  'profitability_summary',
  'explain_change',
  'product_risk',
  'sales_growth',
  'ticket_growth',
  'product_opportunity',
  'sales_trend',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity'
] as const;

export type CommercialAnalysisRequest = {
  kind: 'commercialAnalysis';
  auth: AuthPayload;
  agentKey: typeof COMMERCIAL_AGENT_KEYS[number];
  intent: typeof COMMERCIAL_AGENT_INTENTS[number];
  question: string;
  requestKey: string | null;
  period: Record<string, unknown>;
  scenario: Record<string, unknown>;
  context: Record<string, unknown>;
  options: AnalysisOptions;
};

export type ValidatedRequest = UsageRequest | AnalysisRequest | CommercialAnalysisRequest;

export type ValidationFailure = {
  ok: false;
  code: 'AUTH_PAYLOAD_REQUIRED' | 'PROMPT_TOO_LARGE' | 'INVALID_REQUEST';
  message: string;
  status: number;
};

export type ValidationResult =
  | { ok: true; request: ValidatedRequest }
  | ValidationFailure;

const FORBIDDEN_KEYS = new Set([
  'AI_API_KEY',
  'AI_API_URL',
  'AI_MODEL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'rpc',
  'rpcName',
  'rpc_name',
  'providerUrl',
  'provider_url',
  'providerHeaders',
  'provider_headers',
  'deployment'
]);

const COMMERCIAL_TOP_LEVEL_KEYS = new Set([
  'auth',
  'agentKey',
  'intent',
  'question',
  'requestKey',
  'period',
  'scenario',
  'context',
  'options'
]);

const COMMERCIAL_PERIOD_KEYS = new Set(['from', 'to', 'previousFrom', 'previousTo', 'timezone', 'label']);
const COMMERCIAL_SCENARIO_KEYS = new Set([
  'productName',
  'newPrice',
  'historicalVolume',
  'discountPercent',
  'promotionalPrice'
]);
const COMMERCIAL_CONTEXT_KEYS = new Set(['agentKey', 'scope', 'period', 'source', 'sales']);
const COMMERCIAL_SALES_KEYS = new Set([
  'summary',
  'netSales',
  'grossSales',
  'discounts',
  'unitCosts',
  'profit',
  'margin',
  'averageTicket',
  'unitsPerTicket',
  'products',
  'channels',
  'comparison',
  'growthSignals',
  'contributors',
  'evidenceKeys',
  'coverage',
  'calculations',
  'assumptions',
  'limitations',
  'scenarios',
  'opportunityCandidates',
  'minimumUsefulRecommendations'
]);
const COMMERCIAL_SUMMARY_KEYS = new Set([
  'netSales',
  'units',
  'salesCount',
  'averageTicket',
  'unitsPerTicket',
  'discounts',
  'discountsKnown',
  'unitCosts',
  'knownCostOfSale',
  'profit',
  'margin',
  'costCoverage',
  'missingCostProducts',
  'excludedSales',
  'ecommerceDuplicates',
  'profitabilityStatus',
  'profitabilityExplanation'
]);
const COMMERCIAL_PRODUCT_KEYS = new Set([
  'name', 'quantity', 'netSales', 'salesShare', 'unitCost', 'profit', 'margin', 'averagePrice', 'costKnown',
  'costStatus', 'costSource', 'riskType', 'riskReason'
]);
const COMMERCIAL_PRODUCT_COST_STATUS = new Set(['definitive', 'estimated', 'incomplete']);
const COMMERCIAL_PRODUCT_COST_SOURCE = new Set(['inventory_movement', 'sale_item_snapshot', 'missing']);
const MAX_PRODUCT_COST_STATUS_LENGTH = 48;
const MAX_PRODUCT_COST_SOURCE_LENGTH = 64;
const COMMERCIAL_CHANNEL_KEYS = new Set(['channel', 'netSales', 'orders', 'units', 'averageTicket', 'share']);
const COMMERCIAL_COMPARISON_KEYS = new Set([
  'currentSalesCount',
  'previousSalesCount',
  'deltaSalesCount',
  'previousNetSales',
  'previousUnits',
  'previousTicket',
  'previousUnitsPerTicket',
  'previousCost',
  'previousProfit',
  'previousMargin',
  'deltaNetSales',
  'deltaNetSalesPercent',
  'deltaUnits',
  'deltaTicket',
  'deltaTicketPercent',
  'deltaUnitsPerTicket',
  'deltaCost',
  'deltaProfit',
  'deltaMargin',
  'deltaMarginRelative',
  'deltaDiscounts',
  'productMixChanges',
  'channelMixChanges',
  'productChanges'
]);
const COMMERCIAL_MIX_KEYS = new Set(['name', 'channel', 'currentShare', 'previousShare', 'deltaShare']);
const COMMERCIAL_PRODUCT_CHANGE_KEYS = new Set([
  'name', 'currentSales', 'previousSales', 'salesDelta', 'salesDeltaPercent',
  'currentUnits', 'previousUnits', 'unitsDelta', 'unitsDeltaPercent',
  'currentShare', 'previousShare', 'salesShareDelta', 'currentMargin',
  'previousMargin', 'currentProfit', 'previousProfit', 'costKnown', 'costStatus',
  'direction', 'signals'
]);
const COMMERCIAL_PRODUCT_DIRECTIONS = new Set(['new_in_period', 'not_sold_current', 'growing', 'declining', 'stable']);
const COMMERCIAL_PRODUCT_SIGNALS = new Set([
  'new_in_period', 'not_sold_current', 'growing', 'declining', 'stable',
  'high_sales_share', 'healthy_margin', 'cost_unknown', 'low_margin'
]);
const COMMERCIAL_CHANNEL_CHANGE_KEYS = new Set([
  'channel', 'currentShare', 'previousShare', 'deltaShare', 'currentSales', 'previousSales', 'salesDelta'
]);
const COMMERCIAL_GROWTH_SIGNAL_KEYS = new Set([
  'currentNetSales', 'currentSalesCount', 'currentUnits', 'currentAverageTicket',
  'currentUnitsPerTicket', 'previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent',
  'previousSalesCount', 'deltaSalesCount', 'previousUnits', 'deltaUnits',
  'previousAverageTicket', 'deltaTicket', 'deltaTicketPercent',
  'previousUnitsPerTicket', 'deltaUnitsPerTicket', 'productsGrowing', 'productsDeclining',
  'productOpportunities', 'channels', 'channelChanges', 'comparisonAvailable'
]);
const COMMERCIAL_OPPORTUNITY_TYPES = new Set(['product', 'channel', 'ticket', 'units_per_ticket', 'tickets', 'general']);
const COMMERCIAL_OPPORTUNITY_SIGNALS = new Set([
  'high_sales_share', 'growing', 'healthy_margin', 'new_in_period', 'ticket_increased',
  'ticket_baseline_available', 'units_per_ticket_increased', 'units_per_ticket_baseline_available',
  'tickets_increased', 'ticket_count_baseline_available', 'channel_sales_disappeared',
  'channel_sales_increased', 'channel_change_to_check'
]);
const COMMERCIAL_RECOMMENDATION_TYPES = new Set(['growth_experiment', 'investigation', 'data_quality', 'optimization']);
const COMMERCIAL_OPPORTUNITY_METRIC_KEYS = new Set([
  'currentSales', 'currentShare', 'salesDelta', 'currentUnits', 'costKnown',
  'currentAverageTicket', 'deltaTicket', 'currentUnitsPerTicket', 'deltaUnitsPerTicket',
  'currentSalesCount', 'deltaSalesCount', 'previousSales', 'previousShare', 'deltaShare'
]);
const COMMERCIAL_CONTRIBUTOR_KEYS = new Set(['key', 'title', 'contribution', 'direction', 'explanation', 'evidenceKeys']);
const COMMERCIAL_CALCULATION_KEYS = new Set(['label', 'value', 'formattedValue', 'formula', 'source', 'period']);
const COMMERCIAL_SCENARIO_OUTPUT_KEYS = new Set([
  'label',
  'volume',
  'utility',
  'margin',
  'impactVsCurrent',
  'tickets',
  'frequency',
  'ticketPercentage',
  'comboPrice',
  'discount',
  'products',
  'note',
  'isPrediction',
  'currentPrice',
  'newPrice',
  'unitCost',
  'historicalJointSales',
  'averageJointSale',
  'cost',
  'profit',
  'evidenceLevel',
  'confidence',
  'costCoverage',
  'costStatus',
  'opportunity',
  'historicalVolume',
  'breakEvenVolume',
  'isDemandPrediction'
]);

const COMMERCIAL_SCENARIO_TEXT_KEYS = new Set(['label', 'note', 'opportunity']);
const COMMERCIAL_SCENARIO_BOOLEAN_KEYS = new Set(['isPrediction', 'isDemandPrediction']);
const COMMERCIAL_SCENARIO_NUMBER_KEYS = new Set([
  'volume',
  'utility',
  'margin',
  'impactVsCurrent',
  'tickets',
  'frequency',
  'ticketPercentage',
  'comboPrice',
  'discount',
  'currentPrice',
  'newPrice',
  'unitCost',
  'historicalJointSales',
  'averageJointSale',
  'cost',
  'profit',
  'costCoverage',
  'historicalVolume',
  'breakEvenVolume'
]);
const COMMERCIAL_SCENARIO_RATIO_KEYS = new Set(['frequency', 'ticketPercentage', 'costCoverage']);
const COMMERCIAL_SCENARIO_CONFIDENCE = new Set(['high', 'medium', 'low']);
const COMMERCIAL_SCENARIO_COST_STATUS = new Set(['complete', 'incomplete']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cleanString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const hasForbiddenKey = (value: unknown, depth = 0): boolean => {
  if (depth > 2 || !isRecord(value)) return false;

  return Object.entries(value).some(([key, child]) => (
    FORBIDDEN_KEYS.has(key) || hasForbiddenKey(child, depth + 1)
  ));
};

function invalid(message: string): ValidationFailure {
  return { ok: false, code: 'INVALID_REQUEST', message, status: 400 };
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validFiniteOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function validOptionalEnum(
  value: unknown,
  allowed: Set<string>,
  maxLength: number
): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.length <= maxLength && allowed.has(value));
}

function validCommercialScenarioOutput(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !assertOnlyKeys(value, COMMERCIAL_SCENARIO_OUTPUT_KEYS)) return false;

  return Object.entries(value).every(([key, entry]) => {
    if (key === 'products') {
      return Array.isArray(entry)
        && entry.length > 0
        && entry.length <= 4
        && entry.every((product) => typeof product === 'string' && product.trim().length > 0 && product.length <= 120);
    }

    if (key === 'confidence' || key === 'evidenceLevel') {
      return typeof entry === 'string' && COMMERCIAL_SCENARIO_CONFIDENCE.has(entry);
    }

    if (key === 'costStatus') {
      return typeof entry === 'string' && COMMERCIAL_SCENARIO_COST_STATUS.has(entry);
    }

    if (COMMERCIAL_SCENARIO_BOOLEAN_KEYS.has(key)) return typeof entry === 'boolean';

    if (COMMERCIAL_SCENARIO_TEXT_KEYS.has(key)) {
      return typeof entry === 'string' && entry.length > 0 && entry.length <= 480;
    }

    if (!COMMERCIAL_SCENARIO_NUMBER_KEYS.has(key)) return false;
    if (entry === null) return true;
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return false;
    if (key === 'tickets') return Number.isInteger(entry) && entry >= 0;
    if (COMMERCIAL_SCENARIO_RATIO_KEYS.has(key)) return entry >= 0 && entry <= 1;
    return true;
  });
}

function validCommercialPeriod(value: unknown, intent = 'explain_change'): value is Record<string, unknown> {
  if (!isRecord(value) || !assertOnlyKeys(value, COMMERCIAL_PERIOD_KEYS)) return false;
  const comparableIntent = ['explain_change', 'sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(intent);
  if (!comparableIntent && (value.previousFrom !== null && value.previousFrom !== undefined
    || value.previousTo !== null && value.previousTo !== undefined)) return false;
  return Object.values(value).every((entry) => entry === null || (typeof entry === 'string' && entry.length <= 80));
}

function scenarioKeysForIntent(intent: string): Set<string> {
  if (intent === 'price_simulation') return new Set(['productName', 'newPrice', 'historicalVolume']);
  if (intent === 'promotion_opportunity') return new Set(['productName', 'promotionalPrice', 'discountPercent', 'historicalVolume']);
  return new Set();
}

function validCommercialScenario(value: unknown, intent: string): value is Record<string, unknown> {
  const allowedKeys = scenarioKeysForIntent(intent);
  if (!isRecord(value) || !assertOnlyKeys(value, COMMERCIAL_SCENARIO_KEYS) || !assertOnlyKeys(value, allowedKeys)) return false;
  if (intent === 'promotion_opportunity'
    && value.promotionalPrice !== undefined
    && value.discountPercent !== undefined) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (key === 'productName') return typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 120;
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return false;
    if (key.toLowerCase().includes('volume')) return entry >= 0;
    if (key.toLowerCase().includes('price')) return entry > 0;
    if (key.toLowerCase().includes('discount')) return entry < 0 || entry > 100 ? false : true;
    return true;
  });
}

function validCommercialContext(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !assertOnlyKeys(value, COMMERCIAL_CONTEXT_KEYS)) return false;
  if (value.agentKey !== 'salesProfitability' || value.scope !== 'current_authenticated_tenant') return false;
  if (typeof value.source !== 'string' || !['cloud', 'local', 'mixed'].includes(value.source)) return false;
  if (!validCommercialPeriod(value.period)) return false;
  if (!isRecord(value.sales) || !assertOnlyKeys(value.sales, COMMERCIAL_SALES_KEYS)) return false;

  const sales = value.sales;
  if (!isRecord(sales.summary) || !assertOnlyKeys(sales.summary, COMMERCIAL_SUMMARY_KEYS)) return false;
  if (!Array.isArray(sales.products) || sales.products.length > MAX_COMMERCIAL_ROWS) return false;
  if (!sales.products.every((product) => isRecord(product) && assertOnlyKeys(product, COMMERCIAL_PRODUCT_KEYS)
    && typeof product.name === 'string' && product.name.length <= 120
    && validOptionalEnum(product.costStatus, COMMERCIAL_PRODUCT_COST_STATUS, MAX_PRODUCT_COST_STATUS_LENGTH)
    && validOptionalEnum(product.costSource, COMMERCIAL_PRODUCT_COST_SOURCE, MAX_PRODUCT_COST_SOURCE_LENGTH)
    && Object.entries(product).every(([, entry]) => validFiniteOrNull(entry) || typeof entry === 'string' || typeof entry === 'boolean'))) return false;
  if (!Array.isArray(sales.channels) || sales.channels.length > MAX_COMMERCIAL_ROWS) return false;
  if (!sales.channels.every((channel) => isRecord(channel) && assertOnlyKeys(channel, COMMERCIAL_CHANNEL_KEYS))) return false;
  if (sales.comparison !== null && sales.comparison !== undefined) {
    if (!isRecord(sales.comparison) || !assertOnlyKeys(sales.comparison, COMMERCIAL_COMPARISON_KEYS)) return false;
    const comparison = sales.comparison;
    if (comparison.productMixChanges !== undefined && (!Array.isArray(comparison.productMixChanges) || comparison.productMixChanges.length > 12)) return false;
    if (comparison.channelMixChanges !== undefined && (!Array.isArray(comparison.channelMixChanges) || comparison.channelMixChanges.length > 12)) return false;
    if (comparison.productChanges !== undefined && (!Array.isArray(comparison.productChanges) || comparison.productChanges.length > MAX_COMMERCIAL_ROWS)) return false;
    if (comparison.productChanges !== undefined && !comparison.productChanges.every((product) => (
      isRecord(product)
      && assertOnlyKeys(product, COMMERCIAL_PRODUCT_CHANGE_KEYS)
      && typeof product.name === 'string'
      && COMMERCIAL_PRODUCT_DIRECTIONS.has(String(product.direction))
      && (product.costStatus === null || ['known', 'missing', 'not_sold_current'].includes(String(product.costStatus)))
      && (product.signals === undefined || (Array.isArray(product.signals)
        && product.signals.length <= 8
        && product.signals.every((signal) => typeof signal === 'string' && COMMERCIAL_PRODUCT_SIGNALS.has(signal))))
      && Object.entries(product).every(([key, entry]) => ['name', 'costStatus', 'direction', 'signals'].includes(key)
        || key === 'costKnown' && typeof entry === 'boolean'
        || key !== 'costKnown' && validFiniteOrNull(entry))
    ))) return false;
    for (const mix of comparison.productMixChanges || []) {
      if (!isRecord(mix) || !assertOnlyKeys(mix, COMMERCIAL_MIX_KEYS)) return false;
    }
    if (comparison.channelMixChanges !== undefined && !comparison.channelMixChanges.every((channel) => (
      isRecord(channel) && assertOnlyKeys(channel, COMMERCIAL_CHANNEL_CHANGE_KEYS)
      && typeof channel.channel === 'string'
      && Object.entries(channel).every(([key, entry]) => key === 'channel' ? typeof entry === 'string' : validFiniteOrNull(entry))
    ))) return false;
  }
  if (sales.growthSignals !== undefined && sales.growthSignals !== null) {
    const signals = sales.growthSignals;
    if (!isRecord(signals) || !assertOnlyKeys(signals, COMMERCIAL_GROWTH_SIGNAL_KEYS)) return false;
    for (const key of ['productsGrowing', 'productsDeclining', 'productOpportunities']) {
      if (signals[key] !== undefined && (!Array.isArray(signals[key]) || signals[key].length > MAX_COMMERCIAL_ROWS)) return false;
      if (signals[key] !== undefined && !signals[key].every((product) => (
        isRecord(product) && assertOnlyKeys(product, new Set([...COMMERCIAL_PRODUCT_CHANGE_KEYS, 'opportunityReason']))
        && typeof product.name === 'string'
        && (product.opportunityReason === undefined || (typeof product.opportunityReason === 'string' && product.opportunityReason.length <= 240))
        && Object.entries(product).every(([field, entry]) => ['name', 'costStatus', 'direction', 'signals', 'opportunityReason'].includes(field)
          || field === 'costKnown' && typeof entry === 'boolean'
          || field !== 'costKnown' && validFiniteOrNull(entry))
      ))) return false;
    }
    if (signals.channelChanges !== undefined && (!Array.isArray(signals.channelChanges) || signals.channelChanges.length > 12
      || !signals.channelChanges.every((channel) => isRecord(channel)
        && assertOnlyKeys(channel, COMMERCIAL_CHANNEL_CHANGE_KEYS)
        && typeof channel.channel === 'string'
        && Object.entries(channel).every(([key, entry]) => key === 'channel' ? typeof entry === 'string' : validFiniteOrNull(entry))))) return false;
    if (signals.channels !== undefined && (!Array.isArray(signals.channels) || signals.channels.length > MAX_COMMERCIAL_ROWS
      || !signals.channels.every((channel) => isRecord(channel) && assertOnlyKeys(channel, COMMERCIAL_CHANNEL_KEYS)))) return false;
    if (signals.comparisonAvailable !== undefined && typeof signals.comparisonAvailable !== 'boolean') return false;
    for (const [key, entry] of Object.entries(signals)) {
      if (['productsGrowing', 'productsDeclining', 'productOpportunities', 'channels', 'channelChanges', 'comparisonAvailable'].includes(key)) continue;
      if (!validFiniteOrNull(entry)) return false;
    }
  }
  if (sales.evidenceKeys !== undefined) {
    if (!Array.isArray(sales.evidenceKeys) || sales.evidenceKeys.length > 80) return false;
    if (!sales.evidenceKeys.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 160)) return false;
  }
  if (sales.minimumUsefulRecommendations !== undefined
    && (!Number.isInteger(sales.minimumUsefulRecommendations)
      || Number(sales.minimumUsefulRecommendations) < 0
      || Number(sales.minimumUsefulRecommendations) > 3)) return false;
  if (sales.opportunityCandidates !== undefined) {
    if (!Array.isArray(sales.opportunityCandidates) || sales.opportunityCandidates.length > 8) return false;
    const evidenceKeys = new Set(Array.isArray(sales.evidenceKeys) ? sales.evidenceKeys : []);
    const candidateKeys = new Set<string>();
    if (!sales.opportunityCandidates.every((candidate) => {
      if (!isRecord(candidate)
        || !assertOnlyKeys(candidate, new Set([
          'key', 'type', 'focus', 'entity', 'signal', 'recommendationType', 'strength', 'metrics', 'evidenceKeys'
        ]))
        || typeof candidate.key !== 'string' || candidate.key.length === 0 || candidate.key.length > 160
        || candidateKeys.has(candidate.key)
        || typeof candidate.type !== 'string' || !COMMERCIAL_OPPORTUNITY_TYPES.has(candidate.type)
        || !isRecord(candidate.focus) || !assertOnlyKeys(candidate.focus, new Set(['type', 'key']))
        || candidate.focus.type !== candidate.type
        || typeof candidate.focus.key !== 'string' || candidate.focus.key.length === 0 || candidate.focus.key.length > 120
        || !(candidate.entity === null || (typeof candidate.entity === 'string' && candidate.entity.length <= 120))
        || !Array.isArray(candidate.signal) || candidate.signal.length === 0 || candidate.signal.length > 5
        || !candidate.signal.every((signal) => typeof signal === 'string' && COMMERCIAL_OPPORTUNITY_SIGNALS.has(signal))
        || typeof candidate.recommendationType !== 'string' || !COMMERCIAL_RECOMMENDATION_TYPES.has(candidate.recommendationType)
        || !['strong', 'moderate', 'weak'].includes(String(candidate.strength))
        || !isRecord(candidate.metrics)
        || !Object.entries(candidate.metrics).every(([key, entry]) => COMMERCIAL_OPPORTUNITY_METRIC_KEYS.has(key)
          && (validFiniteOrNull(entry) || typeof entry === 'boolean'))
        || !Array.isArray(candidate.evidenceKeys) || candidate.evidenceKeys.length === 0 || candidate.evidenceKeys.length > 8
        || !candidate.evidenceKeys.every((entry) => typeof entry === 'string' && evidenceKeys.has(entry))) return false;
      if (candidate.type === 'product'
        && (candidate.entity !== candidate.focus.key || !candidate.evidenceKeys.includes(`product:${candidate.entity}`))) return false;
      if (candidate.type === 'channel'
        && (candidate.entity !== candidate.focus.key || !candidate.evidenceKeys.includes(`channel:${candidate.entity}`))) return false;
      candidateKeys.add(candidate.key);
      return true;
    })) return false;
  }
  if (sales.contributors !== undefined) {
    if (!Array.isArray(sales.contributors) || sales.contributors.length > 3) return false;
    if (!sales.contributors.every((item) => isRecord(item)
      && assertOnlyKeys(item, COMMERCIAL_CONTRIBUTOR_KEYS)
      && typeof item.key === 'string'
      && typeof item.title === 'string'
      && validFiniteOrNull(item.contribution)
      && ['positive', 'negative', 'context'].includes(String(item.direction))
      && typeof item.explanation === 'string'
      && Array.isArray(item.evidenceKeys)
      && item.evidenceKeys.every((entry) => typeof entry === 'string'))) return false;
  }
  if (!Array.isArray(sales.calculations) || sales.calculations.length > 40) return false;
  if (!sales.calculations.every((item) => isRecord(item) && assertOnlyKeys(item, COMMERCIAL_CALCULATION_KEYS))) return false;
  if (!Array.isArray(sales.assumptions) || sales.assumptions.length > 24 || !sales.assumptions.every((item) => typeof item === 'string')) return false;
  if (!Array.isArray(sales.scenarios) || sales.scenarios.length > 16) return false;
  if (!sales.scenarios.every((item) => validCommercialScenarioOutput(item))) return false;
  if (sales.coverage !== undefined && !isRecord(sales.coverage)) return false;

  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_COMMERCIAL_CONTEXT_BYTES;
}

function validateCommercialRequest(value: Record<string, unknown>, auth: AuthPayload): ValidationResult {
  if (!assertOnlyKeys(value, COMMERCIAL_TOP_LEVEL_KEYS)) return invalid('La solicitud comercial contiene campos no permitidos.');
  if (value.agentKey !== 'salesProfitability') return invalid('El agente comercial solicitado no está disponible.');
  if (typeof value.intent !== 'string' || !COMMERCIAL_AGENT_INTENTS.includes(value.intent as typeof COMMERCIAL_AGENT_INTENTS[number])) {
    return invalid('La intención comercial no es válida.');
  }
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 1200) {
    return invalid('La pregunta comercial no es válida.');
  }
  if (value.requestKey !== null && value.requestKey !== undefined
    && (typeof value.requestKey !== 'string' || value.requestKey.length > 128)) {
    return invalid('La clave de solicitud no es válida.');
  }
  if (!validCommercialPeriod(value.period, value.intent as string) || !validCommercialScenario(value.scenario, value.intent as string)
    || !validCommercialContext(value.context)) {
    return invalid('El contexto comercial no es válido.');
  }
  const options = validateOptions(value.options);
  if (!('temperature' in options)) return options;

  return {
    ok: true,
    request: {
      kind: 'commercialAnalysis',
      auth,
      agentKey: 'salesProfitability',
      intent: value.intent as typeof COMMERCIAL_AGENT_INTENTS[number],
      question: value.question.trim(),
      requestKey: typeof value.requestKey === 'string' ? value.requestKey.trim() : null,
      period: value.period as Record<string, unknown>,
      scenario: value.scenario as Record<string, unknown>,
      context: value.context as Record<string, unknown>,
      options
    }
  };
}

function validateAuth(value: unknown): AuthPayload | ValidationFailure {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: 'AUTH_PAYLOAD_REQUIRED',
      message: 'Falta el contexto seguro de licencia y dispositivo.',
      status: 401
    };
  }

  const licenseKey = cleanString(value.licenseKey);
  const deviceFingerprint = cleanString(value.deviceFingerprint);
  const deviceSecurityToken = cleanString(value.deviceSecurityToken);
  const staffValue = value.staffSessionToken;
  const staffSessionToken = staffValue === null ? null : cleanString(staffValue);

  if (!licenseKey || !deviceFingerprint || !deviceSecurityToken) {
    return {
      ok: false,
      code: 'AUTH_PAYLOAD_REQUIRED',
      message: 'Falta el contexto seguro de licencia y dispositivo.',
      status: 401
    };
  }

  if (licenseKey.length > 1024 || deviceFingerprint.length > 1024 || deviceSecurityToken.length > 4096) {
    return invalid('El contexto de autenticación no es válido.');
  }

  if (staffValue !== null && typeof staffValue !== 'string') {
    return invalid('El token de sesión staff no es válido.');
  }

  if (staffSessionToken && staffSessionToken.length > 4096) {
    return invalid('El token de sesión staff no es válido.');
  }

  return {
    licenseKey,
    deviceFingerprint,
    deviceSecurityToken,
    staffSessionToken: staffSessionToken || null
  };
}

function validateOptions(value: unknown): AnalysisOptions | ValidationFailure {
  if (value === undefined) {
    return { temperature: DEFAULT_TEMPERATURE, maxTokens: DEFAULT_MAX_TOKENS };
  }

  if (!isRecord(value)) return invalid('Las opciones del análisis no son válidas.');

  const temperature = value.temperature === undefined ? DEFAULT_TEMPERATURE : value.temperature;
  const maxTokens = value.maxTokens === undefined ? DEFAULT_MAX_TOKENS : value.maxTokens;

  if (
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    return invalid('La temperatura del análisis no es válida.');
  }

  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > MAX_MAX_TOKENS
  ) {
    return invalid('El límite de tokens del análisis no es válido.');
  }

  return { temperature, maxTokens };
}

export function validatePayload(value: unknown): ValidationResult {
  if (!isRecord(value)) return invalid('El cuerpo JSON debe ser un objeto.');
  if (hasForbiddenKey(value)) return invalid('La solicitud contiene campos no permitidos.');

  const authResult = validateAuth(value.auth);
  if (!('licenseKey' in authResult)) return authResult;

  if (value.agentKey !== undefined || value.intent !== undefined || value.context !== undefined) {
    return validateCommercialRequest(value, authResult);
  }

  if (value.action !== undefined && value.action !== 'usage') {
    return invalid('La operación solicitada no es válida.');
  }

  if (value.action === 'usage') {
    return { ok: true, request: { kind: 'usage', auth: authResult } };
  }

  const systemPrompt = typeof value.systemPrompt === 'string' ? value.systemPrompt : '';
  const userPrompt = typeof value.userPrompt === 'string' ? value.userPrompt : '';

  if (!systemPrompt.trim() || !userPrompt.trim()) {
    return invalid('Los prompts del análisis son requeridos.');
  }

  if (
    systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS ||
    userPrompt.length > MAX_USER_PROMPT_CHARS ||
    systemPrompt.length + userPrompt.length > MAX_TOTAL_PROMPT_CHARS
  ) {
    return {
      ok: false,
      code: 'PROMPT_TOO_LARGE',
      message: 'El análisis contiene demasiados datos. Reduce el rango.',
      status: 413
    };
  }

  const agentTypeValue = value.agentType === undefined ? 'unknown' : value.agentType;
  if (typeof agentTypeValue !== 'string' || !AGENT_TYPES.includes(agentTypeValue as AgentType)) {
    return invalid('El tipo de agente no es válido.');
  }

  const options = validateOptions(value.options);
  if (!('temperature' in options)) return options;

  return {
    ok: true,
    request: {
      kind: 'analysis',
      auth: authResult,
      agentType: agentTypeValue as AgentType,
      systemPrompt,
      userPrompt,
      options
    }
  };
}

export function validateCommercialModelResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version !== 1 || value.agentKey !== 'salesProfitability') return false;
  if (!['completed', 'incomplete', 'error'].includes(String(value.status))) return false;
  if (typeof value.executiveSummary !== 'string' || typeof value.explanation !== 'string') return false;
  if (!['high', 'medium', 'low'].includes(String(value.confidence))) return false;
  if (!['cloud', 'local', 'mixed'].includes(String(value.source))) return false;
  if (!isRecord(value.coverage)) return false;
  if (!Array.isArray(value.facts)
    || !Array.isArray(value.calculations)
    || !Array.isArray(value.assumptions)
    || !Array.isArray(value.scenarios)
    || !Array.isArray(value.recommendations)
    || !Array.isArray(value.limitations)
    || !Array.isArray(value.actionDrafts)
    || !Array.isArray(value.citations)) return false;
  if (value.actionDrafts.length !== 0) return false;
  if (value.aiNarrative !== undefined) {
    if (!isRecord(value.aiNarrative)) return false;
    const narrative = value.aiNarrative;
    if (narrative.status !== 'available' && narrative.status !== 'unavailable') return false;
    if (!Array.isArray(narrative.recommendations)) return false;
    if (narrative.directAnswer !== undefined
      && narrative.directAnswer !== null
      && typeof narrative.directAnswer !== 'string') return false;
    if (narrative.status === 'available'
      && narrative.directAnswer !== undefined
      && narrative.directAnswer !== null
      && (typeof narrative.directAnswer !== 'string' || !narrative.directAnswer.trim())) return false;
    if (narrative.confidence !== undefined && !['high', 'medium', 'low'].includes(String(narrative.confidence))) return false;
    if (narrative.diagnosticCode !== undefined && !isCommercialNarrativeDiagnosticCode(narrative.diagnosticCode)) return false;
    const hasNarrativeContent = (typeof narrative.executiveSummary === 'string' && narrative.executiveSummary.trim().length > 0)
      || (typeof narrative.explanation === 'string' && narrative.explanation.trim().length > 0)
      || narrative.recommendations.length > 0;
    if (narrative.status === 'available' && !hasNarrativeContent) return false;
    if (narrative.status === 'unavailable'
      && (!isCommercialNarrativeDiagnosticCode(narrative.diagnosticCode) || hasNarrativeContent)) return false;
  }
  if (value.calculations.some((item) => !isRecord(item)
    || typeof item.label !== 'string'
    || !Object.prototype.hasOwnProperty.call(item, 'value')
    || typeof item.formattedValue !== 'string'
    || typeof item.formula !== 'string'
    || typeof item.source !== 'string'
    || !isRecord(item.period))) return false;
  if (value.recommendations.some((item) => {
    if (!isRecord(item)
      || typeof item.title !== 'string'
      || typeof item.explanation !== 'string'
      || typeof item.expectedImpact !== 'string'
      || item.requiresConfirmation !== true) return true;
    const legacy = typeof item.effort === 'string' && Array.isArray(item.evidence);
    const narrative = ['high', 'medium', 'low'].includes(String(item.priority)) && Array.isArray(item.evidenceKeys);
    const hasAction = typeof item.action === 'string' && item.action.trim().length > 0;
    const hasMeasurement = typeof item.measurement === 'string' && item.measurement.trim().length > 0;
    const hasFocus = item.focus === undefined || (isRecord(item.focus)
      && Object.keys(item.focus).every((key) => ['type', 'key'].includes(key))
      && ['product', 'channel', 'ticket', 'units_per_ticket', 'tickets', 'general'].includes(String(item.focus.type))
      && typeof item.focus.key === 'string' && item.focus.key.trim().length > 0);
    const hasRecommendationType = item.recommendationType === undefined
      || ['growth_experiment', 'investigation', 'data_quality', 'optimization'].includes(String(item.recommendationType));
    return (!legacy && !narrative)
      || !hasFocus
      || !hasRecommendationType
      || (item.focus === undefined) !== (item.recommendationType === undefined)
      || (hasAction !== hasMeasurement)
      || (item.action !== undefined && !hasAction)
      || (item.measurement !== undefined && !hasMeasurement);
  })) return false;
  return !hasForbiddenKey(value) && !Object.values(value).some((entry) => hasForbiddenKey(entry));
}

export function isJsonContentType(contentType: string | null): boolean {
  return Boolean(contentType && /^application\/json(?:\s*;|$)/iu.test(contentType));
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function cleanText(value: unknown): string {
  return cleanString(value);
}
