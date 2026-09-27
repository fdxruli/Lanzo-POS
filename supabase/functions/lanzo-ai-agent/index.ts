import {
  MAX_BODY_BYTES,
  cleanText,
  isCommercialNarrativeDiagnosticCode,
  isJsonContentType,
  isRecordValue,
  validateCommercialModelResponse,
  validatePayload,
  type CommercialAnalysisRequest,
  type AnalysisRequest,
  type AuthPayload,
  type ValidatedRequest
} from './contract.ts';
import {
  ProviderError,
  isProviderError,
  requestProvider,
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResult,
  type ProviderRequestMode
} from './provider.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SAFE_MESSAGES: Record<string, string> = {
  AUTH_PAYLOAD_REQUIRED: 'No se pudo confirmar la licencia y el dispositivo para usar IA.',
  LICENSE_NOT_FOUND: 'Licencia no encontrada.',
  LICENSE_NOT_ACTIVE: 'La licencia no está activa.',
  LICENSE_EXPIRED: 'La licencia está expirada.',
  AI_AGENTS_NOT_AVAILABLE: 'Los agentes de IA no están disponibles para este plan.',
  AI_AGENT_PERIOD_NOT_FOUND: 'No hay un periodo vigente para usar agentes IA.',
  AI_AGENT_LIMIT_DISABLED: 'Este periodo no tiene análisis de IA disponibles.',
  AI_AGENT_LIMIT_REACHED: 'Ya se alcanzó el límite de análisis de IA para esta licencia.',
  DEVICE_NOT_ALLOWED: 'Este dispositivo no está autorizado para esta licencia.',
  DEVICE_TOKEN_REQUIRED: 'Se requiere el token seguro del dispositivo.',
  DEVICE_TOKEN_INVALID: 'El token de este dispositivo no es válido.',
  STAFF_SESSION_REQUIRED: 'Se requiere una sesión staff válida para usar agentes de IA.',
  STAFF_SESSION_INVALID: 'La sesión staff expiró o ya no es válida.',
  AI_AGENT_PERMISSION_REQUIRED: 'Tu usuario staff no tiene permiso para usar agentes de IA.',
  AI_RATE_LIMITED: 'Demasiadas consultas de uso de IA. Intenta de nuevo más tarde.',
  USAGE_LOOKUP_ERROR: 'No se pudo consultar el uso de agentes IA.',
  USAGE_RESERVATION_ERROR: 'No se pudo reservar o finalizar el uso del agente IA.',
  AI_KEY_MISSING: 'Falta configurar AI_API_KEY en Supabase Secrets.',
  AI_PROVIDER_ERROR: 'La configuración del proveedor de IA no es válida.',
  PROMPT_TOO_LARGE: 'El análisis contiene demasiados datos. Reduce el rango.',
  AI_REQUEST_FAILED: 'No se pudo contactar al proveedor de IA.',
  AI_EMPTY_RESPONSE: 'El proveedor IA devolvió una respuesta vacía.',
  AI_INVALID_RESPONSE: 'El proveedor IA devolvió una respuesta estructurada inválida.',
  INVALID_REQUEST: 'No se pudo procesar la solicitud.'
};

const KNOWN_RPC_CODES = new Set([
  'LICENSE_NOT_FOUND',
  'LICENSE_NOT_ACTIVE',
  'LICENSE_EXPIRED',
  'AI_AGENTS_NOT_AVAILABLE',
  'AI_AGENT_PERIOD_NOT_FOUND',
  'AI_AGENT_LIMIT_DISABLED',
  'AI_AGENT_LIMIT_REACHED',
  'DEVICE_NOT_ALLOWED',
  'DEVICE_TOKEN_REQUIRED',
  'DEVICE_TOKEN_INVALID',
  'STAFF_SESSION_REQUIRED',
  'STAFF_SESSION_INVALID',
  'AI_AGENT_PERMISSION_REQUIRED',
  'AI_RATE_LIMITED'
]);

const ALLOWED_RPC_NAMES = new Set([
  'get_ai_agent_usage',
  'get_ai_agent_usage_unlimited',
  'begin_ai_agent_analysis',
  'complete_ai_agent_analysis'
]);

type RpcResult = {
  data: unknown;
  error: unknown | null;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type HandlerDependencies = {
  env?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  createClient?: (url: string, key: string, options: { auth: { persistSession: boolean; autoRefreshToken: boolean } }) => RpcClient;
  requestId?: () => string;
  now?: () => number;
  providerTimeoutMs?: number;
};

type ServerClientOptions = {
  auth: { persistSession: boolean; autoRefreshToken: boolean };
};

type UsageSnapshot = Record<string, unknown>;
type ExecutionTelemetry = {
  providerCalled: boolean;
  quotaOutcome: 'consumed' | 'not_consumed' | 'not_confirmed';
};

const NO_PROVIDER_NO_QUOTA: ExecutionTelemetry = {
  providerCalled: false,
  quotaOutcome: 'not_consumed'
};
const NO_PROVIDER_QUOTA_UNKNOWN: ExecutionTelemetry = {
  providerCalled: false,
  quotaOutcome: 'not_confirmed'
};
const PROVIDER_QUOTA_UNKNOWN: ExecutionTelemetry = {
  providerCalled: true,
  quotaOutcome: 'not_confirmed'
};
const COMMERCIAL_MAX_TOKENS = 2048;
const COMMERCIAL_PROVIDER_REQUEST_MODE: ProviderRequestMode = 'commercial-narrative';
const COMPACT_NARRATIVE_INTENTS = new Set(['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend']);
const NARRATIVE_EVIDENCE_KEY_ALLOWLIST: Record<string, string[]> = {
  sales_growth: [
    'comparison.deltaNetSales', 'comparison.deltaNetSalesPercent', 'comparison.deltaSalesCount',
    'comparison.deltaUnits', 'comparison.deltaTicket', 'comparison.deltaTicketPercent',
    'comparison.deltaUnitsPerTicket', 'summary.unitsPerTicket',
    'metric:deltaNetSales', 'metric:deltaSalesCount', 'metric:deltaUnits', 'metric:deltaTicket',
    'metric:deltaUnitsPerTicket', 'metric:currentNetSales', 'metric:currentAverageTicket',
    'metric:currentUnitsPerTicket'
  ],
  ticket_growth: [
    'summary.unitsPerTicket', 'comparison.deltaTicket', 'comparison.deltaTicketPercent',
    'comparison.deltaUnitsPerTicket', 'comparison.deltaSalesCount', 'comparison.deltaUnits',
    'metric:deltaTicket', 'metric:deltaUnitsPerTicket', 'metric:deltaSalesCount', 'metric:deltaUnits',
    'metric:currentAverageTicket', 'metric:currentUnitsPerTicket'
  ],
  product_opportunity: [
    'products.risks', 'profitability.costCoverage', 'coverage.costCoverage',
    'metric:currentNetSales', 'metric:costCoverage'
  ],
  sales_trend: [
    'comparison.deltaNetSales', 'comparison.deltaNetSalesPercent', 'comparison.deltaSalesCount',
    'comparison.deltaUnits', 'comparison.deltaTicket', 'comparison.deltaUnitsPerTicket',
    'summary.unitsPerTicket',
    'metric:deltaNetSales', 'metric:deltaSalesCount', 'metric:deltaUnits', 'metric:deltaTicket',
    'metric:deltaUnitsPerTicket'
  ]
};
const NARRATIVE_ENTITY_EVIDENCE_PREFIXES: Record<string, string[]> = {
  sales_growth: ['product:', 'channel:'],
  ticket_growth: ['product:'],
  product_opportunity: ['product:'],
  sales_trend: ['channel:']
};
const ACTIONABLE_NARRATIVE_INTENTS = new Set(['sales_growth', 'ticket_growth', 'product_opportunity']);

type UsageFailure = {
  code: string;
  message: string;
  narrativeDiagnostic?: string;
};

type CommercialNarrativeNormalization = {
  content: string;
  available: boolean;
  diagnosticCode: string | null;
};

function createRestClient(url: string, key: string, _options: ServerClientOptions): RpcClient {
  const baseUrl = url.replace(/\/+$/u, '');

  return {
    async rpc(name, args) {
      if (!ALLOWED_RPC_NAMES.has(name)) {
        return { data: null, error: { code: 'RPC_NOT_ALLOWED' } };
      }

      const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        return { data: null, error: { status: response.status, code: 'SUPABASE_RPC_ERROR' } };
      }

      return { data, error: null };
    }
  };
}

function jsonResponse(status: number, body: Record<string, unknown>, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'X-Request-Id': requestId
    }
  });
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(value) ? value : fallback;
}

function publicMessage(code: string): string {
  return SAFE_MESSAGES[code] || SAFE_MESSAGES.INVALID_REQUEST;
}

function errorResponse(
  status: number,
  code: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  execution?: ExecutionTelemetry
): Response {
  return jsonResponse(status, {
    success: false,
    code,
    message: publicMessage(code),
    ...extra,
    ...(execution || {})
  }, requestId);
}

function asSnapshot(value: unknown): UsageSnapshot | null {
  if (isRecordValue(value)) return value;
  if (Array.isArray(value) && isRecordValue(value[0])) return value[0];
  return null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function usageFields(value: UsageSnapshot): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const allowed = [
    'limit',
    'used',
    'remaining',
    'plan_code',
    'plan_name',
    'ai_agents',
    'period_id',
    'period_type',
    'period_status',
    'period_start',
    'period_end'
  ];

  for (const key of allowed) {
    if (value[key] !== undefined) fields[key] = value[key];
  }

  return fields;
}

function analysisUsageStatus(value: UsageSnapshot): Record<string, unknown> {
  const fields = usageFields(value);
  if (fields.limit !== undefined) fields.limit = safeInteger(fields.limit) ?? 0;
  if (fields.used !== undefined) fields.used = safeInteger(fields.used) ?? 0;
  if (fields.remaining !== undefined) fields.remaining = safeInteger(fields.remaining) ?? 0;
  return fields;
}

function statusForRpcCode(code: string, fallback = 403): number {
  if (code === 'AI_AGENT_LIMIT_REACHED' || code === 'AI_RATE_LIMITED') return 429;
  if (code === 'AI_AGENT_PERIOD_NOT_FOUND') return 404;
  if (code === 'AUTH_PAYLOAD_REQUIRED') return 401;
  if (KNOWN_RPC_CODES.has(code)) return 403;
  return fallback;
}

function rpcFailureResponse(
  responseCode: string,
  status: number,
  requestId: string,
  data: unknown
): Response {
  const snapshot = asSnapshot(data);
  return errorResponse(status, responseCode, requestId, snapshot ? usageFields(snapshot) : {});
}

function createServerClient(
  env: (name: string) => string | undefined,
  factory: NonNullable<HandlerDependencies['createClient']>
): RpcClient | Response {
  const supabaseUrl = cleanText(env('SUPABASE_URL'));
  const serviceRoleKey = cleanText(env('SUPABASE_SERVICE_ROLE_KEY'));

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(500, 'USAGE_LOOKUP_ERROR', 'unavailable');
  }

  return factory(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isResponse(value: RpcClient | Response): value is Response {
  return value instanceof Response;
}

function providerFailure(error: unknown): ProviderError {
  if (isProviderError(error)) return error;
  return new ProviderError('AI_REQUEST_FAILED', 'No se pudo contactar al proveedor de IA.', 502);
}

async function validateCommercialAccess(
  client: RpcClient,
  auth: AuthPayload,
  requestId: string
): Promise<Response | null> {
  let result: RpcResult;
  try {
    result = await client.rpc('get_ai_agent_usage_unlimited', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_device_security_token: auth.deviceSecurityToken,
      p_staff_session_token: auth.staffSessionToken
    });
  } catch {
    return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId, {}, NO_PROVIDER_NO_QUOTA);
  }
  const snapshot = asSnapshot(result.data);
  if (result.error || !snapshot) return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId, {}, NO_PROVIDER_NO_QUOTA);
  if (snapshot.success !== true) {
    const code = safeCode(snapshot.code, 'USAGE_LOOKUP_ERROR');
    return errorResponse(statusForRpcCode(code), code, requestId, usageFields(snapshot), NO_PROVIDER_NO_QUOTA);
  }
  return null;
}

function pickRecordFields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecordValue(value)) return {};
  return Object.fromEntries(keys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => [key, value[key]]));
}

function commercialEvidenceImpact(value: unknown): number {
  if (!isRecordValue(value)) return 0;
  const salesDelta = commercialNumber(value.salesDelta);
  if (salesDelta !== null) return Math.abs(salesDelta);
  const salesDeltaPercent = commercialNumber(value.salesDeltaPercent);
  if (salesDeltaPercent !== null) return Math.abs(salesDeltaPercent) * 100;
  return Math.abs(commercialNumber(value.currentSales) ?? 0);
}

function selectCommercialEvidenceRows(value: unknown, limit: number, nameKey: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isRecordValue(item) && typeof item[nameKey] === 'string')
    .map((item, index) => ({ item: item as Record<string, unknown>, index }))
    .sort((left, right) => commercialEvidenceImpact(right.item) - commercialEvidenceImpact(left.item) || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function compactNarrativeProduct(value: Record<string, unknown>, intent: string): Record<string, unknown> {
  const fields = intent === 'product_opportunity'
    ? [
      'name', 'currentSales', 'previousSales', 'salesDelta', 'salesDeltaPercent', 'currentShare', 'previousShare',
      'salesShareDelta', 'costKnown', 'costStatus', 'direction', 'signals', 'opportunityReason'
    ]
    : intent === 'ticket_growth'
      ? ['name', 'currentSales', 'salesDelta', 'salesDeltaPercent', 'unitsDelta', 'direction', 'signals']
      : [
        'name', 'currentSales', 'salesDelta', 'unitsDelta', 'currentShare',
        'costKnown', 'costStatus', 'direction', 'signals'
      ];
  const product = pickRecordFields(value, [
    ...fields
  ]);
  if (Array.isArray(product.signals)) product.signals = product.signals.slice(0, intent === 'product_opportunity' ? 4 : 2);
  if (intent === 'product_opportunity' && value.costKnown === true) {
    Object.assign(product, pickRecordFields(value, ['currentMargin', 'previousMargin', 'currentProfit', 'previousProfit']));
  }
  return product;
}

function compactCommercialEvidence(context: Record<string, unknown>, intent: string): Record<string, unknown> {
  const sales = isRecordValue(context.sales) ? context.sales : {};
  const comparison = isRecordValue(sales.comparison) ? sales.comparison : {};
  const growthSignals = isRecordValue(sales.growthSignals) ? sales.growthSignals : {};
  if (COMPACT_NARRATIVE_INTENTS.has(intent)) {
    const summaryFields = intent === 'ticket_growth'
      ? ['averageTicket', 'unitsPerTicket', 'salesCount', 'units']
      : intent === 'product_opportunity'
        ? ['netSales', 'salesCount']
        : ['netSales', 'salesCount', 'units', 'averageTicket', 'unitsPerTicket'];
    const comparisonFields = intent === 'ticket_growth'
      ? ['previousTicket', 'deltaTicket', 'deltaTicketPercent', 'previousUnitsPerTicket', 'deltaUnitsPerTicket', 'previousSalesCount', 'deltaSalesCount']
      : intent === 'product_opportunity'
        ? []
        : ['previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousUnits', 'deltaUnits', 'previousTicket', 'deltaTicket', 'deltaTicketPercent', 'previousUnitsPerTicket', 'deltaUnitsPerTicket', 'previousSalesCount', 'deltaSalesCount'];
    const comparisonProducts = Array.isArray(comparison.productChanges) ? comparison.productChanges : [];
    const opportunities = Array.isArray(growthSignals.productOpportunities) && growthSignals.productOpportunities.length
      ? growthSignals.productOpportunities
      : comparisonProducts.filter((item) => isRecordValue(item)
        && (item.direction === 'growing'
          || (Array.isArray(item.signals) && item.signals.some((signal) => ['high_sales_share', 'healthy_margin'].includes(String(signal))))));
    const growing = Array.isArray(growthSignals.productsGrowing) && growthSignals.productsGrowing.length
      ? growthSignals.productsGrowing
      : comparisonProducts.filter((item) => isRecordValue(item) && item.direction === 'growing');
    const declining = Array.isArray(growthSignals.productsDeclining) && growthSignals.productsDeclining.length
      ? growthSignals.productsDeclining
      : comparisonProducts.filter((item) => isRecordValue(item) && item.direction === 'declining');
    const productLimit = intent === 'ticket_growth' ? 2 : 3;
    const selectedOpportunities = selectCommercialEvidenceRows(
      opportunities.length ? opportunities : (intent === 'ticket_growth' ? growing : []),
      productLimit,
      'name'
    ).map((product) => compactNarrativeProduct(product, intent));
    const selectedDeclines = intent === 'sales_growth'
      ? selectCommercialEvidenceRows(declining, 3, 'name').map((product) => compactNarrativeProduct(product, intent))
      : [];
    const selectedChannels = ['sales_growth', 'sales_trend'].includes(intent)
      ? selectCommercialEvidenceRows(
        Array.isArray(growthSignals.channelChanges) && growthSignals.channelChanges.length
          ? growthSignals.channelChanges
          : comparison.channelMixChanges,
        2,
        'channel'
      ).map((channel) => pickRecordFields(channel, [
        'channel', 'currentShare', 'previousShare', 'deltaShare', 'currentSales', 'previousSales', 'salesDelta'
      ]))
      : [];
    const compactSignals: Record<string, unknown> = {
      comparisonAvailable: growthSignals.comparisonAvailable === true
    };
    if (['sales_growth', 'ticket_growth', 'product_opportunity'].includes(intent)) {
      compactSignals.productOpportunities = selectedOpportunities;
    }
    if (selectedDeclines.length) compactSignals.productsDeclining = selectedDeclines;
    if (selectedChannels.length) compactSignals.channelChanges = selectedChannels;
    const coverage = pickRecordFields(sales.coverage, [
      'validSales', 'comparisonAvailable', 'comparisonDataAvailable', 'growthDataComplete',
      'salesDataComplete', 'itemsComplete', 'paginationComplete', 'sourceComplete', 'complete'
    ]);

    return {
      sales: {
        summary: pickRecordFields(sales.summary, summaryFields),
        products: [],
        channels: [],
        comparison: pickRecordFields(comparison, comparisonFields),
        growthSignals: compactSignals,
        coverage
      }
    };
  }

  const compactComparison = pickRecordFields(comparison, [
    'currentSalesCount', 'previousSalesCount', 'deltaSalesCount', 'previousNetSales', 'previousUnits',
    'previousTicket', 'previousUnitsPerTicket', 'previousCost', 'previousProfit', 'previousMargin',
    'deltaNetSales', 'deltaNetSalesPercent', 'deltaUnits', 'deltaTicket', 'deltaTicketPercent',
    'deltaUnitsPerTicket', 'deltaCost', 'deltaProfit', 'deltaMargin', 'deltaMarginRelative', 'deltaDiscounts'
  ]);
  for (const key of ['productMixChanges', 'channelMixChanges', 'productChanges']) {
    if (Array.isArray(comparison[key])) compactComparison[key] = (comparison[key] as unknown[]).slice(0, 5);
  }
  const compactGrowthSignals = pickRecordFields(growthSignals, [
    'currentNetSales', 'currentSalesCount', 'currentUnits', 'currentAverageTicket', 'currentUnitsPerTicket',
    'previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousSalesCount', 'deltaSalesCount',
    'previousUnits', 'deltaUnits', 'previousAverageTicket', 'deltaTicket', 'deltaTicketPercent',
    'previousUnitsPerTicket', 'deltaUnitsPerTicket', 'comparisonAvailable'
  ]);
  for (const key of ['productsGrowing', 'productsDeclining', 'productOpportunities', 'channelChanges']) {
    if (Array.isArray(growthSignals[key])) compactGrowthSignals[key] = (growthSignals[key] as unknown[]).slice(0, 3);
  }

  return {
    agentKey: context.agentKey,
    scope: context.scope,
    source: context.source,
    sales: {
      summary: pickRecordFields(sales.summary, [
        'netSales', 'units', 'salesCount', 'averageTicket', 'unitsPerTicket', 'discounts', 'discountsKnown',
        'unitCosts', 'knownCostOfSale', 'profit', 'margin', 'costCoverage', 'missingCostProducts',
        'excludedSales', 'ecommerceDuplicates', 'profitabilityStatus', 'profitabilityExplanation'
      ]),
      ...(Object.prototype.hasOwnProperty.call(sales, 'grossSales') ? { grossSales: sales.grossSales } : {}),
      products: Array.isArray(sales.products) ? sales.products.slice(0, 6) : [],
      channels: Array.isArray(sales.channels) ? sales.channels.slice(0, 4) : [],
      comparison: compactComparison,
      ...(Object.keys(compactGrowthSignals).length ? { growthSignals: compactGrowthSignals } : {}),
      contributors: Array.isArray(sales.contributors) ? sales.contributors.slice(0, 3) : [],
      coverage: pickRecordFields(sales.coverage, [
        'validSales', 'rawSales', 'excludedSales', 'ecommerceDuplicatesExcluded', 'productsIncluded',
        'productsMissingCost', 'costCoverage', 'itemCoverage', 'detailLines', 'expectedDetailLines', 'knownCostOfSale',
        'costStatus', 'itemsComplete', 'paginationComplete', 'sourceComplete', 'comparisonAvailable',
        'comparisonDataAvailable', 'comparisonItemsAvailable', 'salesDataComplete', 'growthDataComplete', 'complete'
      ]),
      calculations: Array.isArray(sales.calculations) ? sales.calculations.slice(0, 8) : [],
      assumptions: Array.isArray(sales.assumptions) ? sales.assumptions.slice(0, 6) : [],
      scenarios: Array.isArray(sales.scenarios) ? sales.scenarios.slice(0, 6) : [],
      limitations: Array.isArray(sales.limitations) ? sales.limitations.slice(0, 4) : []
    }
  };
}

function buildNarrativeEvidenceKeyAllowlist(
  context: Record<string, unknown>,
  intent: string
): string[] {
  const sales = isRecordValue(context.sales) ? context.sales : {};
  const availableKeys = new Set(
    Array.isArray(sales.evidenceKeys)
      ? sales.evidenceKeys.filter((entry): entry is string => typeof entry === 'string')
      : []
  );
  const metricAndLegacyKeys = (NARRATIVE_EVIDENCE_KEY_ALLOWLIST[intent] || [])
    .filter((key) => availableKeys.has(key));
  const entityEvidenceKeys: string[] = [];
  const compactEvidence = compactCommercialEvidence(context, intent);
  const evidenceSales = isRecordValue(compactEvidence.sales) ? compactEvidence.sales : {};
  const growthSignals = isRecordValue(evidenceSales.growthSignals) ? evidenceSales.growthSignals : {};
  const productRows = [
    ...(Array.isArray(growthSignals.productOpportunities) ? growthSignals.productOpportunities : []),
    ...(Array.isArray(growthSignals.productsDeclining) ? growthSignals.productsDeclining : [])
  ];
  const channelRows = Array.isArray(growthSignals.channelChanges) ? growthSignals.channelChanges : [];
  const prefixes = NARRATIVE_ENTITY_EVIDENCE_PREFIXES[intent] || [];
  if (prefixes.includes('product:')) {
    for (const item of productRows) {
      if (!isRecordValue(item) || typeof item.name !== 'string' || !item.name.trim()) continue;
      const key = `product:${item.name.trim()}`;
      if (availableKeys.has(key)) entityEvidenceKeys.push(key);
    }
  }
  if (prefixes.includes('channel:')) {
    for (const item of channelRows) {
      if (!isRecordValue(item) || typeof item.channel !== 'string' || !item.channel.trim()) continue;
      const key = `channel:${item.channel.trim()}`;
      if (availableKeys.has(key)) entityEvidenceKeys.push(key);
    }
  }
  return Array.from(new Set([...entityEvidenceKeys, ...metricAndLegacyKeys]));
}

function foldCommercialEntityText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

function recommendationHasGroundedEvidence(
  recommendation: Record<string, unknown>,
  evidenceKeys: string[],
  intent: string,
  evidence: Record<string, unknown>,
  allowedEvidenceKeys: Set<string>
): boolean {
  if (!ACTIONABLE_NARRATIVE_INTENTS.has(intent)) return true;
  const narrativeText = [recommendation.title, recommendation.explanation, recommendation.action, recommendation.measurement]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const normalizedText = foldCommercialEntityText(narrativeText);
  const sales = isRecordValue(evidence.sales) ? evidence.sales : {};
  const growth = isRecordValue(sales.growthSignals) ? sales.growthSignals : {};
  const productRows = [
    ...(Array.isArray(growth.productOpportunities) ? growth.productOpportunities : []),
    ...(Array.isArray(growth.productsDeclining) ? growth.productsDeclining : [])
  ].filter(isRecordValue);
  const channelRows = (Array.isArray(growth.channelChanges) ? growth.channelChanges : []).filter(isRecordValue);
  const mentionedProducts = productRows
    .filter((row) => typeof row.name === 'string' && normalizedText.includes(foldCommercialEntityText(row.name)))
    .map((row) => String(row.name));
  const mentionedChannels = channelRows
    .filter((row) => typeof row.channel === 'string' && normalizedText.includes(foldCommercialEntityText(row.channel)))
    .map((row) => String(row.channel));
  const productEvidenceKeys = evidenceKeys.filter((key) => key.startsWith('product:'));
  const channelEvidenceKeys = evidenceKeys.filter((key) => key.startsWith('channel:'));
  const metricEvidenceKeys = evidenceKeys.filter((key) => key.startsWith('metric:'));

  if (mentionedProducts.some((name) => !productEvidenceKeys.includes(`product:${name}`))) return false;
  if (mentionedChannels.some((name) => !channelEvidenceKeys.includes(`channel:${name}`))) return false;
  if (productEvidenceKeys.some((key) => !normalizedText.includes(foldCommercialEntityText(key.slice('product:'.length))))) return false;
  if (channelEvidenceKeys.some((key) => !normalizedText.includes(foldCommercialEntityText(key.slice('channel:'.length))))) return false;

  if (intent === 'product_opportunity') return productEvidenceKeys.length > 0;
  if (intent === 'ticket_growth') {
    const ticketMetrics = new Map<string, string[]>([
      ['metric:deltaTicket', ['ticket promedio']],
      ['metric:currentAverageTicket', ['ticket promedio']],
      ['metric:deltaUnitsPerTicket', ['unidades por ticket', 'unidades por compra', 'articulos por ticket', 'articulos por compra']],
      ['metric:currentUnitsPerTicket', ['unidades por ticket', 'unidades por compra', 'articulos por ticket', 'articulos por compra']]
    ]);
    const citedTicketMetrics = evidenceKeys.filter((key) => ticketMetrics.has(key));
    const measurementText = foldCommercialEntityText(typeof recommendation.measurement === 'string'
      ? recommendation.measurement
      : '');
    return citedTicketMetrics.some((key) => (ticketMetrics.get(key) || [])
      .some((label) => measurementText.includes(label)));
  }
  if (intent === 'sales_growth') {
    const hasProductEvidence = Array.from(allowedEvidenceKeys).some((key) => key.startsWith('product:'));
    const hasChannelEvidence = Array.from(allowedEvidenceKeys).some((key) => key.startsWith('channel:'));
    if (hasProductEvidence || hasChannelEvidence) {
      return productEvidenceKeys.length + channelEvidenceKeys.length > 0;
    }
  }
  if (mentionedProducts.length || mentionedChannels.length) return productEvidenceKeys.length + channelEvidenceKeys.length > 0;
  return metricEvidenceKeys.length > 0;
}

function hasActionableNarrativeEvidence(evidenceKeys: string[], intent: string): boolean {
  if (intent === 'product_opportunity') return evidenceKeys.some((key) => key.startsWith('product:'));
  if (intent === 'ticket_growth') return evidenceKeys.some((key) => [
    'metric:deltaTicket', 'metric:currentAverageTicket', 'metric:deltaUnitsPerTicket', 'metric:currentUnitsPerTicket'
  ].includes(key));
  return evidenceKeys.some((key) => key.startsWith('product:')
    || key.startsWith('channel:')
    || key.startsWith('metric:'));
}

function buildCommercialPrompts(request: Extract<ValidatedRequest, { kind: 'commercialAnalysis' }>): { systemPrompt: string; userPrompt: string } {
  const compactNarrative = COMPACT_NARRATIVE_INTENTS.has(request.intent);
  const recommendationLimit = compactNarrative ? 2 : 3;
  const intentGuidance: Record<string, string> = {
    sales_growth: 'Responde qué oportunidades concretas vale la pena probar para vender más. Conecta ventas, número de tickets y ticket promedio cuando coincidan, sin atribuir causalidad. Prioriza productos y canales con evidencia; si ecommerce pasó de ventas a cero, plantea revisar si estuvo activo y si los pedidos se registraron antes de inferir demanda.',
    ticket_growth: 'Responde cómo probar un aumento del valor o de las unidades por compra. Compara cambios del ticket con unidades por ticket; usa productos concretos sólo cuando haya evidencia y no inventes relaciones de complemento.',
    product_opportunity: 'Nombra productos existentes con evidencia. Explica por qué destacan, qué acción pequeña evaluar y qué medir. Si falta costo, di que aún no puede juzgarse rentabilidad; usa margen sólo con costKnown=true.',
    sales_trend: 'Contesta primero si las ventas crecieron, bajaron o no hay evidencia suficiente. Después explica qué señales coinciden y qué conviene vigilar.'
  };
  const systemPrompt = [
    'Eres la capa narrativa del agente de Ventas y rentabilidad de Lanzo-POS.',
    'Devuelve exclusivamente el objeto JSON solicitado, sin markdown ni texto fuera del JSON. Contesta directamente la pregunta con una interpretación comercial priorizada; no narres el reporte.',
    'No añadas campos fuera del contrato de respuesta.',
    'Los hechos y cálculos ya son determinísticos: no recalcules cifras ni inventes datos, entidades, causalidad o resultados futuros. Selecciona las cifras que justifican tu interpretación; no repitas todo el reporte.',
    'Cada recomendación debe convertir una señal concreta de Lanzo en una acción revisable y medible. Evita consejos intercambiables como revisar productos, mejorar promociones o impulsar ventas si no identificas qué entidad o métrica lo justifica.',
    'Si mencionas un producto o canal, debe aparecer en la evidencia recibida y debes citar su clave product: o channel: exacta. Si hablas de una métrica, cita su clave metric: correspondiente. Usa sólo claves permitidas.',
    'new_in_period sólo significa que un producto apareció con ventas en el periodo actual y no tuvo ventas en el comparable; no afirmes que se acaba de crear o agregar al catálogo.',
    ...(compactNarrative ? [
      'El resumen debe tener máximo 2 frases y 300 caracteres. La explicación debe tener 2–4 frases y máximo 800 caracteres.',
      'Usa como máximo 2 recomendaciones. Cada recomendación requiere title, explanation (por qué), action, measurement, expectedImpact, priority, evidenceKeys y requiresConfirmation=true.',
      'La action debe describir una prueba pequeña y concreta; measurement debe indicar qué comparar y durante qué periodo si hay base para proponerlo. expectedImpact expresa qué permitirá validar, sin prometer ni cuantificar resultados futuros.',
      'Cada título admite hasta 80 caracteres, cada explicación hasta 300, action hasta 280, measurement hasta 220 e impacto esperado hasta 180; cita hasta 3 evidenceKeys existentes.'
    ] : ['Resume en 1–2 frases y da una explicación breve. Incluye hasta tres recomendaciones breves.']),
    'Para tendencias compara periodos equivalentes y describe coincidencias, nunca causalidad. Sin costo conocido no afirmes utilidad o margen; las señales no predicen demanda ni garantizan crecimiento.',
    `Cada recomendación debe ser prudente, revisable y llevar requiresConfirmation=true; devuelve como máximo ${recommendationLimit}.`,
    'No ejecutes ni sugieras cambios automáticos de precios, promociones, inventario o datos.',
    intentGuidance[request.intent] || ''
  ].join(' ');

  const period = compactNarrative
    ? pickRecordFields(request.period, ['from', 'to', 'previousFrom', 'previousTo'])
    : request.period;
  const userPromptPayload: Record<string, unknown> = {
    intent: request.intent,
    question: request.question,
    period,
    deterministicEvidence: compactCommercialEvidence(request.context, request.intent),
    allowedEvidenceKeys: isRecordValue(request.context.sales) && Array.isArray(request.context.sales.evidenceKeys)
      ? (compactNarrative
        ? buildNarrativeEvidenceKeyAllowlist(request.context, request.intent).slice(0, 12)
        : request.context.sales.evidenceKeys)
      : [],
    responseContract: {
      executiveSummary: compactNarrative ? 'texto, máximo 2 frases y 300 caracteres' : 'máximo 2 frases',
      explanation: compactNarrative ? 'texto, 2–4 frases y máximo 800 caracteres' : 'breve y clara',
      recommendations: [{
        title: compactNarrative ? 'acción (máximo 80 caracteres)' : 'acción sugerida',
        explanation: compactNarrative ? 'por qué (máximo 300 caracteres)' : 'por qué',
        ...(compactNarrative ? { action: 'prueba concreta (máximo 280 caracteres)', measurement: 'qué comparar y cómo (máximo 220 caracteres)' } : {}),
        expectedImpact: compactNarrative ? 'impacto (máximo 180 caracteres)' : 'impacto esperado',
        priority: 'high | medium | low',
        evidenceKeys: compactNarrative ? ['hasta 3 claves existentes'] : ['clave de evidencia existente'],
        requiresConfirmation: true
      }],
      confidence: 'high | medium | low'
    },
    ...(compactNarrative ? { intentGuidance: intentGuidance[request.intent] } : {})
  };
  if (Object.keys(request.scenario).length) userPromptPayload.scenario = request.scenario;
  const userPrompt = JSON.stringify(userPromptPayload);
  return { systemPrompt, userPrompt };
}
const COMMERCIAL_UNSAFE_TEXT = /<\/?[a-z][^>]*>|```|\b(?:javascript|data|vbscript):/iu;

function parseJsonRecord(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecordValue(parsed)) return parsed;
    } catch {
      // El siguiente candidato puede ser un JSON envuelto por el proveedor.
    }
  }
  return null;
}

function safeCommercialText(value: unknown, fallback: string, maxLength = 1600): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().slice(0, maxLength);
  return text && !COMMERCIAL_UNSAFE_TEXT.test(text) ? text : fallback;
}

function commercialNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildDeterministicCommercialResponse(request: CommercialAnalysisRequest): Record<string, unknown> {
  const context = isRecordValue(request.context) ? request.context : {};
  const sales = isRecordValue(context.sales) ? context.sales : {};
  const summary = isRecordValue(sales.summary) ? sales.summary : {};
  const coverage = isRecordValue(sales.coverage) ? sales.coverage : {};
  const products = Array.isArray(sales.products) ? sales.products.slice(0, 12) : [];
  const calculations = Array.isArray(sales.calculations)
    ? sales.calculations.filter((item) => isRecordValue(item)
      && typeof item.label === 'string'
      && Object.prototype.hasOwnProperty.call(item, 'value')
      && typeof item.formattedValue === 'string'
      && typeof item.formula === 'string'
      && typeof item.source === 'string'
      && isRecordValue(item.period)).slice(0, 32)
    : [];
  const assumptions = Array.isArray(sales.assumptions)
    ? sales.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 24)
    : [];
  const scenarios = Array.isArray(sales.scenarios)
    ? sales.scenarios.filter((item) => isRecordValue(item)).slice(0, 12)
    : [];
  const facts = products.filter((product) => isRecordValue(product)).map((product) => ({
    label: typeof product.name === 'string' ? product.name : 'Producto',
    quantity: commercialNumber(product.quantity),
    netSales: commercialNumber(product.netSales),
    margin: commercialNumber(product.margin),
    costKnown: product.costKnown === true
  }));
  const source = context.source === 'cloud' || context.source === 'local' || context.source === 'mixed'
    ? context.source
    : 'mixed';
  const validSales = commercialNumber(summary.salesCount) ?? commercialNumber(coverage.validSales) ?? 0;
  const costCoverage = commercialNumber(summary.costCoverage);
  const confidence = validSales === 0 || (costCoverage !== null && costCoverage < 0.7) ? 'low' : 'medium';

  return {
    version: 1,
    agentKey: 'salesProfitability',
    status: validSales > 0 ? 'completed' : 'incomplete',
    executiveSummary: '',
    explanation: '',
    facts,
    calculations,
    assumptions,
    scenarios,
    recommendations: [],
    limitations: [],
    confidence,
    source,
    coverage,
    citations: [],
    actionDrafts: []
  };
}
function normalizeProviderRecommendations(
  value: unknown,
  allowedEvidenceKeys: Set<string>,
  intent: string,
  evidence: Record<string, unknown>
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const compactNarrative = COMPACT_NARRATIVE_INTENTS.has(intent);
  const recommendations: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!isRecordValue(item)) continue;
    const title = safeCommercialText(item.title, '', compactNarrative ? 80 : 160);
    const explanation = safeCommercialText(item.explanation, '', compactNarrative ? 300 : 600);
    const action = safeCommercialText(item.action, '', compactNarrative ? 280 : 600);
    const measurement = safeCommercialText(item.measurement, '', compactNarrative ? 220 : 600);
    const expectedImpact = safeCommercialText(item.expectedImpact, '', compactNarrative ? 180 : 240);
    const legacyEffort = safeCommercialText(item.effort, '', 40);
    const priorityValue = safeCommercialText(item.priority, '', 40);
    const priority = ['high', 'medium', 'low'].includes(priorityValue)
      ? priorityValue
      : (['high', 'medium', 'low'].includes(legacyEffort) ? legacyEffort : 'medium');
    const rawEvidence = Array.isArray(item.evidenceKeys)
      ? item.evidenceKeys
      : (Array.isArray(item.evidence) ? item.evidence : []);
    const evidenceKeys = rawEvidence
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => safeCommercialText(entry, '', 160))
      .filter((entry) => entry && allowedEvidenceKeys.has(entry))
      .slice(0, compactNarrative ? 3 : 8);
    const recommendation: Record<string, unknown> = {
      title,
      explanation,
      expectedImpact,
      priority,
      evidenceKeys,
      requiresConfirmation: true
    };
    if (action) recommendation.action = action;
    if (measurement) recommendation.measurement = measurement;
    if (title && explanation && expectedImpact && evidenceKeys.length > 0
      && (!compactNarrative || (action && measurement))
      && recommendationHasGroundedEvidence(recommendation, evidenceKeys, intent, evidence, allowedEvidenceKeys)) {
      recommendations.push(recommendation);
    }
  }
  return recommendations.slice(0, compactNarrative ? 2 : 3);
}
function unavailableCommercialNormalization(
  request: CommercialAnalysisRequest,
  diagnosticCode: string
): CommercialNarrativeNormalization {
  const fallback = buildDeterministicCommercialResponse(request);
  const unavailable: Record<string, unknown> = {
    ...fallback,
    aiNarrative: {
      status: 'unavailable',
      diagnosticCode: isCommercialNarrativeDiagnosticCode(diagnosticCode) ? diagnosticCode : 'AI_NARRATIVE_UNAVAILABLE',
      executiveSummary: null,
      explanation: null,
      recommendations: []
    }
  };
  return {
    content: JSON.stringify(unavailable),
    available: false,
    diagnosticCode: String((unavailable.aiNarrative as Record<string, unknown>).diagnosticCode)
  };
}

function normalizeCommercialProviderResponse(
  content: string,
  request: CommercialAnalysisRequest,
  finishReason: string | null
): CommercialNarrativeNormalization {
  const normalizedFinishReason = finishReason?.trim().toLowerCase() || null;
  if (normalizedFinishReason === 'length'
    || normalizedFinishReason === 'max_tokens'
    || normalizedFinishReason === 'max_output_tokens'
    || normalizedFinishReason === 'incomplete') {
    return unavailableCommercialNormalization(request, 'AI_NARRATIVE_TRUNCATED');
  }
  if (normalizedFinishReason !== 'stop' && normalizedFinishReason !== 'completed') {
    return unavailableCommercialNormalization(request, 'AI_NARRATIVE_PROVIDER_ERROR');
  }

  const fallback = buildDeterministicCommercialResponse(request);
  const parsed = parseJsonRecord(content);
  const parsedConfidence = parsed && ['high', 'medium', 'low'].includes(String(parsed.confidence))
    ? String(parsed.confidence)
    : fallback.confidence;
  const contextSales = isRecordValue(request.context.sales) ? request.context.sales : {};
  const compactNarrative = COMPACT_NARRATIVE_INTENTS.has(request.intent);
  const allowedEvidenceKeys = new Set(compactNarrative
    ? buildNarrativeEvidenceKeyAllowlist(request.context, request.intent)
    : (Array.isArray(contextSales.evidenceKeys)
      ? contextSales.evidenceKeys.filter((entry): entry is string => typeof entry === 'string')
      : []));
  const compactEvidence = compactCommercialEvidence(request.context, request.intent);
  const providerRecommendations = normalizeProviderRecommendations(
    parsed?.recommendations,
    allowedEvidenceKeys,
    request.intent,
    compactEvidence
  );
  const safeNarrativeText = (value: unknown, maxLength: number) => safeCommercialText(value, '', maxLength);
  const summaryMaxLength = compactNarrative ? 300 : 1600;
  const explanationMaxLength = compactNarrative ? 800 : 1600;
  const summaryCandidates = parsed
    ? [parsed.executiveSummary, parsed.answer].filter((value) => typeof value === 'string')
    : [];
  const executiveSummary = summaryCandidates
    .map((value) => safeNarrativeText(value, summaryMaxLength))
    .find((value) => value.length > 0) || '';
  const explanation = safeNarrativeText(parsed?.explanation, explanationMaxLength);
  const hasNarrativeContent = Boolean(executiveSummary || explanation || providerRecommendations.length);
  const requiresActionableRecommendation = ACTIONABLE_NARRATIVE_INTENTS.has(request.intent)
    && hasActionableNarrativeEvidence(Array.from(allowedEvidenceKeys), request.intent);
  if (requiresActionableRecommendation
    && (!executiveSummary || !explanation || providerRecommendations.length === 0)) {
    return unavailableCommercialNormalization(request, 'AI_NARRATIVE_LOW_VALUE');
  }
  const unsafeNarrativeText = parsed
    ? [
      [parsed.executiveSummary, summaryMaxLength],
      [parsed.answer, summaryMaxLength],
      [parsed.explanation, explanationMaxLength]
    ].some(([value, maxLength]) => typeof value === 'string' && value.trim().length > 0
      && !safeNarrativeText(value, Number(maxLength)))
    : false;
  const hasPartialNarrativeInput = Boolean(parsed && (
    (Object.prototype.hasOwnProperty.call(parsed, 'executiveSummary')
      && parsed.executiveSummary !== undefined
      && typeof parsed.executiveSummary !== 'string')
    || (Object.prototype.hasOwnProperty.call(parsed, 'answer')
      && parsed.answer !== undefined
      && typeof parsed.answer !== 'string')
    || (Object.prototype.hasOwnProperty.call(parsed, 'explanation')
      && parsed.explanation !== undefined
      && typeof parsed.explanation !== 'string')
    || (Object.prototype.hasOwnProperty.call(parsed, 'recommendations')
      && (!Array.isArray(parsed.recommendations)
        || parsed.recommendations.length > providerRecommendations.length))
  ));
  let diagnosticCode: string | null = null;
  if (!content.trim()) diagnosticCode = 'AI_NARRATIVE_EMPTY';
  else if (!parsed) diagnosticCode = 'AI_NARRATIVE_INVALID_JSON';
  else if (!hasNarrativeContent) {
    diagnosticCode = unsafeNarrativeText
      ? 'AI_NARRATIVE_UNSAFE_CONTENT'
      : 'AI_NARRATIVE_MISSING_CONTENT';
  } else if (hasPartialNarrativeInput || unsafeNarrativeText) {
    diagnosticCode = 'AI_NARRATIVE_PARTIAL_CONTENT';
  }
  if (diagnosticCode && !isCommercialNarrativeDiagnosticCode(diagnosticCode)) {
    diagnosticCode = 'AI_NARRATIVE_UNAVAILABLE';
  }
  const usable = Boolean(hasNarrativeContent && parsed);
  const normalized: Record<string, unknown> = {
    ...fallback,
    executiveSummary,
    explanation,
    confidence: parsedConfidence,
    recommendations: providerRecommendations,
    aiNarrative: {
      status: hasNarrativeContent ? 'available' : 'unavailable',
      ...(diagnosticCode ? { diagnosticCode } : {}),
      executiveSummary: executiveSummary || null,
      explanation: explanation || null,
      recommendations: providerRecommendations,
      confidence: parsedConfidence
    }
  };
  if (!usable) {
    return unavailableCommercialNormalization(request, diagnosticCode || 'AI_NARRATIVE_MISSING_CONTENT');
  }
  if (!validateCommercialModelResponse(normalized)) {
    return unavailableCommercialNormalization(request, 'AI_NARRATIVE_UNAVAILABLE');
  }

  return {
    content: JSON.stringify(normalized),
    available: true,
    diagnosticCode
  };
}

async function completeUsage(
  client: RpcClient,
  usageId: string,
  success: boolean,
  provider: ProviderConfig,
  request: AnalysisRequest | CommercialAnalysisRequest,
  startedAt: number,
  now: () => number,
  providerResult: ProviderResult | null,
  failure: UsageFailure | null,
  promptLengths: { system: number; user: number } | null = null
): Promise<RpcResult> {
  const latency = Math.max(0, Math.trunc(now() - startedAt));
  const metadata: Record<string, unknown> = {
    agent_type: 'agentKey' in request ? request.agentKey : request.agentType,
    agent_key: 'agentKey' in request ? request.agentKey : null,
    intent: 'intent' in request ? request.intent : null,
    system_prompt_length: promptLengths?.system ?? ('systemPrompt' in request ? request.systemPrompt.length : 0),
    user_prompt_length: promptLengths?.user ?? ('userPrompt' in request ? request.userPrompt.length : 0),
    provider: provider.vendor,
    protocol: provider.style,
    model: provider.model,
    latency_ms: latency
  };

  if (providerResult?.requestId) metadata.request_id = providerResult.requestId;
  if (providerResult?.finishReason) metadata.finish_reason = providerResult.finishReason;
  if (providerResult?.reasoningTokens !== null && providerResult?.reasoningTokens !== undefined) {
    metadata.reasoning_tokens = providerResult.reasoningTokens;
  }
  if (failure) metadata.error_code = failure.code;
  if (failure?.narrativeDiagnostic) {
    metadata.narrative_status = 'unavailable';
    metadata.narrative_diagnostic = failure.narrativeDiagnostic;
  }

  return client.rpc('complete_ai_agent_analysis', {
    p_usage_id: usageId,
    p_success: success,
    p_prompt_tokens: providerResult?.promptTokens ?? null,
    p_completion_tokens: providerResult?.completionTokens ?? null,
    p_total_tokens: providerResult?.totalTokens ?? null,
    p_error_message: failure ? failure.message.slice(0, 160) : null,
    p_metadata: metadata
  });
}

async function refreshCommercialUsage(client: RpcClient, auth: AuthPayload): Promise<Record<string, unknown> | null> {
  try {
    const result = await client.rpc('get_ai_agent_usage_unlimited', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_device_security_token: auth.deviceSecurityToken,
      p_staff_session_token: auth.staffSessionToken
    });
    const snapshot = asSnapshot(result.data);
    if (result.error || !snapshot || snapshot.success !== true) return null;
    return analysisUsageStatus(snapshot);
  } catch {
    return null;
  }
}

async function handleUsage(
  client: RpcClient,
  auth: AuthPayload,
  requestId: string
): Promise<Response> {
  let result: RpcResult;
  try {
    result = await client.rpc('get_ai_agent_usage', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_device_security_token: auth.deviceSecurityToken,
      p_staff_session_token: auth.staffSessionToken
    });
  } catch {
    return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId);
  }

  if (result.error) return rpcFailureResponse('USAGE_LOOKUP_ERROR', 500, requestId, null);

  const snapshot = asSnapshot(result.data);
  if (!snapshot) return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId);
  if (snapshot.success !== true) {
    const code = safeCode(snapshot.code, 'USAGE_LOOKUP_ERROR');
    return errorResponse(statusForRpcCode(code), code, requestId, usageFields(snapshot));
  }

  return jsonResponse(200, snapshot, requestId);
}

async function handleAnalysis(
  client: RpcClient,
  request: AnalysisRequest,
  provider: ProviderConfig,
  fetchImpl: typeof fetch,
  now: () => number,
  requestId: string,
  providerTimeoutMs: number | undefined
): Promise<Response> {
  let begin: RpcResult;
  try {
    begin = await client.rpc('begin_ai_agent_analysis', {
      p_license_key: request.auth.licenseKey,
      p_device_fingerprint: request.auth.deviceFingerprint,
      p_device_security_token: request.auth.deviceSecurityToken,
      p_staff_session_token: request.auth.staffSessionToken,
      p_agent_type: request.agentType,
      p_metadata: {
        agent_type: request.agentType,
        system_prompt_length: request.systemPrompt.length,
        user_prompt_length: request.userPrompt.length
      }
    });
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);
  }

  const beginSnapshot = asSnapshot(begin.data);
  if (begin.error || !beginSnapshot) {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);
  }

  if (beginSnapshot.success !== true) {
    const code = safeCode(beginSnapshot.code, 'USAGE_RESERVATION_ERROR');
    return errorResponse(statusForRpcCode(code, 500), code, requestId, usageFields(beginSnapshot), NO_PROVIDER_NO_QUOTA);
  }

  const usageId = cleanText(beginSnapshot.usage_id);
  if (!usageId) return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);

  const startedAt = now();
  let providerResult: ProviderResult;
  try {
    providerResult = await requestProvider(
      provider,
      request.systemPrompt,
      request.userPrompt,
      request.options,
      fetchImpl,
      providerTimeoutMs
    );
    if (!providerResult.content.trim()) {
      throw new ProviderError('AI_EMPTY_RESPONSE', 'El proveedor IA devolvió una respuesta vacía.', 502);
    }
  } catch (error) {
    const failure = providerFailure(error);
    let completion: RpcResult;
    try {
      completion = await completeUsage(client, usageId, false, provider, request, startedAt, now, null, failure);
    } catch {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
    }

    const completionSnapshot = asSnapshot(completion.data);
    if (completion.error || completionSnapshot?.success !== true) {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
    }

    return errorResponse(failure.status, failure.code, requestId, {}, {
      providerCalled: true,
      quotaOutcome: completionSnapshot.status === 'failed' ? 'not_consumed' : 'not_confirmed'
    });
  }

  let completion: RpcResult;
  try {
    completion = await completeUsage(client, usageId, true, provider, request, startedAt, now, providerResult, null);
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
  }

  const completionSnapshot = asSnapshot(completion.data);
  if (completion.error || completionSnapshot?.success !== true || completionSnapshot.status !== 'completed') {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
  }

  return jsonResponse(200, {
    success: true,
    content: providerResult.content,
    usageStatus: analysisUsageStatus(beginSnapshot),
    providerCalled: true,
    quotaOutcome: 'consumed'
  }, requestId);
}

async function handleCommercialAnalysis(
  client: RpcClient,
  request: CommercialAnalysisRequest,
  provider: ProviderConfig,
  fetchImpl: typeof fetch,
  now: () => number,
  requestId: string,
  providerTimeoutMs: number | undefined
): Promise<Response> {
  const accessError = await validateCommercialAccess(client, request.auth, requestId);
  if (accessError) return accessError;

  let begin: RpcResult;
  try {
    begin = await client.rpc('begin_ai_agent_analysis', {
      p_license_key: request.auth.licenseKey,
      p_device_fingerprint: request.auth.deviceFingerprint,
      p_device_security_token: request.auth.deviceSecurityToken,
      p_staff_session_token: request.auth.staffSessionToken,
      p_agent_type: request.agentKey,
      p_metadata: {
        agent_key: request.agentKey,
        intent: request.intent,
        request_key: request.requestKey,
        period: request.period
      }
    });
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);
  }

  const beginSnapshot = asSnapshot(begin.data);
  if (begin.error || !beginSnapshot) return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);
  if (beginSnapshot.success !== true) {
    const code = safeCode(beginSnapshot.code, 'USAGE_RESERVATION_ERROR');
    return errorResponse(statusForRpcCode(code, 500), code, requestId, usageFields(beginSnapshot), NO_PROVIDER_NO_QUOTA);
  }

  const usageId = cleanText(beginSnapshot.usage_id);
  if (!usageId) return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, NO_PROVIDER_QUOTA_UNKNOWN);

  const prompts = buildCommercialPrompts(request);
  const startedAt = now();
  let providerResult: ProviderResult;
  let narrative: CommercialNarrativeNormalization;
  try {
    providerResult = await requestProvider(
      provider,
      prompts.systemPrompt,
      prompts.userPrompt,
      { ...request.options, maxTokens: Math.min(request.options.maxTokens, COMMERCIAL_MAX_TOKENS) },
      fetchImpl,
      providerTimeoutMs,
      COMMERCIAL_PROVIDER_REQUEST_MODE
    );
    narrative = normalizeCommercialProviderResponse(providerResult.content, request, providerResult.finishReason);
    providerResult = {
      ...providerResult,
      content: narrative.content
    };
  } catch (error) {
    const failure = providerFailure(error);
    let completion: RpcResult;
    try {
      completion = await completeUsage(
        client,
        usageId,
        false,
        provider,
        request,
        startedAt,
        now,
        null,
        failure,
        { system: prompts.systemPrompt.length, user: prompts.userPrompt.length }
      );
    } catch {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
    }
    const completionSnapshot = asSnapshot(completion.data);
    if (completion.error || completionSnapshot?.success !== true) {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
    }
    const failedConfirmed = completionSnapshot.status === 'failed';
    const usageStatus = failedConfirmed ? await refreshCommercialUsage(client, request.auth) : null;
    return errorResponse(failure.status, failure.code, requestId, usageStatus ? { usageStatus } : {}, {
      providerCalled: true,
      quotaOutcome: failedConfirmed ? 'not_consumed' : 'not_confirmed'
    });
  }

  if (!narrative.available) {
    const diagnosticCode = narrative.diagnosticCode || 'AI_NARRATIVE_UNAVAILABLE';
    const failure: UsageFailure = {
      code: diagnosticCode,
      message: `La narrativa no superó la validación (${diagnosticCode}).`,
      narrativeDiagnostic: diagnosticCode
    };
    let completion: RpcResult | null = null;
    try {
      completion = await completeUsage(
        client,
        usageId,
        false,
        provider,
        request,
        startedAt,
        now,
        providerResult,
        failure,
        { system: prompts.systemPrompt.length, user: prompts.userPrompt.length }
      );
    } catch {
      // La respuesta determinística sigue siendo útil; el estado de cuota queda sin confirmar.
    }
    const completionSnapshot = completion && !completion.error ? asSnapshot(completion.data) : null;
    const failedConfirmed = completionSnapshot?.success === true && completionSnapshot.status === 'failed';
    const quotaOutcome = failedConfirmed ? 'not_consumed' : 'not_confirmed';
    const usageStatus = failedConfirmed ? await refreshCommercialUsage(client, request.auth) : null;

    return jsonResponse(200, {
      success: true,
      agentKey: request.agentKey,
      intent: request.intent,
      content: providerResult.content,
      rawResultContent: providerResult.content,
      resultFormat: 'json',
      status: 'completed',
      usageStatus,
      providerCalled: true,
      quotaOutcome
    }, requestId);
  }

  let completion: RpcResult;
  try {
    completion = await completeUsage(
      client,
      usageId,
      true,
      provider,
      request,
      startedAt,
      now,
      providerResult,
      null,
      { system: prompts.systemPrompt.length, user: prompts.userPrompt.length }
    );
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
  }
  const completionSnapshot = asSnapshot(completion.data);
  if (completion.error || completionSnapshot?.success !== true || completionSnapshot.status !== 'completed') {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId, {}, PROVIDER_QUOTA_UNKNOWN);
  }

  return jsonResponse(200, {
    success: true,
    agentKey: request.agentKey,
    intent: request.intent,
    content: providerResult.content,
    rawResultContent: providerResult.content,
    resultFormat: 'json',
    status: 'completed',
    usageStatus: analysisUsageStatus(beginSnapshot),
    providerCalled: true,
    quotaOutcome: 'consumed'
  }, requestId);
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  const env = dependencies.env || ((name: string) => Deno.env.get(name) || undefined);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const factory = dependencies.createClient || createRestClient;
  const requestIdFactory = dependencies.requestId || (() => crypto.randomUUID());
  const now = dependencies.now || (() => Date.now());

  return async function handler(req: Request): Promise<Response> {
    const requestId = requestIdFactory();

    if (req.method === 'OPTIONS') return jsonResponse(200, { success: true }, requestId);
    if (req.method !== 'POST') return errorResponse(405, 'INVALID_REQUEST', requestId, {}, NO_PROVIDER_NO_QUOTA);
    if (!isJsonContentType(req.headers.get('content-type'))) return errorResponse(400, 'INVALID_REQUEST', requestId, {}, NO_PROVIDER_NO_QUOTA);

    const declaredLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'PROMPT_TOO_LARGE', requestId, {}, NO_PROVIDER_NO_QUOTA);
    }

    let rawBody: ArrayBuffer;
    try {
      rawBody = await req.arrayBuffer();
    } catch {
      return errorResponse(400, 'INVALID_REQUEST', requestId, {}, NO_PROVIDER_NO_QUOTA);
    }

    if (rawBody.byteLength > MAX_BODY_BYTES) return errorResponse(413, 'PROMPT_TOO_LARGE', requestId, {}, NO_PROVIDER_NO_QUOTA);

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return errorResponse(400, 'INVALID_REQUEST', requestId, {}, NO_PROVIDER_NO_QUOTA);
    }

    const validation = validatePayload(payload);
    if (!validation.ok) return errorResponse(validation.status, validation.code, requestId, {}, NO_PROVIDER_NO_QUOTA);

    const client = createServerClient(env, factory);
    if (isResponse(client)) return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId, {}, NO_PROVIDER_NO_QUOTA);

    if (validation.request.kind === 'usage') {
      return handleUsage(client, validation.request.auth, requestId);
    }

    const providerConfig = resolveProviderConfig(env);
    if (providerConfig instanceof ProviderError) {
      const code = providerConfig.message.includes('clave') ? 'AI_KEY_MISSING' : providerConfig.code;
      return errorResponse(providerConfig.status, code, requestId, {}, NO_PROVIDER_NO_QUOTA);
    }

    if (validation.request.kind === 'commercialAnalysis') {
      return handleCommercialAnalysis(client, validation.request, providerConfig, fetchImpl, now, requestId, dependencies.providerTimeoutMs);
    }

    return handleAnalysis(client, validation.request, providerConfig, fetchImpl, now, requestId, dependencies.providerTimeoutMs);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
