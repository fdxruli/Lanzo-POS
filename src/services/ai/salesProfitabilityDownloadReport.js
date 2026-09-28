import { normalizeCommercialAINarrativeDiagnosticCode } from './commercialAgentContract';
import { sanitizePublicHttpUrl, validateCompetitiveEvidence } from './competitiveAnalysis';

const REPORT_SCHEMA_VERSION = 'sales-profitability-report-v2';
const VALID_STATUSES = new Set(['completed', 'incomplete', 'insufficient_data', 'out_of_scope', 'not_ready', 'local_answer']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_QUOTA_OUTCOMES = new Set(['consumed', 'not_consumed', 'not_confirmed']);
const VALID_SOURCES = new Set(['cloud', 'local', 'mixed']);
const VALID_RESOLUTION_KINDS = new Set(['identity', 'supported', 'recognized_not_supported', 'needs_context', 'out_of_scope']);
const VALID_RESOLUTION_TOPICS = new Set([
  'name',
  'name_meaning',
  'ai',
  'capabilities',
  'identity',
  'competition',
  'assortment',
  'growth',
  'sales_growth',
  'ticket_growth',
  'product_opportunity',
  'sales_trend',
  'commercial_question',
  'price_simulation',
  'profitability_summary',
  'explain_change',
  'product_risk',
  'promotion_opportunity',
  'combo_opportunity',
  'greeting',
  'unrelated',
  'module'
]);
const VALID_CONTEXT_SLOTS = new Set(['question', 'objective', 'productName', 'newPrice', 'competitorEvidence']);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /\+?\d(?:[\s().-]*\d){9,14}\b/gu;
const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const CREDENTIAL_PATTERN = /\b(?:licenseKey|deviceFingerprint|deviceSecurityToken|staffSessionToken|AI_API_KEY|requestKey|usage_id|service_role)\b\s*[:=]\s*[^\s,;]+/giu;

export const SALES_PROFITABILITY_REPORT_REDACTIONS = Object.freeze([
  'raw sales rows omitted',
  'customer personal data omitted',
  'internal identifiers omitted',
  'authentication context omitted'
]);

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const safeBoolean = (value) => value === true;

const sanitizeText = (value, maxLength = 2000) => {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, maxLength)
    .replace(CREDENTIAL_PATTERN, '[redacted credential]')
    .replace(UUID_PATTERN, '[redacted internal identifier]')
    .replace(EMAIL_PATTERN, '[redacted email]')
    .replace(PHONE_PATTERN, '[redacted phone]')
    .replace(URL_PATTERN, '[redacted url]');
};

const safeTextArray = (value, limit = 30, maxLength = 500) => (
  (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === 'string')
    .slice(0, limit)
    .map((item) => sanitizeText(item, maxLength))
);

const safeStatus = (value) => VALID_STATUSES.has(value) ? value : 'insufficient_data';
const safeConfidence = (value) => VALID_CONFIDENCE.has(value) ? value : 'low';
const safeSource = (value) => VALID_SOURCES.has(value) ? value : 'mixed';
const safeResolution = (value) => {
  const source = asRecord(value);
  if (!VALID_RESOLUTION_KINDS.has(source.kind)) return null;
  return {
    kind: source.kind,
    topic: VALID_RESOLUTION_TOPICS.has(source.topic) ? source.topic : null,
    confidence: safeConfidence(source.confidence),
    missingContext: (Array.isArray(source.missingContext) ? source.missingContext : [])
      .filter((item) => VALID_CONTEXT_SLOTS.has(item))
      .slice(0, 4)
  };
};

const safeRequestPeriod = (period) => {
  const source = asRecord(period);
  return {
    from: sanitizeText(source.from, 40) || null,
    to: sanitizeText(source.to, 40) || null,
    previousFrom: sanitizeText(source.previousFrom, 40) || null,
    previousTo: sanitizeText(source.previousTo, 40) || null,
    timezone: sanitizeText(source.timezone, 80) || null
  };
};

const safeCalculationPeriod = (period) => {
  const source = asRecord(period);
  return {
    from: sanitizeText(source.from, 40) || null,
    to: sanitizeText(source.to, 40) || null,
    label: sanitizeText(source.label, 100) || null,
    days: finiteNumber(source.days)
  };
};

const safeQueryBoundary = (range) => {
  const source = asRecord(range);
  if (!Object.keys(source).length) return null;
  return {
    calendar: {
      from: sanitizeText(source.calendar?.from, 40) || null,
      to: sanitizeText(source.calendar?.to, 40) || null
    },
    timezone: sanitizeText(source.timezone, 120) || null,
    fromInclusiveUtc: sanitizeText(source.fromInclusiveUtc, 80) || null,
    toExclusiveUtc: sanitizeText(source.toExclusiveUtc, 80) || null
  };
};

const safeQueryRange = (queryRange) => {
  const source = asRecord(queryRange);
  return {
    current: safeQueryBoundary(source.current),
    previous: safeQueryBoundary(source.previous)
  };
};

const safeCoverage = (coverage) => {
  const source = asRecord(coverage);
  return {
    validSales: finiteNumber(source.validSales),
    rawSales: finiteNumber(source.rawSales),
    excludedSales: finiteNumber(source.excludedSales),
    ecommerceDuplicatesExcluded: finiteNumber(source.ecommerceDuplicatesExcluded),
    productsIncluded: finiteNumber(source.productsIncluded),
    productsMissingCost: finiteNumber(source.productsMissingCost),
    costCoverage: finiteNumber(source.costCoverage),
    itemCoverage: finiteNumber(source.itemCoverage),
    detailLines: finiteNumber(source.detailLines),
    expectedDetailLines: finiteNumber(source.expectedDetailLines),
    knownCostOfSale: finiteNumber(source.knownCostOfSale),
    costStatus: sanitizeText(source.costStatus, 48) || null,
    itemsComplete: safeBoolean(source.itemsComplete),
    paginationComplete: safeBoolean(source.paginationComplete),
    sourceComplete: safeBoolean(source.sourceComplete),
    historyTruncated: safeBoolean(source.historyTruncated),
    detailTruncated: safeBoolean(source.detailTruncated),
    comparisonAvailable: safeBoolean(source.comparisonAvailable),
    comparisonDataAvailable: safeBoolean(source.comparisonDataAvailable),
    comparisonItemsAvailable: safeBoolean(source.comparisonItemsAvailable),
    salesDataComplete: safeBoolean(source.salesDataComplete),
    growthDataComplete: safeBoolean(source.growthDataComplete),
    strategyEvidenceAvailable: safeBoolean(source.strategyEvidenceAvailable),
    strategyCatalogComplete: safeBoolean(source.strategyCatalogComplete),
    competitorCount: finiteNumber(source.competitorCount),
    observationCount: finiteNumber(source.observationCount),
    comparablePriceCount: finiteNumber(source.comparablePriceCount),
    catalogComplete: safeBoolean(source.catalogComplete),
    verifiedExternalSources: finiteNumber(source.verifiedExternalSources),
    sourcePolicy: {
      excludedSources: finiteNumber(source.sourcePolicy?.excludedSources),
      excludedStatuses: finiteNumber(source.sourcePolicy?.excludedStatuses),
      cancelledMarkers: finiteNumber(source.sourcePolicy?.cancelledMarkers),
      legacySources: finiteNumber(source.sourcePolicy?.legacySources),
      shadowSources: finiteNumber(source.sourcePolicy?.shadowSources),
      ecommerceSources: finiteNumber(source.sourcePolicy?.ecommerceSources),
      unknownSources: finiteNumber(source.sourcePolicy?.unknownSources)
    },
    sourceWarnings: safeTextArray(source.sourceWarnings, 20, 500),
    complete: safeBoolean(source.complete)
  };
};

const safeProduct = (product) => {
  const source = asRecord(product);
  return {
    name: sanitizeText(source.name, 160) || 'Producto',
    quantity: finiteNumber(source.quantity),
    netSales: finiteNumber(source.netSales),
    cost: finiteNumber(source.cost),
    unitCost: finiteNumber(source.unitCost),
    profit: finiteNumber(source.profit),
    margin: finiteNumber(source.margin),
    averagePrice: finiteNumber(source.averagePrice),
    costKnown: safeBoolean(source.costKnown),
    knownCost: finiteNumber(source.knownCost),
    costStatus: sanitizeText(source.costStatus, 48) || null,
    costSource: sanitizeText(source.costSource, 64) || null,
    missingCostLines: finiteNumber(source.missingCostLines),
    discounts: finiteNumber(source.discounts)
  };
};

const safeChannel = (channel) => {
  const source = asRecord(channel);
  return {
    channel: sanitizeText(source.channel, 80) || 'Sin canal',
    netSales: finiteNumber(source.netSales),
    orders: finiteNumber(source.orders),
    units: finiteNumber(source.units),
    unitsPerTicket: finiteNumber(source.unitsPerTicket),
    averageTicket: finiteNumber(source.averageTicket),
    share: finiteNumber(source.share)
  };
};

const safeAggregate = (aggregate) => {
  const source = asRecord(aggregate);
  if (!Object.keys(source).length) return {};
  return {
    period: safeCalculationPeriod(source.period),
    salesCount: finiteNumber(source.salesCount),
    units: finiteNumber(source.units),
    netSales: finiteNumber(source.netSales),
    discounts: finiteNumber(source.discounts),
    discountsKnown: safeBoolean(source.discountsKnown),
    costOfSale: finiteNumber(source.costOfSale),
    knownCostOfSale: finiteNumber(source.knownCostOfSale),
    costComplete: safeBoolean(source.costComplete),
    costStatus: sanitizeText(source.costStatus, 48) || null,
    detailComplete: safeBoolean(source.detailComplete),
    itemCoverage: finiteNumber(source.itemCoverage),
    paginationComplete: safeBoolean(source.paginationComplete),
    sourceComplete: safeBoolean(source.sourceComplete),
    knownSales: finiteNumber(source.knownSales),
    missingCostLines: finiteNumber(source.missingCostLines),
    missingCostProducts: safeTextArray(source.missingCostProducts, 30, 160),
    products: (Array.isArray(source.products) ? source.products : []).slice(0, 30).map(safeProduct),
    channels: (Array.isArray(source.channels) ? source.channels : []).slice(0, 20).map(safeChannel),
    averageTicket: finiteNumber(source.averageTicket),
    profit: finiteNumber(source.profit),
    margin: finiteNumber(source.margin),
    costCoverage: finiteNumber(source.costCoverage),
    lowMarginSalesShare: finiteNumber(source.lowMarginSalesShare)
  };
};

const safeMixChange = (item, nameKey) => {
  const source = asRecord(item);
  return {
    [nameKey]: sanitizeText(source[nameKey], 160),
    currentShare: finiteNumber(source.currentShare),
    previousShare: finiteNumber(source.previousShare),
    deltaShare: finiteNumber(source.deltaShare)
  };
};

const safeComparison = (comparison) => {
  const source = asRecord(comparison);
  if (!Object.keys(source).length) return {};
  return {
    currentSalesCount: finiteNumber(source.currentSalesCount),
    previousSalesCount: finiteNumber(source.previousSalesCount),
    deltaSalesCount: finiteNumber(source.deltaSalesCount),
    previousNetSales: finiteNumber(source.previousNetSales),
    previousUnits: finiteNumber(source.previousUnits),
    previousTicket: finiteNumber(source.previousTicket),
    previousUnitsPerTicket: finiteNumber(source.previousUnitsPerTicket),
    previousCost: finiteNumber(source.previousCost),
    previousProfit: finiteNumber(source.previousProfit),
    previousMargin: finiteNumber(source.previousMargin),
    previousDiscounts: finiteNumber(source.previousDiscounts),
    deltaNetSales: finiteNumber(source.deltaNetSales),
    deltaNetSalesPercent: finiteNumber(source.deltaNetSalesPercent),
    deltaUnits: finiteNumber(source.deltaUnits),
    deltaTicket: finiteNumber(source.deltaTicket),
    deltaTicketPercent: finiteNumber(source.deltaTicketPercent),
    deltaUnitsPerTicket: finiteNumber(source.deltaUnitsPerTicket),
    deltaCost: finiteNumber(source.deltaCost),
    deltaProfit: finiteNumber(source.deltaProfit),
    deltaMargin: finiteNumber(source.deltaMargin),
    deltaMarginRelative: finiteNumber(source.deltaMarginRelative),
    deltaDiscounts: finiteNumber(source.deltaDiscounts),
    productMixChanges: (Array.isArray(source.productMixChanges) ? source.productMixChanges : []).slice(0, 20).map((item) => safeMixChange(item, 'name')),
    channelMixChanges: (Array.isArray(source.channelMixChanges) ? source.channelMixChanges : []).slice(0, 20).map((item) => ({
      ...safeMixChange(item, 'channel'),
      currentSales: finiteNumber(item.currentSales),
      previousSales: finiteNumber(item.previousSales),
      salesDelta: finiteNumber(item.salesDelta)
    })),
    productChanges: (Array.isArray(source.productChanges) ? source.productChanges : []).slice(0, 30).map(safeProductChange)
  };
};

const safeProductChange = (product) => {
  const source = asRecord(product);
  return {
    name: sanitizeText(source.name, 160),
    currentSales: finiteNumber(source.currentSales),
    previousSales: finiteNumber(source.previousSales),
    salesDelta: finiteNumber(source.salesDelta),
    salesDeltaPercent: finiteNumber(source.salesDeltaPercent),
    currentUnits: finiteNumber(source.currentUnits),
    previousUnits: finiteNumber(source.previousUnits),
    unitsDelta: finiteNumber(source.unitsDelta),
    unitsDeltaPercent: finiteNumber(source.unitsDeltaPercent),
    currentShare: finiteNumber(source.currentShare),
    previousShare: finiteNumber(source.previousShare),
    salesShareDelta: finiteNumber(source.salesShareDelta),
    currentMargin: finiteNumber(source.currentMargin),
    previousMargin: finiteNumber(source.previousMargin),
    currentProfit: finiteNumber(source.currentProfit),
    previousProfit: finiteNumber(source.previousProfit),
    costKnown: safeBoolean(source.costKnown),
    costStatus: sanitizeText(source.costStatus, 32) || null,
    direction: sanitizeText(source.direction, 32),
    signals: safeTextArray(source.signals, 8, 32),
    opportunityReason: sanitizeText(source.opportunityReason, 300) || null
  };
};

const safeGrowthSignals = (signals) => {
  const source = asRecord(signals);
  if (!Object.keys(source).length) return null;
  const numberKeys = [
    'currentNetSales', 'currentSalesCount', 'currentUnits', 'currentAverageTicket', 'currentUnitsPerTicket',
    'previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousSalesCount', 'deltaSalesCount',
    'previousUnits', 'deltaUnits', 'previousAverageTicket', 'deltaTicket', 'deltaTicketPercent',
    'previousUnitsPerTicket', 'deltaUnitsPerTicket'
  ];
  return {
    ...Object.fromEntries(numberKeys.map((key) => [key, finiteNumber(source[key])])),
    productsGrowing: (Array.isArray(source.productsGrowing) ? source.productsGrowing : []).slice(0, 10).map(safeProductChange),
    productsDeclining: (Array.isArray(source.productsDeclining) ? source.productsDeclining : []).slice(0, 10).map(safeProductChange),
    productOpportunities: (Array.isArray(source.productOpportunities) ? source.productOpportunities : []).slice(0, 12).map(safeProductChange),
    channelChanges: (Array.isArray(source.channelChanges) ? source.channelChanges : []).slice(0, 20).map((item) => ({
      channel: sanitizeText(item.channel, 80),
      currentShare: finiteNumber(item.currentShare),
      previousShare: finiteNumber(item.previousShare),
      deltaShare: finiteNumber(item.deltaShare),
      currentSales: finiteNumber(item.currentSales),
      previousSales: finiteNumber(item.previousSales),
      salesDelta: finiteNumber(item.salesDelta)
    })),
    comparisonAvailable: safeBoolean(source.comparisonAvailable)
  };
};

const safeContributor = (contributor) => {
  const source = asRecord(contributor);
  return {
    key: sanitizeText(source.key, 120),
    title: sanitizeText(source.title ?? source.label, 160),
    contribution: finiteNumber(source.contribution ?? source.value),
    direction: sanitizeText(source.direction, 40),
    explanation: sanitizeText(source.explanation, 500),
    evidenceKeys: safeTextArray(source.evidenceKeys, 12, 200)
  };
};

const safeProfitability = (profitability) => {
  const source = asRecord(profitability);
  return {
    status: sanitizeText(source.status, 48),
    netSales: finiteNumber(source.netSales),
    costOfSale: finiteNumber(source.costOfSale),
    profit: finiteNumber(source.profit),
    margin: finiteNumber(source.margin),
    costCoverage: finiteNumber(source.costCoverage),
    validSales: finiteNumber(source.validSales),
    missingCostProducts: finiteNumber(source.missingCostProducts),
    explanation: sanitizeText(source.explanation, 700)
  };
};

const safeProductRisk = (risk) => {
  const source = asRecord(risk);
  return {
    product: sanitizeText(source.product, 160),
    units: finiteNumber(source.units),
    netSales: finiteNumber(source.netSales),
    cost: finiteNumber(source.cost),
    profit: finiteNumber(source.profit),
    margin: finiteNumber(source.margin),
    salesShare: finiteNumber(source.salesShare),
    riskType: sanitizeText(source.riskType, 80),
    riskLabel: sanitizeText(source.riskLabel, 120),
    reason: sanitizeText(source.reason, 700),
    evidenceKeys: safeTextArray(source.evidenceKeys, 12, 200)
  };
};

const safeCalculation = (calculation) => {
  const source = asRecord(calculation);
  return {
    label: sanitizeText(source.label, 180),
    value: finiteNumber(source.value),
    formattedValue: sanitizeText(source.formattedValue, 120),
    formula: sanitizeText(source.formula, 300),
    source: sanitizeText(source.source, 80),
    period: safeCalculationPeriod(source.period)
  };
};

const safeScenario = (scenario) => {
  const source = asRecord(scenario);
  return {
    label: sanitizeText(source.label, 180) || null,
    product: sanitizeText(source.product, 160) || null,
    products: safeTextArray(source.products, 8, 160),
    volume: finiteNumber(source.volume),
    utility: finiteNumber(source.utility),
    margin: finiteNumber(source.margin),
    impactVsCurrent: finiteNumber(source.impactVsCurrent),
    tickets: finiteNumber(source.tickets),
    frequency: finiteNumber(source.frequency),
    currentPrice: finiteNumber(source.currentPrice),
    newPrice: finiteNumber(source.newPrice),
    promotionalPrice: finiteNumber(source.promotionalPrice),
    unitCost: finiteNumber(source.unitCost),
    historicalVolume: finiteNumber(source.historicalVolume),
    currentProfit: finiteNumber(source.currentProfit),
    simulatedProfit: finiteNumber(source.simulatedProfit),
    promotionalProfit: finiteNumber(source.promotionalProfit),
    currentMargin: finiteNumber(source.currentMargin),
    simulatedMargin: finiteNumber(source.simulatedMargin),
    promotionalMargin: finiteNumber(source.promotionalMargin),
    profitDelta: finiteNumber(source.profitDelta),
    breakEvenVolume: finiteNumber(source.breakEvenVolume),
    historicalJointSales: finiteNumber(source.historicalJointSales),
    averageJointSale: finiteNumber(source.averageJointSale),
    individualPrice: finiteNumber(source.individualPrice),
    comboPrice: finiteNumber(source.comboPrice),
    discount: finiteNumber(source.discount),
    profit: finiteNumber(source.profit),
    breakEvenTickets: finiteNumber(source.breakEvenTickets),
    evidenceLevel: sanitizeText(source.evidenceLevel, 40),
    opportunity: sanitizeText(source.opportunity, 700),
    isPrediction: safeBoolean(source.isPrediction),
    isDemandPrediction: safeBoolean(source.isDemandPrediction),
    note: sanitizeText(source.note, 500) || null
  };
};

const safeSummary = (response) => {
  const contextSummary = asRecord(asRecord(response.context).summary);
  const current = asRecord(response.current);
  const source = Object.keys(contextSummary).length ? contextSummary : current;
  return {
    netSales: finiteNumber(source.netSales),
    units: finiteNumber(source.units),
    salesCount: finiteNumber(source.salesCount),
      averageTicket: finiteNumber(source.averageTicket),
    unitsPerTicket: finiteNumber(source.unitsPerTicket),
    discounts: finiteNumber(source.discounts),
    discountsKnown: source.discountsKnown === true,
    unitCosts: finiteNumber(source.unitCosts ?? source.costOfSale),
    knownCostOfSale: finiteNumber(source.knownCostOfSale),
    profit: finiteNumber(source.profit),
    margin: finiteNumber(source.margin),
    costCoverage: finiteNumber(source.costCoverage),
    missingCostProducts: finiteNumber(source.missingCostProducts),
    excludedSales: finiteNumber(source.excludedSales),
    ecommerceDuplicates: finiteNumber(source.ecommerceDuplicates),
    profitabilityStatus: sanitizeText(source.profitabilityStatus, 48),
    profitabilityExplanation: sanitizeText(source.profitabilityExplanation, 700)
  };
};

const safeRecommendation = (recommendation) => {
  const source = asRecord(recommendation);
  const focus = asRecord(source.focus);
  return {
    title: sanitizeText(source.title, 200),
    explanation: sanitizeText(source.explanation, 1000),
    ...(typeof source.action === 'string' ? { action: sanitizeText(source.action, 700) } : {}),
    ...(typeof source.measurement === 'string' ? { measurement: sanitizeText(source.measurement, 500) } : {}),
    ...(typeof focus.type === 'string' && typeof focus.key === 'string'
      ? { focus: { type: sanitizeText(focus.type, 40), key: sanitizeText(focus.key, 160) } }
      : {}),
    ...(typeof source.recommendationType === 'string'
      ? { recommendationType: sanitizeText(source.recommendationType, 48) }
      : {}),
    expectedImpact: sanitizeText(source.expectedImpact, 400),
    priority: sanitizeText(source.priority, 40) || null,
    evidenceKeys: safeTextArray(source.evidenceKeys, 12, 300),
    effort: sanitizeText(source.effort, 80) || null,
    evidence: safeTextArray(source.evidence, 12, 300),
    requiresConfirmation: source.requiresConfirmation === true
  };
};

const safeOpportunityCandidate = (candidate) => {
  const source = asRecord(candidate);
  const focus = asRecord(source.focus);
  const metrics = asRecord(source.metrics);
  return {
    key: sanitizeText(source.key, 180),
    type: sanitizeText(source.type, 40),
    focus: {
      type: sanitizeText(focus.type, 40),
      key: sanitizeText(focus.key, 160)
    },
    entity: sanitizeText(source.entity, 160) || null,
    signal: safeTextArray(source.signal, 5, 80),
    recommendationType: sanitizeText(source.recommendationType, 48),
    strength: sanitizeText(source.strength, 24),
    metrics: Object.fromEntries(Object.entries(metrics)
      .filter(([, value]) => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      .slice(0, 16)),
    evidenceKeys: safeTextArray(source.evidenceKeys, 8, 180)
  };
};

const STRATEGY_REASON_CODES = new Set([
  'ticket_down_sales_stable', 'sales_declining', 'margin_deteriorating', 'product_cost_missing',
  'product_low_margin', 'product_growing', 'category_concentrated', 'category_growing', 'products_without_sales', 'historical_combo'
]);

const GOAL_RESULT_NUMBER_KEYS = [
  'targetValue', 'currentValue', 'gap', 'gapPercent', 'excess', 'progress', 'revenueGap',
  'requiredAdditionalTicketsAtCurrentTicket', 'requiredAverageTicketAtCurrentTicketCount', 'currentSales',
  'currentTickets', 'currentAverageTicket', 'currentProfit', 'targetProfit', 'profitGap', 'currentRevenue',
  'currentMargin', 'requiredRevenue', 'additionalRevenue', 'equivalentAdditionalTickets', 'costOfSale',
  'requiredSalesAtCurrentTicketCount', 'salesIncreaseAtCurrentTicketCount', 'ticketDifference',
  'ticketChangePercent', 'targetMargin', 'requiredProfitAtCurrentSales', 'additionalProfitRequired',
  'currentPrice', 'unitCost', 'requiredPrice', 'priceDifference', 'priceChangePercent'
];
const WHAT_IF_RESULT_NUMBER_KEYS = [
  'changePercent', 'currentSales', 'simulatedSales', 'salesDelta', 'currentCost', 'simulatedCost',
  'currentProfit', 'simulatedProfit', 'profitDelta', 'currentMargin', 'simulatedMargin', 'ticketCount',
  'currentTicket', 'simulatedTicket', 'historicalUnits', 'simulatedUnits', 'averagePrice', 'historicalSales'
];
const safeSimulationResult = (value, kind) => {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  const goal = kind === 'goal';
  const result = {
    ...(goal
      ? { type: ['revenue', 'gross_profit', 'average_ticket', 'gross_margin', 'product_margin'].includes(source.type) ? source.type : null }
      : { changeType: ['sales', 'ticket', 'product'].includes(source.changeType) ? source.changeType : null }),
    ...(goal ? {} : { ready: safeBoolean(source.ready), changePercent: finiteNumber(source.changePercent) }),
    ...(goal ? { ready: safeBoolean(source.ready), state: ['achieved', 'remaining', 'unavailable'].includes(source.state) ? source.state : 'unavailable' } : {}),
    ...Object.fromEntries((goal ? GOAL_RESULT_NUMBER_KEYS : WHAT_IF_RESULT_NUMBER_KEYS)
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, finiteNumber(source[key])])),
    ...(typeof source.productName === 'string' ? { productName: sanitizeText(source.productName, 160) || null } : {}),
    ...(typeof source.limitation === 'string' ? { limitation: sanitizeText(source.limitation, 700) || null } : {}),
    ...(typeof source.costKnown === 'boolean' ? { costKnown: source.costKnown } : {}),
    assumptions: safeTextArray(source.assumptions, 12, 700),
    limitations: safeTextArray(source.limitations, 12, 700)
  };
  return result;
};

const safeStrategyCandidate = (candidate) => {
  const source = asRecord(candidate);
  const focus = asRecord(source.focus);
  const metrics = asRecord(source.metrics);
  return {
    key: sanitizeText(source.key, 120),
    type: ['product', 'category', 'ticket', 'general'].includes(source.type) ? source.type : 'general',
    focus: {
      type: ['product', 'category', 'ticket', 'general'].includes(focus.type) ? focus.type : 'general',
      key: sanitizeText(focus.key, 120)
    },
    priority: ['high', 'medium', 'low'].includes(source.priority) ? source.priority : 'low',
    reasonCode: STRATEGY_REASON_CODES.has(source.reasonCode) ? source.reasonCode : null,
    title: sanitizeText(source.title, 160),
    entity: sanitizeText(source.entity, 180) || null,
    recommendationType: sanitizeText(source.recommendationType, 48),
    strength: ['strong', 'moderate', 'weak'].includes(source.strength) ? source.strength : 'weak',
    metrics: Object.fromEntries(Object.entries(metrics)
      .filter(([, value]) => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      .slice(0, 16)),
    signal: safeTextArray(source.signal, 2, 80),
    evidenceKeys: safeTextArray(source.evidenceKeys, 8, 180)
  };
};

const safeScenarioRequest = (scenario) => {
  const source = asRecord(scenario);
  return {
    goalType: ['revenue', 'gross_profit', 'average_ticket', 'gross_margin', 'product_margin'].includes(source.goalType) ? source.goalType : null,
    targetValue: finiteNumber(source.targetValue),
    changeType: ['sales', 'ticket', 'product'].includes(source.changeType) ? source.changeType : null,
    changePercent: finiteNumber(source.changePercent),
    productName: sanitizeText(source.productName, 160) || null,
    newPrice: finiteNumber(source.newPrice),
    promotionalPrice: finiteNumber(source.promotionalPrice),
    discountPercent: finiteNumber(source.discountPercent),
    historicalVolume: finiteNumber(source.historicalVolume),
    expectedVolume: finiteNumber(source.expectedVolume)
  };
};

const safeUsage = (usageStatus) => {
  const source = asRecord(usageStatus);
  const used = finiteNumber(source.used);
  const limit = finiteNumber(source.limit);
  const remaining = finiteNumber(source.remaining);
  const isUnlimited = source.isUnlimited === true
    || source.is_unlimited === true
    || source.unlimited === true;
  if (source.available === false || (used === null && limit === null && remaining === null && !isUnlimited)) {
    return { available: false };
  }
  return {
    available: true,
    used,
    limit,
    remaining,
    isUnlimited
  };
};

const ASSORTMENT_SIGNAL_KEYS = new Set([
  'category_growing', 'new_category_activity', 'category_declining',
  'strong_category_few_products', 'single_product_concentration', 'many_unsold_products'
]);
const ASSORTMENT_ACTIVITY_KEYS = new Set([
  'never_sold_in_window', 'previously_sold_now_inactive', 'low_activity', 'declining'
]);

const safeAssortment = (value) => {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  const catalog = asRecord(source.catalog);
  const health = asRecord(source.health);
  const concentration = asRecord(health.concentration);
  const safeCategory = (value) => {
    const row = asRecord(value);
    return {
      name: sanitizeText(row.name, 120),
      active: safeBoolean(row.active),
      netSales: finiteNumber(row.netSales),
      previousNetSales: finiteNumber(row.previousNetSales),
      units: finiteNumber(row.units),
      previousUnits: finiteNumber(row.previousUnits),
      salesDelta: finiteNumber(row.salesDelta),
      salesDeltaPercent: finiteNumber(row.salesDeltaPercent),
      salesShare: finiteNumber(row.salesShare),
      activeProducts: finiteNumber(row.activeProducts),
      soldProducts: finiteNumber(row.soldProducts),
      unsoldProducts: finiteNumber(row.unsoldProducts),
      topProductShare: finiteNumber(row.topProductShare),
      signals: safeTextArray(row.signals, 6, 48).filter((signal) => ASSORTMENT_SIGNAL_KEYS.has(signal))
    };
  };
  const safeProduct = (value) => {
    const row = asRecord(value);
    const activity = ASSORTMENT_ACTIVITY_KEYS.has(row.activity) ? row.activity : null;
    return {
      candidateRef: /^product_candidate_\d+$/u.test(String(row.candidateRef || '')) ? row.candidateRef : null,
      name: sanitizeText(row.name, 180),
      category: sanitizeText(row.category, 120) || null,
      activity,
      currentSales: finiteNumber(row.currentSales),
      previousSales: finiteNumber(row.previousSales),
      currentUnits: finiteNumber(row.currentUnits),
      previousUnits: finiteNumber(row.previousUnits),
      availability: row.availability === 'availability_unknown' ? row.availability : null,
      reason: sanitizeText(row.reason, 200) || null
    };
  };
  return {
    version: Number.isInteger(source.version) ? source.version : 1,
    catalog: {
      source: catalog.source === 'local_tenant_catalog' ? catalog.source : null,
      complete: safeBoolean(catalog.complete),
      productsRead: finiteNumber(catalog.productsRead),
      categoriesRead: finiteNumber(catalog.categoriesRead),
      productsTruncated: safeBoolean(catalog.productsTruncated),
      categoriesTruncated: safeBoolean(catalog.categoriesTruncated)
    },
    health: {
      activeCatalogProducts: finiteNumber(health.activeCatalogProducts),
      inactiveCatalogProducts: finiteNumber(health.inactiveCatalogProducts),
      soldProducts: finiteNumber(health.soldProducts),
      unsoldProducts: finiteNumber(health.unsoldProducts),
      activeCategories: finiteNumber(health.activeCategories),
      soldCategories: finiteNumber(health.soldCategories),
      currentSalesCoverageComplete: safeBoolean(health.currentSalesCoverageComplete),
      previousComparisonAvailable: safeBoolean(health.previousComparisonAvailable),
      productSalesJoinCoverage: finiteNumber(health.productSalesJoinCoverage),
      categorySalesCoverage: finiteNumber(health.categorySalesCoverage),
      concentration: {
        topProductShare: finiteNumber(concentration.topProductShare),
        top3ProductShare: finiteNumber(concentration.top3ProductShare),
        topCategoryShare: finiteNumber(concentration.topCategoryShare),
        categoryRevenueCoverage: finiteNumber(concentration.categoryRevenueCoverage)
      }
    },
    categoryPerformance: (Array.isArray(source.categoryPerformance) ? source.categoryPerformance : []).slice(0, 10).map(safeCategory),
    categoryOpportunities: (Array.isArray(source.categoryOpportunities) ? source.categoryOpportunities : []).slice(0, 8).map((value) => {
      const row = asRecord(value);
      return {
        ...safeCategory({ ...row, netSales: row.currentSales, previousNetSales: row.previousSales }),
        candidateRef: /^category_candidate_\d+$/u.test(String(row.candidateRef || '')) ? row.candidateRef : null
      };
    }),
    dormantProducts: (Array.isArray(source.dormantProducts) ? source.dormantProducts : []).slice(0, 12).map(safeProduct),
    reactivationCandidates: (Array.isArray(source.reactivationCandidates) ? source.reactivationCandidates : []).slice(0, 12).map(safeProduct),
    opportunityCandidates: (Array.isArray(source.opportunityCandidates) ? source.opportunityCandidates : []).slice(0, 8).map(safeOpportunityCandidate),
    evidenceKeys: safeTextArray(source.evidenceKeys, 24, 120).filter((key) => /^assortment\.(?:metric:[A-Za-z0-9]+|(?:category|product):(?:category|product)_candidate_\d+)$/u.test(key)),
    minimumUsefulRecommendations: Number.isInteger(source.minimumUsefulRecommendations)
      ? Math.max(0, Math.min(2, source.minimumUsefulRecommendations))
      : 0,
    currentPeriod: {
      netSales: finiteNumber(source.currentPeriod?.netSales),
      units: finiteNumber(source.currentPeriod?.units),
      complete: safeBoolean(source.currentPeriod?.complete)
    },
    previousPeriod: {
      netSales: finiteNumber(source.previousPeriod?.netSales),
      units: finiteNumber(source.previousPeriod?.units),
      complete: safeBoolean(source.previousPeriod?.complete)
    },
    comparisonAvailable: safeBoolean(source.comparisonAvailable),
    narrativeEligible: safeBoolean(source.narrativeEligible),
    limitations: safeTextArray(source.limitations, 8, 240)
  };
};

const safeExternalSource = (value) => {
  const source = asRecord(value);
  const publicUrl = sanitizePublicHttpUrl(source.url);
  return {
    type: ['manual', 'public_url', 'copied_text', 'user_observation'].includes(source.type) ? source.type : 'manual',
    label: sanitizeText(source.label, 160) || null,
    url: publicUrl.valid ? publicUrl.url : null,
    text: sanitizeText(source.text, 3000) || null,
    evidenceType: 'user_provided',
    verified: false
  };
};

const safeCompetitiveAnalysis = (value) => {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  const validation = validateCompetitiveEvidence({
    capturedAt: source.capturedAt,
    competitors: source.competitors
  });
  if (!validation.valid) return null;
  const safeCompetitors = validation.evidence.competitors.map((competitor) => ({
    ...competitor,
    name: sanitizeText(competitor.name, 100),
    description: sanitizeText(competitor.description, 600) || null,
    location: sanitizeText(competitor.location, 160) || null,
    source: safeExternalSource(competitor.source),
    observations: competitor.observations.map((item) => ({
      ...item,
      name: sanitizeText(item.name, 120),
      description: sanitizeText(item.description, 600) || null,
      category: sanitizeText(item.category, 100) || null,
      promotion: sanitizeText(item.promotion, 300) || null,
      note: sanitizeText(item.note, 600) || null
    }))
  }));
  const safeOffer = (value) => {
    const row = asRecord(value);
    return {
      competitorName: sanitizeText(row.competitorName, 100),
      observedAt: /^\d{4}-\d{2}-\d{2}$/u.test(String(row.observedAt || '')) ? row.observedAt : null,
      source: safeExternalSource(row.source),
      type: ['product', 'service'].includes(row.type) ? row.type : 'product',
      name: sanitizeText(row.name, 120),
      description: sanitizeText(row.description, 600) || null,
      category: sanitizeText(row.category, 100) || null,
      price: finiteNumber(row.price),
      currency: /^[A-Z]{3}$/u.test(String(row.currency || '')) ? row.currency : null,
      unit: sanitizeText(row.unit, 80) || null,
      priceType: ['regular', 'promotion', 'unknown'].includes(row.priceType) ? row.priceType : 'unknown',
      promotion: sanitizeText(row.promotion, 300) || null,
      taxStatus: ['included', 'excluded', 'unknown'].includes(row.taxStatus) ? row.taxStatus : 'unknown',
      shippingStatus: ['included', 'excluded', 'not_applicable', 'unknown'].includes(row.shippingStatus) ? row.shippingStatus : 'unknown',
      note: sanitizeText(row.note, 600) || null,
      evidenceKey: /^external\.observation:\d+$/u.test(String(row.evidenceKey || '')) ? row.evidenceKey : null
    };
  };
  const internal = asRecord(source.internalBusiness);
  const offer = asRecord(source.offerComparison);
  const sourceCapturedAt = typeof source.capturedAt === 'string' && !Number.isNaN(Date.parse(source.capturedAt))
    ? new Date(source.capturedAt).toISOString()
    : validation.evidence.capturedAt;
  return {
    status: 'completed',
    evidenceType: 'user_provided',
    verified: false,
    capturedAt: sourceCapturedAt,
    competitors: safeCompetitors,
    internalBusiness: {
      source: 'local_tenant_catalog',
      catalogComplete: safeBoolean(internal.catalogComplete),
      currency: /^[A-Z]{3}$/u.test(String(internal.currency || '')) ? internal.currency : null,
      activeProductCount: finiteNumber(internal.activeProductCount),
      activeCategoryCount: finiteNumber(internal.activeCategoryCount),
      categories: safeTextArray(internal.categories, 100, 100)
    },
    priceComparisons: (Array.isArray(source.priceComparisons) ? source.priceComparisons : []).slice(0, 100).map((value) => {
      const row = asRecord(value);
      const url = sanitizePublicHttpUrl(row.source?.url);
      return {
        competitorName: sanitizeText(row.competitorName, 100),
        observedAt: /^\d{4}-\d{2}-\d{2}$/u.test(String(row.observedAt || '')) ? row.observedAt : null,
        source: { ...safeExternalSource(row.source), url: url.valid ? url.url : null },
        productName: sanitizeText(row.productName, 120),
        ownProductName: sanitizeText(row.ownProductName, 120) || null,
        ownPrice: finiteNumber(row.ownPrice),
        ownCurrency: /^[A-Z]{3}$/u.test(String(row.ownCurrency || '')) ? row.ownCurrency : null,
        ownUnit: sanitizeText(row.ownUnit, 80) || null,
        externalPrice: finiteNumber(row.externalPrice),
        externalCurrency: /^[A-Z]{3}$/u.test(String(row.externalCurrency || '')) ? row.externalCurrency : null,
        externalUnit: sanitizeText(row.externalUnit, 80) || null,
        externalPriceType: ['regular', 'promotion', 'unknown'].includes(row.externalPriceType) ? row.externalPriceType : 'unknown',
        ownTaxStatus: ['included', 'excluded', 'unknown'].includes(row.ownTaxStatus) ? row.ownTaxStatus : 'unknown',
        comparisonStatus: ['comparable', 'comparable_with_conditions', 'not_comparable'].includes(row.comparisonStatus) ? row.comparisonStatus : 'not_comparable',
        reason: sanitizeText(row.reason, 80) || null,
        difference: finiteNumber(row.difference),
        differencePercent: finiteNumber(row.differencePercent),
        normalizedOwnPrice: finiteNumber(row.normalizedOwnPrice),
        normalizedExternalPrice: finiteNumber(row.normalizedExternalPrice),
        basis: ['ml', 'g', 'pza'].includes(row.basis) ? row.basis : null,
        normalizedPresentation: safeBoolean(row.normalizedPresentation),
        taxStatus: ['included', 'excluded', 'unknown'].includes(row.taxStatus) ? row.taxStatus : 'unknown',
        shippingStatus: ['included', 'excluded', 'not_applicable', 'unknown'].includes(row.shippingStatus) ? row.shippingStatus : 'unknown',
        conditionNotes: safeTextArray(row.conditionNotes, 4, 160),
        evidenceKeys: safeTextArray(row.evidenceKeys, 4, 100).filter((key) => /^(?:external\.observation|internal\.product|comparison\.price):\d+$/u.test(key))
      };
    }),
    offerComparison: {
      observedFromCompetitor: (Array.isArray(offer.observedFromCompetitor) ? offer.observedFromCompetitor : []).slice(0, 100).map(safeOffer),
      observedObservationCount: finiteNumber(offer.observedObservationCount),
      observedButNotMatchedToOwnCatalog: (Array.isArray(offer.observedButNotMatchedToOwnCatalog) ? offer.observedButNotMatchedToOwnCatalog : []).slice(0, 100).map(safeOffer),
      observedButNotMatchedCount: finiteNumber(offer.observedButNotMatchedCount),
      ownProductsNotFoundInCapturedEvidence: (Array.isArray(offer.ownProductsNotFoundInCapturedEvidence) ? offer.ownProductsNotFoundInCapturedEvidence : []).slice(0, 100).map((row) => ({
        name: sanitizeText(row?.name, 120), category: sanitizeText(row?.category, 100) || null,
        price: finiteNumber(row?.price), currency: /^[A-Z]{3}$/u.test(String(row?.currency || '')) ? row.currency : null,
        unit: sanitizeText(row?.unit, 80) || null
      })),
      ownProductsNotFoundInCapturedEvidenceCount: finiteNumber(offer.ownProductsNotFoundInCapturedEvidenceCount),
      ownProductsNotFoundInCapturedEvidenceTruncated: safeBoolean(offer.ownProductsNotFoundInCapturedEvidenceTruncated),
      catalogComplete: safeBoolean(offer.catalogComplete),
      observedCategories: safeTextArray(offer.observedCategories, 100, 100),
      businessCategories: safeTextArray(offer.businessCategories, 100, 100),
      sharedCategories: safeTextArray(offer.sharedCategories, 100, 100),
      observedCategoriesNotInBusinessCatalog: safeTextArray(offer.observedCategoriesNotInBusinessCatalog, 100, 100),
      categoryComparisonAvailable: safeBoolean(offer.categoryComparisonAvailable)
    },
    recommendations: (Array.isArray(source.recommendations) ? source.recommendations : []).slice(0, 3).map((row) => ({
      key: sanitizeText(row?.key, 64),
      type: 'investigation',
      title: sanitizeText(row?.title, 160),
      explanation: sanitizeText(row?.explanation, 600),
      expectedImpact: sanitizeText(row?.expectedImpact, 300),
      priority: ['high', 'medium', 'low'].includes(row?.priority) ? row.priority : 'medium',
      evidenceKeys: safeTextArray(row?.evidenceKeys, 4, 100).filter((key) => /^(?:external\.observation|internal\.product|comparison\.price):\d+$/u.test(key)),
      requiresConfirmation: true
    })),
    limitations: safeTextArray(source.limitations, 12, 300),
    staleCompetitors: safeTextArray(source.staleCompetitors, 5, 100),
    executiveSummary: sanitizeText(source.executiveSummary, 1000),
    answer: sanitizeText(source.answer, 1000),
    explanation: sanitizeText(source.explanation, 1500),
    confidence: safeConfidence(source.confidence),
    evidenceWarnings: safeTextArray(source.evidenceWarnings, 20, 120)
  };
};

export const buildSalesProfitabilityDownloadReport = (result, requestContext = {}, options = {}) => {
  const response = asRecord(result?.response);
  if (!Object.keys(response).length) return null;

  const request = asRecord(requestContext);
  const providerCalled = typeof result?.providerCalled === 'boolean' ? result.providerCalled : null;
  const quotaOutcome = VALID_QUOTA_OUTCOMES.has(result?.quotaOutcome)
    ? result.quotaOutcome
    : 'not_confirmed';
  const explicitCacheHit = result?.cacheHit === true || result?.cache?.hit === true;
  const narrative = asRecord(response.aiNarrative);
  const narrativeSummary = sanitizeText(narrative.executiveSummary, 2400) || null;
  const narrativeDirectAnswer = sanitizeText(narrative.directAnswer, 2400) || null;
  const narrativeExplanation = sanitizeText(narrative.explanation, 4000) || null;
  const narrativeRecommendations = (Array.isArray(narrative.recommendations) ? narrative.recommendations : [])
    .slice(0, 20)
    .map(safeRecommendation)
    .filter((recommendation) => recommendation.title && recommendation.explanation && recommendation.expectedImpact);
  const hasNarrativeContent = Boolean(
    narrativeDirectAnswer || narrativeSummary || narrativeExplanation || narrativeRecommendations.length
  );
  const narrativeAttempted = providerCalled || explicitCacheHit
    || narrative.status === 'available' || narrative.status === 'unavailable';
  const aiStatus = narrative.status === 'unavailable'
    ? 'unavailable'
    : hasNarrativeContent
      ? 'available'
      : narrativeAttempted
        ? 'unavailable'
        : 'not_generated';
  const diagnosticCode = normalizeCommercialAINarrativeDiagnosticCode(narrative.diagnosticCode)
    || (aiStatus === 'unavailable' ? 'AI_NARRATIVE_UNAVAILABLE' : null);
  const now = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const current = safeAggregate(response.current);
  const resolution = safeResolution(request.resolution);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    agent: {
      key: 'salesProfitability',
      title: (request.resolvedIntent ?? request.intent) === 'competitive_analysis' ? 'Análisis de competencia' : 'Ventas y rentabilidad'
    },
    request: {
      question: sanitizeText(request.question, 1200),
      resolvedIntent: sanitizeText(request.resolvedIntent ?? request.intent, 80),
      ...(resolution ? { resolution } : {}),
      period: safeRequestPeriod(request.period),
      queryRange: safeQueryRange(response.queryRange),
      compare: request.compare === true,
      scenario: safeScenarioRequest(request.scenario)
    },
    result: {
      status: safeStatus(response.status),
      executiveSummary: sanitizeText(response.executiveSummary, 2400),
      answer: sanitizeText(response.answer ?? response.executiveSummary, 2400),
      explanation: sanitizeText(response.explanation, 4000),
      confidence: safeConfidence(response.confidence),
      source: safeSource(response.source),
      coverage: safeCoverage(response.coverage),
      providerCalled,
      quotaOutcome,
      cacheHit: explicitCacheHit
    },
    deterministic: {
      summary: safeSummary(response),
      current,
      previous: safeAggregate(response.previous),
      comparison: safeComparison(response.comparison),
      growthSignals: safeGrowthSignals(response.growthSignals),
      assortment: safeAssortment(response.assortment),
      opportunityCandidates: (Array.isArray(response.opportunityCandidates) ? response.opportunityCandidates : [])
        .slice(0, 8).map(safeOpportunityCandidate),
      minimumUsefulRecommendations: Number.isInteger(response.minimumUsefulRecommendations)
        ? Math.max(0, Math.min(3, response.minimumUsefulRecommendations))
        : 0,
      productOpportunities: (Array.isArray(response.productOpportunities) ? response.productOpportunities : []).slice(0, 20).map(safeProductChange),
      profitability: safeProfitability(response.profitability),
      contributors: (Array.isArray(response.contributors) ? response.contributors : []).slice(0, 20).map(safeContributor),
      productRisks: (Array.isArray(response.productRisks) ? response.productRisks : []).slice(0, 50).map(safeProductRisk),
      priceSimulation: response.priceSimulation ? safeScenario(response.priceSimulation) : null,
      promotionSimulation: response.promotionSimulation ? safeScenario(response.promotionSimulation) : null,
      comboOpportunities: (Array.isArray(response.comboOpportunities) ? response.comboOpportunities : []).slice(0, 30).map(safeScenario),
      goalSimulation: safeSimulationResult(response.goalSimulation, 'goal'),
      whatIfSimulation: safeSimulationResult(response.whatIfSimulation, 'whatIf'),
      strategyRequested: response.strategyRequested === true,
      strategyCandidates: (Array.isArray(response.strategyCandidates) ? response.strategyCandidates : []).slice(0, 8).map(safeStrategyCandidate),
      competitiveAnalysis: safeCompetitiveAnalysis(response.competitiveAnalysis),
      products: Array.isArray(current.products) ? current.products : [],
      channels: Array.isArray(current.channels) ? current.channels : [],
      calculations: (Array.isArray(response.calculations) ? response.calculations : []).slice(0, 80).map(safeCalculation),
      scenarios: (Array.isArray(response.scenarios) ? response.scenarios : []).slice(0, 30).map(safeScenario),
      recommendations: (Array.isArray(response.recommendations) ? response.recommendations : []).slice(0, 20).map(safeRecommendation),
      assumptions: safeTextArray(response.assumptions, 40, 700),
      limitations: safeTextArray(response.limitations, 40, 700),
      queryRange: safeQueryRange(response.queryRange)
    },
    ai: {
      status: aiStatus,
      diagnosticCode,
      directAnswer: aiStatus === 'available' ? narrativeDirectAnswer : null,
      executiveSummary: aiStatus === 'available' ? narrativeSummary : null,
      explanation: aiStatus === 'available' ? narrativeExplanation : null,
      recommendations: aiStatus === 'available' ? narrativeRecommendations : [],
      confidence: aiStatus === 'available' ? safeConfidence(narrative.confidence) : null
    },
    usage: safeUsage(result?.usageStatus),
    redactions: [...SALES_PROFITABILITY_REPORT_REDACTIONS]
  };
};

// Reapply the report allowlist before an already-sanitized report is rendered
// from local history or written to a history download. This never reads live
// sales data, auth state, quota, or provider state.
export const sanitizeSalesProfitabilityDownloadReport = (value) => {
  const source = asRecord(value);
  if (source.schemaVersion !== REPORT_SCHEMA_VERSION) return null;

  const result = asRecord(source.result);
  const deterministic = asRecord(source.deterministic);
  const ai = asRecord(source.ai);
  const generatedAt = new Date(source.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) return null;

  return buildSalesProfitabilityDownloadReport({
    providerCalled: typeof result.providerCalled === 'boolean' ? result.providerCalled : null,
    quotaOutcome: result.quotaOutcome,
    cacheHit: result.cacheHit === true,
    usageStatus: source.usage?.available === true ? source.usage : null,
    response: {
      status: result.status,
      executiveSummary: result.executiveSummary,
      answer: result.answer,
      explanation: result.explanation,
      confidence: result.confidence,
      source: result.source,
      coverage: result.coverage,
      intent: source.request?.resolvedIntent,
      context: { summary: deterministic.summary },
      current: deterministic.current,
      previous: deterministic.previous,
      comparison: deterministic.comparison,
      growthSignals: deterministic.growthSignals,
      assortment: deterministic.assortment,
      opportunityCandidates: deterministic.opportunityCandidates,
      minimumUsefulRecommendations: deterministic.minimumUsefulRecommendations,
      productOpportunities: deterministic.productOpportunities,
      profitability: deterministic.profitability,
      contributors: deterministic.contributors,
      productRisks: deterministic.productRisks,
      priceSimulation: deterministic.priceSimulation,
      promotionSimulation: deterministic.promotionSimulation,
      comboOpportunities: deterministic.comboOpportunities,
      goalSimulation: deterministic.goalSimulation,
      whatIfSimulation: deterministic.whatIfSimulation,
      strategyRequested: deterministic.strategyRequested,
      strategyCandidates: deterministic.strategyCandidates,
      competitiveAnalysis: deterministic.competitiveAnalysis,
      calculations: deterministic.calculations,
      scenarios: deterministic.scenarios,
      recommendations: deterministic.recommendations,
      assumptions: deterministic.assumptions,
      limitations: deterministic.limitations,
      queryRange: deterministic.queryRange,
      aiNarrative: {
        status: ai.status,
        diagnosticCode: normalizeCommercialAINarrativeDiagnosticCode(ai.diagnosticCode),
        directAnswer: ai.directAnswer || null,
        executiveSummary: ai.executiveSummary,
        explanation: ai.explanation,
        recommendations: ai.recommendations,
        confidence: ai.confidence
      }
    }
  }, source.request, { generatedAt });
};

export const buildSalesProfitabilityDownloadFilename = (date = new Date()) => {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(value.getTime()) ? new Date() : value;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getDate()).padStart(2, '0');
  const hours = String(safeDate.getHours()).padStart(2, '0');
  const minutes = String(safeDate.getMinutes()).padStart(2, '0');
  return 'lanzo-ventas-rentabilidad-' + year + '-' + month + '-' + day + '-' + hours + minutes + '.json';
};

export const downloadSalesProfitabilityReport = (result, requestContext = {}, options = {}) => {
  if (!result?.response) return null;

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const report = buildSalesProfitabilityDownloadReport(result, requestContext, { generatedAt: now });
  if (!report) return null;

  const documentRef = options.documentRef ?? globalThis.document;
  const urlApi = options.urlApi ?? globalThis.URL;
  const BlobCtor = options.BlobCtor ?? globalThis.Blob;
  if (!documentRef?.createElement || !documentRef?.body || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL || !BlobCtor) {
    throw new Error('DOWNLOAD_API_UNAVAILABLE');
  }

  const filename = buildSalesProfitabilityDownloadFilename(now);
  const blob = new BlobCtor([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  documentRef.body.appendChild(link);

  try {
    link.click();
  } finally {
    link.remove();
    urlApi.revokeObjectURL(objectUrl);
  }

  return { report, filename };
};

export default {
  buildSalesProfitabilityDownloadReport,
  buildSalesProfitabilityDownloadFilename,
  downloadSalesProfitabilityReport
};
