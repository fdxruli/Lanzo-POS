import { AIApiError, analyzeCommercialAgent } from '../aiService';
import { assertCurrentAIAgentActor } from '../auth/aiAgentAuthorization';
import { reportsRepository } from '../reports/reportsRepository';
import {
  buildPreviousPeriod,
  buildSalesProfitabilityAnalysis,
  buildSalesProfitabilityProductOptions,
  inferSalesProfitabilityIntent
} from './salesProfitabilityAnalytics';
import {
  COMMERCIAL_AGENT_KEYS,
  parseCommercialAgentResponse,
  validateCommercialAgentRequest
} from './commercialAgentContract';
import { buildSalesProfitabilityContext } from './commercialAgentContext';

const inflightRequests = new Map();

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

const getSourceMode = (report) => report?.source?.mode || report?.source?.sourceMode || 'mixed';

const normalizePeriod = (period = {}) => ({
  from: period.from || period.dateFrom || null,
  to: period.to || period.dateTo || null,
  days: Math.max(Number(period.days) || 30, 1),
  previous: period.previous || null,
  timezone: period.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
});

const getHistory = (repository, filters) => repository.getSalesFinalHistory({
  ...filters,
  limit: 500,
  offset: 0
});

const priorityFromLegacyEffort = (effort) => {
  if (effort === 'high') return 'high';
  if (effort === 'low') return 'low';
  return 'medium';
};

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
        ? recommendation.evidenceKeys.filter((item) => typeof item === 'string').slice(0, 8)
        : (Array.isArray(recommendation.evidence)
          ? recommendation.evidence.filter((item) => typeof item === 'string').slice(0, 8)
          : []),
      requiresConfirmation: true
    }))
    .filter((recommendation) => recommendation.title && recommendation.explanation && recommendation.expectedImpact)
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
  const executiveSummary = narrative.executiveSummary || narrative.answer || deterministic.executiveSummary;
  const providerRecommendations = normalizeNarrativeRecommendations(narrative.recommendations);

  return {
    ...deterministic,
    executiveSummary,
    answer: narrative.answer || executiveSummary,
    explanation: narrative.explanation || deterministic.explanation,
    recommendations: providerRecommendations.length ? providerRecommendations : deterministic.recommendations,
    confidence: deterministic.confidence,
    facts: deterministic.facts,
    calculations: deterministic.calculations,
    assumptions: deterministic.assumptions,
    scenarios: deterministic.scenarios,
    limitations: deterministic.limitations,
    coverage: deterministic.coverage,
    source: deterministic.source,
    contributors: deterministic.contributors,
    profitability: deterministic.profitability,
    productRisks: deterministic.productRisks,
    priceSimulation: deterministic.priceSimulation,
    promotionSimulation: deterministic.promotionSimulation,
    comboOpportunities: deterministic.comboOpportunities,
    current: deterministic.current,
    previous: deterministic.previous,
    comparison: deterministic.comparison,
    context: deterministic.context,
    actionDrafts: [],
    citations: []
  };
};

export const createSalesProfitabilityProductLoader = ({
  repository = reportsRepository,
  assertActor = assertCurrentAIAgentActor
} = {}) => async ({ period = {} } = {}) => {
  const normalizedPeriod = normalizePeriod(period);
  assertActor();
  const currentHistory = await getHistory(repository, {
    dateFrom: normalizedPeriod.from,
    dateTo: normalizedPeriod.to
  });
  return {
    products: buildSalesProfitabilityProductOptions({
      period: normalizedPeriod,
      currentHistory
    }),
    source: getSourceMode(currentHistory)
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
    assertActor();
    const [currentHistory, previousHistory] = await Promise.all([
      getHistory(repository, { dateFrom: currentPeriod.from, dateTo: currentPeriod.to }),
      previousPeriod
        ? getHistory(repository, { dateFrom: previousPeriod.from, dateTo: previousPeriod.to })
        : Promise.resolve(null)
    ]);

    const deterministic = buildSalesProfitabilityAnalysis({
      period: currentPeriod,
      currentHistory,
      previousHistory,
      sourceMode: getSourceMode(currentHistory),
      intent,
      scenario
    });

    if (deterministic.coverage.validSales === 0) {
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
        scenarios: deterministic.scenarios
      },
      source: deterministic.source
    });

    const providerResult = await analyze({
      ...request,
      context,
      requestKey: requestKey || null
    }, { temperature: 0.2, maxTokens: 2048 });
    const response = mergeProviderResponse(deterministic, providerResult.rawResultContent || providerResult.content || '');

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
  createSalesProfitabilityProductLoader
};
