import {
  COMMERCIAL_AGENT_KEYS,
  resolveCommercialIntent,
  normalizeScenarioForIntent
} from './commercialAgentContract';
import { isMissingUnitCost } from '../sales/financialPolicy';
import { buildGoalSimulation, buildWhatIfAnalysis } from './commercialScenarioAnalytics';

export const SALES_PROFITABILITY_INTENTS = Object.freeze([
  'profitability_summary',
  'explain_change',
  'product_risk',
  'sales_growth',
  'ticket_growth',
  'product_opportunity',
  'sales_trend',
  'assortment_analysis',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity',
  'goal_simulation',
  'what_if_analysis',
  'commercial_strategy'
]);

const DEFAULT_COST_COVERAGE = 0;
const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';
const MAX_PRODUCT_OPPORTUNITIES = 8;
const MAX_CHANNELS = 12;
const MIN_COMBO_TICKETS = 3;
const LOW_MARGIN_THRESHOLD = 0.2;

const EXCLUDED_SALES_STATUSES = new Set([
  'cancelled',
  'canceled',
  'cancelada',
  'cancelado',
  'annulled',
  'anulada',
  'anulado',
  'reverted',
  'revertida',
  'revertido',
  'void',
  'voided',
  'rejected',
  'rechazada',
  'rechazado',
  'shadow'
]);

const OPERATIONAL_SALES_SOURCES = new Set([
  'cloud_committed',
  'cloud_final',
  'local',
  'local_committed',
  'pos',
  'pos_sale',
  'pos_converted',
  'ecommerce_converted',
  'ecommerce_pos_converted'
]);

const EXCLUDED_SALES_SOURCES = new Set([
  'shadow',
  'shadow_history',
  'history_shadow',
  'legacy',
  'legacy_imported',
  'legacy_history',
  'historical',
  'historical_import',
  'imported_history',
  'ecommerce_order',
  'ecommerce_pending',
  'ecommerce_rejected',
  'ecommerce_cancelled',
  'ecommerce_canceled',
  'rejected',
  'cancelled',
  'canceled'
]);

const HISTORICAL_SOURCE_TOKEN_PATTERN = /(?:^|_)(?:legacy|historical|history|imported)(?:_|$)/u;
const MONEY_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
});
const PERCENT_FORMATTER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const NUMBER_FORMATTERS = new Map();

const numberFormatter = (maximumFractionDigits) => {
  if (!NUMBER_FORMATTERS.has(maximumFractionDigits)) {
    NUMBER_FORMATTERS.set(maximumFractionDigits, new Intl.NumberFormat('es-MX', { maximumFractionDigits }));
  }
  return NUMBER_FORMATTERS.get(maximumFractionDigits);
};

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumberOrNull = (value) => {
  const numeric = numberOrNull(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

const safeText = (value, fallback = null, maxLength = 120) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().slice(0, maxLength);
  return text || fallback;
};

const normalize = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const formatMoney = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : MONEY_FORMATTER.format(Number(value));

const formatNumber = (value, maximumFractionDigits = 2) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : numberFormatter(maximumFractionDigits).format(Number(value));

const formatPercent = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : `${PERCENT_FORMATTER.format(Number(value) * 100)}%`;

const formatPercentPoints = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : `${PERCENT_FORMATTER.format(Number(value))}%`;

const calculation = (label, value, formula, period, source = 'sales_history', formatter = formatMoney) => ({
  label,
  value,
  formattedValue: formatter(value),
  formula,
  source,
  period
});

const extractRows = (history) => {
  if (Array.isArray(history)) return history;
  const source = asRecord(history);
  return Array.isArray(source.rows) ? source.rows : (Array.isArray(source.sales) ? source.sales : []);
};

const extractItems = (sale) => {
  const source = asRecord(sale);
  if (Array.isArray(source.items)) return source.items;
  if (Array.isArray(source.sale_items)) return source.sale_items;
  return [];
};

const normalizeItem = (item = {}) => {
  const source = asRecord(item);
  const quantity = positiveNumberOrNull(source.quantity ?? source.qty) || 0;
  const unitPrice = numberOrNull(
    source.unitPrice ?? source.unit_price ?? source.price ?? source.sale_price ?? source.selling_price
  );
  const providedTotal = numberOrNull(source.total ?? source.line_total ?? source.subtotal ?? source.net_total);
  const total = providedTotal !== null ? providedTotal : (unitPrice !== null ? unitPrice * quantity : null);
  const parsedUnitCost = numberOrNull(source.cost ?? source.unit_cost ?? source.cost_snapshot ?? source.costPrice);
  const unitCost = isMissingUnitCost(parsedUnitCost) ? null : parsedUnitCost;
  const discount = numberOrNull(source.discount ?? source.discount_amount ?? source.discountAmount);

  return {
    productId: safeText(source.productId ?? source.product_id, null, 180),
    name: safeText(source.name ?? source.product_name ?? source.productName ?? source.description, 'Producto sin nombre'),
    quantity,
    unitPrice: unitPrice !== null ? unitPrice : (quantity > 0 && total !== null ? total / quantity : null),
    total,
    unitCost,
    discount
  };
};

const productIdentityKey = (product = {}) => product.productId
  ? `id:${product.productId}`
  : `name:${product.name}`;

const normalizedSource = (sale) => {
  if (sale?.sourceModeKnown === false || sale?.source_mode_known === false) return '';
  return normalize(sale?.sourceMode ?? sale?.source_mode ?? sale?.source ?? '');
};
const normalizedStatus = (sale) => normalize(sale?.status ?? sale?.sale_status ?? 'closed');

export const isOperationalSalesSource = (source) => OPERATIONAL_SALES_SOURCES.has(normalize(source));

export const isExcludedSalesSource = (source) => {
  const normalized = normalize(source);
  if (!normalized) return false;
  return EXCLUDED_SALES_SOURCES.has(normalized)
    || normalized.startsWith('shadow_')
    || normalized.endsWith('_shadow')
    || HISTORICAL_SOURCE_TOKEN_PATTERN.test(normalized);
};

export const isExcludedSalesStatus = (status) => EXCLUDED_SALES_STATUSES.has(normalize(status));

const salesSourceCategory = (source) => {
  const normalized = normalize(source);
  if (normalized.startsWith('shadow') || normalized.endsWith('_shadow')) return 'shadow';
  if (HISTORICAL_SOURCE_TOKEN_PATTERN.test(normalized)) return 'legacy';
  if (normalized.startsWith('ecommerce_') || normalized === 'cancelled' || normalized === 'canceled' || normalized === 'rejected') {
    return 'ecommerce';
  }
  return 'other';
};

const excludedSaleReason = (sale) => {
  const status = normalizedStatus(sale);
  const source = normalizedSource(sale);
  if (sale?.cancelledAt || sale?.cancelled_at || sale?.cancellationId || sale?.cancellation_id) {
    return { reason: 'cancelled_marker', source, status };
  }
  if (isExcludedSalesStatus(status)) return { reason: 'status', source, status };
  if (isExcludedSalesSource(source)) return { reason: 'source', source, status };
  return null;
};

const ecommerceKey = (sale) => safeText(
  sale?.ecommerceOrderId
    ?? sale?.ecommerce_order_id
    ?? sale?.ecommerceOrderCode
    ?? sale?.ecommerce_order_code,
  null,
  100
);

const SALES_SOURCE_PREFERENCE = new Map([
  ['cloud_final', 4],
  ['cloud_committed', 4],
  ['pos_converted', 4],
  ['ecommerce_pos_converted', 4],
  ['pos_sale', 3],
  ['pos', 3],
  ['local_committed', 3],
  ['ecommerce_converted', 2],
  ['local', 1]
]);

const salesSourcePreference = (sale) => SALES_SOURCE_PREFERENCE.get(normalizedSource(sale)) || 0;

export const normalizeValidSales = (history) => {
  const rows = extractRows(history);
  const excluded = [];
  const candidates = [];
  const sourcePolicy = {
    excludedSources: 0,
    excludedStatuses: 0,
    cancelledMarkers: 0,
    legacySources: 0,
    shadowSources: 0,
    ecommerceSources: 0,
    unknownSources: 0
  };

  rows.forEach((row) => {
    if (!asRecord(row)) {
      excluded.push(row);
      sourcePolicy.excludedSources += 1;
      return;
    }

    const exclusion = excludedSaleReason(row);
    if (exclusion) {
      excluded.push(row);
      if (exclusion.reason === 'status') sourcePolicy.excludedStatuses += 1;
      if (exclusion.reason === 'cancelled_marker') sourcePolicy.cancelledMarkers += 1;
      if (exclusion.reason === 'source') {
        sourcePolicy.excludedSources += 1;
        const category = salesSourceCategory(exclusion.source);
        if (category === 'legacy') sourcePolicy.legacySources += 1;
        if (category === 'shadow') sourcePolicy.shadowSources += 1;
        if (category === 'ecommerce') sourcePolicy.ecommerceSources += 1;
      }
      return;
    }

    const source = normalizedSource(row);
    if (!source || !isOperationalSalesSource(source)) sourcePolicy.unknownSources += 1;
    candidates.push(row);
  });

  const deduped = [];
  const ecommerceIndexes = new Map();
  let ecommerceDuplicates = 0;

  candidates.forEach((row) => {
    const key = ecommerceKey(row);
    if (!key) {
      deduped.push(row);
      return;
    }

    const existingIndex = ecommerceIndexes.get(key);
    if (existingIndex === undefined) {
      ecommerceIndexes.set(key, deduped.length);
      deduped.push(row);
      return;
    }

    ecommerceDuplicates += 1;
    if (salesSourcePreference(row) > salesSourcePreference(deduped[existingIndex])) {
      deduped[existingIndex] = row;
    }
  });

  return {
    rows: deduped,
    excludedCount: excluded.length,
    ecommerceDuplicates,
    rawCount: rows.length,
    sourcePolicy
  };
};

const normalizeSale = (sale = {}) => {
  const source = asRecord(sale);
  const items = extractItems(source).map(normalizeItem).filter((item) => item.quantity > 0);
  const total = numberOrNull(source.total ?? source.net_total ?? source.net_sales_total)
    ?? items.reduce((sum, item) => sum + (item.total || 0), 0);
  const discount = numberOrNull(source.discount ?? source.discount_amount ?? source.total_discount ?? source.discounts);
  const channel = safeText(source.salesChannel ?? source.sales_channel ?? source.channel ?? source.canal, 'Físico', 40);
  const id = safeText(source.id ?? source.cloudSaleId ?? source.cloud_sale_id ?? source.folio, null, 120);

  return {
    id,
    total: total !== null && total >= 0 ? total : 0,
    discount,
    channel,
    items,
    source: normalizedSource(source),
    timestamp: source.soldAt ?? source.sold_at ?? source.timestamp ?? source.created_at ?? null
  };
};

const emptyAggregate = (period) => ({
  period,
  salesCount: 0,
  units: 0,
  netSales: 0,
  discounts: 0,
  discountsKnown: true,
  costOfSale: 0,
  costComplete: true,
  knownSales: 0,
  missingCostLines: 0,
  missingCostProducts: [],
  products: [],
  channels: [],
  tickets: []
});

const aggregateSales = (history, period) => {
  const normalized = normalizeValidSales(history);
  const aggregate = emptyAggregate(period);
  const productMap = new Map();
  const channelMap = new Map();

  normalized.rows.map(normalizeSale).forEach((sale) => {
    aggregate.salesCount += 1;
    aggregate.netSales += sale.total;
    aggregate.tickets.push(sale.total);

    if (sale.discount === null) aggregate.discountsKnown = false;
    else aggregate.discounts += sale.discount;

    const channel = channelMap.get(sale.channel) || { channel: sale.channel, netSales: 0, orders: 0, units: 0 };
    channel.netSales += sale.total;
    channel.orders += 1;

    sale.items.forEach((item) => {
      aggregate.units += item.quantity;
      channel.units += item.quantity;
      const identityKey = productIdentityKey(item);
      const product = productMap.get(identityKey) || {
        identityKey,
        productId: item.productId,
        name: item.name,
        quantity: 0,
        netSales: 0,
        knownCostSales: 0,
        cost: 0,
        missingCostLines: 0,
        averagePriceWeighted: 0,
        discount: 0,
        discountKnown: true
      };
      const lineTotal = item.total !== null ? item.total : 0;
      product.quantity += item.quantity;
      product.netSales += lineTotal;
      product.averagePriceWeighted += (item.unitPrice || 0) * item.quantity;
      if (item.discount === null) product.discountKnown = false;
      else product.discount += item.discount;

      if (item.unitCost === null) {
        aggregate.costComplete = false;
        aggregate.missingCostLines += 1;
        product.missingCostLines += 1;
      } else {
        const lineCost = item.unitCost * item.quantity;
        aggregate.costOfSale += lineCost;
        aggregate.knownSales += lineTotal;
        product.cost += lineCost;
        product.knownCostSales += lineTotal;
      }
      productMap.set(identityKey, product);
    });

    channelMap.set(sale.channel, channel);
  });

  aggregate.missingCostProducts = Array.from(productMap.values())
    .filter((product) => product.missingCostLines > 0)
    .map((product) => product.name);
  aggregate.products = Array.from(productMap.values())
    .map((product) => {
      const costKnown = product.missingCostLines === 0;
      const averagePrice = product.quantity > 0 ? product.averagePriceWeighted / product.quantity : null;
      const profit = costKnown ? product.netSales - product.cost : null;
      return {
        identityKey: product.identityKey,
        productId: product.productId,
        name: product.name,
        quantity: product.quantity,
        netSales: product.netSales,
        salesShare: aggregate.netSales > 0 ? product.netSales / aggregate.netSales : null,
        cost: costKnown ? product.cost : null,
        unitCost: costKnown && product.quantity > 0 ? product.cost / product.quantity : null,
        profit,
        margin: costKnown && product.netSales > 0 ? profit / product.netSales : null,
        averagePrice,
        costKnown,
        missingCostLines: product.missingCostLines,
        discounts: product.discountKnown ? product.discount : null
      };
    })
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name, 'es')
      || String(a.identityKey).localeCompare(String(b.identityKey)));
  aggregate.channels = Array.from(channelMap.values())
    .map((channel) => ({
      ...channel,
      averageTicket: channel.orders > 0 ? channel.netSales / channel.orders : null,
      share: aggregate.netSales > 0 ? channel.netSales / aggregate.netSales : null
    }))
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, MAX_CHANNELS);
  aggregate.averageTicket = aggregate.salesCount > 0 ? aggregate.netSales / aggregate.salesCount : null;
  aggregate.unitsPerTicket = aggregate.salesCount > 0 ? aggregate.units / aggregate.salesCount : null;
  aggregate.profit = aggregate.costComplete ? aggregate.netSales - aggregate.costOfSale : null;
  aggregate.margin = aggregate.costComplete && aggregate.netSales > 0 ? aggregate.profit / aggregate.netSales : null;
  aggregate.costCoverage = aggregate.netSales > 0 ? aggregate.knownSales / aggregate.netSales : DEFAULT_COST_COVERAGE;
  aggregate.lowMarginSalesShare = aggregate.products.length > 0
    ? aggregate.products.filter((product) => product.margin !== null && product.margin < LOW_MARGIN_THRESHOLD)
      .reduce((sum, product) => sum + product.netSales, 0) / Math.max(aggregate.knownSales, 1)
    : null;
  aggregate.meta = normalized;
  return aggregate;
};

const delta = (current, previous) => (
  current === null || previous === null || current === undefined || previous === undefined
    ? null
    : current - previous
);

const buildComparison = (current, previous) => {
  if (!previous) return null;
  const currentByIdentity = new Map(current.products.map((product) => [productIdentityKey(product), product]));
  const previousByIdentity = new Map(previous.products.map((product) => [productIdentityKey(product), product]));
  const identities = new Set([...currentByIdentity.keys(), ...previousByIdentity.keys()]);
  const shareOf = (sales, total) => total > 0 ? sales / total : null;
  const percentChange = (now, before) => before > 0 && now !== null && now !== undefined
    ? (now - before) / before
    : null;
  const productChanges = Array.from(identities).map((identityKey) => {
    const now = currentByIdentity.get(identityKey) || null;
    const before = previousByIdentity.get(identityKey) || null;
    const name = now?.name || before?.name || 'Producto sin nombre';
    const currentSales = now?.netSales ?? 0;
    const previousSales = before?.netSales ?? 0;
    const currentUnits = now?.quantity ?? 0;
    const previousUnits = before?.quantity ?? 0;
    const salesDelta = currentSales - previousSales;
    const unitsDelta = currentUnits - previousUnits;
    const currentShare = shareOf(currentSales, current.netSales);
    const previousShare = shareOf(previousSales, previous.netSales);
    const salesShareDelta = currentShare !== null && previousShare !== null
      ? currentShare - previousShare
      : null;
    const direction = !before
      ? 'new_in_period'
      : !now
        ? 'not_sold_current'
        : salesDelta > 0.005
          ? 'growing'
          : salesDelta < -0.005
            ? 'declining'
            : 'stable';
    const signals = [direction];
    if (currentShare !== null && currentShare >= 0.1) signals.push('high_sales_share');
    if (now?.costKnown === true && now.margin !== null && now.margin >= LOW_MARGIN_THRESHOLD) {
      signals.push('healthy_margin');
    }
    if (now && now.costKnown !== true) signals.push('cost_unknown');
    if (now?.costKnown === true && now.margin !== null && now.margin < LOW_MARGIN_THRESHOLD) {
      signals.push('low_margin');
    }
    return {
      identityKey,
      productId: now?.productId || before?.productId || null,
      name,
      currentSales,
      previousSales,
      salesDelta,
      salesDeltaPercent: percentChange(currentSales, previousSales),
      currentUnits,
      previousUnits,
      unitsDelta,
      unitsDeltaPercent: percentChange(currentUnits, previousUnits),
      currentShare,
      previousShare,
      salesShareDelta,
      currentMargin: now?.margin ?? null,
      previousMargin: before?.margin ?? null,
      currentProfit: now?.profit ?? null,
      previousProfit: before?.profit ?? null,
      costKnown: now?.costKnown === true,
      costStatus: now?.costKnown === true ? 'known' : (now ? 'missing' : 'not_sold_current'),
      direction,
      signals
    };
  }).sort((a, b) => Math.abs(b.salesDelta) - Math.abs(a.salesDelta) || b.currentSales - a.currentSales
    || a.name.localeCompare(b.name, 'es') || String(a.identityKey).localeCompare(String(b.identityKey)));

  const currentMix = new Map(current.products.map((product) => [productIdentityKey(product), shareOf(product.netSales, current.netSales)]));
  const previousMix = new Map(previous.products.map((product) => [productIdentityKey(product), shareOf(product.netSales, previous.netSales)]));
  const productMixChanges = Array.from(identities).map((identityKey) => {
    const now = currentByIdentity.get(identityKey);
    const before = previousByIdentity.get(identityKey);
    const name = now?.name || before?.name || 'Producto sin nombre';
    const currentShare = currentMix.has(identityKey) ? currentMix.get(identityKey) : (current.netSales > 0 ? 0 : null);
    const previousShare = previousMix.has(identityKey) ? previousMix.get(identityKey) : (previous.netSales > 0 ? 0 : null);
    return {
      identityKey,
      productId: now?.productId || before?.productId || null,
      name,
      currentShare,
      previousShare,
      deltaShare: currentShare !== null && previousShare !== null ? currentShare - previousShare : null
    };
  }).sort((a, b) => Math.abs(b.deltaShare || 0) - Math.abs(a.deltaShare || 0)
    || a.name.localeCompare(b.name, 'es') || String(a.identityKey).localeCompare(String(b.identityKey))).slice(0, 8);

  const channelNames = new Set([...current.channels.map((item) => item.channel), ...previous.channels.map((item) => item.channel)]);
  const channelMixChanges = Array.from(channelNames).map((channelName) => {
    const now = current.channels.find((item) => item.channel === channelName);
    const before = previous.channels.find((item) => item.channel === channelName);
    const currentShare = now?.share ?? (current.netSales > 0 ? 0 : null);
    const previousShare = before?.share ?? (previous.netSales > 0 ? 0 : null);
    return {
      channel: channelName,
      currentShare,
      previousShare,
      deltaShare: currentShare !== null && previousShare !== null ? currentShare - previousShare : null,
      currentSales: now?.netSales ?? 0,
      previousSales: before?.netSales ?? 0,
      salesDelta: (now?.netSales ?? 0) - (before?.netSales ?? 0)
    };
  }).sort((a, b) => Math.abs(b.deltaShare || 0) - Math.abs(a.deltaShare || 0)).slice(0, 6);

  return {
    currentSalesCount: current.salesCount,
    previousSalesCount: previous.salesCount,
    deltaSalesCount: current.salesCount - previous.salesCount,
    previousNetSales: previous.netSales,
    previousUnits: previous.units,
    previousTicket: previous.averageTicket,
    previousUnitsPerTicket: previous.unitsPerTicket,
    previousCost: previous.costComplete ? previous.costOfSale : null,
    previousProfit: previous.profit,
    previousMargin: previous.margin,
    previousDiscounts: previous.discountsKnown ? previous.discounts : null,
    deltaNetSales: delta(current.netSales, previous.netSales),
    deltaNetSalesPercent: percentChange(current.netSales, previous.netSales),
    deltaUnits: delta(current.units, previous.units),
    deltaTicket: delta(current.averageTicket, previous.averageTicket),
    deltaTicketPercent: percentChange(current.averageTicket, previous.averageTicket),
    deltaUnitsPerTicket: delta(current.unitsPerTicket, previous.unitsPerTicket),
    deltaCost: delta(current.costComplete ? current.costOfSale : null, previous.costComplete ? previous.costOfSale : null),
    deltaProfit: delta(current.profit, previous.profit),
    deltaMargin: delta(current.margin, previous.margin),
    deltaMarginRelative: current.margin !== null && previous.margin !== null && previous.margin !== 0
      ? (current.margin - previous.margin) / Math.abs(previous.margin)
      : null,
    deltaDiscounts: delta(current.discountsKnown ? current.discounts : null, previous.discountsKnown ? previous.discounts : null),
    productMixChanges,
    channelMixChanges,
    productChanges
  };
};

const buildContributors = (current, previous, comparison) => {
  if (!comparison) return [];
  const contributors = [];
  const push = (key, title, contribution, direction, explanation, evidenceKeys) => {
    if (contribution === null || contribution === undefined || !Number.isFinite(Number(contribution))) return;
    contributors.push({
      key,
      title,
      contribution,
      value: contribution,
      direction,
      explanation,
      evidenceKeys
    });
  };

  const currentCostRate = current.costComplete && current.netSales > 0 ? current.costOfSale / current.netSales : null;
  const previousCostRate = previous.costComplete && previous.netSales > 0 ? previous.costOfSale / previous.netSales : null;
  const costRateDelta = delta(currentCostRate, previousCostRate);
  if (costRateDelta !== null && Math.abs(costRateDelta) > 0.0001) {
    push(
      'cost_rate',
      'Cambio en costo de venta',
      costRateDelta,
      costRateDelta > 0 ? 'negative' : 'positive',
      `El historial muestra que la proporción del costo de venta cambió ${formatPercent(costRateDelta)}.`,
      ['comparison.deltaCost', 'comparison.costRate']
    );
  }

  const mixDelta = delta(current.lowMarginSalesShare, previous.lowMarginSalesShare);
  if (mixDelta !== null && Math.abs(mixDelta) > 0.0001) {
    push(
      'low_margin_mix',
      'Mezcla de productos',
      mixDelta,
      mixDelta > 0 ? 'negative' : 'positive',
      `La participación de productos de bajo margen cambió ${formatPercent(mixDelta)}.`,
      ['comparison.productMixChanges', 'current.lowMarginSalesShare']
    );
  }

  const currentDiscountRate = current.netSales > 0 && current.discountsKnown ? current.discounts / current.netSales : null;
  const previousDiscountRate = previous.netSales > 0 && previous.discountsKnown ? previous.discounts / previous.netSales : null;
  const discountDelta = delta(currentDiscountRate, previousDiscountRate);
  if (discountDelta !== null && Math.abs(discountDelta) > 0.0001) {
    push(
      'discount_rate',
      'Descuentos',
      discountDelta,
      discountDelta > 0 ? 'negative' : 'positive',
      `La proporción de descuentos cambió ${formatPercent(discountDelta)}.`,
      ['comparison.deltaDiscounts']
    );
  }

  const volumeDelta = previous.units > 0 ? (current.units - previous.units) / previous.units : null;
  if (volumeDelta !== null && Math.abs(volumeDelta) >= 0.05) {
    push(
      'sales_volume',
      'Volumen vendido',
      volumeDelta,
      'context',
      `El volumen vendido cambió ${formatPercent(volumeDelta)} frente al periodo anterior.`,
      ['comparison.deltaUnits']
    );
  }

  const ticketDelta = previous.averageTicket > 0 && current.averageTicket !== null
    ? (current.averageTicket - previous.averageTicket) / previous.averageTicket
    : null;
  if (ticketDelta !== null && Math.abs(ticketDelta) >= 0.05) {
    push(
      'average_ticket',
      'Ticket promedio',
      ticketDelta,
      'context',
      `El ticket promedio cambió ${formatPercent(ticketDelta)}.`,
      ['comparison.deltaTicket']
    );
  }

  comparison.channelMixChanges.slice(0, 2).forEach((channel) => {
    if (Math.abs(channel.deltaShare || 0) > 0.05) {
      push(
        `channel_${normalize(channel.channel).replace(/[^a-z0-9]+/g, '_')}`,
        `Canal ${channel.channel}`,
        channel.deltaShare,
        'context',
        `La participación del canal cambió ${formatPercent(channel.deltaShare)}.`,
        ['comparison.channelMixChanges']
      );
    }
  });

  return contributors
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);
};

const sourceModeToContractSource = (mode) => {
  if (mode === 'cloud' || mode === 'cloud_final') return 'cloud';
  if (mode === 'local') return 'local';
  return 'mixed';
};

const chooseProduct = (aggregate, scenario = {}) => {
  const requested = normalize(scenario.productName ?? scenario.product ?? '');
  if (!requested) return null;
  return aggregate.products.find((product) => normalize(product.name) === requested)
    || aggregate.products.find((product) => normalize(product.name).includes(requested))
    || null;
};

const buildVolumeScenarios = ({ currentPrice, newPrice, unitCost, volume, baselineProfit }) => {
  const prices = { currentPrice, newPrice };
  return [-0.1, 0, 0.1].map((change) => {
    const scenarioVolume = Math.max(volume * (1 + change), 0);
    const profit = (newPrice - unitCost) * scenarioVolume;
    return {
      label: change === 0 ? 'Volumen sin cambio' : `Volumen ${change > 0 ? '+' : ''}${change * 100}%`,
      volume: scenarioVolume,
      utility: profit,
      margin: newPrice > 0 ? (newPrice - unitCost) / newPrice : null,
      impactVsCurrent: profit - baselineProfit,
      isPrediction: false,
      ...prices,
      note: 'Escenario ilustrativo; no es una predicción de demanda.'
    };
  });
};

const simulatePrice = (aggregate, scenario, period) => {
  const product = chooseProduct(aggregate, scenario);
  if (!product) {
    return {
      product: null,
      priceSimulation: null,
      scenarios: [],
      calculations: [],
      assumptions: [],
      limitations: ['No hay productos vendidos en el periodo para simular un precio.']
    };
  }
  const currentPrice = positiveNumberOrNull(scenario.currentPrice) || positiveNumberOrNull(product.averagePrice);
  const newPrice = positiveNumberOrNull(scenario.newPrice);
  const unitCost = numberOrNull(scenario.unitCost) ?? product.unitCost;
  const requestedVolume = numberOrNull(scenario.historicalVolume);
  const volume = requestedVolume !== null ? requestedVolume : product.quantity;
  if (currentPrice === null || newPrice === null || unitCost === null || volume === null) {
    return {
      product: product.name,
      priceSimulation: null,
      scenarios: [],
      calculations: [],
      assumptions: ['El volumen histórico sólo se usa como supuesto del escenario.'],
      limitations: ['Se requiere precio actual, nuevo precio, costo unitario y volumen histórico con datos confiables.']
    };
  }
  const currentProfit = (currentPrice - unitCost) * volume;
  const currentMargin = currentPrice > 0 ? (currentPrice - unitCost) / currentPrice : null;
  const simulatedProfit = (newPrice - unitCost) * volume;
  const simulatedMargin = newPrice > 0 ? (newPrice - unitCost) / newPrice : null;
  const profitDelta = simulatedProfit - currentProfit;
  const breakEvenVolume = newPrice > unitCost && currentProfit > 0 ? currentProfit / (newPrice - unitCost) : null;
  const scenarios = buildVolumeScenarios({ currentPrice, newPrice, unitCost, volume, baselineProfit: currentProfit });
  const priceSimulation = {
    product: product.name,
    currentPrice,
    newPrice,
    unitCost,
    historicalVolume: volume,
    currentProfit,
    currentMargin,
    simulatedProfit,
    simulatedMargin,
    profitDelta,
    breakEvenVolume,
    isDemandPrediction: false
  };
  return {
    product: product.name,
    priceSimulation,
    scenarios,
    calculations: [
      calculation('Precio actual', currentPrice, 'precio promedio histórico del producto', period),
      calculation('Precio nuevo', newPrice, 'precio indicado para la simulación', period, 'simulation'),
      calculation('Costo unitario', unitCost, 'costo unitario registrado', period),
      calculation('Volumen histórico', volume, 'unidades vendidas del producto en el periodo', period, 'sales_history', formatNumber),
      calculation('Utilidad actual', currentProfit, '(precio actual - costo unitario) × volumen histórico', period),
      calculation('Margen actual', currentMargin, '(precio actual - costo unitario) / precio actual', period, 'sales_history', formatPercent),
      calculation('Utilidad simulada con el mismo volumen', simulatedProfit, '(precio nuevo - costo unitario) × volumen histórico', period, 'simulation'),
      calculation('Margen simulado', simulatedMargin, '(precio nuevo - costo unitario) / precio nuevo', period, 'simulation', formatPercent),
      calculation('Diferencia de utilidad', profitDelta, 'utilidad simulada - utilidad actual', period, 'simulation'),
      calculation('Volumen mínimo para conservar la utilidad actual', breakEvenVolume, 'utilidad actual / (precio nuevo - costo unitario)', period, 'simulation', formatNumber)
    ],
    assumptions: ['La simulación conserva como referencia el volumen histórico observado.'],
    limitations: newPrice <= unitCost
      ? ['El nuevo precio no deja utilidad unitaria positiva; no existe un volumen finito que conserve la utilidad actual.']
      : ['La simulación no predice cómo cambiará la demanda al modificar el precio.']
  };
};
const simulatePromotion = (aggregate, scenario, period) => {
  const product = chooseProduct(aggregate, scenario);
  if (!product) {
    return {
      product: null,
      promotionSimulation: null,
      scenarios: [],
      calculations: [],
      assumptions: [],
      limitations: ['No hay productos vendidos en el periodo para simular una promoción.']
    };
  }
  const currentPrice = positiveNumberOrNull(scenario.currentPrice) || positiveNumberOrNull(product.averagePrice);
  const discountPercent = numberOrNull(scenario.discountPercent);
  const promotionalPrice = positiveNumberOrNull(scenario.promotionalPrice)
    || (currentPrice !== null && discountPercent !== null ? currentPrice * (1 - discountPercent / 100) : null);
  const unitCost = numberOrNull(scenario.unitCost) ?? product.unitCost;
  const requestedVolume = numberOrNull(scenario.historicalVolume);
  const volume = requestedVolume !== null ? requestedVolume : product.quantity;
  if (currentPrice === null || promotionalPrice === null || unitCost === null || volume === null) {
    return {
      product: product.name,
      promotionSimulation: null,
      scenarios: [],
      calculations: [],
      assumptions: ['El volumen histórico sólo se usa como supuesto del escenario.'],
      limitations: ['Se requiere precio actual, descuento o precio promocional, costo unitario y volumen histórico.']
    };
  }
  const currentUnitProfit = currentPrice - unitCost;
  const promotionalUnitProfit = promotionalPrice - unitCost;
  const currentProfit = currentUnitProfit * volume;
  const promotionalProfit = promotionalUnitProfit * volume;
  const currentMargin = currentPrice > 0 ? currentUnitProfit / currentPrice : null;
  const promotionalMargin = promotionalPrice > 0 ? promotionalUnitProfit / promotionalPrice : null;
  const discount = currentPrice > 0 ? (currentPrice - promotionalPrice) / currentPrice : null;
  const breakEvenVolume = promotionalUnitProfit > 0 ? currentProfit / promotionalUnitProfit : null;
  const scenarios = buildVolumeScenarios({
    currentPrice,
    newPrice: promotionalPrice,
    unitCost,
    volume,
    baselineProfit: currentProfit
  });
  const promotionSimulation = {
    product: product.name,
    currentPrice,
    discount,
    promotionalPrice,
    unitCost,
    historicalVolume: volume,
    currentMargin,
    promotionalMargin,
    currentProfit,
    promotionalProfit,
    profitDelta: promotionalProfit - currentProfit,
    breakEvenVolume,
    isDemandPrediction: false
  };
  return {
    product: product.name,
    promotionSimulation,
    scenarios,
    calculations: [
      calculation('Precio actual', currentPrice, 'precio promedio histórico del producto', period),
      calculation('Descuento', discount, '(precio actual - precio promocional) / precio actual', period, 'simulation', formatPercent),
      calculation('Precio promocional', promotionalPrice, 'precio actual después del descuento simulado', period, 'simulation'),
      calculation('Costo unitario', unitCost, 'costo unitario registrado', period),
      calculation('Margen actual', currentMargin, '(precio actual - costo unitario) / precio actual', period, 'sales_history', formatPercent),
      calculation('Margen promocional', promotionalMargin, '(precio promocional - costo unitario) / precio promocional', period, 'simulation', formatPercent),
      calculation('Utilidad actual', currentProfit, '(precio actual - costo unitario) × volumen histórico', period),
      calculation('Utilidad con promoción', promotionalProfit, '(precio promocional - costo unitario) × volumen histórico', period, 'simulation'),
      calculation('Volumen mínimo para conservar la utilidad actual', breakEvenVolume, 'utilidad actual / utilidad unitaria promocional', period, 'simulation', formatNumber)
    ],
    assumptions: ['La simulación conserva como referencia el volumen histórico observado.'],
    limitations: promotionalUnitProfit <= 0
      ? ['El precio promocional no deja utilidad unitaria positiva.']
      : ['La simulación no predice el aumento de demanda que podría generar la promoción.']
  };
};
const buildComboSimulation = (validRows, period) => {
  const pairMap = new Map();
  const ticketCount = validRows.length;
  validRows.map(normalizeSale).forEach((sale) => {
    const byName = new Map();
    sale.items.forEach((item) => {
      const current = byName.get(item.name) || {
        name: item.name,
        total: 0,
        cost: 0,
        costKnown: true
      };
      current.total += item.total || 0;
      if (item.unitCost === null) {
        current.costKnown = false;
      } else {
        current.cost += item.unitCost * item.quantity;
      }
      byName.set(item.name, current);
    });

    const uniqueItems = Array.from(byName.keys()).sort();
    for (let i = 0; i < uniqueItems.length; i += 1) {
      for (let j = i + 1; j < uniqueItems.length; j += 1) {
        const first = uniqueItems[i];
        const second = uniqueItems[j];
        const firstEntry = byName.get(first);
        const secondEntry = byName.get(second);
        const key = `${first}\u0000${second}`;
        const previous = pairMap.get(key) || {
          tickets: 0,
          jointSales: 0,
          jointCost: 0,
          completeCostTickets: 0
        };
        const costKnown = firstEntry?.costKnown === true && secondEntry?.costKnown === true;
        pairMap.set(key, {
          tickets: previous.tickets + 1,
          jointSales: previous.jointSales + (firstEntry?.total || 0) + (secondEntry?.total || 0),
          jointCost: previous.jointCost + (costKnown ? (firstEntry?.cost || 0) + (secondEntry?.cost || 0) : 0),
          completeCostTickets: previous.completeCostTickets + (costKnown ? 1 : 0)
        });
      }
    }
  });

  const candidates = Array.from(pairMap.entries())
    .map(([key, pair]) => {
      const [first, second] = key.split('\u0000');
      const averageJointSale = pair.tickets > 0 ? pair.jointSales / pair.tickets : null;
      const costComplete = pair.completeCostTickets === pair.tickets;
      const averageJointCost = costComplete && pair.tickets > 0 ? pair.jointCost / pair.tickets : null;
      const profit = averageJointSale !== null && averageJointCost !== null
        ? averageJointSale - averageJointCost
        : null;
      const frequency = ticketCount > 0 ? pair.tickets / ticketCount : 0;
      const evidenceLevel = pair.tickets >= 8 && frequency >= 0.1
        ? 'high'
        : (pair.tickets >= MIN_COMBO_TICKETS ? 'medium' : 'low');
      return {
        products: [first, second],
        tickets: pair.tickets,
        frequency,
        ticketPercentage: frequency,
        historicalJointSales: pair.jointSales,
        averageJointSale,
        cost: averageJointCost,
        costCoverage: pair.tickets > 0 ? pair.completeCostTickets / pair.tickets : 0,
        costStatus: costComplete ? 'complete' : 'incomplete',
        comboPrice: averageJointSale,
        discount: null,
        profit,
        margin: averageJointSale > 0 && profit !== null ? profit / averageJointSale : null,
        evidenceLevel,
        confidence: evidenceLevel,
        opportunity: `Evaluar presentar ${first} y ${second} juntos; aparecen en ${pair.tickets} tickets compartidos.`,
        isPrediction: false,
        note: 'La relación proviene de tickets históricos compartidos; no implica que un producto cause la compra del otro.'
      };
    })
    .filter((candidate) => candidate.tickets >= MIN_COMBO_TICKETS)
    .sort((a, b) => b.tickets - a.tickets || b.frequency - a.frequency)
    .slice(0, 5);

  if (!candidates.length) {
    return {
      comboOpportunities: [],
      scenarios: [],
      calculations: [],
      assumptions: ['Se requieren al menos tres tickets con la misma combinación para mostrar una oportunidad.'],
      limitations: ['No hay suficientes tickets con productos compartidos para recomendar un combo confiable.']
    };
  }

  return {
    comboOpportunities: candidates,
    scenarios: candidates,
    calculations: candidates.slice(0, 3).flatMap((candidate) => [
      calculation(`Tickets compartidos: ${candidate.products.join(' + ')}`, candidate.tickets, 'conteo de tickets válidos con ambos productos', period, 'sales_history', formatNumber),
      calculation(`Venta conjunta histórica promedio: ${candidate.products.join(' + ')}`, candidate.averageJointSale, 'venta conjunta histórica / tickets compartidos', period),
      calculation(`Costo conjunto histórico promedio: ${candidate.products.join(' + ')}`, candidate.cost, 'costo conocido de los artículos compartidos / tickets compartidos', period),
      calculation(`Margen observado de referencia: ${candidate.products.join(' + ')}`, candidate.margin, '(venta conjunta promedio - costo conjunto promedio) / venta conjunta promedio', period, 'sales_history', formatPercent)
    ]),
    assumptions: ['La coocurrencia describe asociación histórica y no demuestra causalidad.'],
    limitations: [
      ...(candidates.some((candidate) => candidate.margin === null)
        ? ['Algunos tickets compartidos no tienen costo completo; el margen de esas oportunidades no puede confirmarse.']
        : []),
      'La asociación es una correlación histórica de tickets; no garantiza demanda futura.'
    ]
  };
};
const normalizeSimulationResult = (simulation = {}) => ({
  product: simulation.product || null,
  priceSimulation: simulation.priceSimulation || null,
  promotionSimulation: simulation.promotionSimulation || null,
  comboOpportunities: Array.isArray(simulation.comboOpportunities) ? simulation.comboOpportunities : [],
  scenarios: Array.isArray(simulation.scenarios) ? simulation.scenarios : [],
  calculations: Array.isArray(simulation.calculations) ? simulation.calculations : [],
  assumptions: Array.isArray(simulation.assumptions) ? simulation.assumptions : [],
  limitations: Array.isArray(simulation.limitations) ? simulation.limitations : []
});

const buildProfitabilitySummary = (current) => {
  let status = 'undetermined';
  if (current.salesCount === 0) status = 'insufficient_data';
  else if (!current.costComplete) status = 'undetermined';
  else if ((current.profit ?? 0) > 0 && (current.margin ?? 0) > 0) status = 'profitable';
  else status = 'not_profitable';

  const explanation = status === 'insufficient_data'
    ? 'No hay ventas válidas suficientes en el periodo para evaluar la rentabilidad.'
    : status === 'undetermined'
      ? `No puedo determinar la rentabilidad bruta completa de este periodo porque la cobertura de costos o ventas está incompleta.${current.missingCostProducts.length > 0 ? ` Faltan costos de ${current.missingCostProducts.length} producto(s) vendido(s).` : ''} La cobertura de costos registrada es ${formatPercent(current.costCoverage)}.`
      : status === 'profitable'
        ? `Sí. Tus ventas generaron utilidad bruta positiva de ${formatMoney(current.profit)} y un margen bruto de ${formatPercent(current.margin)}. Este cálculo usa los costos de producto registrados y no necesariamente incluye todos los gastos operativos; no determina la rentabilidad neta del negocio.`
        : `No se registró utilidad bruta positiva durante este periodo. El resultado fue ${formatMoney(current.profit)} y el margen bruto ${formatPercent(current.margin)}, con los costos de producto registrados. El cálculo no necesariamente incluye todos los gastos operativos.`;

  return {
    status,
    netSales: current.netSales,
    costOfSale: current.costComplete ? current.costOfSale : null,
    profit: current.profit,
    margin: current.margin,
    costCoverage: current.costCoverage,
    validSales: current.salesCount,
    missingCostProducts: current.missingCostProducts.length,
    explanation
  };
};

const buildProductRisks = (current) => {
  const averageUnits = current.products.length
    ? current.products.reduce((sum, product) => sum + product.quantity, 0) / current.products.length
    : 0;
  return current.products.map((product) => {
    const salesShare = current.netSales > 0 ? product.netSales / current.netSales : 0;
    const profitShare = current.profit && current.profit > 0 && product.profit !== null
      ? product.profit / current.profit
      : null;
    let riskType = null;
    let riskLabel = null;
    let reason = null;
    let severity = 0;

    if (!product.costKnown) {
      riskType = 'missing_cost';
      riskLabel = 'Costos faltantes';
      reason = 'No se puede confirmar su utilidad ni margen porque faltan costos unitarios.';
      severity = 5;
    } else if (product.margin < 0) {
      riskType = 'negative_margin';
      riskLabel = 'Margen negativo';
      reason = 'El costo registrado supera la venta neta del producto en el periodo.';
      severity = 5;
    } else if (product.margin < LOW_MARGIN_THRESHOLD) {
      riskType = 'low_margin';
      riskLabel = 'Margen bajo';
      reason = `Su margen está por debajo del umbral documentado de ${formatPercent(LOW_MARGIN_THRESHOLD)}.`;
      severity = 4;
    } else if (product.quantity >= Math.max(averageUnits, 3) && product.margin < LOW_MARGIN_THRESHOLD * 1.5) {
      riskType = 'many_sales_low_profit';
      riskLabel = 'Muchas ventas con poca utilidad';
      reason = 'Tiene un volumen relevante, pero su margen aporta poco por unidad vendida.';
      severity = 3;
    } else if (salesShare >= 0.2 && profitShare !== null && profitShare < salesShare * 0.5) {
      riskType = 'high_sales_low_contribution';
      riskLabel = 'Alta venta con baja contribución';
      reason = 'Representa una parte importante de las ventas, pero una proporción mucho menor de la utilidad.';
      severity = 2;
    }

    if (!riskType) return null;
    return {
      identityKey: productIdentityKey(product),
      productId: product.productId,
      product: product.name,
      units: product.quantity,
      netSales: product.netSales,
      cost: product.cost,
      profit: product.profit,
      margin: product.margin,
      salesShare,
      riskType,
      riskLabel,
      reason,
      evidenceKeys: [`product:${product.name}`, 'current.products'],
      severity
    };
  }).filter(Boolean).sort((a, b) => b.severity - a.severity || b.netSales - a.netSales);
};

const buildGrowthSignals = (current, comparison) => {
  const productChanges = Array.isArray(comparison?.productChanges) ? comparison.productChanges : [];
  const productsGrowing = productChanges.filter((product) => product.direction === 'growing').slice(0, 5);
  const productsDeclining = productChanges.filter((product) => product.direction === 'declining' || product.direction === 'not_sold_current').slice(0, 5);
  const opportunityRows = productChanges
    .filter((product) => product.direction === 'growing' || product.signals.includes('high_sales_share'))
    .sort((a, b) => {
      const priority = (product) => Number(product.direction === 'growing')
        + Number(product.signals.includes('high_sales_share'))
        + Number(product.signals.includes('healthy_margin'));
      return priority(b) - priority(a)
        || (b.currentShare ?? 0) - (a.currentShare ?? 0)
        || Math.abs(b.salesDelta) - Math.abs(a.salesDelta)
        || b.currentSales - a.currentSales
        || a.name.localeCompare(b.name, 'es')
        || String(a.identityKey).localeCompare(String(b.identityKey));
    });
  const opportunityByDisplayName = new Map();
  opportunityRows.forEach((product) => {
    // Equal labels remain separate in sales and comparisons. For the narrative, keep
    // the strongest individual row so the provider cannot confuse two same-named items.
    if (!opportunityByDisplayName.has(product.name)) opportunityByDisplayName.set(product.name, product);
  });
  const productOpportunities = Array.from(opportunityByDisplayName.values())
    .slice(0, MAX_PRODUCT_OPPORTUNITIES)
    .map((product) => {
      const reasons = [];
      if (product.direction === 'growing') {
        const percent = product.salesDeltaPercent === null ? '' : ` (${formatPercent(product.salesDeltaPercent)})`;
        reasons.push(`sus ventas aumentaron ${formatMoney(product.salesDelta)} frente al periodo anterior${percent}`);
      }
      if (product.signals.includes('high_sales_share')) {
        reasons.push(`representa ${formatPercent(product.currentShare)} de las ventas actuales`);
      }
      if (product.signals.includes('healthy_margin') && product.costKnown === true) {
        reasons.push(`tiene un margen bruto conocido de ${formatPercent(product.currentMargin)}`);
      }
      return {
        ...product,
        opportunityReason: `${product.name}: ${reasons.join('; ')}.`
      };
    });

  return {
    currentNetSales: current.netSales,
    currentSalesCount: current.salesCount,
    currentUnits: current.units,
    currentAverageTicket: current.averageTicket,
    currentUnitsPerTicket: current.unitsPerTicket,
    previousNetSales: comparison?.previousNetSales ?? null,
    deltaNetSales: comparison?.deltaNetSales ?? null,
    deltaNetSalesPercent: comparison?.deltaNetSalesPercent ?? null,
    previousSalesCount: comparison?.previousSalesCount ?? null,
    deltaSalesCount: comparison?.deltaSalesCount ?? null,
    previousUnits: comparison?.previousUnits ?? null,
    deltaUnits: comparison?.deltaUnits ?? null,
    previousAverageTicket: comparison?.previousTicket ?? null,
    deltaTicket: comparison?.deltaTicket ?? null,
    deltaTicketPercent: comparison?.deltaTicketPercent ?? null,
    previousUnitsPerTicket: comparison?.previousUnitsPerTicket ?? null,
    deltaUnitsPerTicket: comparison?.deltaUnitsPerTicket ?? null,
    productsGrowing,
    productsDeclining,
    productOpportunities,
    productsGrowingCount: productChanges.filter((product) => product.direction === 'growing').length,
    productsDecliningCount: productChanges.filter((product) => product.direction === 'declining' || product.direction === 'not_sold_current').length,
    productsComparedCount: productChanges.length,
    channels: current.channels,
    channelChanges: comparison?.channelMixChanges || [],
    comparisonAvailable: Boolean(comparison)
  };
};

const fallbackRecommendation = (intent, { profitability, productRisks, contributors, simulation, growthSignals }) => {
  if (intent === 'profitability_summary') {
    if (profitability.status === 'undetermined') {
      return [{
        title: 'Completar los costos faltantes',
        explanation: 'La rentabilidad no puede confirmarse mientras existan productos vendidos sin costo unitario.',
        expectedImpact: 'Permitir una lectura confiable de utilidad y margen.',
        priority: 'high',
        evidenceKeys: ['profitability.costCoverage'],
        requiresConfirmation: true
      }];
    }
    return [{
      title: 'Revisar el margen antes de decidir cambios',
      explanation: 'Usa la utilidad y el margen del periodo como punto de partida y confirma cualquier ajuste comercial por separado.',
      expectedImpact: 'Decisiones basadas en el resultado real del periodo.',
      priority: 'medium',
      evidenceKeys: ['profitability.margin', 'profitability.profit'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'explain_change') {
    return contributors.length ? [{
      title: `Revisar primero: ${contributors[0].title}`,
      explanation: contributors[0].explanation,
      expectedImpact: 'Aclarar el movimiento principal observado antes de hacer cambios.',
      priority: 'high',
      evidenceKeys: contributors[0].evidenceKeys,
      requiresConfirmation: true
    }] : [];
  }
  if (intent === 'product_risk') {
    return productRisks.length ? [{
      title: `Revisar ${productRisks[0].product}`,
      explanation: productRisks[0].reason,
      expectedImpact: 'Identificar si el producto necesita corrección de costo, precio o estrategia comercial.',
      priority: productRisks[0].severity >= 4 ? 'high' : 'medium',
      evidenceKeys: productRisks[0].evidenceKeys,
      requiresConfirmation: true
    }] : [];
  }
  if (intent === 'price_simulation' && simulation.priceSimulation) {
    return [{
      title: 'Comparar la utilidad antes de cambiar el precio',
      explanation: 'La simulación conserva el volumen histórico y no predice la respuesta de la demanda.',
      expectedImpact: `Diferencia simulada de utilidad: ${formatMoney(simulation.priceSimulation.profitDelta)}.`,
      priority: 'medium',
      evidenceKeys: ['priceSimulation.profitDelta', 'priceSimulation.breakEvenVolume'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'promotion_opportunity' && simulation.promotionSimulation) {
    return [{
      title: 'Validar el margen promocional',
      explanation: 'Confirma que el margen promocional siga siendo aceptable y toma el volumen mínimo sólo como referencia.',
      expectedImpact: `Margen promocional simulado: ${formatPercent(simulation.promotionSimulation.promotionalMargin)}.`,
      priority: simulation.promotionSimulation.promotionalMargin <= 0 ? 'high' : 'medium',
      evidenceKeys: ['promotionSimulation.promotionalMargin', 'promotionSimulation.breakEvenVolume'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'combo_opportunity' && simulation.comboOpportunities.length) {
    return [{
      title: `Evaluar ${simulation.comboOpportunities[0].products.join(' + ')}`,
      explanation: simulation.comboOpportunities[0].opportunity,
      expectedImpact: 'Validar una presentación conjunta con base en tickets compartidos reales.',
      priority: simulation.comboOpportunities[0].evidenceLevel === 'high' ? 'high' : 'medium',
      evidenceKeys: ['comboOpportunities.0.tickets', 'comboOpportunities.0.frequency'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'sales_growth' && growthSignals?.productOpportunities?.length) {
    const product = growthSignals.productOpportunities[0];
    return [{
      title: `Revisar la señal de ${product.name}`,
      explanation: product.opportunityReason,
      expectedImpact: 'Priorizar una revisión comercial con base en el movimiento histórico observado; no garantiza crecimiento.',
      priority: product.direction === 'growing' ? 'high' : 'medium',
      evidenceKeys: ['growthSignals.productOpportunities', 'comparison.productChanges'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'product_opportunity' && growthSignals?.productOpportunities?.length) {
    const product = growthSignals.productOpportunities[0];
    return [{
      title: `Evaluar si conviene impulsar ${product.name}`,
      explanation: product.opportunityReason,
      expectedImpact: 'Usar la señal para decidir una prueba comercial y revisar su resultado después.',
      priority: product.direction === 'growing' ? 'high' : 'medium',
      evidenceKeys: ['growthSignals.productOpportunities', 'comparison.productChanges'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'ticket_growth' && simulation.comboOpportunities.length) {
    const combo = simulation.comboOpportunities[0];
    return [{
      title: `Revisar la combinación ${combo.products.join(' + ')}`,
      explanation: `Los productos aparecieron juntos en ${formatNumber(combo.tickets, 0)} tickets (${formatPercent(combo.frequency)} de los tickets del periodo). Es una asociación histórica, no evidencia de que uno cause la compra del otro.`,
      expectedImpact: 'Considerar una prueba comercial pequeña y comparar sus resultados antes de ampliarla.',
      priority: combo.evidenceLevel === 'high' ? 'high' : 'medium',
      evidenceKeys: ['comboOpportunities.0.tickets', 'comboOpportunities.0.frequency'],
      requiresConfirmation: true
    }];
  }
  if (intent === 'sales_trend' && growthSignals?.comparisonAvailable) {
    return [{
      title: 'Revisar los movimientos que coincidieron con la tendencia',
      explanation: 'Compara el cambio de tickets, ticket promedio, productos y canales por separado; el reporte no demuestra causalidad.',
      expectedImpact: 'Elegir qué señal observar en el siguiente periodo comparable.',
      priority: 'medium',
      evidenceKeys: ['comparison.deltaNetSales', 'comparison.deltaSalesCount', 'comparison.deltaTicket'],
      requiresConfirmation: true
    }];
  }
  return [];
};

const buildAgentContext = ({ current, comparison, period, source, profitability, productRisks, contributors, growthSignals, intent, includeCommercialStrategyEvidence = false, comboOpportunities = [] }) => {
  const risksByProduct = new Map(productRisks.map((risk) => [productIdentityKey({
    productId: risk.productId,
    name: risk.product
  }), risk]));
  const isGrowthIntent = ['sales_growth', 'ticket_growth', 'product_opportunity', 'sales_trend', 'commercial_strategy'].includes(intent)
    || includeCommercialStrategyEvidence === true;
  return {
    summary: {
      netSales: current.netSales,
      units: current.units,
      salesCount: current.salesCount,
      averageTicket: current.averageTicket,
      ...(isGrowthIntent ? { unitsPerTicket: current.unitsPerTicket } : {}),
      discounts: current.discountsKnown ? current.discounts : null,
      unitCosts: current.costComplete ? current.costOfSale : null,
      profit: current.profit,
      margin: current.margin,
      costCoverage: current.costCoverage,
      missingCostProducts: current.missingCostProducts.length,
      excludedSales: current.meta.excludedCount,
      ecommerceDuplicates: current.meta.ecommerceDuplicates,
      profitabilityStatus: profitability.status,
      profitabilityExplanation: profitability.explanation
    },
    products: current.products.map((product) => {
      const risk = risksByProduct.get(productIdentityKey(product));
      return {
        name: product.name,
        quantity: product.quantity,
        netSales: product.netSales,
        salesShare: product.salesShare,
        unitCost: product.unitCost,
        profit: product.profit,
        margin: product.margin,
        averagePrice: product.averagePrice,
        costKnown: product.costKnown,
        riskType: risk?.riskType || null,
        riskReason: risk?.reason || null
      };
    }),
    channels: current.channels,
    comparison: comparison ? {
      previousNetSales: comparison.previousNetSales,
      previousUnits: comparison.previousUnits,
      previousTicket: comparison.previousTicket,
      previousCost: comparison.previousCost,
      previousProfit: comparison.previousProfit,
      previousMargin: comparison.previousMargin,
      deltaNetSales: comparison.deltaNetSales,
      deltaUnits: comparison.deltaUnits,
      currentSalesCount: comparison.currentSalesCount,
      previousSalesCount: comparison.previousSalesCount,
      deltaSalesCount: comparison.deltaSalesCount,
      deltaTicket: comparison.deltaTicket,
      deltaNetSalesPercent: comparison.deltaNetSalesPercent,
      deltaTicketPercent: comparison.deltaTicketPercent,
      previousUnitsPerTicket: comparison.previousUnitsPerTicket,
      deltaUnitsPerTicket: comparison.deltaUnitsPerTicket,
      deltaCost: comparison.deltaCost,
      deltaProfit: comparison.deltaProfit,
      deltaMargin: comparison.deltaMargin,
      deltaMarginRelative: comparison.deltaMarginRelative,
      deltaDiscounts: comparison.deltaDiscounts,
      productMixChanges: comparison.productMixChanges,
      channelMixChanges: comparison.channelMixChanges,
      productChanges: comparison.productChanges
    } : null,
    ...(isGrowthIntent ? {
      growthSignals: {
        currentNetSales: growthSignals.currentNetSales,
        currentSalesCount: growthSignals.currentSalesCount,
        currentUnits: growthSignals.currentUnits,
        currentAverageTicket: growthSignals.currentAverageTicket,
        currentUnitsPerTicket: growthSignals.currentUnitsPerTicket,
        previousNetSales: growthSignals.previousNetSales,
        deltaNetSales: growthSignals.deltaNetSales,
        deltaNetSalesPercent: growthSignals.deltaNetSalesPercent,
        previousSalesCount: growthSignals.previousSalesCount,
        deltaSalesCount: growthSignals.deltaSalesCount,
        previousUnits: growthSignals.previousUnits,
        deltaUnits: growthSignals.deltaUnits,
        previousAverageTicket: growthSignals.previousAverageTicket,
        deltaTicket: growthSignals.deltaTicket,
        deltaTicketPercent: growthSignals.deltaTicketPercent,
        previousUnitsPerTicket: growthSignals.previousUnitsPerTicket,
        deltaUnitsPerTicket: growthSignals.deltaUnitsPerTicket,
        productsGrowing: growthSignals.productsGrowing,
        productsDeclining: growthSignals.productsDeclining,
        productOpportunities: growthSignals.productOpportunities,
        channelChanges: growthSignals.channelChanges,
        comparisonAvailable: growthSignals.comparisonAvailable
      }
    } : {}),
    ...(includeCommercialStrategyEvidence === true ? { comboOpportunities: comboOpportunities.slice(0, 3) } : {}),
    contributors,
    period,
    source
  };
};
export const inferSalesProfitabilityIntent = (question = '') => {
  const resolution = resolveCommercialIntent(question);
  return resolution.kind === 'supported' ? resolution.intent : 'profitability_summary';
};
export const buildSalesProfitabilityProductOptions = ({ currentHistory } = {}) => {
  const productMap = new Map();
  normalizeValidSales(currentHistory).rows.map(normalizeSale).forEach((sale) => {
    sale.items.forEach((item) => {
      const product = productMap.get(item.name) || {
        name: item.name,
        units: 0,
        netSales: 0,
        weightedPrice: 0,
        knownCost: 0,
        missingCostLines: 0
      };
      product.units += item.quantity;
      product.netSales += item.total || 0;
      product.weightedPrice += (item.unitPrice || 0) * item.quantity;
      if (item.unitCost === null) product.missingCostLines += 1;
      else product.knownCost += item.unitCost * item.quantity;
      productMap.set(item.name, product);
    });
  });

  return Array.from(productMap.values())
    .map((product) => ({
      name: product.name,
      units: product.units,
      netSales: product.netSales,
      averagePrice: product.units > 0 ? product.weightedPrice / product.units : null,
      unitCost: product.missingCostLines === 0 && product.units > 0 ? product.knownCost / product.units : null,
      costKnown: product.missingCostLines === 0
    }))
    .filter((product) => (
      typeof product.name === 'string'
      && product.name.trim()
      && Number(product.units) > 0
      && Number(product.netSales) > 0
      && Number(product.averagePrice) > 0
      && product.costKnown === true
      && Number.isFinite(Number(product.unitCost))
      && Number(product.unitCost) >= 0
    ))
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name, 'es'));
};

export const buildSalesProfitabilityAnalysis = ({
  period = {},
  currentHistory,
  previousHistory = null,
  sourceMode = 'mixed',
  intent = 'profitability_summary',
  scenario = {},
  includeCommercialStrategyEvidence = false
} = {}) => {
  const resolvedIntent = SALES_PROFITABILITY_INTENTS.includes(intent) ? intent : 'profitability_summary';
  let normalizedScenario = {};
  try {
    normalizedScenario = normalizeScenarioForIntent(resolvedIntent, scenario);
  } catch {
    normalizedScenario = {};
  }
  const current = aggregateSales(currentHistory, period);
  const previous = previousHistory ? aggregateSales(previousHistory, period.previous || {}) : null;
  const comparison = previous
    ? (resolvedIntent === 'explain_change' && previous.salesCount === 0 ? null : buildComparison(current, previous))
    : null;
  const contributors = comparison ? buildContributors(current, previous, comparison) : [];
  const validRows = normalizeValidSales(currentHistory).rows;
  const profitability = buildProfitabilitySummary(current);
  const productRisks = buildProductRisks(current);
  const growthSignals = buildGrowthSignals(current, comparison);

  let simulation = normalizeSimulationResult();
  if (resolvedIntent === 'price_simulation') simulation = normalizeSimulationResult(simulatePrice(current, normalizedScenario, period));
  if (resolvedIntent === 'promotion_opportunity') simulation = normalizeSimulationResult(simulatePromotion(current, normalizedScenario, period));
  if (resolvedIntent === 'combo_opportunity' || resolvedIntent === 'ticket_growth' || resolvedIntent === 'commercial_strategy' || includeCommercialStrategyEvidence) {
    simulation = normalizeSimulationResult(buildComboSimulation(validRows, period));
  }
  const initialCoverage = { complete: current.salesCount > 0 && current.costComplete === true };
  const goalSimulation = resolvedIntent === 'goal_simulation'
    ? buildGoalSimulation({ current, scenario: normalizedScenario, coverage: initialCoverage })
    : null;
  const whatIfSimulation = resolvedIntent === 'what_if_analysis'
    ? buildWhatIfAnalysis({ current, scenario: normalizedScenario, coverage: initialCoverage })
    : null;

  let calculations = [];
  if (resolvedIntent === 'profitability_summary') {
    calculations = [
      calculation('Ventas netas', current.netSales, 'suma de ventas válidas del periodo', period),
      calculation('Costo de venta', current.costComplete ? current.costOfSale : null, 'suma de (costo unitario × cantidad)', period),
      calculation('Utilidad bruta', current.profit, 'ventas netas - costo de venta', period),
      calculation('Margen bruto', current.margin, 'utilidad bruta / ventas netas', period, 'sales_history', formatPercent),
      calculation('Cobertura de costos', current.costCoverage, 'ventas con costo conocido / ventas netas', period, 'sales_history', formatPercent),
      calculation('Ventas válidas', current.salesCount, 'conteo de ventas válidas', period, 'sales_history', formatNumber)
    ];
  } else if (resolvedIntent === 'explain_change') {
    calculations = [
      calculation('Margen actual', current.margin, 'utilidad actual / ventas actuales', period, 'sales_history', formatPercent),
      calculation('Margen anterior', comparison?.previousMargin ?? null, 'utilidad anterior / ventas anteriores', period, 'comparison', formatPercent),
      calculation('Variación absoluta del margen', comparison?.deltaMargin ?? null, 'margen actual - margen anterior', period, 'comparison', formatPercent),
      calculation('Variación relativa del margen', comparison?.deltaMarginRelative ?? null, '(margen actual - margen anterior) / |margen anterior|', period, 'comparison', formatPercent),
      calculation('Ventas actuales', current.netSales, 'ventas netas del periodo actual', period),
      calculation('Ventas anteriores', comparison?.previousNetSales ?? null, 'ventas netas del periodo anterior', period, 'comparison'),
      calculation('Utilidad actual', current.profit, 'ventas actuales - costo actual', period),
      calculation('Utilidad anterior', comparison?.previousProfit ?? null, 'ventas anteriores - costo anterior', period, 'comparison')
    ];
  } else if (resolvedIntent === 'product_risk') {
    const riskSales = productRisks.reduce((sum, product) => sum + product.netSales, 0);
    calculations = [
      calculation('Productos con riesgo', productRisks.length, 'conteo de productos con una clasificación de riesgo', period, 'sales_history', formatNumber),
      calculation('Ventas asociadas a productos con riesgo', riskSales, 'suma de ventas netas de productos clasificados', period),
      calculation('Productos con margen negativo', productRisks.filter((product) => product.riskType === 'negative_margin').length, 'conteo de productos con margen < 0', period, 'sales_history', formatNumber),
      calculation('Productos con costo faltante', productRisks.filter((product) => product.riskType === 'missing_cost').length, 'conteo de productos vendidos sin costo completo', period, 'sales_history', formatNumber)
    ];
  } else if (['sales_growth', 'sales_trend'].includes(resolvedIntent)) {
    calculations = [
      calculation('Ventas netas actuales', current.netSales, 'suma de ventas válidas del periodo actual', period),
      calculation('Ventas netas anteriores', comparison?.previousNetSales ?? null, 'suma de ventas válidas del periodo anterior comparable', period, 'comparison'),
      calculation('Variación absoluta de ventas', comparison?.deltaNetSales ?? null, 'ventas actuales - ventas anteriores', period, 'comparison'),
      calculation('Variación relativa de ventas', comparison?.deltaNetSalesPercent ?? null, '(ventas actuales - ventas anteriores) / ventas anteriores', period, 'comparison', formatPercent),
      calculation('Tickets actuales', current.salesCount, 'conteo de ventas válidas del periodo actual', period, 'sales_history', formatNumber),
      calculation('Tickets anteriores', comparison?.previousSalesCount ?? null, 'conteo de ventas válidas del periodo anterior', period, 'comparison', formatNumber),
      calculation('Unidades por ticket', current.unitsPerTicket, 'unidades válidas / ventas válidas', period, 'sales_history', formatNumber),
      calculation('Ticket promedio', current.averageTicket, 'ventas netas / ventas válidas', period)
    ];
  } else if (resolvedIntent === 'ticket_growth') {
    calculations = [
      calculation('Ticket promedio actual', current.averageTicket, 'ventas netas actuales / tickets actuales', period),
      calculation('Ticket promedio anterior', comparison?.previousTicket ?? null, 'ventas netas anteriores / tickets anteriores', period, 'comparison'),
      calculation('Variación absoluta del ticket', comparison?.deltaTicket ?? null, 'ticket promedio actual - anterior', period, 'comparison'),
      calculation('Variación relativa del ticket', comparison?.deltaTicketPercent ?? null, '(ticket actual - anterior) / ticket anterior', period, 'comparison', formatPercent),
      calculation('Tickets actuales', current.salesCount, 'conteo de ventas válidas del periodo actual', period, 'sales_history', formatNumber),
      calculation('Unidades por ticket actuales', current.unitsPerTicket, 'unidades válidas / ventas válidas', period, 'sales_history', formatNumber),
      calculation('Unidades por ticket anteriores', comparison?.previousUnitsPerTicket ?? null, 'unidades anteriores / tickets anteriores', period, 'comparison', formatNumber),
      calculation('Variación de unidades por ticket', comparison?.deltaUnitsPerTicket ?? null, 'unidades por ticket actuales - anteriores', period, 'comparison', formatNumber)
    ];
  } else if (resolvedIntent === 'product_opportunity') {
    calculations = [
      calculation('Productos comparados', comparison?.productChanges?.length ?? current.products.length, 'conteo de productos con ventas o detalle de artículos en los periodos', period, 'sales_history', formatNumber),
      calculation('Productos con ventas crecientes', growthSignals.productsGrowingCount, 'conteo de productos con ventas actuales mayores al periodo anterior', period, 'comparison', formatNumber),
      calculation('Productos con ventas decrecientes', growthSignals.productsDecliningCount, 'conteo de productos con ventas actuales menores al periodo anterior o sin venta actual', period, 'comparison', formatNumber),
      calculation('Productos con costo faltante', current.products.filter((product) => product.costKnown !== true).length, 'conteo de productos actuales sin costo completo conocido', period, 'sales_history', formatNumber)
    ];
  } else if (resolvedIntent === 'goal_simulation') {
    const goalPercentPoints = ['gross_margin', 'product_margin'].includes(goalSimulation?.type);
    calculations = [
      calculation('Objetivo', goalSimulation?.targetValue ?? null, goalPercentPoints ? 'porcentaje objetivo indicado por el usuario' : 'valor objetivo indicado por el usuario', period, 'scenario', goalPercentPoints ? formatPercentPoints : formatMoney),
      calculation('Valor actual', goalSimulation?.currentValue ?? null, 'valor observado en las ventas históricas y costos con cobertura válida', period, 'sales_history', goalPercentPoints ? formatPercentPoints : formatMoney),
      calculation('Brecha de la meta', goalSimulation?.gap ?? null, 'máximo entre objetivo - valor actual y cero', period, 'deterministic_simulation', goalPercentPoints ? formatPercentPoints : formatMoney),
      ...(goalSimulation?.type === 'revenue' ? [
        calculation('Brecha porcentual de ventas', goalSimulation.gapPercent ?? null, 'brecha de ventas / meta × 100', period, 'deterministic_simulation', formatPercentPoints)
      ] : []),
      ...(goalSimulation?.requiredRevenue !== undefined ? [
        calculation('Ventas requeridas con margen constante', goalSimulation.requiredRevenue, 'utilidad objetivo / margen bruto actual', period, 'deterministic_simulation'),
        calculation('Tickets adicionales equivalentes', goalSimulation.equivalentAdditionalTickets, 'techo de ventas adicionales requeridas / ticket promedio actual', period, 'deterministic_simulation', formatNumber)
      ] : []),
      ...(goalSimulation?.requiredAdditionalTicketsAtCurrentTicket !== undefined ? [
        calculation('Tickets adicionales al ticket actual', goalSimulation.requiredAdditionalTicketsAtCurrentTicket, 'techo de brecha de ventas / ticket promedio actual', period, 'deterministic_simulation', formatNumber),
        calculation('Ticket promedio requerido al conteo actual', goalSimulation.requiredAverageTicketAtCurrentTicketCount, 'meta de ventas / tickets actuales', period, 'deterministic_simulation')
      ] : []),
      ...(goalSimulation?.requiredProfitAtCurrentSales !== undefined ? [
        calculation('Utilidad bruta requerida al volumen actual', goalSimulation.requiredProfitAtCurrentSales, 'ventas actuales × margen objetivo', period, 'deterministic_simulation'),
        calculation('Brecha de utilidad bruta', goalSimulation.additionalProfitRequired, 'utilidad requerida - utilidad actual', period, 'deterministic_simulation')
      ] : []),
      ...(goalSimulation?.requiredSalesAtCurrentTicketCount !== undefined ? [
        calculation('Cambio porcentual del ticket promedio', goalSimulation.ticketChangePercent, 'diferencia de ticket / ticket actual × 100', period, 'deterministic_simulation', formatPercentPoints),
        calculation('Ventas al ticket objetivo', goalSimulation.requiredSalesAtCurrentTicketCount, 'ticket objetivo × tickets actuales', period, 'deterministic_simulation'),
        calculation('Incremento de ventas al conteo actual', goalSimulation.salesIncreaseAtCurrentTicketCount, 'ventas requeridas - ventas actuales', period, 'deterministic_simulation')
      ] : []),
      ...(goalSimulation?.requiredPrice !== undefined ? [
        calculation('Precio para el margen objetivo', goalSimulation.requiredPrice, 'costo unitario / (1 - margen objetivo)', period, 'deterministic_simulation'),
        calculation('Diferencia frente al precio promedio actual', goalSimulation.priceDifference, 'precio requerido - precio histórico promedio', period, 'deterministic_simulation'),
        calculation('Cambio porcentual del precio', goalSimulation.priceChangePercent, 'diferencia de precio / precio actual × 100', period, 'deterministic_simulation', formatPercentPoints)
      ] : [])
    ];
  } else if (resolvedIntent === 'what_if_analysis') {
    calculations = [
      calculation('Valor actual', whatIfSimulation?.currentSales ?? whatIfSimulation?.historicalSales ?? null, 'valor observado en las ventas históricas', period, 'sales_history'),
      calculation('Porcentaje simulado', whatIfSimulation?.changePercent ?? null, 'porcentaje indicado por el usuario', period, 'scenario', formatPercentPoints),
      calculation('Valor simulado', whatIfSimulation?.simulatedSales ?? null, 'valor actual × (1 + cambio porcentual / 100)', period, 'deterministic_simulation'),
      calculation('Diferencia simulada', whatIfSimulation?.salesDelta ?? null, 'valor simulado - valor actual', period, 'deterministic_simulation'),
      ...(whatIfSimulation?.simulatedProfit !== undefined && whatIfSimulation.simulatedProfit !== null ? [
        calculation('Utilidad bruta simulada', whatIfSimulation.simulatedProfit, 'utilidad actual × factor de cambio con margen constante', period, 'deterministic_simulation'),
        calculation('Variación de utilidad', whatIfSimulation.profitDelta, 'utilidad simulada - utilidad actual', period, 'deterministic_simulation')
      ] : []),
      ...(whatIfSimulation?.simulatedUnits !== undefined ? [
        calculation('Unidades simuladas', whatIfSimulation.simulatedUnits, 'unidades históricas × (1 + cambio porcentual / 100)', period, 'deterministic_simulation', formatNumber)
      ] : []),
      ...(whatIfSimulation?.simulatedTicket !== undefined ? [
        calculation('Ticket promedio simulado', whatIfSimulation.simulatedTicket, 'ticket actual × (1 + cambio porcentual / 100)', period, 'deterministic_simulation')
      ] : [])
    ];
  } else {
    calculations = simulation.calculations;
  }

  const limitations = [];
  if (current.salesCount === 0) limitations.push('No hay ventas válidas en el periodo seleccionado.');
  if (!current.costComplete && ['profitability_summary', 'product_risk', 'price_simulation', 'promotion_opportunity', 'combo_opportunity'].includes(resolvedIntent)) {
    limitations.push(`Faltan costos unitarios en ${current.missingCostLines} líneas de producto; no se convierten en costo cero.`);
  }
  if (resolvedIntent === 'explain_change' && !comparison) {
    limitations.push('No hay un periodo anterior comparable con ventas válidas para explicar un cambio de margen.');
  }
  if (resolvedIntent === 'sales_trend' && !comparison) {
    limitations.push('No se cargó un periodo anterior comparable; no se puede afirmar una tendencia.');
  }
  if (resolvedIntent === 'product_opportunity' && comparison?.productChanges?.length) {
    limitations.push('Las señales de participación alta usan el umbral descriptivo de 10% de las ventas netas actuales; no son una predicción.');
  }
  if (resolvedIntent === 'explain_change' && !current.discountsKnown) {
    limitations.push('No todas las ventas tienen descuento registrado; ese factor puede estar incompleto.');
  }
  if (goalSimulation?.limitation) limitations.push(goalSimulation.limitation);
  if (Array.isArray(goalSimulation?.limitations)) limitations.push(...goalSimulation.limitations);
  if (Array.isArray(whatIfSimulation?.limitations)) limitations.push(...whatIfSimulation.limitations);
  if (resolvedIntent === 'goal_simulation' && goalSimulation?.type === 'gross_margin' && goalSimulation.ready) {
    limitations.push('La brecha de utilidad no determina si el cambio vendrá de precio, costo o mezcla de productos.');
  }
  const sourcePolicy = current.meta.sourcePolicy || {};
  const sourceWarnings = [];
  if ((sourcePolicy.legacySources || 0) > 0) {
    sourceWarnings.push(`Se excluyeron ${sourcePolicy.legacySources} venta(s) legacy/históricas del dataset analítico.`);
  }
  if ((sourcePolicy.shadowSources || 0) > 0) {
    sourceWarnings.push(`Se excluyeron ${sourcePolicy.shadowSources} venta(s) shadow del dataset analítico.`);
  }
  if ((sourcePolicy.ecommerceSources || 0) > 0) {
    sourceWarnings.push(`Se excluyeron ${sourcePolicy.ecommerceSources} registro(s) ecommerce no convertidos a venta POS.`);
  }
  if ((sourcePolicy.unknownSources || 0) > 0) {
    sourceWarnings.push(`Hay ${sourcePolicy.unknownSources} venta(s) con fuente no reconocida; se conservaron por compatibilidad y se reportan con confianza limitada.`);
  }
  limitations.push(...simulation.limitations, ...sourceWarnings);

  const assumptions = [
    ...(resolvedIntent === 'price_simulation' || resolvedIntent === 'promotion_opportunity' ? simulation.assumptions : []),
    ...(resolvedIntent === 'combo_opportunity' || resolvedIntent === 'commercial_strategy' ? simulation.assumptions : []),
    ...(Array.isArray(goalSimulation?.assumptions) ? goalSimulation.assumptions : []),
    ...(Array.isArray(whatIfSimulation?.assumptions) ? whatIfSimulation.assumptions : [])
  ];

  const source = sourceModeToContractSource(sourceMode);
  const coverage = {
    validSales: current.salesCount,
    rawSales: current.meta.rawCount,
    excludedSales: current.meta.excludedCount,
    ecommerceDuplicatesExcluded: current.meta.ecommerceDuplicates,
    productsIncluded: current.products.length,
    productsMissingCost: current.missingCostProducts.length,
    costCoverage: current.costCoverage,
    comparisonAvailable: Boolean(comparison),
    reportSource: sourceMode,
    sourcePolicy: {
      excludedSources: sourcePolicy.excludedSources || 0,
      excludedStatuses: sourcePolicy.excludedStatuses || 0,
      cancelledMarkers: sourcePolicy.cancelledMarkers || 0,
      legacySources: sourcePolicy.legacySources || 0,
      shadowSources: sourcePolicy.shadowSources || 0,
      ecommerceSources: sourcePolicy.ecommerceSources || 0,
      unknownSources: sourcePolicy.unknownSources || 0
    },
    sourceWarnings,
    complete: current.salesCount > 0 && current.costComplete
  };

  const sourceReliable = (sourcePolicy.unknownSources || 0) === 0;
  const confidence = current.salesCount === 0
    ? 'low'
    : resolvedIntent === 'explain_change'
      ? (comparison && current.costComplete && previous?.costComplete && sourceReliable ? 'high' : 'low')
      : current.costComplete && sourceReliable ? 'high' : (current.costCoverage >= 0.7 && sourceReliable ? 'medium' : 'low');

  let facts = [];
  let executiveSummary = '';
  let explanation = '';

  if (resolvedIntent === 'profitability_summary') {
    facts = [{
      label: 'Rentabilidad del periodo',
      status: profitability.status,
      netSales: profitability.netSales,
      profit: profitability.profit,
      margin: profitability.margin,
      costCoverage: profitability.costCoverage
    }];
    executiveSummary = profitability.explanation;
    explanation = profitability.status === 'undetermined'
      ? 'Primero conviene completar los costos faltantes; sin ellos Lanzo-POS evita clasificar el negocio como rentable o no rentable.'
      : `La conclusión usa ${formatNumber(profitability.validSales, 0)} ventas válidas y una cobertura de costos de ${formatPercent(profitability.costCoverage)}.`;
  } else if (resolvedIntent === 'explain_change') {
    facts = contributors.map((item) => ({
      label: item.title,
      contribution: item.contribution,
      direction: item.direction,
      evidenceKeys: item.evidenceKeys
    }));
    executiveSummary = comparison
      ? `El margen pasó de ${formatPercent(comparison.previousMargin)} a ${formatPercent(current.margin)}, una variación de ${formatPercent(comparison.deltaMargin)}.`
      : 'No hay un periodo anterior comparable suficiente para explicar cómo cambió el margen.';
    explanation = contributors.length
      ? `El principal movimiento observado es ${contributors[0].title.toLowerCase()}. ${contributors[0].explanation}`
      : 'No hay evidencia suficiente para atribuir el cambio a costos, descuentos, mezcla, volumen, ticket o canal.';
  } else if (resolvedIntent === 'product_risk') {
    facts = productRisks.slice(0, 8).map((risk) => ({
      label: risk.product,
      riskType: risk.riskType,
      riskLabel: risk.riskLabel,
      netSales: risk.netSales,
      profit: risk.profit,
      margin: risk.margin
    }));
    executiveSummary = productRisks.length
      ? `Se detectaron ${formatNumber(productRisks.length, 0)} producto(s) que conviene revisar por margen, contribución o costos faltantes.`
      : 'No se detectaron productos con los criterios de riesgo disponibles en este periodo.';
    explanation = productRisks.length
      ? `${productRisks[0].product} aparece primero porque: ${productRisks[0].reason}`
      : 'El análisis sólo usa ventas, costos, utilidad y margen; no infiere rotación, stock detenido ni disponibilidad.';
  } else if (resolvedIntent === 'sales_growth') {
    const change = comparison
      ? ` Las ventas ${comparison.deltaNetSales > 0 ? 'subieron' : comparison.deltaNetSales < 0 ? 'bajaron' : 'se mantuvieron'} ${formatMoney(Math.abs(comparison.deltaNetSales))} frente al periodo anterior.`
      : '';
    executiveSummary = `El periodo registra ${formatMoney(current.netSales)} en ventas netas y ${formatNumber(current.salesCount, 0)} tickets.${change}`;
    const leading = growthSignals.productOpportunities[0];
    explanation = `${leading ? `${leading.name} muestra una señal para revisar: ${leading.opportunityReason}` : 'No hay productos con señales comparables suficientes para priorizar.'} El canal con mayor venta fue ${current.channels[0]?.channel || 'no disponible'}; esto describe volumen y no atribuye una causa.`;
  } else if (resolvedIntent === 'sales_trend') {
    executiveSummary = comparison
      ? `Las ventas netas ${comparison.deltaNetSales > 0 ? 'aumentaron' : comparison.deltaNetSales < 0 ? 'disminuyeron' : 'se mantuvieron'} ${formatMoney(Math.abs(comparison.deltaNetSales))} (${formatPercent(comparison.deltaNetSalesPercent)}) frente al periodo anterior.`
      : 'No hay un periodo anterior comparable suficiente para determinar una tendencia de ventas.';
    explanation = comparison
      ? `Los tickets cambiaron ${formatNumber(comparison.deltaSalesCount, 0)} y el ticket promedio ${formatMoney(comparison.deltaTicket)}. Estos movimientos ocurrieron en los mismos periodos; el reporte no demuestra que uno haya causado el otro.`
      : 'La comparación requiere rangos equivalentes con datos completos de ambos periodos.';
  } else if (resolvedIntent === 'ticket_growth') {
    executiveSummary = comparison?.previousTicket !== null && comparison?.previousTicket !== undefined
      ? `El ticket promedio fue ${formatMoney(current.averageTicket)} frente a ${formatMoney(comparison.previousTicket)} en el periodo anterior (${formatMoney(comparison.deltaTicket)}; ${formatPercent(comparison.deltaTicketPercent)}).`
      : `El ticket promedio actual es ${formatMoney(current.averageTicket)} con ${formatNumber(current.salesCount, 0)} tickets; no hay un ticket anterior válido para calcular una variación.`;
    explanation = `Se registraron ${formatNumber(current.units, 0)} unidades, equivalentes a ${formatNumber(current.unitsPerTicket)} por ticket.${simulation.comboOpportunities.length ? ` La combinación histórica más frecuente fue ${simulation.comboOpportunities[0].products.join(' + ')} en ${formatNumber(simulation.comboOpportunities[0].tickets, 0)} tickets.` : ' No se encontró una combinación histórica con la frecuencia mínima.'} Estas señales pueden orientar pruebas; no garantizan un ticket mayor.`;
  } else if (resolvedIntent === 'product_opportunity') {
    executiveSummary = `Se evaluaron ${formatNumber(growthSignals.productsComparedCount, 0)} producto(s) comparable(s) y se priorizaron ${formatNumber(growthSignals.productOpportunities.length, 0)} oportunidad(es) entre ${formatNumber(current.products.length, 0)} producto(s) vendidos en el periodo.`;
    const declining = growthSignals.productsDeclining[0];
    const leadingOpportunity = growthSignals.productOpportunities[0];
    explanation = `${leadingOpportunity ? leadingOpportunity.opportunityReason : 'No se observan productos con señales comparables suficientes para priorizar.'} ${declining ? `${declining.name} muestra una disminución de ${formatMoney(Math.abs(declining.salesDelta))}.` : ''} El margen sólo se muestra cuando el costo del producto está completo.`;
  } else if (resolvedIntent === 'price_simulation') {
    facts = simulation.priceSimulation ? [{ label: simulation.priceSimulation.product, ...simulation.priceSimulation }] : [];
    executiveSummary = simulation.priceSimulation
      ? `Con el mismo volumen histórico, la utilidad cambiaría ${formatMoney(simulation.priceSimulation.profitDelta)} y el margen quedaría en ${formatPercent(simulation.priceSimulation.simulatedMargin)}.`
      : 'No hay datos suficientes para completar la simulación de precio.';
    explanation = simulation.priceSimulation
      ? `El volumen mínimo para conservar la utilidad actual es ${formatNumber(simulation.priceSimulation.breakEvenVolume, 1)} unidades. Esto no es una predicción de demanda.`
      : simulation.limitations[0] || 'Selecciona un producto y un precio nuevo para simular.';
  } else if (resolvedIntent === 'promotion_opportunity') {
    facts = simulation.promotionSimulation ? [{ label: simulation.promotionSimulation.product, ...simulation.promotionSimulation }] : [];
    executiveSummary = simulation.promotionSimulation
      ? `El precio promocional deja un margen de ${formatPercent(simulation.promotionSimulation.promotionalMargin)} con el volumen histórico usado como supuesto.`
      : 'No hay datos suficientes para completar la simulación de promoción.';
    explanation = simulation.promotionSimulation
      ? `Para conservar la utilidad actual se requerirían ${formatNumber(simulation.promotionSimulation.breakEvenVolume, 1)} unidades al precio promocional. Esto no predice demanda.`
      : simulation.limitations[0] || 'Selecciona un producto y un descuento o precio promocional.';
  } else if (resolvedIntent === 'combo_opportunity') {
    facts = simulation.comboOpportunities.slice(0, 5).map((combo) => ({
      label: combo.products.join(' + '),
      tickets: combo.tickets,
      frequency: combo.frequency,
      margin: combo.margin,
      evidenceLevel: combo.evidenceLevel
    }));
    executiveSummary = simulation.comboOpportunities.length
      ? `La combinación con mayor evidencia es ${simulation.comboOpportunities[0].products.join(' + ')} con ${simulation.comboOpportunities[0].tickets} tickets compartidos.`
      : 'No hay suficientes tickets con productos compartidos para recomendar un combo confiable.';
    explanation = simulation.comboOpportunities.length
      ? 'La oportunidad se basa exclusivamente en coocurrencias históricas y no presupone que una compra cause la otra.'
      : 'Se requieren al menos tres tickets compartidos de la misma combinación.';
  } else if (resolvedIntent === 'goal_simulation') {
    if (!goalSimulation?.ready) {
      executiveSummary = goalSimulation?.limitation || 'No hay datos suficientes para calcular esta meta con confianza.';
      explanation = goalSimulation?.type === 'gross_profit'
        ? 'Las ventas requeridas para utilidad sólo se calculan con costos completos y margen positivo.'
        : 'Los valores faltantes permanecen como no disponibles y no se sustituyen por cero.';
    } else if (goalSimulation.type === 'revenue') {
      executiveSummary = goalSimulation.state === 'achieved'
        ? `La meta de ventas de ${formatMoney(goalSimulation.targetValue)} ya se alcanzó; llevas ${formatMoney(goalSimulation.currentSales)}.`
        : `Llevas ${formatMoney(goalSimulation.currentSales)} de una meta de ${formatMoney(goalSimulation.targetValue)}; la brecha es ${formatMoney(goalSimulation.revenueGap)}.`;
      explanation = goalSimulation.requiredAdditionalTicketsAtCurrentTicket === null
        ? 'No hay un ticket promedio positivo para traducir la brecha a tickets adicionales.'
        : `Al ticket promedio actual de ${formatMoney(goalSimulation.currentAverageTicket)}, serían aproximadamente ${formatNumber(goalSimulation.requiredAdditionalTicketsAtCurrentTicket, 0)} tickets adicionales; con el conteo actual, el ticket promedio sería ${formatMoney(goalSimulation.requiredAverageTicketAtCurrentTicketCount)}.`;
    } else if (goalSimulation.type === 'gross_profit') {
      executiveSummary = goalSimulation.state === 'achieved'
        ? `La meta de utilidad bruta de ${formatMoney(goalSimulation.targetProfit)} ya se alcanzó con ${formatMoney(goalSimulation.currentProfit)}.`
        : `La utilidad bruta actual es ${formatMoney(goalSimulation.currentProfit)}; la meta de ${formatMoney(goalSimulation.targetProfit)} deja una brecha de ${formatMoney(goalSimulation.profitGap)}.`;
      explanation = `Manteniendo mezcla y margen bruto de ${(goalSimulation.currentMargin * 100).toFixed(1)}%, las ventas del escenario serían ${formatMoney(goalSimulation.requiredRevenue)}. Este escenario no es una predicción.`;
    } else if (goalSimulation.type === 'average_ticket') {
      executiveSummary = `El ticket promedio actual es ${formatMoney(goalSimulation.currentAverageTicket)} y la meta es ${formatMoney(goalSimulation.targetValue)}.`;
      explanation = `Con ${formatNumber(goalSimulation.currentTickets, 0)} tickets, las ventas totales serían ${formatMoney(goalSimulation.requiredSalesAtCurrentTicketCount)}; el incremento matemático es ${formatMoney(goalSimulation.salesIncreaseAtCurrentTicketCount)}.`;
    } else if (goalSimulation.type === 'gross_margin') {
      executiveSummary = `El margen bruto actual es ${(goalSimulation.currentMargin * 100).toFixed(1)}% y la meta es ${goalSimulation.targetValue}%.`;
      explanation = `Con ventas actuales de ${formatMoney(goalSimulation.currentSales)}, la utilidad bruta requerida sería ${formatMoney(goalSimulation.requiredProfitAtCurrentSales)}, ${formatMoney(goalSimulation.additionalProfitRequired)} respecto a la actual. El cálculo no determina qué cambio comercial lo produciría.`;
    } else {
      executiveSummary = `${goalSimulation.productName}: precio histórico promedio ${formatMoney(goalSimulation.currentPrice)}, costo unitario ${formatMoney(goalSimulation.unitCost)} y margen ${((goalSimulation.currentMargin || 0) * 100).toFixed(1)}%.`;
      explanation = `El precio matemático para el margen objetivo de ${goalSimulation.targetValue}% sería ${formatMoney(goalSimulation.requiredPrice)} (diferencia ${formatMoney(goalSimulation.priceDifference)}). No cambia el precio real ni predice demanda.`;
    }
  } else if (resolvedIntent === 'what_if_analysis') {
    if (!whatIfSimulation?.ready) {
      executiveSummary = whatIfSimulation?.limitations?.[1] || 'No hay datos históricos suficientes para construir este escenario.';
      explanation = 'Completa los parámetros y usa productos con ventas históricas para que Lanzo calcule la simulación.';
    } else {
      const label = whatIfSimulation.changeType === 'sales' ? 'ventas'
        : whatIfSimulation.changeType === 'ticket' ? 'ticket promedio'
          : `ventas de ${whatIfSimulation.productName}`;
      const baseValue = whatIfSimulation.currentSales ?? whatIfSimulation.historicalSales;
      executiveSummary = `${label}: de ${formatMoney(baseValue)} a ${formatMoney(whatIfSimulation.simulatedSales)} (${whatIfSimulation.changePercent > 0 ? '+' : ''}${formatNumber(whatIfSimulation.changePercent)}%).`;
      explanation = whatIfSimulation.changeType === 'product'
        ? `Las unidades pasarían matemáticamente de ${formatNumber(whatIfSimulation.historicalUnits)} a ${formatNumber(whatIfSimulation.simulatedUnits)} al precio promedio histórico. El escenario no predice demanda.`
        : whatIfSimulation.changeType === 'ticket'
          ? `Supone el mismo número de ${formatNumber(whatIfSimulation.ticketCount, 0)} tickets. El escenario no predice demanda.`
          : 'La simulación escala las ventas y, sólo con costos completos, también la estructura de margen. No es un pronóstico.';
    }
  } else if (resolvedIntent === 'commercial_strategy') {
    executiveSummary = 'Lanzo está reuniendo señales internas para ordenar prioridades comerciales.';
    explanation = 'Las prioridades se derivan de rentabilidad, cambios de ventas y ticket, oportunidades de producto, surtido y coocurrencias históricas disponibles.';
  }

  const recommendations = current.salesCount > 0
    ? fallbackRecommendation(resolvedIntent, { profitability, productRisks, contributors, simulation, growthSignals })
    : [];
  return {
    version: 1,
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    intent: resolvedIntent,
    status: current.salesCount === 0 || (resolvedIntent === 'combo_opportunity' && simulation.comboOpportunities.length === 0)
      ? 'insufficient_data'
      : 'completed',
    executiveSummary,
    answer: executiveSummary,
    explanation,
    facts,
    calculations,
    assumptions,
    scenarios: simulation.scenarios,
    recommendations,
    limitations,
    confidence,
    source,
    coverage,
    citations: [],
    contributors,
    profitability,
    productRisks,
    growthSignals,
    productOpportunities: growthSignals.productOpportunities,
    priceSimulation: simulation.priceSimulation,
    promotionSimulation: simulation.promotionSimulation,
    comboOpportunities: simulation.comboOpportunities,
    goalSimulation,
    whatIfSimulation,
    strategyCandidates: [],
    includeCommercialStrategyEvidence: includeCommercialStrategyEvidence === true,
    context: buildAgentContext({
      current,
      comparison,
      period,
      source,
      profitability,
      productRisks,
      contributors,
      growthSignals,
      intent: resolvedIntent,
      includeCommercialStrategyEvidence,
      comboOpportunities: simulation.comboOpportunities
    }),
    current,
    previous,
    comparison
  };
};
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const shiftCalendarDate = (value, days) => {
  if (!DATE_ONLY_PATTERN.test(String(value || ''))) throw new Error('SALES_PROFITABILITY_DATE_INVALID');
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
};

const calendarDateInTimeZone = (value, timezone) => {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) return value;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('SALES_PROFITABILITY_DATE_INVALID');
  const zone = safeText(timezone, DEFAULT_BUSINESS_TIMEZONE, 120) || DEFAULT_BUSINESS_TIMEZONE;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(instant);
  } catch {
    throw new Error('SALES_PROFITABILITY_TIMEZONE_INVALID');
  }
  const values = parts.reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${values.year}-${values.month}-${values.day}`;
};

export const buildPeriodRange = ({
  days = 30,
  end = new Date(),
  timezone = DEFAULT_BUSINESS_TIMEZONE
} = {}) => {
  const normalizedDays = Math.max(Number(days) || 30, 1);
  const to = calendarDateInTimeZone(end, timezone);
  return {
    from: shiftCalendarDate(to, -normalizedDays + 1),
    to,
    days: normalizedDays,
    timezone: safeText(timezone, DEFAULT_BUSINESS_TIMEZONE, 120) || DEFAULT_BUSINESS_TIMEZONE
  };
};

export const buildPreviousPeriod = (period = {}) => {
  const days = Math.max(Number(period.days) || 30, 1);
  const timezone = safeText(period.timezone, DEFAULT_BUSINESS_TIMEZONE, 120) || DEFAULT_BUSINESS_TIMEZONE;
  const anchor = period.from || period.to || calendarDateInTimeZone(new Date(), timezone);
  const previous = buildPeriodRange({
    days,
    end: shiftCalendarDate(anchor, -1),
    timezone
  });
  return { ...previous, label: 'Periodo anterior comparable' };
};

export const formatAnalysisValue = { formatMoney, formatNumber, formatPercent };
