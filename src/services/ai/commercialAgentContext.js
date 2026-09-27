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
    'comparison.deltaUnitsPerTicket', 'summary.unitsPerTicket',
    'metric:deltaNetSales', 'metric:deltaSalesCount', 'metric:deltaUnits', 'metric:deltaTicket',
    'metric:deltaUnitsPerTicket', 'metric:currentNetSales', 'metric:currentAverageTicket',
    'metric:currentUnitsPerTicket', 'metric:currentSalesCount', 'metric:currentUnits'
  ],
  ticket_growth: [
    'summary.unitsPerTicket', 'comparison.deltaTicket', 'comparison.deltaTicketPercent',
    'comparison.deltaUnitsPerTicket', 'comparison.deltaSalesCount', 'comparison.deltaUnits',
    'metric:deltaTicket', 'metric:deltaUnitsPerTicket', 'metric:deltaSalesCount', 'metric:deltaUnits',
    'metric:currentAverageTicket', 'metric:currentUnitsPerTicket', 'metric:currentSalesCount', 'metric:currentUnits'
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

const NARRATIVE_ENTITY_PREFIXES = {
  sales_growth: ['product:', 'channel:'],
  ticket_growth: ['product:'],
  product_opportunity: ['product:'],
  sales_trend: ['channel:']
};

const candidateNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const candidateEvidence = (keys, availableEvidence) => Array.from(new Set(keys.filter((key) => availableEvidence.has(key))));

const makeOpportunityCandidate = ({ type, key, entity = null, signal, recommendationType, strength, score, metrics, evidenceKeys }) => ({
  key,
  type,
  focus: { type, key: entity || key },
  entity,
  signal: Array.isArray(signal) ? signal : [signal],
  recommendationType,
  strength,
  metrics,
  evidenceKeys,
  score
});

export const buildCommercialOpportunityCandidates = (intent, sales = {}) => {
  const summary = asRecord(sales.summary);
  const comparison = asRecord(sales.comparison);
  const signals = asRecord(sales.growthSignals);
  const availableEvidence = new Set(Array.isArray(sales.evidenceKeys) ? sales.evidenceKeys : []);
  const candidates = [];
  const add = (candidate) => {
    if (candidate.evidenceKeys.length) candidates.push(candidate);
  };

  const productRows = ['sales_growth', 'product_opportunity'].includes(intent) ? [
    ...(Array.isArray(signals.productOpportunities) ? signals.productOpportunities : []),
    ...(Array.isArray(signals.productsGrowing) ? signals.productsGrowing : [])
  ] : [];
  const uniqueProducts = new Map();
  productRows.forEach((row) => {
    const product = asRecord(row);
    const name = asSafeText(product.name, null, MAX_PRODUCT_NAME_LENGTH);
    const key = name ? `product:${name}` : null;
    if (!key || !availableEvidence.has(key) || (candidateNumber(product.currentSales) ?? 0) <= 0) return;
    const productSignals = Array.isArray(product.signals) ? product.signals : [];
    const positiveSignals = productSignals.filter((signal) => [
      'high_sales_share', 'growing', 'healthy_margin', 'new_in_period'
    ].includes(signal) && (signal !== 'healthy_margin' || product.costKnown === true));
    if (!positiveSignals.length) return;
    const strong = positiveSignals.some((signal) => ['high_sales_share', 'growing', 'healthy_margin'].includes(signal));
    const evidenceKeys = candidateEvidence([key, 'metric:currentNetSales'], availableEvidence);
    if (!evidenceKeys.includes(key)) return;
    const candidate = makeOpportunityCandidate({
      type: 'product',
      key,
      entity: name,
      signal: positiveSignals,
      recommendationType: 'growth_experiment',
      strength: strong ? 'strong' : 'moderate',
      score: positiveSignals.includes('high_sales_share') ? 100
        : positiveSignals.includes('growing') ? 90
          : positiveSignals.includes('healthy_margin') ? 80 : 60,
      metrics: {
        currentSales: candidateNumber(product.currentSales),
        currentShare: candidateNumber(product.currentShare),
        salesDelta: candidateNumber(product.salesDelta),
        currentUnits: candidateNumber(product.currentUnits),
        costKnown: product.costKnown === true
      },
      evidenceKeys
    });
    const prior = uniqueProducts.get(key);
    if (!prior || candidate.score > prior.score) uniqueProducts.set(key, candidate);
  });
  uniqueProducts.forEach(add);

  if (intent === 'sales_growth' || intent === 'ticket_growth') {
    const currentAverageTicket = candidateNumber(summary.averageTicket);
    const deltaTicket = candidateNumber(comparison.deltaTicket);
    const currentUnitsPerTicket = candidateNumber(summary.unitsPerTicket);
    const deltaUnitsPerTicket = candidateNumber(comparison.deltaUnitsPerTicket);
    const ticketEvidence = candidateEvidence([
      'metric:currentAverageTicket', 'metric:deltaTicket'
    ], availableEvidence);
    if (currentAverageTicket !== null && ticketEvidence.some((key) => key.startsWith('metric:'))) {
      const strong = deltaTicket !== null && deltaTicket > 0;
      add(makeOpportunityCandidate({
        type: 'ticket',
        key: 'ticket',
        signal: strong ? 'ticket_increased' : 'ticket_baseline_available',
        recommendationType: 'growth_experiment',
        strength: strong ? 'strong' : 'moderate',
        score: strong ? 75 : 35,
        metrics: { currentAverageTicket, deltaTicket },
        evidenceKeys: ticketEvidence
      }));
    }
    const unitsEvidence = candidateEvidence([
      'metric:currentUnitsPerTicket', 'metric:deltaUnitsPerTicket'
    ], availableEvidence);
    if (currentUnitsPerTicket !== null && unitsEvidence.some((key) => key.startsWith('metric:'))) {
      const strong = deltaUnitsPerTicket !== null && deltaUnitsPerTicket > 0;
      add(makeOpportunityCandidate({
        type: 'units_per_ticket',
        key: 'units_per_ticket',
        signal: strong ? 'units_per_ticket_increased' : 'units_per_ticket_baseline_available',
        recommendationType: 'growth_experiment',
        strength: strong ? 'strong' : 'moderate',
        score: strong ? 70 : 30,
        metrics: { currentUnitsPerTicket, deltaUnitsPerTicket },
        evidenceKeys: unitsEvidence
      }));
    }
  }

  if (intent === 'sales_growth') {
    const deltaSalesCount = candidateNumber(comparison.deltaSalesCount);
    const currentSalesCount = candidateNumber(summary.salesCount);
    const ticketEvidence = candidateEvidence(['metric:deltaSalesCount', 'metric:currentSalesCount'], availableEvidence);
    if (ticketEvidence.length && (deltaSalesCount !== null || currentSalesCount !== null)) {
      const strong = deltaSalesCount !== null && deltaSalesCount > 0;
      add(makeOpportunityCandidate({
        type: 'tickets',
        key: 'tickets',
        signal: strong ? 'tickets_increased' : 'ticket_count_baseline_available',
        recommendationType: strong ? 'optimization' : 'investigation',
        strength: strong ? 'strong' : 'moderate',
        score: strong ? 65 : 20,
        metrics: { currentSalesCount, deltaSalesCount },
        evidenceKeys: ticketEvidence
      }));
    }

    const channelRows = Array.isArray(signals.channelChanges) ? signals.channelChanges : [];
    channelRows.forEach((row) => {
      const channel = asRecord(row);
      const name = asSafeText(channel.channel, null, 80);
      const entityKey = name ? `channel:${name}` : null;
      if (!entityKey || !availableEvidence.has(entityKey)) return;
      const currentSales = candidateNumber(channel.currentSales);
      const previousSales = candidateNumber(channel.previousSales);
      const salesDelta = candidateNumber(channel.salesDelta);
      const disappeared = currentSales === 0 && previousSales !== null && previousSales > 0;
      const positive = salesDelta !== null && salesDelta > 0;
      const recommendationType = disappeared ? 'investigation' : positive ? 'optimization' : 'investigation';
      const candidate = makeOpportunityCandidate({
        type: 'channel',
        key: entityKey,
        entity: name,
        signal: disappeared ? 'channel_sales_disappeared' : positive ? 'channel_sales_increased' : 'channel_change_to_check',
        recommendationType,
        strength: positive ? 'strong' : 'moderate',
        score: disappeared ? 15 : positive ? 55 : 18,
        metrics: {
          currentSales,
          previousSales,
          salesDelta,
          currentShare: candidateNumber(channel.currentShare),
          previousShare: candidateNumber(channel.previousShare),
          deltaShare: candidateNumber(channel.deltaShare)
        },
        evidenceKeys: candidateEvidence([entityKey], availableEvidence)
      });
      add(candidate);
    });
  }

  const sorted = candidates
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const selected = sorted.slice(0, intent === 'sales_growth' ? 7 : 4)
    .map(({ score: _score, ...candidate }) => candidate);
  const actionableCandidates = selected.filter((candidate) => candidate.strength === 'strong'
    && ['growth_experiment', 'optimization'].includes(candidate.recommendationType)).length;
  const strongCount = intent === 'ticket_growth'
    ? selected.filter((candidate) => candidate.strength === 'strong'
      && ['ticket', 'units_per_ticket'].includes(candidate.type)).length
    : actionableCandidates;
  const minimumUsefulRecommendations = intent === 'sales_growth'
    ? Math.min(2, strongCount)
    : intent === 'ticket_growth'
      ? Math.min(1, strongCount || selected.filter((candidate) => ['ticket', 'units_per_ticket'].includes(candidate.type)).length)
      : intent === 'product_opportunity' ? Math.min(1, selected.length) : 0;

  return { candidates: selected, minimumUsefulRecommendations };
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
      : [
        'name', 'currentSales', 'salesDelta', 'unitsDelta', 'currentShare',
        'costKnown', 'costStatus', 'direction', 'signals'
      ];
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
  const entityPrefixes = NARRATIVE_ENTITY_PREFIXES[intent] || [];
  const selectedEntityKeys = [
    ...(entityPrefixes.includes('product:')
      ? [
        ...(Array.isArray(growthSignals.productOpportunities) ? growthSignals.productOpportunities : []),
        ...(Array.isArray(growthSignals.productsDeclining) ? growthSignals.productsDeclining : [])
      ].map((product) => asRecord(product).name).filter((name) => typeof name === 'string').map((name) => `product:${name}`)
      : []),
    ...(entityPrefixes.includes('channel:') && Array.isArray(growthSignals.channelChanges)
      ? growthSignals.channelChanges.map((channel) => asRecord(channel).channel)
        .filter((channel) => typeof channel === 'string').map((channel) => `channel:${channel}`)
      : [])
  ].filter((key) => availableEvidence.has(key));
  const evidenceKeys = [
    ...selectedEntityKeys,
    ...(NARRATIVE_EVIDENCE_KEYS[intent] || []).filter((key) => availableEvidence.has(key))
  ].filter((key, index, values) => values.indexOf(key) === index).slice(0, 24);
  const opportunityPlan = buildCommercialOpportunityCandidates(intent, {
    summary: sales.summary,
    comparison,
    growthSignals,
    evidenceKeys,
    coverage: sales.coverage
  });

  return {
    summary: pickOwnFields(asRecord(sales.summary), summaryFields),
    products: [],
    channels: [],
    comparison: pickOwnFields(comparison, comparisonFields),
    growthSignals,
    evidenceKeys,
    opportunityCandidates: opportunityPlan.candidates,
    minimumUsefulRecommendations: opportunityPlan.minimumUsefulRecommendations,
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
  const overview = asRecord(value.overview || value.metrics || value.summary);
  const coverage = asRecord(value.coverage);
  const growthSignals = asRecord(value.growthSignals);
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
  const productRows = [
    ...(Array.isArray(value.products) ? value.products : []),
    ...(Array.isArray(value.byProduct) ? value.byProduct : []),
    ...(Array.isArray(comparison.productChanges) ? comparison.productChanges : []),
    ...(Array.isArray(growthSignals.productOpportunities) ? growthSignals.productOpportunities : []),
    ...(Array.isArray(growthSignals.productsGrowing) ? growthSignals.productsGrowing : []),
    ...(Array.isArray(growthSignals.productsDeclining) ? growthSignals.productsDeclining : [])
  ];
  for (const item of productRows) {
    const row = asRecord(item);
    const name = asSafeText(row.name || row.product_name || row.productName, null, MAX_PRODUCT_NAME_LENGTH);
    const hasSalesEvidence = [
      'netSales', 'net_sales', 'sales', 'revenue', 'currentSales', 'previousSales', 'salesDelta',
      'quantity', 'units', 'currentUnits', 'previousUnits', 'currentShare', 'salesShare'
    ].some((field) => pickNumber(row, [field]) !== null);
    if (name && hasSalesEvidence) keys.push(`product:${name}`);
  }
  const channelRows = [
    ...(Array.isArray(value.channels) ? value.channels : []),
    ...(Array.isArray(value.byChannel) ? value.byChannel : []),
    ...(Array.isArray(comparison.channelMixChanges) ? comparison.channelMixChanges : []),
    ...(Array.isArray(growthSignals.channelChanges) ? growthSignals.channelChanges : [])
  ];
  for (const item of channelRows) {
    const row = asRecord(item);
    const name = asSafeText(row.channel || row.sales_channel || row.canal, null, 80);
    const hasChannelEvidence = [
      'netSales', 'net_sales', 'sales', 'revenue', 'currentSales', 'previousSales', 'salesDelta',
      'share', 'salesShare', 'currentShare', 'previousShare', 'deltaShare'
    ].some((field) => pickNumber(row, [field]) !== null);
    if (name && hasChannelEvidence) keys.push(`channel:${name}`);
  }
  const metricValues = {
    deltaNetSales: pickNumber(comparison, ['deltaNetSales', 'delta_net_sales']) ?? pickNumber(growthSignals, ['deltaNetSales']),
    deltaSalesCount: pickNumber(comparison, ['deltaSalesCount', 'delta_sales_count']) ?? pickNumber(growthSignals, ['deltaSalesCount']),
    deltaUnits: pickNumber(comparison, ['deltaUnits', 'delta_units']) ?? pickNumber(growthSignals, ['deltaUnits']),
    deltaTicket: pickNumber(comparison, ['deltaTicket', 'delta_ticket']) ?? pickNumber(growthSignals, ['deltaTicket']),
    deltaUnitsPerTicket: pickNumber(comparison, ['deltaUnitsPerTicket', 'delta_units_per_ticket']) ?? pickNumber(growthSignals, ['deltaUnitsPerTicket']),
    currentNetSales: pickNumber(overview, ['netSales', 'net_sales', 'sales', 'revenue']) ?? pickNumber(growthSignals, ['currentNetSales']),
    currentAverageTicket: pickNumber(overview, ['averageTicket', 'average_ticket', 'avg_ticket']) ?? pickNumber(growthSignals, ['currentAverageTicket']),
    currentUnitsPerTicket: pickNumber(overview, ['unitsPerTicket', 'units_per_ticket']) ?? pickNumber(growthSignals, ['currentUnitsPerTicket']),
    currentSalesCount: pickNumber(overview, ['salesCount', 'sales_count', 'orders', 'order_count']) ?? pickNumber(growthSignals, ['currentSalesCount']),
    currentUnits: pickNumber(overview, ['units', 'items', 'items_sold']) ?? pickNumber(growthSignals, ['currentUnits']),
    costCoverage: pickNumber(coverage, ['costCoverage', 'cost_coverage'])
  };
  Object.entries(metricValues).forEach(([key, metric]) => {
    if (metric !== null) keys.push(`metric:${key}`);
  });
  contributors.forEach((item) => keys.push(`contributors.${item.key}`));
  if (Array.isArray(value.scenarios) && value.scenarios.length) {
    keys.push('scenarios.values');
  }
  return Array.from(new Set(keys)).slice(0, 80);
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
