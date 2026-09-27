import { COMMERCIAL_AGENT_KEYS } from './commercialAgentContract';

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_ROWS = 20;
const SAFE_SOURCES = new Set(['cloud', 'local', 'mixed']);

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const asFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const asSafeText = (value, fallbackOrMaxLength = null, maxLength = MAX_PRODUCT_NAME_LENGTH) => {
  const legacyMaxLength = typeof fallbackOrMaxLength === 'number' ? fallbackOrMaxLength : null;
  const fallback = legacyMaxLength === null ? fallbackOrMaxLength : null;
  const limit = legacyMaxLength ?? maxLength;
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text ? text.slice(0, limit) : fallback;
};

const asSafeSource = (value) => SAFE_SOURCES.has(value) ? value : 'mixed';

const pickNumber = (row, keys) => {
  for (const key of keys) {
    const value = asFiniteNumber(row?.[key]);
    if (value !== null) return value;
  }
  return null;
};

const normalizePeriod = (period = {}) => {
  const source = asRecord(period);
  return {
    from: asSafeText(source.from || source.dateFrom || source.date_from, 32),
    to: asSafeText(source.to || source.dateTo || source.date_to, 32),
    label: asSafeText(source.label, 80)
  };
};

const normalizeProduct = (row = {}) => {
  const source = asRecord(row);
  return {
    name: asSafeText(source.name || source.product_name || source.productName),
    quantity: pickNumber(source, ['quantity', 'units', 'items_sold']),
    netSales: pickNumber(source, ['netSales', 'net_sales', 'sales', 'revenue']),
    salesShare: pickNumber(source, ['salesShare', 'sales_share']),
    unitCost: pickNumber(source, ['unitCost', 'unit_cost', 'cost']),
    profit: pickNumber(source, ['profit', 'gross_profit', 'utility']),
    margin: pickNumber(source, ['margin', 'gross_margin']),
    averagePrice: pickNumber(source, ['averagePrice', 'average_price', 'unit_price']),
    costKnown: source.costKnown === undefined ? null : source.costKnown === true,
    costStatus: asSafeText(source.costStatus, null, 48),
    costSource: asSafeText(source.costSource, null, 64),
    riskType: asSafeText(source.riskType, null, 48),
    riskReason: asSafeText(source.riskReason, null, 240)
  };
};

const normalizeChannel = (row = {}) => {
  const source = asRecord(row);
  return {
    channel: asSafeText(source.channel || source.sales_channel || source.canal, 32),
    netSales: pickNumber(source, ['netSales', 'net_sales', 'sales', 'revenue']),
    orders: pickNumber(source, ['orders', 'order_count', 'orders_count']),
    units: pickNumber(source, ['units', 'quantity', 'items_sold']),
    averageTicket: pickNumber(source, ['averageTicket', 'average_ticket', 'avg_ticket']),
    share: pickNumber(source, ['share', 'salesShare', 'sales_share'])
  };
};

const PRODUCT_CHANGE_NUMBER_KEYS = [
  'currentSales', 'previousSales', 'salesDelta', 'salesDeltaPercent', 'currentUnits', 'previousUnits',
  'unitsDelta', 'unitsDeltaPercent', 'currentShare', 'previousShare', 'salesShareDelta',
  'currentMargin', 'previousMargin', 'currentProfit', 'previousProfit'
];
const PRODUCT_DIRECTIONS = new Set(['new_in_period', 'not_sold_current', 'growing', 'declining', 'stable']);
const PRODUCT_SIGNALS = new Set([
  'new_in_period', 'not_sold_current', 'growing', 'declining', 'stable',
  'high_sales_share', 'healthy_margin', 'cost_unknown', 'low_margin'
]);
const COMPACT_NARRATIVE_INTENTS = new Set([
  'sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend'
]);

const NARRATIVE_EVIDENCE_KEYS = {
  sales_growth: [
    'comparison.deltaNetSales', 'comparison.deltaNetSalesPercent', 'comparison.deltaSalesCount',
    'comparison.deltaUnits', 'comparison.deltaTicket', 'comparison.deltaTicketPercent',
    'comparison.deltaUnitsPerTicket', 'comparison.productChanges', 'comparison.channelMixChanges',
    'growthSignals.productOpportunities', 'summary.unitsPerTicket'
  ],
  ticket_growth: [
    'summary.unitsPerTicket', 'comparison.deltaTicket', 'comparison.deltaTicketPercent',
    'comparison.deltaUnitsPerTicket', 'comparison.deltaSalesCount', 'comparison.productChanges',
    'growthSignals.productOpportunities'
  ],
  product_opportunity: [
    'comparison.productChanges', 'comparison.productMixChanges', 'growthSignals.productOpportunities',
    'products.risks', 'profitability.costCoverage', 'coverage.costCoverage'
  ],
  sales_trend: [
    'comparison.deltaNetSales', 'comparison.deltaNetSalesPercent', 'comparison.deltaSalesCount',
    'comparison.deltaUnits', 'comparison.deltaTicket', 'comparison.deltaUnitsPerTicket',
    'comparison.channelMixChanges', 'summary.unitsPerTicket'
  ]
};

const narrativeImpact = (row) => {
  const salesDelta = pickNumber(row, ['salesDelta']);
  if (salesDelta !== null) return Math.abs(salesDelta);
  const salesDeltaPercent = pickNumber(row, ['salesDeltaPercent']);
  if (salesDeltaPercent !== null) return Math.abs(salesDeltaPercent) * 100;
  return Math.abs(pickNumber(row, ['currentSales']) ?? 0);
};

const selectNarrativeRows = (rows, limit) => (
  (Array.isArray(rows) ? rows : [])
    .filter((row) => asRecord(row).name || asRecord(row).channel)
    .map((row, index) => ({ row: asRecord(row), index }))
    .sort((left, right) => narrativeImpact(right.row) - narrativeImpact(left.row) || left.index - right.index)
    .slice(0, limit)
    .map(({ row }) => row)
);

const projectNarrativeProduct = (product, intent) => {
  const keys = intent === 'product_opportunity'
    ? [
      'name', 'currentSales', 'previousSales', 'salesDelta', 'salesDeltaPercent', 'currentShare', 'previousShare',
      'salesShareDelta', 'costKnown', 'costStatus', 'direction', 'signals', 'opportunityReason'
    ]
    : intent === 'ticket_growth'
      ? ['name', 'currentSales', 'salesDelta', 'salesDeltaPercent', 'unitsDelta', 'direction', 'signals']
      : ['name', 'currentSales', 'salesDelta', 'salesDeltaPercent', 'unitsDelta', 'costKnown', 'costStatus', 'direction', 'signals'];
  const projected = Object.fromEntries([
    ...keys
  ].filter((key) => Object.prototype.hasOwnProperty.call(product, key)).map((key) => [key, product[key]]));
  if (intent === 'product_opportunity' && product.costKnown === true) {
    for (const key of ['currentMargin', 'previousMargin', 'currentProfit', 'previousProfit']) {
      if (Object.prototype.hasOwnProperty.call(product, key)) projected[key] = product[key];
    }
  }
  if (Array.isArray(projected.signals)) projected.signals = projected.signals.slice(0, intent === 'product_opportunity' ? 4 : 2);
  return projected;
};

const projectNarrativeChannel = (channel) => Object.fromEntries([
  'channel', 'currentShare', 'previousShare', 'deltaShare', 'currentSales', 'previousSales', 'salesDelta'
].filter((key) => Object.prototype.hasOwnProperty.call(channel, key)).map((key) => [key, channel[key]]));

const pickOwnFields = (value, keys) => Object.fromEntries(
  keys.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).map((key) => [key, value[key]])
);

const buildNarrativeEvidence = (intent, sales) => {
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
  const signals = asRecord(sales.growthSignals);
  const comparison = asRecord(sales.comparison);
  const comparisonProducts = Array.isArray(comparison.productChanges) ? comparison.productChanges : [];
  const opportunities = signals.productOpportunities?.length
    ? signals.productOpportunities
    : comparisonProducts.filter((product) => product.direction === 'growing'
      || product.signals?.some((signal) => ['high_sales_share', 'healthy_margin'].includes(signal)));
  const growing = signals.productsGrowing?.length
    ? signals.productsGrowing
    : comparisonProducts.filter((product) => product.direction === 'growing');
  const declining = signals.productsDeclining?.length
    ? signals.productsDeclining
    : comparisonProducts.filter((product) => product.direction === 'declining');
  const channelRows = signals.channelChanges?.length
    ? signals.channelChanges
    : (Array.isArray(comparison.channelMixChanges) ? comparison.channelMixChanges : []);

  const growthSignals = { comparisonAvailable: signals.comparisonAvailable === true };
  if (intent === 'sales_growth') {
    growthSignals.productOpportunities = selectNarrativeRows(opportunities, 3).map((product) => projectNarrativeProduct(product, intent));
    growthSignals.productsDeclining = selectNarrativeRows(declining, 3).map((product) => projectNarrativeProduct(product, intent));
  } else if (intent === 'ticket_growth') {
    growthSignals.productOpportunities = selectNarrativeRows(opportunities.length ? opportunities : growing, 2)
      .map((product) => projectNarrativeProduct(product, intent));
  } else if (intent === 'product_opportunity') {
    growthSignals.productOpportunities = selectNarrativeRows(opportunities, 3)
      .map((product) => projectNarrativeProduct(product, intent));
  }
  if (['sales_growth', 'sales_trend'].includes(intent)) {
    growthSignals.channelChanges = selectNarrativeRows(channelRows, 2).map(projectNarrativeChannel);
  }

  const availableEvidence = new Set(Array.isArray(sales.evidenceKeys) ? sales.evidenceKeys : []);
  const evidenceKeys = (NARRATIVE_EVIDENCE_KEYS[intent] || [])
    .filter((key) => availableEvidence.has(key))
    .slice(0, 12);

  return {
    summary: pickOwnFields(asRecord(sales.summary), summaryFields),
    products: [],
    channels: [],
    comparison: pickOwnFields(comparison, comparisonFields),
    growthSignals,
    evidenceKeys,
    coverage: pickOwnFields(asRecord(sales.coverage), [
      'validSales', 'comparisonAvailable', 'comparisonDataAvailable', 'growthDataComplete',
      'salesDataComplete', 'itemsComplete', 'paginationComplete', 'sourceComplete', 'complete'
    ]),
    calculations: [],
    assumptions: [],
    scenarios: [],
    limitations: []
  };
};

const normalizeProductChange = (row = {}) => {
  const source = asRecord(row);
  return {
    name: asSafeText(source.name, null, MAX_PRODUCT_NAME_LENGTH),
    ...Object.fromEntries(PRODUCT_CHANGE_NUMBER_KEYS.map((key) => [key, pickNumber(source, [key])])),
    costKnown: source.costKnown === true,
    costStatus: asSafeText(source.costStatus, null, 32),
    direction: PRODUCT_DIRECTIONS.has(source.direction) ? source.direction : 'stable',
    signals: Array.isArray(source.signals)
      ? source.signals.filter((signal) => typeof signal === 'string' && PRODUCT_SIGNALS.has(signal)).slice(0, 8)
      : [],
    ...(typeof source.opportunityReason === 'string'
      ? { opportunityReason: asSafeText(source.opportunityReason, null, 240) }
      : {})
  };
};

const normalizeProducts = (rows = []) => (
  (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_ROWS)
    .map(normalizeProduct)
    .filter((row) => row.name || row.netSales !== null || row.profit !== null)
);

const normalizeChannels = (rows = []) => (
  (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_ROWS)
    .map(normalizeChannel)
    .filter((row) => row.channel || row.netSales !== null || row.orders !== null)
);

const normalizeMixRows = (rows = [], key = 'name') => (
  (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row = {}) => {
      const source = asRecord(row);
      return {
        [key]: asSafeText(source[key], null, 80),
        currentShare: pickNumber(source, ['currentShare']),
        previousShare: pickNumber(source, ['previousShare']),
        deltaShare: pickNumber(source, ['deltaShare'])
      };
    })
    .filter((row) => row[key])
);

const normalizeComparison = (comparison = {}) => {
  const source = asRecord(comparison);
  return {
    currentSalesCount: pickNumber(source, ['currentSalesCount', 'current_sales_count']),
    previousSalesCount: pickNumber(source, ['previousSalesCount', 'previous_sales_count']),
    deltaSalesCount: pickNumber(source, ['deltaSalesCount', 'delta_sales_count']),
    previousNetSales: pickNumber(source, ['previousNetSales', 'previous_net_sales']),
    previousUnits: pickNumber(source, ['previousUnits', 'previous_units']),
    previousTicket: pickNumber(source, ['previousTicket', 'previous_ticket']),
    previousUnitsPerTicket: pickNumber(source, ['previousUnitsPerTicket', 'previous_units_per_ticket']),
    previousCost: pickNumber(source, ['previousCost', 'previous_cost']),
    previousProfit: pickNumber(source, ['previousProfit', 'previous_profit']),
    previousMargin: pickNumber(source, ['previousMargin', 'previous_margin']),
    deltaNetSales: pickNumber(source, ['deltaNetSales', 'delta_net_sales']),
    deltaNetSalesPercent: pickNumber(source, ['deltaNetSalesPercent', 'delta_net_sales_percent']),
    deltaUnits: pickNumber(source, ['deltaUnits', 'delta_units']),
    deltaTicket: pickNumber(source, ['deltaTicket', 'delta_ticket']),
    deltaTicketPercent: pickNumber(source, ['deltaTicketPercent', 'delta_ticket_percent']),
    deltaUnitsPerTicket: pickNumber(source, ['deltaUnitsPerTicket', 'delta_units_per_ticket']),
    deltaCost: pickNumber(source, ['deltaCost', 'delta_cost']),
    deltaProfit: pickNumber(source, ['deltaProfit', 'delta_profit']),
    deltaMargin: pickNumber(source, ['deltaMargin', 'delta_margin']),
    deltaMarginRelative: pickNumber(source, ['deltaMarginRelative', 'delta_margin_relative']),
    deltaDiscounts: pickNumber(source, ['deltaDiscounts', 'delta_discounts']),
    productMixChanges: normalizeMixRows(source.productMixChanges, 'name'),
    channelMixChanges: (Array.isArray(source.channelMixChanges) ? source.channelMixChanges : [])
      .slice(0, 12)
      .map((row = {}) => {
        const item = asRecord(row);
        return {
          channel: asSafeText(item.channel, null, 80),
          currentShare: pickNumber(item, ['currentShare']),
          previousShare: pickNumber(item, ['previousShare']),
          deltaShare: pickNumber(item, ['deltaShare']),
          currentSales: pickNumber(item, ['currentSales']),
          previousSales: pickNumber(item, ['previousSales']),
          salesDelta: pickNumber(item, ['salesDelta'])
        };
      })
      .filter((row) => row.channel),
    productChanges: (Array.isArray(source.productChanges) ? source.productChanges : [])
      .slice(0, 20).map(normalizeProductChange).filter((row) => row.name)
  };
};

const normalizeContributors = (contributors = []) => (
  (Array.isArray(contributors) ? contributors : [])
    .slice(0, 3)
    .map((row = {}) => {
      const source = asRecord(row);
      return {
        key: asSafeText(source.key, null, 80),
        title: asSafeText(source.title, null, 120),
        contribution: pickNumber(source, ['contribution', 'value']),
        direction: ['positive', 'negative', 'context'].includes(source.direction) ? source.direction : 'context',
        explanation: asSafeText(source.explanation, null, 300),
        evidenceKeys: Array.isArray(source.evidenceKeys)
          ? source.evidenceKeys.filter((item) => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 120))
          : []
      };
    })
    .filter((row) => row.key && row.title && row.explanation)
);
const normalizeCoverage = (coverage = {}) => {
  const source = asRecord(coverage);
  return {
    validSales: pickNumber(source, ['validSales', 'valid_sales']),
    rawSales: pickNumber(source, ['rawSales', 'raw_sales']),
    excludedSales: pickNumber(source, ['excludedSales', 'excluded_sales']),
    ecommerceDuplicatesExcluded: pickNumber(source, ['ecommerceDuplicatesExcluded', 'ecommerce_duplicates_excluded']),
    productsIncluded: pickNumber(source, ['productsIncluded', 'products_included']),
    productsMissingCost: pickNumber(source, ['productsMissingCost', 'products_missing_cost']),
    costCoverage: pickNumber(source, ['costCoverage', 'cost_coverage']),
    itemCoverage: pickNumber(source, ['itemCoverage', 'item_coverage']),
    detailLines: pickNumber(source, ['detailLines', 'detail_lines']),
    expectedDetailLines: pickNumber(source, ['expectedDetailLines', 'expected_detail_lines']),
    knownCostOfSale: pickNumber(source, ['knownCostOfSale', 'known_cost_of_sale']),
    costStatus: asSafeText(source.costStatus, null, 48),
    itemsComplete: source.itemsComplete === true,
    paginationComplete: source.paginationComplete === true,
    sourceComplete: source.sourceComplete === true,
    comparisonDataAvailable: source.comparisonDataAvailable === true,
    comparisonItemsAvailable: source.comparisonItemsAvailable === true,
    salesDataComplete: source.salesDataComplete === true,
    growthDataComplete: source.growthDataComplete === true,
    comparisonAvailable: source.comparisonAvailable === true,
    complete: source.complete === true
  };
};

const normalizeCalculations = (calculations = []) => (
  (Array.isArray(calculations) ? calculations : [])
    .slice(0, 32)
    .map((calculation = {}) => {
      const source = asRecord(calculation);
      return {
        label: asSafeText(source.label, null, 100),
        value: source.value === null || typeof source.value === 'number' ? source.value : null,
        formattedValue: asSafeText(source.formattedValue, 'No disponible', 80),
        formula: asSafeText(source.formula, '', 180),
        source: asSafeText(source.source, 'deterministic', 40),
        period: normalizePeriod(source.period)
      };
    })
    .filter((calculation) => calculation.label && calculation.formula)
);

const SAFE_SCENARIO_KEYS = new Set([
  'label', 'volume', 'utility', 'margin', 'impactVsCurrent', 'tickets', 'frequency',
  'ticketPercentage', 'comboPrice', 'discount', 'products', 'note', 'isPrediction', 'currentPrice', 'newPrice',
  'unitCost', 'historicalJointSales', 'averageJointSale', 'cost', 'profit', 'evidenceLevel',
  'confidence', 'costCoverage', 'costStatus', 'opportunity', 'historicalVolume', 'breakEvenVolume', 'isDemandPrediction'
]);

const buildEvidenceKeys = (source = {}) => {
  const value = asRecord(source);
  const comparison = asRecord(value.comparison || value.previous);
  const contributors = normalizeContributors(value.contributors);
  const keys = [
    'profitability.status',
    'profitability.netSales',
    'profitability.costOfSale',
    'profitability.profit',
    'profitability.margin',
    'profitability.costCoverage',
    'coverage.itemsComplete',
    'coverage.costCoverage',
    'coverage.paginationComplete',
    'coverage.sourceComplete',
    'coverage.costStatus',
    'summary.discountsKnown',
    'summary.unitsPerTicket',
    'products.risks'
  ];
  if (Object.keys(comparison).length) {
    keys.push(
      'comparison.deltaMargin',
      'comparison.deltaMarginRelative',
      'comparison.deltaCost',
      'comparison.deltaDiscounts',
      'comparison.deltaUnits',
      'comparison.deltaTicket',
      'comparison.deltaNetSales',
      'comparison.deltaNetSalesPercent',
      'comparison.deltaSalesCount',
      'comparison.deltaUnitsPerTicket',
      'comparison.productMixChanges',
      'comparison.channelMixChanges',
      'comparison.productChanges'
    );
  }
  if (Object.keys(asRecord(value.growthSignals)).length) {
    keys.push('growthSignals.currentNetSales', 'growthSignals.deltaNetSales', 'growthSignals.productOpportunities');
  }
  contributors.forEach((item) => keys.push(`contributors.${item.key}`));
  if (Array.isArray(value.scenarios) && value.scenarios.length) {
    keys.push('scenarios.values');
  }
  return Array.from(new Set(keys)).slice(0, 40);
};

const normalizeSalesPayload = (payload = {}, intent = null) => {
  const source = asRecord(payload);
  const overview = asRecord(source.overview || source.metrics || source.summary);

  return {
    summary: {
      netSales: pickNumber(overview, ['netSales', 'net_sales', 'sales', 'revenue']),
      units: pickNumber(overview, ['units', 'items', 'items_sold']),
      salesCount: pickNumber(overview, ['salesCount', 'sales_count', 'orders', 'order_count']),
      averageTicket: pickNumber(overview, ['averageTicket', 'average_ticket', 'avg_ticket']),
      unitsPerTicket: pickNumber(overview, ['unitsPerTicket', 'units_per_ticket']),
      discounts: pickNumber(overview, ['discounts', 'discount_amount', 'total_discounts']),
      discountsKnown: overview.discountsKnown === true,
      unitCosts: pickNumber(overview, ['unitCosts', 'unit_costs', 'cogs', 'costs']),
      knownCostOfSale: pickNumber(overview, ['knownCostOfSale', 'known_cost_of_sale']),
      profit: pickNumber(overview, ['profit', 'gross_profit', 'utility']),
      margin: pickNumber(overview, ['margin', 'gross_margin']),
      costCoverage: pickNumber(asRecord(source.coverage), ['costCoverage', 'cost_coverage']),
      missingCostProducts: pickNumber(asRecord(source.coverage), ['productsMissingCost', 'products_missing_cost']),
      excludedSales: pickNumber(asRecord(source.coverage), ['excludedSales', 'excluded_sales']),
      ecommerceDuplicates: pickNumber(asRecord(source.coverage), ['ecommerceDuplicatesExcluded', 'ecommerce_duplicates_excluded']),
      profitabilityStatus: asSafeText(overview.profitabilityStatus, null, 40),
      profitabilityExplanation: asSafeText(overview.profitabilityExplanation, null, 300)
    },
    netSales: pickNumber(overview, ['netSales', 'net_sales', 'sales', 'revenue']),
    grossSales: pickNumber(overview, ['grossSales', 'gross_sales']),
    discounts: pickNumber(overview, ['discounts', 'discount_amount', 'total_discounts']),
    unitCosts: pickNumber(overview, ['unitCosts', 'unit_costs', 'cogs', 'costs']),
    profit: pickNumber(overview, ['profit', 'gross_profit', 'utility']),
    margin: pickNumber(overview, ['margin', 'gross_margin']),
    averageTicket: pickNumber(overview, ['averageTicket', 'average_ticket', 'avg_ticket']),
    unitsPerTicket: pickNumber(overview, ['unitsPerTicket', 'units_per_ticket']),
    products: normalizeProducts(source.products || source.byProduct || source.by_product),
    channels: normalizeChannels(source.channels || source.byChannel || source.by_channel),
    comparison: normalizeComparison(source.comparison || source.previous),
    ...(source.growthSignals && Object.keys(asRecord(source.growthSignals)).length
      ? { growthSignals: normalizeGrowthSignals(source.growthSignals, COMPACT_NARRATIVE_INTENTS.has(intent)) }
      : {}),
    contributors: normalizeContributors(source.contributors),
    evidenceKeys: buildEvidenceKeys(source),
    coverage: normalizeCoverage(source.coverage),
    calculations: normalizeCalculations(source.calculations),
    assumptions: Array.isArray(source.assumptions)
      ? source.assumptions.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 180))
      : [],
    limitations: Array.isArray(source.limitations)
      ? source.limitations.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 240))
      : [],
    scenarios: Array.isArray(source.scenarios) ? source.scenarios.slice(0, 12).map((scenario) => {
      const safeScenario = asRecord(scenario);
      return Object.fromEntries(Object.entries(safeScenario).filter(([key, value]) => (
        SAFE_SCENARIO_KEYS.has(key)
        && (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || Array.isArray(value))
      )));
    }) : []
  };
};

const normalizeGrowthSignals = (signals = {}, prioritizeNarrativeEvidence = false) => {
  const source = asRecord(signals);
  const rows = (value, limit) => (prioritizeNarrativeEvidence
    ? selectNarrativeRows(value, limit)
    : (Array.isArray(value) ? value.slice(0, limit) : []));
  const numericKeys = [
    'currentNetSales', 'currentSalesCount', 'currentUnits', 'currentAverageTicket', 'currentUnitsPerTicket',
    'previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousSalesCount', 'deltaSalesCount',
    'previousUnits', 'deltaUnits', 'previousAverageTicket', 'deltaTicket', 'deltaTicketPercent',
    'previousUnitsPerTicket', 'deltaUnitsPerTicket'
  ];
  return {
    ...Object.fromEntries(numericKeys.map((key) => [key, pickNumber(source, [key])])),
    productsGrowing: rows(source.productsGrowing, 5).map(normalizeProductChange),
    productsDeclining: rows(source.productsDeclining, 5).map(normalizeProductChange),
    productOpportunities: rows(source.productOpportunities, 8).map(normalizeProductChange),
    channelChanges: rows(source.channelChanges, 12).map((row = {}) => {
      const item = asRecord(row);
      return {
        channel: asSafeText(item.channel, null, 80),
        currentShare: pickNumber(item, ['currentShare']),
        previousShare: pickNumber(item, ['previousShare']),
        deltaShare: pickNumber(item, ['deltaShare']),
        currentSales: pickNumber(item, ['currentSales']),
        previousSales: pickNumber(item, ['previousSales']),
        salesDelta: pickNumber(item, ['salesDelta'])
      };
    }).filter((row) => row.channel),
    comparisonAvailable: source.comparisonAvailable === true
  };
};

const normalizeEcommercePayload = (payload = {}) => {
  const source = asRecord(payload);
  const orders = asRecord(source.orders || source.orderFunnel || source.order_funnel);
  const catalog = asRecord(source.catalog || source.catalogHealth || source.catalog_health);

  return {
    orders: {
      received: pickNumber(orders, ['received', 'ordersReceived', 'orders_received']),
      accepted: pickNumber(orders, ['accepted', 'ordersAccepted', 'orders_accepted']),
      rejected: pickNumber(orders, ['rejected', 'ordersRejected', 'orders_rejected']),
      converted: pickNumber(orders, ['converted', 'ordersConverted', 'orders_converted']),
      averageOperationalTime: pickNumber(orders, ['averageOperationalTime', 'average_operational_time'])
    },
    events: {
      total: pickNumber(asRecord(source.events), ['total', 'count']),
      conversionRate: pickNumber(asRecord(source.events), ['conversionRate', 'conversion_rate'])
    },
    catalog: {
      published: pickNumber(catalog, ['published', 'publishedProducts', 'published_products']),
      eligible: pickNumber(catalog, ['eligible', 'eligibleProducts', 'eligible_products']),
      availableStock: pickNumber(catalog, ['availableStock', 'available_stock', 'stock_available', 'stockAvailable']),
      bestPerformers: normalizeProducts(catalog.bestPerformers || catalog.best_performers)
    },
    reconciledSales: {
      netSales: pickNumber(asRecord(source.reconciledSales || source.reconciled_sales), ['netSales', 'net_sales', 'sales']),
      orders: pickNumber(asRecord(source.reconciledSales || source.reconciled_sales), ['orders', 'order_count'])
    }
  };
};

export const buildSalesProfitabilityContext = ({ period, report, source = 'mixed', intent = null } = {}) => {
  const sales = normalizeSalesPayload(report, intent);
  return {
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    scope: 'current_authenticated_tenant',
    period: normalizePeriod(period),
    source: asSafeSource(source),
    sales: COMPACT_NARRATIVE_INTENTS.has(intent) ? buildNarrativeEvidence(intent, sales) : sales
  };
};

export const buildEcommerceContext = ({ period, report, source = 'mixed' } = {}) => ({
  agentKey: COMMERCIAL_AGENT_KEYS.ECOMMERCE,
  scope: 'current_authenticated_tenant',
  period: normalizePeriod(period),
  source: asSafeSource(source),
  ecommerce: normalizeEcommercePayload(report)
});

export const buildCommercialAgentContext = (agentKey, options = {}) => {
  if (agentKey === COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY) {
    return buildSalesProfitabilityContext(options);
  }
  if (agentKey === COMMERCIAL_AGENT_KEYS.ECOMMERCE) {
    return buildEcommerceContext(options);
  }
  throw new Error('INVALID_COMMERCIAL_AGENT_KEY');
};
