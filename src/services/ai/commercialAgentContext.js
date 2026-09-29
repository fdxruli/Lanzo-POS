import { COMMERCIAL_AGENT_KEYS } from './commercialAgentContract';

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_ROWS = 20;
const MAX_PRODUCT_CANDIDATE_ROWS = 10000;
const MAX_INTERNAL_EVIDENCE_KEYS = MAX_PRODUCT_CANDIDATE_ROWS + 128;
const SAFE_SOURCES = new Set(['cloud', 'local', 'mixed']);
const STRATEGY_SUMMARY_EVIDENCE_KEYS = new Set([
  'profitability.netSales', 'profitability.profit', 'profitability.margin', 'profitability.costCoverage',
  'coverage.itemsComplete', 'coverage.costCoverage', 'coverage.paginationComplete', 'coverage.sourceComplete',
  'metric:currentNetSales', 'metric:currentAverageTicket', 'metric:currentSalesCount'
]);

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};
const asArray = (value) => (Array.isArray(value) ? value : []);

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
  'sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'assortment_analysis',
  'goal_simulation', 'what_if_analysis', 'commercial_strategy'
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
  ],
  assortment_analysis: [
    'assortment.metric:activeCatalogProducts', 'assortment.metric:soldProducts',
    'assortment.metric:unsoldProducts', 'assortment.metric:topProductShare',
    'assortment.metric:top3ProductShare', 'assortment.metric:topCategoryShare'
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
      score: positiveSignals.includes('high_sales_share') && positiveSignals.includes('growing') ? 100
        : positiveSignals.includes('high_sales_share') ? 90
          : positiveSignals.includes('growing') ? 80
            : positiveSignals.includes('healthy_margin') ? 70 : 60,
      metrics: {
        currentSales: candidateNumber(product.currentSales),
        currentShare: candidateNumber(product.currentShare),
        salesDelta: candidateNumber(product.salesDelta),
        currentUnits: candidateNumber(product.currentUnits),
        costKnown: product.costKnown === true
      },
      evidenceKeys
    });
    const prior = uniqueProducts.get(name);
    const priorCurrentSales = candidateNumber(prior?.metrics?.currentSales) ?? 0;
    const candidateCurrentSales = candidateNumber(candidate.metrics.currentSales) ?? 0;
    const priorSalesDelta = Math.abs(candidateNumber(prior?.metrics?.salesDelta) ?? 0);
    const candidateSalesDelta = Math.abs(candidateNumber(candidate.metrics.salesDelta) ?? 0);
    if (!prior || candidate.score > prior.score
      || (candidate.score === prior.score && candidateCurrentSales > priorCurrentSales)
      || (candidate.score === prior.score && candidateCurrentSales === priorCurrentSales && candidateSalesDelta > priorSalesDelta)) {
      uniqueProducts.set(name, candidate);
    }
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
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const scoreDelta = right.candidate.score - left.candidate.score;
      if (scoreDelta) return scoreDelta;
      const leftMetrics = asRecord(left.candidate.metrics);
      const rightMetrics = asRecord(right.candidate.metrics);
      const shareDelta = (candidateNumber(rightMetrics.currentShare) ?? 0)
        - (candidateNumber(leftMetrics.currentShare) ?? 0);
      if (shareDelta) return shareDelta;
      const salesDelta = Math.abs(candidateNumber(rightMetrics.salesDelta) ?? 0)
        - Math.abs(candidateNumber(leftMetrics.salesDelta) ?? 0);
      if (salesDelta) return salesDelta;
      const unitsDelta = (candidateNumber(rightMetrics.currentUnits) ?? 0)
        - (candidateNumber(leftMetrics.currentUnits) ?? 0);
      if (unitsDelta) return unitsDelta;
      const currentSalesDelta = (candidateNumber(rightMetrics.currentSales) ?? 0)
        - (candidateNumber(leftMetrics.currentSales) ?? 0);
      return currentSalesDelta || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
  const candidateLimit = intent === 'sales_growth' ? 7 : 4;
  const productCandidateLimit = intent === 'sales_growth' ? 4 : candidateLimit;
  let selectedProductCount = 0;
  const selected = sorted.filter((candidate) => {
    if (candidate.type !== 'product') return true;
    if (selectedProductCount >= productCandidateLimit) return false;
    selectedProductCount += 1;
    return true;
  }).slice(0, candidateLimit)
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
      'name', 'currentSales', 'previousSales', 'salesDelta', 'salesDeltaPercent', 'currentUnits', 'previousUnits', 'unitsDelta',
      'currentShare', 'previousShare',
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

const ASSORTMENT_SIGNALS = new Set([
  'category_growing', 'new_category_activity', 'category_declining',
  'strong_category_few_products', 'single_product_concentration', 'many_unsold_products'
]);
const ASSORTMENT_ACTIVITY = new Set([
  'never_sold_in_window', 'previously_sold_now_inactive', 'low_activity', 'declining'
]);

const normalizeAssortmentPayload = (value = {}) => {
  const source = asRecord(value);
  const health = asRecord(source.health);
  const concentration = asRecord(health.concentration);
  const catalog = asRecord(source.catalog);
  const safeCategory = (row) => {
    const item = asRecord(row);
    return {
      name: asSafeText(item.name, null, 120),
      active: item.active === true,
      netSales: pickNumber(item, ['netSales', 'currentSales']),
      previousNetSales: pickNumber(item, ['previousNetSales', 'previousSales']),
      salesDelta: pickNumber(item, ['salesDelta']),
      salesDeltaPercent: pickNumber(item, ['salesDeltaPercent']),
      units: pickNumber(item, ['units']),
      previousUnits: pickNumber(item, ['previousUnits']),
      salesShare: pickNumber(item, ['salesShare']),
      activeProducts: pickNumber(item, ['activeProducts']),
      soldProducts: pickNumber(item, ['soldProducts']),
      unsoldProducts: pickNumber(item, ['unsoldProducts']),
      topProductShare: pickNumber(item, ['topProductShare']),
      signals: Array.isArray(item.signals) ? item.signals.filter((signal) => ASSORTMENT_SIGNALS.has(signal)).slice(0, 4) : []
    };
  };
  const safeProduct = (row) => {
    const item = asRecord(row);
    return {
      candidateRef: typeof item.candidateRef === 'string' && /^product_candidate_\d+$/u.test(item.candidateRef) ? item.candidateRef : null,
      name: asSafeText(item.name, null, MAX_PRODUCT_NAME_LENGTH),
      category: asSafeText(item.category, null, 120),
      activity: ASSORTMENT_ACTIVITY.has(item.activity) ? item.activity : null,
      currentSales: pickNumber(item, ['currentSales']),
      previousSales: pickNumber(item, ['previousSales']),
      currentUnits: pickNumber(item, ['currentUnits']),
      previousUnits: pickNumber(item, ['previousUnits']),
      availability: item.availability === 'availability_unknown' ? item.availability : null
    };
  };
  const opportunityRows = asArray(source.categoryOpportunities).slice(0, 8).map((row) => {
    const item = safeCategory(row);
    const candidateRef = asRecord(row).candidateRef;
    return {
      candidateRef: typeof candidateRef === 'string' && /^category_candidate_\d+$/u.test(candidateRef) ? candidateRef : null,
      ...item
    };
  }).filter((row) => row.name);
  const candidates = asArray(source.opportunityCandidates).slice(0, 8).flatMap((rawCandidate) => {
    const item = asRecord(rawCandidate);
    const focus = asRecord(item.focus);
    const type = item.type === 'category' || item.type === 'product' ? item.type : null;
    const key = typeof focus.key === 'string' && /^(?:category|product)_candidate_\d+$/u.test(focus.key) ? focus.key : null;
    if (!type || !key || focus.type !== type || !asSafeText(item.entity, null, MAX_PRODUCT_NAME_LENGTH)) return [];
    const expectedPrefix = type === 'category' ? `assortment.category:${key}` : `assortment.product:${key}`;
    const evidenceKeys = asArray(item.evidenceKeys).filter((entry) => entry === expectedPrefix).slice(0, 2);
    if (!evidenceKeys.length) return [];
    const metrics = asRecord(item.metrics);
    return [{
      key,
      type,
      focus: { type, key },
      entity: asSafeText(item.entity, null, MAX_PRODUCT_NAME_LENGTH),
      signal: asArray(item.signal).filter((signal) => ASSORTMENT_SIGNALS.has(signal) || signal === 'previously_sold_now_inactive' || signal === 'availability_unknown').slice(0, 4),
      recommendationType: ['growth_experiment', 'investigation', 'data_quality', 'optimization'].includes(item.recommendationType)
        ? item.recommendationType
        : 'investigation',
      strength: ['strong', 'moderate'].includes(item.strength) ? item.strength : 'moderate',
      metrics: pickOwnFields(metrics, [
        'currentSales', 'previousSales', 'salesDelta', 'salesShare',
        'activeProducts', 'soldProducts', 'unsoldProducts', 'topProductShare',
        'currentUnits', 'previousUnits', 'costKnown'
      ]),
      evidenceKeys
    }];
  });
  const candidateEvidence = candidates.flatMap((candidate) => candidate.evidenceKeys);
  const evidenceKeys = [
    ...asArray(source.evidenceKeys).filter((key) => typeof key === 'string' && /^assortment\.(?:metric:[A-Za-z0-9]+|(?:category|product):(?:category|product)_candidate_\d+)$/u.test(key)),
    ...candidateEvidence
  ].slice(0, 24);

  return {
    catalog: {
      source: catalog.source === 'local_tenant_catalog' ? catalog.source : 'local_tenant_catalog',
      complete: catalog.complete === true,
      productsRead: pickNumber(catalog, ['productsRead']),
      categoriesRead: pickNumber(catalog, ['categoriesRead']),
      productsTruncated: catalog.productsTruncated === true,
      categoriesTruncated: catalog.categoriesTruncated === true
    },
    health: {
      activeCatalogProducts: pickNumber(health, ['activeCatalogProducts']),
      inactiveCatalogProducts: pickNumber(health, ['inactiveCatalogProducts']),
      soldProducts: pickNumber(health, ['soldProducts']),
      unsoldProducts: pickNumber(health, ['unsoldProducts']),
      activeCategories: pickNumber(health, ['activeCategories']),
      soldCategories: pickNumber(health, ['soldCategories']),
      currentSalesCoverageComplete: health.currentSalesCoverageComplete === true,
      previousComparisonAvailable: health.previousComparisonAvailable === true,
      productSalesJoinCoverage: pickNumber(health, ['productSalesJoinCoverage']),
      categorySalesCoverage: pickNumber(health, ['categorySalesCoverage']),
      concentration: pickOwnFields(concentration, ['topProductShare', 'top3ProductShare', 'topCategoryShare', 'categoryRevenueCoverage'])
    },
    categoryPerformance: asArray(source.categoryPerformance).slice(0, 10).map(safeCategory).filter((row) => row.name),
    categoryOpportunities: opportunityRows,
    dormantProducts: asArray(source.dormantProducts).slice(0, 12).map(safeProduct).filter((row) => row.name),
    reactivationCandidates: asArray(source.reactivationCandidates).slice(0, 12).map((row) => {
      const item = safeProduct(row);
      return {
        ...item,
        reason: asSafeText(asRecord(row).reason, null, 200)
      };
    }).filter((row) => row.name),
    opportunityCandidates: candidates,
    evidenceKeys,
    minimumUsefulRecommendations: Number.isInteger(source.minimumUsefulRecommendations)
      ? Math.max(0, Math.min(source.minimumUsefulRecommendations, 2))
      : 0,
    narrativeEligible: source.narrativeEligible === true,
    currentPeriod: pickOwnFields(asRecord(source.currentPeriod), ['netSales', 'units', 'complete']),
    previousPeriod: pickOwnFields(asRecord(source.previousPeriod), ['netSales', 'units', 'complete']),
    comparisonAvailable: source.comparisonAvailable === true,
    limitations: asArray(source.limitations).filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 240))
  };
};

const buildNarrativeEvidence = (intent, sales) => {
  if (['goal_simulation', 'what_if_analysis', 'commercial_strategy'].includes(intent)) {
    const strategyCandidates = sales.strategyRequested === true
      ? sales.strategyCandidates.filter((candidate) => candidate.priority !== 'low').slice(0, 3)
      : [];
    const opportunityCandidates = strategyCandidates.map((candidate) => ({
      key: candidate.key,
      type: candidate.type,
      focus: candidate.focus,
      entity: candidate.entity,
      signal: candidate.signal,
      recommendationType: candidate.recommendationType,
      strength: candidate.strength,
      metrics: candidate.metrics,
      evidenceKeys: candidate.evidenceKeys
    }));
    const candidateProductNames = new Set(strategyCandidates.filter((candidate) => candidate.type === 'product').map((candidate) => candidate.entity));
    const candidateGrowthNames = new Set(strategyCandidates.filter((candidate) => candidate.reasonCode === 'product_growing').map((candidate) => candidate.entity));
    const evidenceKeys = Array.from(new Set([
      ...(sales.strategyRequested ? opportunityCandidates.flatMap((candidate) => candidate.evidenceKeys) : []),
      ...(sales.evidenceKeys || []).filter((key) => STRATEGY_SUMMARY_EVIDENCE_KEYS.has(key)),
      ...(sales.whatIfSimulation ? ['scenarios.values'] : [])
    ])).slice(0, 40);
    const assortment = sales.assortment;
    return {
      summary: pickOwnFields(asRecord(sales.summary), [
        'netSales', 'salesCount', 'averageTicket', 'units', 'profit', 'margin', 'costCoverage', 'profitabilityStatus'
      ]),
      products: sales.strategyProducts.filter((product) => candidateProductNames.has(product.name)).slice(0, 8),
      channels: [],
      comparison: pickOwnFields(asRecord(sales.comparison), [
        'previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousSalesCount', 'deltaSalesCount',
        'previousTicket', 'deltaTicket', 'deltaTicketPercent', 'deltaMargin'
      ]),
      ...(sales.goalSimulation ? { goalSimulation: sales.goalSimulation } : {}),
      ...(sales.whatIfSimulation ? { whatIfSimulation: sales.whatIfSimulation } : {}),
      strategyRequested: sales.strategyRequested === true,
      strategyCandidates,
      ...(sales.growthSignals ? { growthSignals: {
        comparisonAvailable: sales.growthSignals.comparisonAvailable === true,
        productsGrowing: sales.growthSignals.productsGrowing.filter((product) => candidateGrowthNames.has(product.name)).slice(0, 8)
      } } : {}),
      ...(assortment ? { assortment: {
        catalog: assortment.catalog,
        health: assortment.health,
        categoryPerformance: assortment.categoryPerformance.slice(0, 10),
        categoryOpportunities: assortment.categoryOpportunities,
        dormantProducts: assortment.dormantProducts.slice(0, 12),
        reactivationCandidates: assortment.reactivationCandidates,
        currentPeriod: assortment.currentPeriod,
        previousPeriod: assortment.previousPeriod,
        comparisonAvailable: assortment.comparisonAvailable,
        limitations: assortment.limitations.slice(0, 6)
      } } : {}),
      comboOpportunities: sales.comboOpportunities || [],
      evidenceKeys,
      opportunityCandidates,
      minimumUsefulRecommendations: Math.min(2, strategyCandidates.length),
      coverage: pickOwnFields(asRecord(sales.coverage), [
        'validSales', 'complete', 'itemsComplete', 'paginationComplete', 'sourceComplete', 'comparisonAvailable',
        'comparisonDataAvailable', 'comparisonItemsAvailable', 'strategyEvidenceAvailable', 'strategyCatalogComplete'
      ]),
      calculations: sales.calculations.slice(0, 20),
      assumptions: sales.assumptions.slice(0, 8),
      scenarios: sales.scenarios.slice(0, 8),
      limitations: sales.limitations.slice(0, 12)
    };
  }
  if (intent === 'assortment_analysis') {
    const assortment = normalizeAssortmentPayload(sales.assortment);
    const availableEvidence = new Set(assortment.evidenceKeys);
    const evidenceKeys = [
      ...(NARRATIVE_EVIDENCE_KEYS.assortment_analysis || []).filter((key) => availableEvidence.has(key)),
      ...assortment.opportunityCandidates.flatMap((candidate) => candidate.evidenceKeys)
    ].filter((key, index, values) => values.indexOf(key) === index).slice(0, 24);
    const candidateKeys = new Set(evidenceKeys);
    const opportunityCandidates = assortment.opportunityCandidates.filter((candidate) => (
      candidate.evidenceKeys.every((key) => candidateKeys.has(key))
    ));
    return {
      summary: pickOwnFields(asRecord(sales.summary), ['netSales', 'salesCount', 'units']),
      products: [],
      channels: [],
      comparison: pickOwnFields(asRecord(sales.comparison), ['previousNetSales', 'deltaNetSales', 'deltaNetSalesPercent', 'previousUnits', 'deltaUnits']),
      growthSignals: { comparisonAvailable: assortment.comparisonAvailable },
      assortment: {
        catalog: assortment.catalog,
        health: assortment.health,
        categoryPerformance: assortment.categoryPerformance.slice(0, 10),
        categoryOpportunities: assortment.categoryOpportunities,
        dormantProducts: assortment.dormantProducts.slice(0, 12),
        reactivationCandidates: assortment.reactivationCandidates,
        currentPeriod: assortment.currentPeriod,
        previousPeriod: assortment.previousPeriod,
        comparisonAvailable: assortment.comparisonAvailable,
        limitations: assortment.limitations.slice(0, 8)
      },
      evidenceKeys,
      opportunityCandidates,
      minimumUsefulRecommendations: assortment.minimumUsefulRecommendations,
      coverage: pickOwnFields(asRecord(sales.coverage), [
        'validSales', 'comparisonAvailable', 'comparisonDataAvailable', 'growthDataComplete',
        'salesDataComplete', 'itemsComplete', 'paginationComplete', 'sourceComplete', 'complete'
      ]),
      calculations: [],
      assumptions: [],
      scenarios: [],
      limitations: assortment.limitations.slice(0, 8)
    };
  }
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
    growthSignals.productOpportunities = opportunities.slice(0, MAX_PRODUCT_CANDIDATE_ROWS)
      .map((product) => projectNarrativeProduct(product, intent));
    growthSignals.productsDeclining = selectNarrativeRows(declining, 3).map((product) => projectNarrativeProduct(product, intent));
  } else if (intent === 'ticket_growth') {
    growthSignals.productOpportunities = selectNarrativeRows(opportunities.length ? opportunities : growing, 2)
      .map((product) => projectNarrativeProduct(product, intent));
  } else if (intent === 'product_opportunity') {
    growthSignals.productOpportunities = opportunities.slice(0, MAX_PRODUCT_CANDIDATE_ROWS)
      .map((product) => projectNarrativeProduct(product, intent));
  }
  if (['sales_growth', 'sales_trend'].includes(intent)) {
    growthSignals.channelChanges = selectNarrativeRows(channelRows, 2).map(projectNarrativeChannel);
  }

  const availableEvidence = new Set(Array.isArray(sales.evidenceKeys) ? sales.evidenceKeys : []);
  const opportunityPlan = buildCommercialOpportunityCandidates(intent, {
    summary: sales.summary,
    comparison,
    growthSignals,
    // Rank against the full bounded internal evidence set. Compact only after
    // candidates are selected so an early product name cannot consume the
    // narrative evidence budget and hide a stronger later candidate.
    evidenceKeys: Array.from(availableEvidence),
    coverage: sales.coverage
  });
  if (['sales_growth', 'product_opportunity'].includes(intent)) {
    const selectedProductNames = opportunityPlan.candidates
      .filter((candidate) => candidate.type === 'product')
      .slice(0, 3)
      .map((candidate) => candidate.entity);
    const opportunityByName = new Map();
    opportunities.forEach((product) => {
      if (typeof product?.name === 'string' && !opportunityByName.has(product.name)) {
        opportunityByName.set(product.name, product);
      }
    });
    growthSignals.productOpportunities = selectedProductNames
      .map((name) => opportunityByName.get(name))
      .filter(Boolean)
      .map((product) => projectNarrativeProduct(product, intent));
  }

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
  const candidateEvidenceKeys = opportunityPlan.candidates.flatMap((candidate) => candidate.evidenceKeys);
  const evidenceKeys = [
    ...candidateEvidenceKeys,
    ...selectedEntityKeys,
    ...(NARRATIVE_EVIDENCE_KEYS[intent] || []).filter((key) => availableEvidence.has(key))
  ].filter((key, index, values) => values.indexOf(key) === index).slice(0, 24);

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
    strategyEvidenceAvailable: source.strategyEvidenceAvailable === true,
    strategyCatalogComplete: source.strategyCatalogComplete === true,
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

const GOAL_TYPES = new Set(['revenue', 'gross_profit', 'average_ticket', 'gross_margin', 'product_margin']);
const STRATEGY_REASON_CODES = new Set([
  'ticket_down_sales_stable', 'sales_declining', 'margin_deteriorating', 'product_cost_missing',
  'product_low_margin', 'product_growing', 'category_concentrated', 'category_growing', 'products_without_sales', 'historical_combo'
]);
const STRATEGY_TYPES = new Set(['product', 'category', 'ticket', 'general']);
const STRATEGY_METRICS = new Set([
  'currentSales', 'currentShare', 'salesDelta', 'deltaSales', 'deltaSalesPercent', 'currentUnits', 'costKnown', 'currentAverageTicket',
  'deltaTicket', 'deltaNetSalesPercent', 'deltaSalesCount', 'currentMargin', 'deltaMargin',
  'previousSales', 'currentProfit', 'unsoldProducts', 'topProductShare', 'tickets', 'frequency'
]);

const normalizeSimulationResult = (value, keys, enums = {}) => {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  const result = {};
  keys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const entry = source[key];
    if (key === 'assumptions' || key === 'limitations') {
      if (Array.isArray(entry)) result[key] = entry.filter((item) => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 240));
      return;
    }
    if (key === 'ready' || key === 'costKnown') {
      if (typeof entry === 'boolean') result[key] = entry;
      return;
    }
    if (key === 'state') {
      if (['achieved', 'remaining', 'unavailable'].includes(entry)) result[key] = entry;
      return;
    }
    if (key === 'type' || key === 'changeType') {
      if ((enums[key] || new Set()).has(entry)) result[key] = entry;
      return;
    }
    if (key === 'productName' || key === 'limitation') {
      const text = asSafeText(entry, null, key === 'productName' ? 120 : 240);
      if (text) result[key] = text;
      return;
    }
    if (entry === null || (typeof entry === 'number' && Number.isFinite(entry))) result[key] = entry;
  });
  return Object.keys(result).length ? result : null;
};

const normalizeGoalSimulation = (value) => normalizeSimulationResult(value, [
  'type', 'targetValue', 'currentValue', 'ready', 'state', 'gap', 'gapPercent', 'excess', 'progress', 'limitation',
  'revenueGap', 'requiredAdditionalTicketsAtCurrentTicket', 'requiredAverageTicketAtCurrentTicketCount',
  'currentSales', 'currentTickets', 'currentAverageTicket', 'currentProfit', 'targetProfit', 'profitGap',
  'currentRevenue', 'currentMargin', 'requiredRevenue', 'additionalRevenue', 'equivalentAdditionalTickets',
  'costOfSale', 'requiredSalesAtCurrentTicketCount', 'salesIncreaseAtCurrentTicketCount', 'ticketDifference',
  'ticketChangePercent', 'targetMargin', 'requiredProfitAtCurrentSales', 'additionalProfitRequired', 'productName',
  'currentPrice', 'unitCost', 'requiredPrice', 'priceDifference', 'priceChangePercent', 'assumptions', 'limitations'
], { type: GOAL_TYPES });

const normalizeWhatIfSimulation = (value) => normalizeSimulationResult(value, [
  'changeType', 'changePercent', 'ready', 'currentSales', 'simulatedSales', 'salesDelta', 'currentCost',
  'simulatedCost', 'currentProfit', 'simulatedProfit', 'profitDelta', 'currentMargin', 'simulatedMargin',
  'ticketCount', 'currentTicket', 'simulatedTicket', 'productName', 'historicalUnits', 'simulatedUnits',
  'averagePrice', 'historicalSales', 'costKnown', 'currentCost', 'simulatedCost', 'assumptions', 'limitations'
], { changeType: new Set(['sales', 'ticket', 'product']) });

const normalizeStrategyCandidates = (rows, availableEvidence) => (Array.isArray(rows) ? rows : [])
  .slice(0, 8)
  .flatMap((raw) => {
    const source = asRecord(raw);
    const type = STRATEGY_TYPES.has(source.type) ? source.type : null;
    const key = asSafeText(source.key, null, 120);
    const focus = asRecord(source.focus);
    const focusKey = asSafeText(focus.key, null, 120);
    const reasonCode = STRATEGY_REASON_CODES.has(source.reasonCode) ? source.reasonCode : null;
    const priority = ['high', 'medium', 'low'].includes(source.priority) ? source.priority : null;
    const recommendationType = ['growth_experiment', 'investigation', 'data_quality', 'optimization'].includes(source.recommendationType)
      ? source.recommendationType : null;
    const evidenceKeys = Array.isArray(source.evidenceKeys)
      ? Array.from(new Set(source.evidenceKeys.filter((entry) => typeof entry === 'string' && availableEvidence.has(entry)))).slice(0, 8)
      : [];
    if (!type || !key || !reasonCode || !priority || !recommendationType || focus.type !== type || focusKey !== key || !evidenceKeys.length) return [];
    const rawMetrics = asRecord(source.metrics);
    const metrics = Object.fromEntries(Object.entries(rawMetrics).filter(([metric, value]) => STRATEGY_METRICS.has(metric)
      && ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean')));
    const entity = source.entity === null ? null : asSafeText(source.entity, null, 180);
    if (['product', 'category'].includes(type) && (!entity || entity !== focusKey)) return [];
    return [{
      key, type, focus: { type, key: focusKey }, priority, reasonCode,
      title: asSafeText(source.title, null, 120),
      entity,
      recommendationType,
      strength: ['strong', 'moderate', 'weak'].includes(source.strength) ? source.strength : 'weak',
      metrics,
      signal: [reasonCode],
      evidenceKeys
    }].filter((candidate) => candidate.title);
  });

const buildEvidenceKeys = (source = {}) => {
  const value = asRecord(source);
  const comparison = asRecord(value.comparison || value.previous);
  const overview = asRecord(value.overview || value.metrics || value.summary);
  const coverage = asRecord(value.coverage);
  const growthSignals = asRecord(value.growthSignals);
  const assortment = asRecord(value.assortment);
  const assortmentHealth = asRecord(assortment.health);
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
  const categoryRows = Array.isArray(assortment.categoryPerformance) ? assortment.categoryPerformance : [];
  categoryRows.forEach((item) => {
    const row = asRecord(item);
    const name = asSafeText(row.name, null, MAX_PRODUCT_NAME_LENGTH);
    if (name && pickNumber(row, ['netSales']) !== null) keys.push(`assortment.category:${name}`);
  });
  const topCategoryShare = pickNumber(asRecord(assortmentHealth.concentration), ['topCategoryShare']);
  const topProductShare = pickNumber(asRecord(assortmentHealth.concentration), ['topProductShare']);
  const top3ProductShare = pickNumber(asRecord(assortmentHealth.concentration), ['top3ProductShare']);
  if (topCategoryShare !== null) keys.push('assortment.metric:topCategoryShare');
  if (topProductShare !== null) keys.push('assortment.metric:topProductShare');
  if (top3ProductShare !== null) keys.push('assortment.metric:top3ProductShare');
  if (pickNumber(assortmentHealth, ['unsoldProducts']) !== null) keys.push('assortment.metric:unsoldProducts');
  const comboRows = Array.isArray(value.comboOpportunities) ? value.comboOpportunities : [];
  comboRows.slice(0, 3).forEach((item, index) => {
    const row = asRecord(item);
    if (Array.isArray(row.products) && row.products.length === 2 && pickNumber(row, ['tickets']) !== null) {
      keys.push(`comboOpportunities.${index}.tickets`);
      if (pickNumber(row, ['frequency']) !== null) keys.push(`comboOpportunities.${index}.frequency`);
    }
  });
  const metricValues = {
    deltaNetSales: pickNumber(comparison, ['deltaNetSales', 'delta_net_sales']) ?? pickNumber(growthSignals, ['deltaNetSales']),
    deltaNetSalesPercent: pickNumber(comparison, ['deltaNetSalesPercent']) ?? pickNumber(growthSignals, ['deltaNetSalesPercent']),
    deltaSalesCount: pickNumber(comparison, ['deltaSalesCount', 'delta_sales_count']) ?? pickNumber(growthSignals, ['deltaSalesCount']),
    deltaUnits: pickNumber(comparison, ['deltaUnits', 'delta_units']) ?? pickNumber(growthSignals, ['deltaUnits']),
    deltaTicket: pickNumber(comparison, ['deltaTicket', 'delta_ticket']) ?? pickNumber(growthSignals, ['deltaTicket']),
    deltaUnitsPerTicket: pickNumber(comparison, ['deltaUnitsPerTicket', 'delta_units_per_ticket']) ?? pickNumber(growthSignals, ['deltaUnitsPerTicket']),
    currentNetSales: pickNumber(overview, ['netSales', 'net_sales', 'sales', 'revenue']) ?? pickNumber(growthSignals, ['currentNetSales']),
    currentAverageTicket: pickNumber(overview, ['averageTicket', 'average_ticket', 'avg_ticket']) ?? pickNumber(growthSignals, ['currentAverageTicket']),
    currentUnitsPerTicket: pickNumber(overview, ['unitsPerTicket', 'units_per_ticket']) ?? pickNumber(growthSignals, ['currentUnitsPerTicket']),
    currentSalesCount: pickNumber(overview, ['salesCount', 'sales_count', 'orders', 'order_count']) ?? pickNumber(growthSignals, ['currentSalesCount']),
    currentUnits: pickNumber(overview, ['units', 'items', 'items_sold']) ?? pickNumber(growthSignals, ['currentUnits']),
    costCoverage: pickNumber(coverage, ['costCoverage', 'cost_coverage']),
    currentMargin: pickNumber(overview, ['margin', 'gross_margin']),
    deltaMargin: pickNumber(comparison, ['deltaMargin'])
  };
  Object.entries(metricValues).forEach(([key, metric]) => {
    if (metric !== null) keys.push(`metric:${key}`);
  });
  contributors.forEach((item) => keys.push(`contributors.${item.key}`));
  if (Array.isArray(value.scenarios) && value.scenarios.length) {
    keys.push('scenarios.values');
  }
  return Array.from(new Set(keys)).slice(0, MAX_INTERNAL_EVIDENCE_KEYS);
};

const normalizeSalesPayload = (payload = {}, intent = null) => {
  const source = asRecord(payload);
  const overview = asRecord(source.overview || source.metrics || source.summary);
  const evidenceKeys = buildEvidenceKeys(source);
  const availableEvidence = new Set(evidenceKeys);
  const strategyCandidates = normalizeStrategyCandidates(source.strategyCandidates, availableEvidence);
  const strategyProductNames = new Set(strategyCandidates.filter((candidate) => candidate.type === 'product').map((candidate) => candidate.entity));
  const rawProductRows = source.products || source.byProduct || source.by_product;
  const strategyProducts = (Array.isArray(rawProductRows) ? rawProductRows : [])
    .filter((row) => strategyProductNames.has(asSafeText(asRecord(row).name || asRecord(row).product_name || asRecord(row).productName)))
    .slice(0, 8)
    .map(normalizeProduct)
    .filter((product) => product.name);
  const opportunityCandidates = strategyCandidates.map((candidate) => ({
    key: candidate.key,
    type: candidate.type,
    focus: candidate.focus,
    entity: candidate.entity,
    signal: candidate.signal,
    recommendationType: candidate.recommendationType,
    strength: candidate.strength,
    metrics: candidate.metrics,
    evidenceKeys: candidate.evidenceKeys
  }));

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
    ...(Object.keys(asRecord(source.assortment)).length
      ? { assortment: normalizeAssortmentPayload(source.assortment) }
      : {}),
    ...(source.growthSignals && Object.keys(asRecord(source.growthSignals)).length
      ? { growthSignals: normalizeGrowthSignals(source.growthSignals, COMPACT_NARRATIVE_INTENTS.has(intent)) }
      : {}),
    ...(normalizeGoalSimulation(source.goalSimulation) ? { goalSimulation: normalizeGoalSimulation(source.goalSimulation) } : {}),
    ...(normalizeWhatIfSimulation(source.whatIfSimulation) ? { whatIfSimulation: normalizeWhatIfSimulation(source.whatIfSimulation) } : {}),
    ...(Array.isArray(source.comboOpportunities) ? {
      comboOpportunities: source.comboOpportunities.slice(0, 3).map((combo) => {
        const row = asRecord(combo);
        return {
          products: Array.isArray(row.products) ? row.products.filter((name) => typeof name === 'string').slice(0, 2).map((name) => name.slice(0, 120)) : [],
          tickets: pickNumber(row, ['tickets']),
          frequency: pickNumber(row, ['frequency']),
          evidenceLevel: ['high', 'medium', 'low'].includes(row.evidenceLevel) ? row.evidenceLevel : 'low'
        };
      }).filter((combo) => combo.products.length === 2 && combo.tickets !== null)
    } : {}),
    strategyRequested: source.strategyRequested === true,
    strategyCandidates,
    strategyProducts,
    opportunityCandidates,
    contributors: normalizeContributors(source.contributors),
    evidenceKeys,
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
  const productOpportunityRows = Array.isArray(source.productOpportunities)
    ? source.productOpportunities.slice(0, MAX_PRODUCT_CANDIDATE_ROWS)
    : [];
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
    productOpportunities: productOpportunityRows.map(normalizeProductChange),
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
  const standardSales = Object.fromEntries(Object.entries(sales).filter(([key]) => key !== 'strategyProducts'));
  return {
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    scope: 'current_authenticated_tenant',
    period: normalizePeriod(period),
    source: asSafeSource(source),
    sales: COMPACT_NARRATIVE_INTENTS.has(intent) ? buildNarrativeEvidence(intent, sales) : standardSales
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
