import { AIApiError, analyzeCommercialAgent } from '../aiService';
import { assertCurrentAIAgentActor } from '../auth/aiAgentAuthorization';
import { getSalesFinalHistoryScope } from '../auth/salesPermissionPolicy';
import { reportsRepository } from '../reports/reportsRepository';
import { productRepository } from '../products/productRepository';
import { useAppStore } from '../../store/useAppStore';
import {
  buildPreviousPeriod,
  buildSalesProfitabilityAnalysis
} from './salesProfitabilityAnalytics';
import {
  buildSalesProfitabilityProductExclusionsFromDataset,
  buildSalesProfitabilityProductOptionsFromDataset,
  loadSalesProfitabilityDataset
} from './salesProfitabilityData';
import {
  COMMERCIAL_AGENT_KEYS,
  createCommercialLocalResponse,
  normalizeScenarioForIntent,
  normalizeCommercialAINarrativeDiagnosticCode,
  parseCommercialAgentResponse,
  resolveCommercialIntent,
  validateCommercialAgentRequest
} from './commercialAgentContract';
import { buildSalesProfitabilityContext } from './commercialAgentContext';
import { buildAssortmentAnalysis } from './assortmentAnalytics';

const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';
const ASSORTMENT_INTENT = 'assortment_analysis';
const ASSORTMENT_MAX_PRODUCTS = 5000;
const ASSORTMENT_MAX_CATEGORIES = 500;
const ASSORTMENT_PERCENT_FORMATTER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const ASSORTMENT_CURRENCY_FORMATTER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const inflightRequests = new Map();
const VALID_QUOTA_OUTCOMES = new Set(['consumed', 'not_consumed', 'not_confirmed']);

const tenantContextKey = (actor) => {
  const tenant = actor?.tenant;
  if (!tenant?.opaqueId || !tenant?.databaseName || !Number.isFinite(tenant?.generation)) return null;
  return `${tenant.opaqueId}\u0000${tenant.databaseName}\u0000${tenant.generation}`;
};

const assertTenantUnchanged = (initialActor, currentActor) => {
  const initialKey = tenantContextKey(initialActor);
  const currentKey = tenantContextKey(currentActor);
  if (!initialKey || !currentKey || initialKey !== currentKey) {
    throw new AIApiError(
      'La sesión o el negocio activo cambió durante la lectura del catálogo. Vuelve a intentar el análisis.',
      409,
      { code: 'AI_AGENT_TENANT_CHANGED' },
      'AI_AGENT_TENANT_CHANGED'
    );
  }
};

export const loadAssortmentCatalogSnapshot = async ({
  repository = productRepository,
  actor,
  assertActor = assertCurrentAIAgentActor
} = {}) => {
  if (typeof repository?.getAssortmentCatalogSnapshot !== 'function') {
    throw new AIApiError('No se pudo cargar el catálogo del negocio.', 503, { code: 'ASSORTMENT_CATALOG_UNAVAILABLE' }, 'ASSORTMENT_CATALOG_UNAVAILABLE');
  }
  if (!tenantContextKey(actor)) {
    throw new AIApiError('No se pudo confirmar el negocio activo para leer el catálogo.', 409, { code: 'AI_AGENT_TENANT_CHANGED' }, 'AI_AGENT_TENANT_CHANGED');
  }
  let snapshot;
  try {
    snapshot = await repository.getAssortmentCatalogSnapshot({
      maxProducts: ASSORTMENT_MAX_PRODUCTS,
      maxCategories: ASSORTMENT_MAX_CATEGORIES
    });
  } catch {
    assertTenantUnchanged(actor, assertActor());
    return {
      source: 'local_tenant_catalog',
      products: [],
      categories: [],
      productsTruncated: false,
      categoriesTruncated: false,
      complete: false
    };
  }
  assertTenantUnchanged(actor, assertActor());
  if (!snapshot || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.categories)) {
    throw new AIApiError('El catálogo devuelto no está completo.', 503, { code: 'ASSORTMENT_CATALOG_INVALID' }, 'ASSORTMENT_CATALOG_INVALID');
  }
  return snapshot;
};

const readFailureExecution = (error) => {
  const payload = error?.originalError && typeof error.originalError === 'object'
    ? error.originalError
    : {};
  const payloadQuotaOutcome = VALID_QUOTA_OUTCOMES.has(payload.quotaOutcome)
    ? payload.quotaOutcome
    : null;
  if (typeof payload.providerCalled === 'boolean' && payloadQuotaOutcome) {
    return { providerCalled: payload.providerCalled, quotaOutcome: payloadQuotaOutcome };
  }

  // A successful Edge response proves that the provider call and usage
  // completion both finished, even when the returned narrative is unusable.
  if (payload.success === true) {
    return {
      providerCalled: true,
      quotaOutcome: payloadQuotaOutcome || 'consumed'
    };
  }

  const code = error?.code || payload.code || payload.reason;
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (code === 'INVALID_REQUEST' && statusCode === 400) {
    // This is compatible with deployed Edge v39, which predates the
    // structured execution fields but validates before usage reservation.
    return { providerCalled: false, quotaOutcome: 'not_consumed' };
  }

  const confirmedPreProviderCodes = new Set([
    'AUTH_PAYLOAD_REQUIRED',
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
    'AI_RATE_LIMITED',
    'AI_KEY_MISSING',
    'PROMPT_TOO_LARGE'
  ]);
  if (
    confirmedPreProviderCodes.has(code)
    || (code === 'AI_PROVIDER_ERROR' && statusCode === 500)
  ) {
    return { providerCalled: false, quotaOutcome: 'not_consumed' };
  }

  if (['AI_REQUEST_FAILED', 'AI_EMPTY_RESPONSE', 'AI_INVALID_RESPONSE', 'MALFORMED_JSON'].includes(code)) {
    return { providerCalled: true, quotaOutcome: 'not_confirmed' };
  }

  return { providerCalled: null, quotaOutcome: 'not_confirmed' };
};

export const resolveBusinessTimezone = (companyProfile = {}) => (
  companyProfile?.timezone
  || companyProfile?.time_zone
  || DEFAULT_BUSINESS_TIMEZONE
);

const stableSerialize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
};

const defaultRequestKey = (request) => {
  const encoded = stableSerialize({
    agentKey: request.agentKey,
    intent: request.intent,
    question: request.question,
    period: request.period,
    scenario: request.scenario
  });
  return `sales-profitability:${encoded}`;
};

const normalizePeriod = (period = {}) => {
  const companyProfile = useAppStore.getState()?.companyProfile || {};
  return {
    from: period.from || period.dateFrom || null,
    to: period.to || period.dateTo || null,
    days: Math.max(Number(period.days) || 30, 1),
    previous: period.previous || null,
    timezone: period.timezone || resolveBusinessTimezone(companyProfile)
  };
};

const priorityFromLegacyEffort = (effort) => {
  if (effort === 'high') return 'high';
  if (effort === 'low') return 'low';
  return 'medium';
};

const ALLOWED_EVIDENCE_PREFIXES = Object.freeze([
  'profitability.',
  'coverage.',
  'comparison.',
  'current.',
  'product:',
  'channel:',
  'metric:',
  'priceSimulation.',
  'promotionSimulation.',
  'comboOpportunities.',
  'assortment.'
]);

const allowedEvidenceKey = (value) => (
  typeof value === 'string'
  && ALLOWED_EVIDENCE_PREFIXES.some((prefix) => value.startsWith(prefix))
);

const normalizeNarrativeRecommendations = (recommendations = [], requireUtility = false) => (
  (Array.isArray(recommendations) ? recommendations : [])
    .slice(0, 3)
    .map((recommendation = {}) => ({
      title: String(recommendation.title || '').trim(),
      explanation: String(recommendation.explanation || '').trim(),
      action: typeof recommendation.action === 'string' ? recommendation.action.trim() : '',
      measurement: typeof recommendation.measurement === 'string' ? recommendation.measurement.trim() : '',
      ...(recommendation.focus && typeof recommendation.focus === 'object' && !Array.isArray(recommendation.focus)
        ? { focus: {
          type: String(recommendation.focus.type || '').trim(),
          key: String(recommendation.focus.key || '').trim()
        } }
        : {}),
      ...(typeof recommendation.recommendationType === 'string'
        ? { recommendationType: recommendation.recommendationType.trim() }
        : {}),
      expectedImpact: String(recommendation.expectedImpact || '').trim(),
      priority: ['high', 'medium', 'low'].includes(recommendation.priority)
        ? recommendation.priority
        : priorityFromLegacyEffort(recommendation.effort),
      evidenceKeys: Array.isArray(recommendation.evidenceKeys)
        ? recommendation.evidenceKeys.filter(allowedEvidenceKey).slice(0, 8)
        : (Array.isArray(recommendation.evidence)
          ? recommendation.evidence.filter(allowedEvidenceKey).slice(0, 8)
          : []),
      requiresConfirmation: true
    }))
    .filter((recommendation) => (
      recommendation.title
      && recommendation.explanation
      && recommendation.expectedImpact
      && (!requireUtility || (recommendation.action && recommendation.measurement))
      && (!requireUtility || (recommendation.focus?.type && recommendation.focus?.key && recommendation.recommendationType))
      && recommendation.evidenceKeys.length > 0
    ))
);

const narrativeDiagnosticFromContractFailure = (code) => {
  if (code === 'MALFORMED_JSON') return 'AI_NARRATIVE_INVALID_JSON';
  if (code === 'UNSAFE_RESPONSE_CONTENT') return 'AI_NARRATIVE_UNSAFE_CONTENT';
  if (code === 'AI_NARRATIVE_CONTENT_REQUIRED' || code === 'EXECUTIVE_SUMMARY_REQUIRED') {
    return 'AI_NARRATIVE_MISSING_CONTENT';
  }
  return 'AI_NARRATIVE_UNAVAILABLE';
};

const mergeProviderResponse = (deterministic, providerResponse, intent = null) => {
  const requireNarrativeUtility = ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', ASSORTMENT_INTENT].includes(intent);
  const parsed = parseCommercialAgentResponse(providerResponse, {
    expectedAgentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    requireNarrativeUtility
  });
  if (!parsed.valid) {
    return {
      ...deterministic,
      aiNarrative: {
        status: 'unavailable',
        diagnosticCode: narrativeDiagnosticFromContractFailure(parsed.code),
        executiveSummary: null,
        explanation: null,
        recommendations: []
      },
      actionDrafts: [],
      citations: []
    };
  }

  const response = parsed.response;
  const hasNestedNarrative = response.aiNarrative && typeof response.aiNarrative === 'object'
    && !Array.isArray(response.aiNarrative);
  const narrative = hasNestedNarrative ? response.aiNarrative : response;
  const directAnswer = String(
    hasNestedNarrative
      ? (narrative.directAnswer || '')
      : (response.directAnswer || '')
  ).trim() || null;
  const executiveSummary = String(
    hasNestedNarrative
      ? (narrative.executiveSummary || narrative.answer || directAnswer || '')
      : (response.executiveSummary || response.answer || directAnswer || '')
  ).trim() || null;
  const explanation = String(narrative.explanation || '').trim() || null;
  const providerRecommendations = normalizeNarrativeRecommendations(
    hasNestedNarrative ? narrative.recommendations : response.recommendations,
    requireNarrativeUtility
  );
  const hasNarrativeContent = Boolean(executiveSummary || explanation || providerRecommendations.length);
  const requestedStatus = narrative.status === 'unavailable' ? 'unavailable' : null;
  const status = hasNarrativeContent && requestedStatus !== 'unavailable' ? 'available' : 'unavailable';
  const diagnosticCode = normalizeCommercialAINarrativeDiagnosticCode(narrative.diagnosticCode)
    || (status === 'unavailable' ? 'AI_NARRATIVE_MISSING_CONTENT' : null);

  return {
    ...deterministic,
    ...(Array.isArray(response.opportunityCandidates)
      ? { opportunityCandidates: response.opportunityCandidates }
      : {}),
    ...(Number.isInteger(response.minimumUsefulRecommendations)
      ? { minimumUsefulRecommendations: response.minimumUsefulRecommendations }
      : {}),
    recommendations: deterministic.recommendations,
    aiNarrative: {
      status,
      ...(diagnosticCode ? { diagnosticCode } : {}),
      directAnswer: status === 'available' ? directAnswer : null,
      executiveSummary: status === 'available' ? executiveSummary : null,
      explanation: status === 'available' ? explanation : null,
      recommendations: status === 'available' ? providerRecommendations : [],
      ...(status === 'available' && ['high', 'medium', 'low'].includes(String(narrative.confidence || response.confidence))
        ? { confidence: narrative.confidence || response.confidence }
        : {})
    },
    actionDrafts: [],
    citations: []
  };
};

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const costCoverageFor = (aggregate, metadata) => {
  const netSales = Number(aggregate?.netSales) || 0;
  return netSales > 0 ? Math.min(Math.max((Number(metadata?.knownSales) || 0) / netSales, 0), 1) : 0;
};

const enrichProducts = (products = [], metadata = {}) => {
  const evidence = new Map(
    (Array.isArray(metadata.products) ? metadata.products : [])
      .map((product) => [product.name, product])
  );
  return (Array.isArray(products) ? products : []).map((product) => {
    const detail = evidence.get(product.name);
    return {
      ...product,
      costStatus: detail?.costStatus || (product.costKnown ? 'estimated' : 'incomplete'),
      costSource: detail?.costSource || (product.costKnown ? 'sale_item_snapshot' : 'missing'),
      knownCost: detail?.knownCost ?? product.cost ?? null
    };
  });
};

const hardenAggregate = (aggregate, metadata = {}) => {
  if (!aggregate) return null;
  const sourceReliable = Number(aggregate?.meta?.sourcePolicy?.unknownSources || 0) === 0;
  const complete = metadata.costComplete === true
    && aggregate.costComplete === true
    && sourceReliable;
  const products = enrichProducts(aggregate.products, metadata);
  const units = Number(metadata.expectedUnits) > 0 ? Number(metadata.expectedUnits) : aggregate.units;
  const costCoverage = costCoverageFor(aggregate, metadata);

  return {
    ...aggregate,
    units,
    unitsPerTicket: metadata.detailComplete === true && aggregate.salesCount > 0
      ? units / aggregate.salesCount
      : null,
    products,
    costOfSale: complete ? aggregate.costOfSale : null,
    knownCostOfSale: Number(metadata.knownCost) || 0,
    costComplete: complete,
    profit: complete ? aggregate.profit : null,
    margin: complete ? aggregate.margin : null,
    costCoverage,
    detailComplete: metadata.detailComplete === true,
    itemCoverage: Number(metadata.itemCoverage) || 0,
    paginationComplete: metadata.paginationComplete === true,
    sourceComplete: metadata.sourceComplete === true && sourceReliable,
    costStatus: complete ? metadata.costStatus : 'incomplete'
  };
};

const hardenCalculations = (calculations, {
  currentComplete,
  comparisonComplete,
  comparisonDataAvailable,
  currentMetadata,
  previousMetadata
}) => {
  const currentUnsafe = new Set([
    'Costo de venta',
    'Utilidad bruta',
    'Margen bruto',
    'Margen actual',
    'Utilidad actual'
  ]);
  const comparisonUnsafe = new Set([
    'Margen anterior',
    'Variación absoluta del margen',
    'Variación relativa del margen',
    'Utilidad anterior'
  ]);
  const comparisonSalesUnsafe = new Set([
    'Ventas netas anteriores',
    'Variación absoluta de ventas',
    'Variación relativa de ventas',
    'Tickets anteriores',
    'Ticket promedio anterior',
    'Variación absoluta del ticket',
    'Variación relativa del ticket',
    'Unidades por ticket anteriores',
    'Variación de unidades por ticket'
  ]);
  const currentItemUnsafe = new Set(['Unidades por ticket', 'Unidades por ticket actuales']);
  const previousItemUnsafe = new Set(['Unidades por ticket anteriores', 'Variación de unidades por ticket']);

  const rows = (Array.isArray(calculations) ? calculations : []).map((row) => {
    const unsafe = (!currentComplete && currentUnsafe.has(row.label))
      || (!comparisonComplete && comparisonUnsafe.has(row.label))
      || (!comparisonDataAvailable && comparisonSalesUnsafe.has(row.label))
      || (currentMetadata?.detailComplete !== true && currentItemUnsafe.has(row.label))
      || (previousMetadata?.detailComplete !== true && previousItemUnsafe.has(row.label));
    if (!unsafe) {
      if (row.label === 'Cobertura de costos') {
        const value = Number(currentMetadata?.knownSales) > 0 ? row.value : 0;
        return { ...row, value };
      }
      return row;
    }
    return { ...row, value: null, formattedValue: 'No disponible' };
  });

  if (!currentComplete && Number(currentMetadata?.knownCost) > 0) {
    rows.push({
      label: 'Costo conocido parcial',
      value: Number(currentMetadata.knownCost),
      formattedValue: new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        maximumFractionDigits: 2
      }).format(Number(currentMetadata.knownCost)),
      formula: 'suma exclusiva de líneas con evidencia de costo válida; no representa el costo total',
      source: 'sales_profit_report',
      period: null
    });
  }
  return rows;
};

const buildCoverage = ({
  deterministic,
  current,
  currentMetadata,
  comparisonComplete,
  previousMetadata,
  hasPrevious
}) => ({
  ...deterministic.coverage,
  productsIncluded: current.products.length,
  costCoverage: current.costCoverage,
  comparisonAvailable: comparisonComplete,
  comparisonDataAvailable: hasPrevious === true
    && current.sourceComplete === true
    && current.paginationComplete === true
    && previousMetadata?.sourceComplete === true
    && previousMetadata?.paginationComplete === true,
  comparisonItemsAvailable: hasPrevious === true
    && current.sourceComplete === true
    && current.paginationComplete === true
    && current.detailComplete === true
    && previousMetadata?.sourceComplete === true
    && previousMetadata?.paginationComplete === true
    && previousMetadata?.detailComplete === true,
  salesDataComplete: current.salesCount > 0
    && current.sourceComplete === true
    && current.paginationComplete === true,
  growthDataComplete: current.salesCount > 0
    && current.sourceComplete === true
    && current.paginationComplete === true
    && current.detailComplete === true,
  detailLines: Number(currentMetadata.matchedDetailLines) || 0,
  expectedDetailLines: Number(currentMetadata.expectedDetailLines) || 0,
  itemCoverage: Number(currentMetadata.itemCoverage) || 0,
  itemsComplete: currentMetadata.detailComplete === true,
  paginationComplete: currentMetadata.paginationComplete === true,
  sourceComplete: current.sourceComplete === true,
  historyTruncated: currentMetadata.historyTruncated === true,
  detailTruncated: currentMetadata.detailTruncated === true,
  knownCostOfSale: Number(currentMetadata.knownCost) || 0,
  costStatus: current.costStatus,
  complete: current.costComplete === true
});

const hardenComparison = (comparison, currentComplete, previousComplete) => {
  if (!comparison) return null;
  if (currentComplete && previousComplete) return comparison;
  return {
    ...comparison,
    previousCost: previousComplete ? comparison.previousCost : null,
    previousProfit: previousComplete ? comparison.previousProfit : null,
    previousMargin: previousComplete ? comparison.previousMargin : null,
    deltaCost: null,
    deltaProfit: null,
    deltaMargin: null,
    deltaMarginRelative: null
  };
};

const limitationMessages = (metadata, prefix = 'periodo') => {
  const limitations = [];
  if (metadata.detailComplete !== true) {
    limitations.push(`El detalle de artículos del ${prefix} está incompleto; las ventas se conservan, pero utilidad y margen no se confirman.`);
  }
  if (metadata.costStatus === 'incomplete') {
    limitations.push(`Hay líneas del ${prefix} sin evidencia de costo válida; los valores coaccionados a cero no se usan como costo real.`);
  }
  if (metadata.paginationComplete !== true) {
    limitations.push(`La cobertura del ${prefix} quedó truncada por paginación o límite de seguridad.`);
  }
  if (metadata.sourceComplete !== true) {
    limitations.push(`La fuente del ${prefix} no está completa o proviene de cache/fallback; el resultado se marca como incompleto.`);
  }
  return limitations;
};

const intentHasUsefulEvidence = (response) => {
  if (!response) return false;
  if (response.intent === ASSORTMENT_INTENT) return response.assortment?.narrativeEligible === true;
  if (response.coverage?.validSales === 0) return false;
  switch (response.intent) {
    case 'profitability_summary':
      return response.coverage?.complete === true;
    case 'explain_change':
      return response.coverage?.comparisonAvailable === true;
    case 'product_risk':
      return response.coverage?.itemsComplete === true
        && response.coverage?.paginationComplete === true
        && response.coverage?.sourceComplete === true
        && response.current?.products?.length > 0;
    case 'sales_growth':
      return response.coverage?.growthDataComplete === true;
    case 'ticket_growth':
      return response.coverage?.salesDataComplete === true
        && response.current?.averageTicket !== null
        && response.current?.averageTicket !== undefined;
    case 'product_opportunity':
      return response.coverage?.comparisonItemsAvailable === true
        && response.comparison?.productChanges?.length > 0
        && response.current?.products?.length > 0;
    case 'sales_trend':
      return response.coverage?.comparisonItemsAvailable === true
        && response.comparison
        && response.coverage?.validSales > 0;
    case ASSORTMENT_INTENT:
      return response.assortment?.narrativeEligible === true;
    case 'price_simulation':
      return Boolean(response.priceSimulation) && response.coverage?.sourceComplete === true;
    case 'promotion_opportunity':
      return Boolean(response.promotionSimulation) && response.coverage?.sourceComplete === true;
    case 'combo_opportunity':
      return response.coverage?.itemsComplete === true
        && response.coverage?.paginationComplete === true
        && response.coverage?.sourceComplete === true
        && response.comboOpportunities?.length > 0;
    default:
      return false;
  }
};

const intentStatus = (response) => {
  if (response.coverage?.validSales === 0) return 'insufficient_data';
  if (response.intent === 'combo_opportunity' && response.comboOpportunities?.length === 0) return 'insufficient_data';
  return intentHasUsefulEvidence(response) ? 'completed' : 'incomplete';
};

const incompleteRecommendations = (response) => {
  if (
    response.intent === 'profitability_summary'
    && response.coverage?.validSales > 0
    && response.coverage?.complete !== true
  ) {
    return [{
      title: 'Completar detalle y costos antes de decidir',
      explanation: 'La utilidad y el margen total permanecen indeterminados mientras la cobertura de artículos, costos o fuente no sea completa.',
      expectedImpact: 'Evitar decisiones basadas en costos faltantes interpretados como cero.',
      priority: 'high',
      evidenceKeys: ['coverage.itemsComplete', 'coverage.costCoverage'],
      requiresConfirmation: true
    }];
  }
  return [];
};

const buildSafeNarrative = (response) => {
  const sales = Number(response.coverage?.validSales) || 0;
  const netSales = Number(response.current?.netSales) || 0;
  const money = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2
  });

  if (sales === 0) {
    return {
      executiveSummary: 'No hay ventas válidas en el periodo seleccionado.',
      explanation: 'No se llamó al proveedor de IA porque no existe evidencia comercial suficiente para esta consulta.'
    };
  }

  if (response.intent === 'profitability_summary' && response.coverage?.complete !== true) {
    return {
      executiveSummary: `Se registraron ${sales} venta(s) por ${money.format(netSales)}, pero la utilidad y el margen no están disponibles con cobertura suficiente.`,
      explanation: 'Lanzo-POS conserva las ventas confirmadas y separa el costo conocido parcial; no interpreta detalle ausente ni costos faltantes como cero.'
    };
  }

  if (response.intent === 'explain_change' && response.coverage?.comparisonAvailable !== true) {
    return {
      executiveSummary: 'No hay una comparación de margen completa y válida para explicar el cambio.',
      explanation: 'Se requieren ambos periodos con detalle de artículos, costos y paginación completos antes de atribuir una variación de margen.'
    };
  }

  if (response.intent === 'sales_growth' && response.coverage?.growthDataComplete !== true) {
    return {
      executiveSummary: `Se registraron ${sales} venta(s) por ${money.format(netSales)}, pero la cobertura de artículos, paginación o fuente no permite priorizar señales de crecimiento con suficiente confianza.`,
      explanation: 'Las ventas del periodo se conservan como evidencia determinística. No se genera una narrativa de proveedor ni se presenta un ranking exhaustivo con datos incompletos.'
    };
  }

  if (response.intent === 'ticket_growth' && response.coverage?.salesDataComplete !== true) {
    return {
      executiveSummary: `Se registraron ${sales} venta(s) por ${money.format(netSales)}, pero la cobertura no permite confirmar el ticket promedio del periodo.`,
      explanation: 'Se requiere una lectura completa de las ventas válidas del periodo antes de explicar el ticket.'
    };
  }

  if (response.intent === 'ticket_growth' && response.coverage?.itemsComplete !== true) {
    return {
      executiveSummary: `El ticket promedio fue ${money.format(Number(response.current?.averageTicket) || 0)} en ${sales} venta(s).`,
      explanation: 'El detalle de artículos está incompleto, así que las unidades por ticket y las combinaciones históricas no se presentan como completas.'
    };
  }

  if (response.intent === 'product_opportunity' && response.coverage?.comparisonItemsAvailable !== true) {
    return {
      executiveSummary: 'No hay detalle comparable completo para priorizar productos actuales con confianza.',
      explanation: 'La comparación por producto requiere artículos, paginación y fuentes completos en ambos periodos. Los costos faltantes se mantienen desconocidos.'
    };
  }

  if (response.intent === 'sales_trend' && response.coverage?.comparisonItemsAvailable !== true) {
    return {
      executiveSummary: 'No hay una comparación completa de periodos equivalentes para confirmar la tendencia de ventas.',
      explanation: 'La lectura requiere rangos temporales equivalentes, ventas completas y detalle de artículos disponible en ambos periodos.'
    };
  }

  if (response.intent === 'product_risk' && response.coverage?.itemsComplete !== true) {
    return {
      executiveSummary: 'No hay detalle de productos suficiente para identificar productos problemáticos con confianza.',
      explanation: 'La lista de riesgos sólo se construye a partir de artículos vendidos reales y señala costos faltantes cuando existe evidencia por producto.'
    };
  }

  if (response.intent === 'price_simulation' && !response.priceSimulation) {
    return {
      executiveSummary: 'No hay datos suficientes para completar la simulación de precio.',
      explanation: 'La simulación requiere un producto vendido en el periodo, un precio nuevo y evidencia válida de costo; sin esos datos no se estima utilidad ni margen.'
    };
  }

  if (response.intent === 'promotion_opportunity' && !response.promotionSimulation) {
    return {
      executiveSummary: 'No hay datos suficientes para construir una promoción respaldada.',
      explanation: 'Selecciona un producto con detalle real y define un descuento o precio promocional; si el costo es desconocido no se publicará utilidad o margen.'
    };
  }

  if (response.intent === 'combo_opportunity' && response.comboOpportunities?.length === 0) {
    return {
      executiveSummary: 'No hay evidencia suficiente de compras conjuntas para proponer un combo confiable.',
      explanation: 'Los combos sólo se derivan de artículos agrupados dentro de las mismas ventas y requieren una frecuencia histórica mínima.'
    };
  }

  return {
    executiveSummary: response.executiveSummary,
    explanation: response.explanation
  };
};

const hardenDeterministicResult = ({
  deterministic,
  currentDataset,
  previousDataset
}) => {
  const currentMetadata = currentDataset.metadata;
  const previousMetadata = previousDataset?.metadata || null;
  const current = hardenAggregate(deterministic.current, currentMetadata);
  const previous = deterministic.previous && previousMetadata
    ? hardenAggregate(deterministic.previous, previousMetadata)
    : deterministic.previous;
  const currentComplete = current?.costComplete === true;
  const previousComplete = previous ? previous.costComplete === true : false;
  const comparisonComplete = Boolean(deterministic.comparison && currentComplete && previousComplete);
  let comparison = hardenComparison(deterministic.comparison, currentComplete, previousComplete);
  const coverage = buildCoverage({
    deterministic,
    current,
    currentMetadata,
    comparisonComplete,
    previousMetadata,
    hasPrevious: Boolean(previous)
  });
  if (['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(deterministic.intent)
    && coverage.comparisonDataAvailable !== true) {
    comparison = null;
  } else if (comparison && coverage.comparisonItemsAvailable !== true) {
    comparison = {
      ...comparison,
      previousUnitsPerTicket: null,
      deltaUnitsPerTicket: null
    };
  }

  const profitability = {
    ...deterministic.profitability,
    status: current.salesCount === 0
      ? 'insufficient_data'
      : (currentComplete ? deterministic.profitability.status : 'undetermined'),
    costOfSale: currentComplete ? deterministic.profitability.costOfSale : null,
    profit: currentComplete ? deterministic.profitability.profit : null,
    margin: currentComplete ? deterministic.profitability.margin : null,
    costCoverage: current.costCoverage,
    explanation: current.salesCount === 0
      ? 'No hay ventas válidas suficientes en el periodo para evaluar la rentabilidad.'
      : currentComplete
        ? deterministic.profitability.explanation
        : 'La rentabilidad es indeterminada porque el detalle de artículos, los costos o la cobertura de la fuente están incompletos.'
  };

  const limitations = unique([
    ...(deterministic.limitations || []),
    ...limitationMessages(currentMetadata, 'periodo actual'),
    ...(previousMetadata ? limitationMessages(previousMetadata, 'periodo anterior') : [])
  ]);

  let comboOpportunities = deterministic.comboOpportunities;
  let scenarios = deterministic.scenarios;
  let contributors = deterministic.contributors;
  let growthSignals = deterministic.growthSignals;
  let productOpportunities = deterministic.productOpportunities;
  if (currentMetadata.detailComplete !== true || currentMetadata.paginationComplete !== true) {
    if (deterministic.intent === 'combo_opportunity') {
      comboOpportunities = [];
      scenarios = [];
    }
  }
  if (!comparisonComplete && deterministic.intent === 'explain_change') contributors = [];
  if (currentMetadata.detailComplete !== true || currentMetadata.paginationComplete !== true
    || current.sourceComplete !== true) {
    if (['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(deterministic.intent)) {
      growthSignals = {
        ...(growthSignals || {}),
        productsGrowing: [],
        productsDeclining: [],
        productOpportunities: [],
        channelChanges: [],
        comparisonAvailable: false
      };
      productOpportunities = [];
    }
  }
  if (!coverage.comparisonItemsAvailable
    && ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(deterministic.intent)) {
    productOpportunities = [];
    if (growthSignals) {
      growthSignals = {
        ...growthSignals,
        productsGrowing: [],
        productsDeclining: [],
        productOpportunities: [],
        channelChanges: [],
        comparisonAvailable: false,
        previousNetSales: coverage.comparisonDataAvailable ? growthSignals.previousNetSales : null,
        deltaNetSales: coverage.comparisonDataAvailable ? growthSignals.deltaNetSales : null,
        deltaNetSalesPercent: coverage.comparisonDataAvailable ? growthSignals.deltaNetSalesPercent : null,
        previousSalesCount: coverage.comparisonDataAvailable ? growthSignals.previousSalesCount : null,
        deltaSalesCount: coverage.comparisonDataAvailable ? growthSignals.deltaSalesCount : null,
        previousUnits: coverage.comparisonDataAvailable ? growthSignals.previousUnits : null,
        deltaUnits: coverage.comparisonDataAvailable ? growthSignals.deltaUnits : null,
        previousAverageTicket: coverage.comparisonDataAvailable ? growthSignals.previousAverageTicket : null,
        deltaTicket: coverage.comparisonDataAvailable ? growthSignals.deltaTicket : null,
        deltaTicketPercent: coverage.comparisonDataAvailable ? growthSignals.deltaTicketPercent : null,
        previousUnitsPerTicket: coverage.comparisonItemsAvailable ? growthSignals.previousUnitsPerTicket : null,
        deltaUnitsPerTicket: coverage.comparisonItemsAvailable ? growthSignals.deltaUnitsPerTicket : null
      };
    }
  }

  const hardened = {
    ...deterministic,
    current,
    previous,
    comparison,
    contributors,
    growthSignals,
    productOpportunities,
    comboOpportunities,
    scenarios,
    profitability,
    coverage,
    limitations,
    calculations: hardenCalculations(deterministic.calculations, {
      currentComplete,
      comparisonComplete,
      comparisonDataAvailable: coverage.comparisonDataAvailable,
      currentMetadata,
      previousMetadata
    }),
    confidence: current.salesCount === 0
      ? 'low'
      : ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(deterministic.intent)
        ? (deterministic.intent === 'ticket_growth'
          ? (coverage.salesDataComplete ? 'high' : 'low')
          : (coverage.growthDataComplete
            && (['sales_growth'].includes(deterministic.intent) || coverage.comparisonItemsAvailable)
            ? 'high'
            : 'low'))
        : currentComplete
          ? (current.costStatus === 'definitive' ? deterministic.confidence : 'medium')
          : 'low',
    queryRange: {
      current: currentMetadata.queryRange,
      previous: previousMetadata?.queryRange || null
    }
  };

  hardened.status = intentStatus(hardened);
  if (!intentHasUsefulEvidence(hardened)) {
    hardened.recommendations = incompleteRecommendations(hardened);
  }
  const narrative = buildSafeNarrative(hardened);
  hardened.executiveSummary = narrative.executiveSummary;
  hardened.answer = narrative.executiveSummary;
  hardened.explanation = narrative.explanation;

  if (!currentComplete) {
    hardened.facts = (hardened.facts || []).map((fact) => ({
      ...fact,
      profit: null,
      margin: null
    }));
  }

  hardened.context = {
    ...(hardened.context || {}),
    summary: {
      ...(hardened.context?.summary || {}),
      units: current.units,
      unitsPerTicket: current.unitsPerTicket,
      discounts: current.discountsKnown ? current.discounts : null,
      discountsKnown: current.discountsKnown === true,
      unitCosts: currentComplete ? current.costOfSale : null,
      knownCostOfSale: current.knownCostOfSale,
      profit: current.profit,
      margin: current.margin,
      costCoverage: current.costCoverage,
      profitabilityStatus: profitability.status,
      profitabilityExplanation: profitability.explanation
    },
    products: current.products.map((product) => ({
      name: product.name,
      quantity: product.quantity,
      netSales: product.netSales,
      unitCost: product.unitCost,
      profit: product.profit,
      margin: product.margin,
      averagePrice: product.averagePrice,
      costKnown: product.costKnown,
      costStatus: product.costStatus,
      costSource: product.costSource
    })),
    comparison: (comparisonComplete || coverage.comparisonDataAvailable)
      ? {
        ...hardened.context?.comparison,
        ...(coverage.comparisonItemsAvailable ? {} : {
          previousUnitsPerTicket: null,
          deltaUnitsPerTicket: null
        })
      }
      : null,
    growthSignals: ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'].includes(deterministic.intent)
      ? growthSignals
      : hardened.context?.growthSignals
  };

  return hardened;
};

export const createSalesProfitabilityProductLoader = ({
  repository = reportsRepository,
  assertActor = assertCurrentAIAgentActor
} = {}) => async ({ period = {} } = {}) => {
  const normalizedPeriod = normalizePeriod(period);
  const actor = assertActor();
  const scope = getSalesFinalHistoryScope(actor);
  const dataset = await loadSalesProfitabilityDataset({
    repository,
    period: normalizedPeriod,
    scope
  });
  return {
    products: buildSalesProfitabilityProductOptionsFromDataset(dataset),
    excludedProducts: buildSalesProfitabilityProductExclusionsFromDataset(dataset),
    source: dataset.metadata.sourceMode,
    coverage: {
      itemsComplete: dataset.metadata.detailComplete,
      paginationComplete: dataset.metadata.paginationComplete,
      sourceComplete: dataset.metadata.sourceComplete
    },
    queryRange: dataset.metadata.queryRange
  };
};

export const loadSalesProfitabilityProducts = createSalesProfitabilityProductLoader();

export const createSalesProfitabilityAgentRunner = ({
  repository = reportsRepository,
  catalogRepository = productRepository,
  catalogLoader = loadAssortmentCatalogSnapshot,
  analyze = analyzeCommercialAgent,
  assertActor = assertCurrentAIAgentActor
} = {}) => async ({
  question = '',
  period = {},
  compare = true,
  scenario = {},
  requestKey = null
} = {}) => {
  const questionText = String(question || '').trim();
  const resolution = resolveCommercialIntent(questionText, { scenario });
  if (resolution.kind !== 'supported') {
    return {
      response: createCommercialLocalResponse(resolution),
      usageStatus: null,
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      reportSource: 'local',
      intentResolution: resolution
    };
  }

  const resolvedIntent = resolution.intent;
  let normalizedScenario;
  try {
    normalizedScenario = normalizeScenarioForIntent(resolvedIntent, scenario);
  } catch (error) {
    throw new AIApiError(
      'La configuración de la simulación no es válida.',
      400,
      { code: error?.code || 'INVALID_SCENARIO' },
      error?.code || 'INVALID_SCENARIO'
    );
  }

  const normalizedPeriod = normalizePeriod(period);
  const currentPeriod = { ...normalizedPeriod, previous: null };
  const comparisonEnabled = ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', ASSORTMENT_INTENT].includes(resolvedIntent)
    || (resolvedIntent === 'explain_change' && compare === true);
  const previousPeriod = comparisonEnabled ? buildPreviousPeriod(currentPeriod) : null;
  if (previousPeriod) previousPeriod.timezone = currentPeriod.timezone;

  const request = {
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    intent: resolvedIntent,
    question: questionText,
    period: {
      from: currentPeriod.from,
      to: currentPeriod.to,
      previousFrom: previousPeriod?.from || null,
      previousTo: previousPeriod?.to || null,
      timezone: currentPeriod.timezone
    },
    scenario: normalizedScenario,
    context: null,
    requestKey
  };
  const validation = validateCommercialAgentRequest(request);
  if (!validation.valid) {
    throw new AIApiError('La pregunta del agente de ventas no es válida.', 400, validation, validation.code);
  }

  const dedupeKey = requestKey || defaultRequestKey(request);
  if (inflightRequests.has(dedupeKey)) return inflightRequests.get(dedupeKey);

  const execution = (async () => {
    const actor = assertActor();
    const scope = getSalesFinalHistoryScope(actor);
    const [currentDataset, previousDataset, catalog] = await Promise.all([
      loadSalesProfitabilityDataset({ repository, period: currentPeriod, scope }),
      previousPeriod
        ? loadSalesProfitabilityDataset({ repository, period: previousPeriod, scope })
        : Promise.resolve(null),
      resolvedIntent === ASSORTMENT_INTENT
        ? catalogLoader({ repository: catalogRepository, actor, assertActor })
        : Promise.resolve(null)
    ]);
    if (resolvedIntent === ASSORTMENT_INTENT) assertTenantUnchanged(actor, assertActor());

    const deterministicBase = buildSalesProfitabilityAnalysis({
      period: currentPeriod,
      currentHistory: currentDataset.history,
      previousHistory: previousDataset?.history || null,
      sourceMode: currentDataset.metadata.sourceMode,
      intent: resolvedIntent,
      scenario: normalizedScenario
    });
    const deterministic = hardenDeterministicResult({
      deterministic: deterministicBase,
      currentDataset,
      previousDataset
    });

    if (resolvedIntent === ASSORTMENT_INTENT) {
      const assortment = buildAssortmentAnalysis({ catalog, currentDataset, previousDataset });
      const currentSales = assortment.currentPeriod.netSales;
      const percent = (value) => value === null || value === undefined
        ? 'no disponible'
        : `${ASSORTMENT_PERCENT_FORMATTER.format(value * 100)}%`;
      deterministic.assortment = assortment;
      deterministic.status = assortment.narrativeEligible ? 'completed' : 'insufficient_data';
      deterministic.source = deterministic.source === 'cloud' ? 'mixed' : deterministic.source;
      deterministic.executiveSummary = assortment.catalog.complete
        ? `Tu catálogo activo tiene ${assortment.health.activeCatalogProducts} producto(s) y ${assortment.health.activeCategories} categoría(s).${assortment.health.unsoldProducts === null ? '' : ` ${assortment.health.unsoldProducts} producto(s) activos no registraron ventas en el periodo.`}`
        : `Se revisó una parte del catálogo (${assortment.catalog.productsRead} producto(s) y ${assortment.catalog.categoriesRead} categoría(s)); el análisis es parcial.`;
      deterministic.answer = deterministic.executiveSummary;
      deterministic.explanation = `Ventas netas identificadas en el detalle: ${currentSales === null ? 'no disponibles' : `$${ASSORTMENT_CURRENCY_FORMATTER.format(currentSales)}`}. Participación de los tres productos principales: ${percent(assortment.health.concentration.top3ProductShare)}. ${assortment.health.previousComparisonAvailable ? 'La comparación usa periodos equivalentes.' : 'No se pudo confirmar una comparación completa con el periodo anterior.'}`;
      deterministic.limitations = unique([...(deterministic.limitations || []), ...assortment.limitations]);
      deterministic.coverage = {
        ...deterministic.coverage,
        assortmentCatalogComplete: assortment.catalog.complete,
        assortmentSalesComplete: assortment.health.currentSalesCoverageComplete,
        assortmentComparisonAvailable: assortment.comparisonAvailable
      };
    }

    if (!intentHasUsefulEvidence(deterministic)) {
      return {
        response: deterministic,
        usageStatus: null,
        providerCalled: false,
        quotaOutcome: 'not_consumed',
        reportSource: deterministic.source,
        intentResolution: resolution
      };
    }

    const context = buildSalesProfitabilityContext({
      intent: request.intent,
      period: request.period,
      report: {
        ...deterministic.context,
        assortment: deterministic.assortment || null,
        coverage: deterministic.coverage,
        calculations: deterministic.calculations,
        assumptions: deterministic.assumptions,
        scenarios: deterministic.scenarios,
        limitations: deterministic.limitations,
        queryRange: deterministic.queryRange
      },
      source: deterministic.source
    });

    let providerOutcome = null;
    try {
      const providerResult = await analyze({
        ...request,
        context,
        requestKey: requestKey || null
      }, { temperature: 0.2, maxTokens: 2048 });
      providerOutcome = {
        providerCalled: typeof providerResult?.providerCalled === 'boolean'
          ? providerResult.providerCalled
          : true,
        quotaOutcome: VALID_QUOTA_OUTCOMES.has(providerResult?.quotaOutcome)
          ? providerResult.quotaOutcome
          : 'consumed'
      };
      const response = mergeProviderResponse(
        deterministic,
        providerResult.rawResultContent || providerResult.content || '',
        request.intent
      );

      return {
        response,
        usageStatus: providerResult.usageStatus || null,
        providerCalled: providerOutcome.providerCalled,
        quotaOutcome: providerOutcome.quotaOutcome,
        reportSource: deterministic.source,
        intentResolution: resolution
      };
    } catch (error) {
      const errorCode = error?.code || error?.originalError?.code;
      const execution = providerOutcome || readFailureExecution(error);
      const diagnosticCode = errorCode === 'INVALID_REQUEST'
        && execution.providerCalled === false
        && execution.quotaOutcome === 'not_consumed'
        ? 'AI_REQUEST_REJECTED'
        : execution.providerCalled !== true
          ? 'AI_NARRATIVE_UNAVAILABLE'
        : errorCode === 'AI_EMPTY_RESPONSE'
        ? 'AI_NARRATIVE_EMPTY'
        : ['MALFORMED_JSON', 'AI_INVALID_RESPONSE'].includes(errorCode)
          ? 'AI_NARRATIVE_INVALID_JSON'
          : 'AI_NARRATIVE_PROVIDER_ERROR';
      console.error('[SalesProfitabilityAgent] narrativa IA no disponible; se conserva el reporte determinístico.', {
        code: diagnosticCode,
        statusCode: error?.statusCode || null,
        cause: error?.originalError?.message || error?.message || null
      });
      return {
        response: {
          ...deterministic,
          limitations: unique([
            ...(deterministic.limitations || []),
            'La narrativa opcional del proveedor IA no está disponible; se conserva el reporte determinístico.'
          ]),
          aiNarrative: {
            status: 'unavailable',
            diagnosticCode,
            executiveSummary: null,
            explanation: 'La narrativa opcional de IA no está disponible. Las cifras, cálculos, cobertura y recomendaciones visibles provienen del análisis determinístico.',
            recommendations: []
          }
        },
        usageStatus: null,
        providerCalled: execution.providerCalled,
        quotaOutcome: execution.quotaOutcome,
        narrativeAvailable: false,
        reportSource: deterministic.source,
        intentResolution: resolution
      };
    }
  })();

  inflightRequests.set(dedupeKey, execution);
  try {
    return await execution;
  } finally {
    inflightRequests.delete(dedupeKey);
  }
};

export const runSalesProfitabilityAgent = createSalesProfitabilityAgentRunner();

export default {
  runSalesProfitabilityAgent,
  loadSalesProfitabilityProducts,
  createSalesProfitabilityAgentRunner,
  createSalesProfitabilityProductLoader,
  resolveBusinessTimezone
};
