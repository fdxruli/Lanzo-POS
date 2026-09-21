import { COMMERCIAL_AGENT_KEYS } from './commercialAgentContract';

const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_ROWS = 20;
const SAFE_SOURCES = new Set(['cloud', 'local', 'mixed']);

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const asSafeText = (value, fallback = null, maxLength = MAX_PRODUCT_NAME_LENGTH) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : fallback;
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
    unitCost: pickNumber(source, ['unitCost', 'unit_cost', 'cost']),
    profit: pickNumber(source, ['profit', 'gross_profit', 'utility']),
    margin: pickNumber(source, ['margin', 'gross_margin']),
    averagePrice: pickNumber(source, ['averagePrice', 'average_price', 'unit_price']),
    costKnown: source.costKnown === undefined ? null : source.costKnown === true,
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
    averageTicket: pickNumber(source, ['averageTicket', 'average_ticket', 'avg_ticket'])
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
    previousNetSales: pickNumber(source, ['previousNetSales', 'previous_net_sales']),
    previousUnits: pickNumber(source, ['previousUnits', 'previous_units']),
    previousTicket: pickNumber(source, ['previousTicket', 'previous_ticket']),
    previousCost: pickNumber(source, ['previousCost', 'previous_cost']),
    previousProfit: pickNumber(source, ['previousProfit', 'previous_profit']),
    previousMargin: pickNumber(source, ['previousMargin', 'previous_margin']),
    deltaNetSales: pickNumber(source, ['deltaNetSales', 'delta_net_sales']),
    deltaUnits: pickNumber(source, ['deltaUnits', 'delta_units']),
    deltaTicket: pickNumber(source, ['deltaTicket', 'delta_ticket']),
    deltaCost: pickNumber(source, ['deltaCost', 'delta_cost']),
    deltaProfit: pickNumber(source, ['deltaProfit', 'delta_profit']),
    deltaMargin: pickNumber(source, ['deltaMargin', 'delta_margin']),
    deltaMarginRelative: pickNumber(source, ['deltaMarginRelative', 'delta_margin_relative']),
    deltaDiscounts: pickNumber(source, ['deltaDiscounts', 'delta_discounts']),
    productMixChanges: normalizeMixRows(source.productMixChanges, 'name'),
    channelMixChanges: normalizeMixRows(source.channelMixChanges, 'channel')
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
  'comboPrice', 'discount', 'products', 'note', 'isPrediction', 'currentPrice', 'newPrice',
  'unitCost', 'historicalJointSales', 'averageJointSale', 'cost', 'profit', 'evidenceLevel',
  'opportunity', 'historicalVolume', 'breakEvenVolume', 'isDemandPrediction'
]);

const normalizeSalesPayload = (payload = {}) => {
  const source = asRecord(payload);
  const overview = asRecord(source.overview || source.metrics || source.summary);

  return {
    summary: {
      netSales: pickNumber(overview, ['netSales', 'net_sales', 'sales', 'revenue']),
      units: pickNumber(overview, ['units', 'items', 'items_sold']),
      salesCount: pickNumber(overview, ['salesCount', 'sales_count', 'orders', 'order_count']),
      averageTicket: pickNumber(overview, ['averageTicket', 'average_ticket', 'avg_ticket']),
      discounts: pickNumber(overview, ['discounts', 'discount_amount', 'total_discounts']),
      unitCosts: pickNumber(overview, ['unitCosts', 'unit_costs', 'cogs', 'costs']),
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
    products: normalizeProducts(source.products || source.byProduct || source.by_product),
    channels: normalizeChannels(source.channels || source.byChannel || source.by_channel),
    comparison: normalizeComparison(source.comparison || source.previous),
    contributors: normalizeContributors(source.contributors),
    coverage: normalizeCoverage(source.coverage),
    calculations: normalizeCalculations(source.calculations),
    assumptions: Array.isArray(source.assumptions)
      ? source.assumptions.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 180))
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

export const buildSalesProfitabilityContext = ({ period, report, source = 'mixed' } = {}) => ({
  agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
  scope: 'current_authenticated_tenant',
  period: normalizePeriod(period),
  source: asSafeSource(source),
  sales: normalizeSalesPayload(report)
});

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
