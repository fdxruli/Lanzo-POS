const REPORT_SCHEMA_VERSION = 'sales-profitability-report-v1';
const VALID_STATUSES = new Set(['completed', 'incomplete', 'insufficient_data']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCES = new Set(['cloud', 'local', 'mixed']);
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
    comparisonAvailable: safeBoolean(source.comparisonAvailable),
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
    costComplete: safeBoolean(source.costComplete),
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
    previousNetSales: finiteNumber(source.previousNetSales),
    previousUnits: finiteNumber(source.previousUnits),
    previousTicket: finiteNumber(source.previousTicket),
    previousCost: finiteNumber(source.previousCost),
    previousProfit: finiteNumber(source.previousProfit),
    previousMargin: finiteNumber(source.previousMargin),
    previousDiscounts: finiteNumber(source.previousDiscounts),
    deltaNetSales: finiteNumber(source.deltaNetSales),
    deltaUnits: finiteNumber(source.deltaUnits),
    deltaTicket: finiteNumber(source.deltaTicket),
    deltaCost: finiteNumber(source.deltaCost),
    deltaProfit: finiteNumber(source.deltaProfit),
    deltaMargin: finiteNumber(source.deltaMargin),
    deltaMarginRelative: finiteNumber(source.deltaMarginRelative),
    deltaDiscounts: finiteNumber(source.deltaDiscounts),
    productMixChanges: (Array.isArray(source.productMixChanges) ? source.productMixChanges : []).slice(0, 20).map((item) => safeMixChange(item, 'name')),
    channelMixChanges: (Array.isArray(source.channelMixChanges) ? source.channelMixChanges : []).slice(0, 20).map((item) => safeMixChange(item, 'channel'))
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
    discounts: finiteNumber(source.discounts),
    unitCosts: finiteNumber(source.unitCosts ?? source.costOfSale),
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
  return {
    title: sanitizeText(source.title, 200),
    explanation: sanitizeText(source.explanation, 1000),
    expectedImpact: sanitizeText(source.expectedImpact, 400),
    priority: sanitizeText(source.priority, 40) || null,
    evidenceKeys: safeTextArray(source.evidenceKeys, 12, 300),
    effort: sanitizeText(source.effort, 80) || null,
    evidence: safeTextArray(source.evidence, 12, 300),
    requiresConfirmation: source.requiresConfirmation === true
  };
};

const safeScenarioRequest = (scenario) => {
  const source = asRecord(scenario);
  return {
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
  const used = finiteNumber(source.used) ?? 0;
  const limit = finiteNumber(source.limit) ?? 0;
  const remaining = finiteNumber(source.remaining);
  return {
    used,
    limit,
    remaining: remaining ?? Math.max(limit - used, 0)
  };
};

export const buildSalesProfitabilityDownloadReport = (result, requestContext = {}, options = {}) => {
  const response = asRecord(result?.response);
  if (!Object.keys(response).length) return null;

  const request = asRecord(requestContext);
  const providerCalled = result?.providerCalled === true;
  const now = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const recommendations = (Array.isArray(response.recommendations) ? response.recommendations : []).slice(0, 20).map(safeRecommendation);
  const current = safeAggregate(response.current);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    agent: {
      key: 'salesProfitability',
      title: 'Ventas y rentabilidad'
    },
    request: {
      question: sanitizeText(request.question, 1200),
      resolvedIntent: sanitizeText(request.resolvedIntent ?? request.intent, 80),
      period: safeRequestPeriod(request.period),
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
      providerCalled
    },
    deterministic: {
      summary: safeSummary(response),
      current,
      previous: safeAggregate(response.previous),
      comparison: safeComparison(response.comparison),
      profitability: safeProfitability(response.profitability),
      contributors: (Array.isArray(response.contributors) ? response.contributors : []).slice(0, 20).map(safeContributor),
      productRisks: (Array.isArray(response.productRisks) ? response.productRisks : []).slice(0, 50).map(safeProductRisk),
      priceSimulation: response.priceSimulation ? safeScenario(response.priceSimulation) : null,
      promotionSimulation: response.promotionSimulation ? safeScenario(response.promotionSimulation) : null,
      comboOpportunities: (Array.isArray(response.comboOpportunities) ? response.comboOpportunities : []).slice(0, 30).map(safeScenario),
      products: Array.isArray(current.products) ? current.products : [],
      channels: Array.isArray(current.channels) ? current.channels : [],
      calculations: (Array.isArray(response.calculations) ? response.calculations : []).slice(0, 80).map(safeCalculation),
      scenarios: (Array.isArray(response.scenarios) ? response.scenarios : []).slice(0, 30).map(safeScenario),
      assumptions: safeTextArray(response.assumptions, 40, 700),
      limitations: safeTextArray(response.limitations, 40, 700)
    },
    ai: {
      executiveSummary: providerCalled ? sanitizeText(response.executiveSummary, 2400) : null,
      explanation: providerCalled ? sanitizeText(response.explanation, 4000) : null,
      recommendations: providerCalled ? recommendations : [],
      confidence: providerCalled ? safeConfidence(response.confidence) : null
    },
    usage: safeUsage(result?.usageStatus),
    redactions: [...SALES_PROFITABILITY_REPORT_REDACTIONS]
  };
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
