import { AIApiError, analyzeCommercialAgent } from '../aiService';
import { assertCurrentAIAgentActor } from '../auth/aiAgentAuthorization';
import { getSalesFinalHistoryScope } from '../auth/salesPermissionPolicy';
import { reportsRepository } from '../reports/reportsRepository';
import { useAppStore } from '../../store/useAppStore';
import {
  buildPreviousPeriod,
  buildSalesProfitabilityAnalysis,
  inferSalesProfitabilityIntent
} from './salesProfitabilityAnalytics';
import {
  buildSalesProfitabilityProductOptionsFromDataset,
  loadSalesProfitabilityDataset
} from './salesProfitabilityData';
import {
  COMMERCIAL_AGENT_KEYS,
  parseCommercialAgentResponse,
  validateCommercialAgentRequest
} from './commercialAgentContract';
import { buildSalesProfitabilityContext } from './commercialAgentContext';

const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';
const inflightRequests = new Map();

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
  'priceSimulation.',
  'promotionSimulation.',
  'comboOpportunities.'
]);

const allowedEvidenceKey = (value) => (
  typeof value === 'string'
  && ALLOWED_EVIDENCE_PREFIXES.some((prefix) => value.startsWith(prefix))
);

const normalizeNarrativeRecommendations = (recommendations = []) => (
  (Array.isArray(recommendations) ? recommendations : [])
    .slice(0, 3)
    .map((recommendation = {}) => ({
      title: String(recommendation.title || '').trim(),
      explanation: String(recommendation.explanation || '').trim(),
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
      && recommendation.evidenceKeys.length > 0
    ))
);

const mergeProviderResponse = (deterministic, providerResponse) => {
  const parsed = parseCommercialAgentResponse(providerResponse, {
    expectedAgentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY
  });
  if (!parsed.valid) {
    throw new AIApiError(
      'El proveedor IA devolvió una respuesta estructurada inválida.',
      502,
      parsed,
      'AI_INVALID_RESPONSE'
    );
  }

  const narrative = parsed.response;
  const providerRecommendations = normalizeNarrativeRecommendations(narrative.recommendations);

  return {
    ...deterministic,
    recommendations: deterministic.recommendations,
    aiNarrative: {
      executiveSummary: String(narrative.executiveSummary || narrative.answer || '').trim() || null,
      explanation: String(narrative.explanation || '').trim() || null,
      recommendations: providerRecommendations
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
  currentMetadata
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

  const rows = (Array.isArray(calculations) ? calculations : []).map((row) => {
    const unsafe = (!currentComplete && currentUnsafe.has(row.label))
      || (!comparisonComplete && comparisonUnsafe.has(row.label));
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
  comparisonComplete
}) => ({
  ...deterministic.coverage,
  productsIncluded: current.products.length,
  costCoverage: current.costCoverage,
  comparisonAvailable: comparisonComplete,
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
  if (!response || response.coverage?.validSales === 0) return false;
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
  const comparison = hardenComparison(deterministic.comparison, currentComplete, previousComplete);
  const coverage = buildCoverage({
    deterministic,
    current,
    currentMetadata,
    comparisonComplete
  });

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
  if (currentMetadata.detailComplete !== true || currentMetadata.paginationComplete !== true) {
    if (deterministic.intent === 'combo_opportunity') {
      comboOpportunities = [];
      scenarios = [];
    }
  }
  if (!comparisonComplete && deterministic.intent === 'explain_change') contributors = [];

  const hardened = {
    ...deterministic,
    current,
    previous,
    comparison,
    contributors,
    comboOpportunities,
    scenarios,
    profitability,
    coverage,
    limitations,
    calculations: hardenCalculations(deterministic.calculations, {
      currentComplete,
      comparisonComplete,
      currentMetadata
    }),
    confidence: current.salesCount === 0
      ? 'low'
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
    comparison: comparisonComplete ? hardened.context?.comparison : null
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
  analyze = analyzeCommercialAgent,
  assertActor = assertCurrentAIAgentActor
} = {}) => async ({
  question = '',
  intent = inferSalesProfitabilityIntent(question),
  period = {},
  compare = true,
  scenario = {},
  requestKey = null
} = {}) => {
  const normalizedPeriod = normalizePeriod(period);
  const currentPeriod = { ...normalizedPeriod, previous: null };
  const previousPeriod = compare ? buildPreviousPeriod(currentPeriod) : null;
  if (previousPeriod) previousPeriod.timezone = currentPeriod.timezone;

  const request = {
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    intent,
    question: String(question || '').trim(),
    period: {
      from: currentPeriod.from,
      to: currentPeriod.to,
      previousFrom: previousPeriod?.from || null,
      previousTo: previousPeriod?.to || null,
      timezone: currentPeriod.timezone
    },
    scenario: { ...scenario },
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
    const [currentDataset, previousDataset] = await Promise.all([
      loadSalesProfitabilityDataset({ repository, period: currentPeriod, scope }),
      previousPeriod
        ? loadSalesProfitabilityDataset({ repository, period: previousPeriod, scope })
        : Promise.resolve(null)
    ]);

    const deterministicBase = buildSalesProfitabilityAnalysis({
      period: currentPeriod,
      currentHistory: currentDataset.history,
      previousHistory: previousDataset?.history || null,
      sourceMode: currentDataset.metadata.sourceMode,
      intent,
      scenario
    });
    const deterministic = hardenDeterministicResult({
      deterministic: deterministicBase,
      currentDataset,
      previousDataset
    });

    if (!intentHasUsefulEvidence(deterministic)) {
      return {
        response: deterministic,
        usageStatus: null,
        providerCalled: false,
        reportSource: deterministic.source
      };
    }

    const context = buildSalesProfitabilityContext({
      period: request.period,
      report: {
        ...deterministic.context,
        coverage: deterministic.coverage,
        calculations: deterministic.calculations,
        assumptions: deterministic.assumptions,
        scenarios: deterministic.scenarios,
        limitations: deterministic.limitations,
        queryRange: deterministic.queryRange
      },
      source: deterministic.source
    });

    const providerResult = await analyze({
      ...request,
      context,
      requestKey: requestKey || null
    }, { temperature: 0.2, maxTokens: 2048 });
    const response = mergeProviderResponse(
      deterministic,
      providerResult.rawResultContent || providerResult.content || ''
    );

    return {
      response,
      usageStatus: providerResult.usageStatus || null,
      providerCalled: true,
      reportSource: deterministic.source
    };
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
