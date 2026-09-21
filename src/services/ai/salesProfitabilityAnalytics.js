import { COMMERCIAL_AGENT_KEYS } from './commercialAgentContract';

export const SALES_PROFITABILITY_INTENTS = Object.freeze([
  'profitability_summary',
  'explain_change',
  'product_risk',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity'
]);

const DEFAULT_COST_COVERAGE = 0;
const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';
const MAX_PRODUCTS = 20;
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
  'rechazado'
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
  : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value));

const formatNumber = (value, maximumFractionDigits = 2) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : new Intl.NumberFormat('es-MX', { maximumFractionDigits }).format(Number(value));

const formatPercent = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'No disponible'
  : `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(Number(value) * 100)}%`;

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
  const unitCost = numberOrNull(source.cost ?? source.unit_cost ?? source.cost_snapshot ?? source.costPrice);
  const discount = numberOrNull(source.discount ?? source.discount_amount ?? source.discountAmount);

  return {
    name: safeText(source.name ?? source.product_name ?? source.productName ?? source.description, 'Producto sin nombre'),
    quantity,
    unitPrice: unitPrice !== null ? unitPrice : (quantity > 0 && total !== null ? total / quantity : null),
    total,
    unitCost,
    discount
  };
};

const normalizedSource = (sale) => normalize(sale?.sourceMode ?? sale?.source_mode ?? sale?.source ?? '');
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
  if (Boolean(sale?.cancelledAt || sale?.cancelled_at || sale?.cancellationId || sale?.cancellation_id)) {
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
      const product = productMap.get(item.name) || {
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
      productMap.set(item.name, product);
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
        name: product.name,
        quantity: product.quantity,
        netSales: product.netSales,
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
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, MAX_PRODUCTS);
  aggregate.channels = Array.from(channelMap.values())
    .map((channel) => ({
      ...channel,
      averageTicket: channel.orders > 0 ? channel.netSales / channel.orders : null,
      share: aggregate.netSales > 0 ? channel.netSales / aggregate.netSales : null
    }))
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, MAX_CHANNELS);
  aggregate.averageTicket = aggregate.salesCount > 0 ? aggregate.netSales / aggregate.salesCount : null;
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
  if (!previous || previous.salesCount === 0) return null;
  const currentMix = new Map(current.products.map((product) => [product.name, product.netSales / Math.max(current.netSales, 1)]));
  const previousMix = new Map(previous.products.map((product) => [product.name, product.netSales / Math.max(previous.netSales, 1)]));
  const names = new Set([...currentMix.keys(), ...previousMix.keys()]);

  return {
    previousNetSales: previous.netSales,
    previousUnits: previous.units,
    previousTicket: previous.averageTicket,
    previousCost: previous.costComplete ? previous.costOfSale : null,
    previousProfit: previous.profit,
    previousMargin: previous.margin,
    previousDiscounts: previous.discountsKnown ? previous.discounts : null,
    deltaNetSales: delta(current.netSales, previous.netSales),
    deltaUnits: delta(current.units, previous.units),
    deltaTicket: delta(current.averageTicket, previous.averageTicket),
    deltaCost: delta(current.costComplete ? current.costOfSale : null, previous.costComplete ? previous.costOfSale : null),
    deltaProfit: delta(current.profit, previous.profit),
    deltaMargin: delta(current.margin, previous.margin),
    deltaMarginRelative: current.margin !== null && previous.margin !== null && previous.margin !== 0
      ? (current.margin - previous.margin) / Math.abs(previous.margin)
      : null,
    deltaDiscounts: delta(current.discountsKnown ? current.discounts : null, previous.discountsKnown ? previous.discounts : null),
    productMixChanges: Array.from(names).map((name) => ({
      name,
      currentShare: currentMix.get(name) || 0,
      previousShare: previousMix.get(name) || 0,
      deltaShare: (currentMix.get(name) || 0) - (previousMix.get(name) || 0)
    })).sort((a, b) => Math.abs(b.deltaShare) - Math.abs(a.deltaShare)).slice(0, 8),
    channelMixChanges: current.channels.map((channel) => {
      const previousChannel = previous.channels.find((item) => item.channel === channel.channel);
      return {
        channel: channel.channel,
        currentShare: channel.share,
        previousShare: previousChannel?.share || 0,
        deltaShare: (channel.share || 0) - (previousChannel?.share || 0)
      };
    }).sort((a, b) => Math.abs(b.deltaShare) - Math.abs(a.deltaShare)).slice(0, 6)
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
  const volume = positiveNumberOrNull(scenario.historicalVolume) || product.quantity;
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
  const volume = positiveNumberOrNull(scenario.historicalVolume) || product.quantity;
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
        historicalJointSales: pair.jointSales,
        averageJointSale,
        cost: averageJointCost,
        comboPrice: averageJointSale,
        discount: null,
        profit,
        margin: averageJointSale > 0 && profit !== null ? profit / averageJointSale : null,
        evidenceLevel,
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
    limitations: candidates.some((candidate) => candidate.margin === null)
      ? ['Algunos tickets compartidos no tienen costo completo; el margen de esas oportunidades no puede confirmarse.']
      : []
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
      ? `No puedo confirmar la rentabilidad completa porque faltan costos unitarios en ${current.missingCostProducts.length} producto(s).`
      : status === 'profitable'
        ? `Con los costos registrados, el negocio genera utilidad bruta en este periodo: ${formatMoney(current.profit)} con margen de ${formatPercent(current.margin)}.`
        : `Con los costos registrados, el periodo no genera utilidad bruta positiva: ${formatMoney(current.profit)} con margen de ${formatPercent(current.margin)}.`;

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

const fallbackRecommendation = (intent, { profitability, productRisks, contributors, simulation }) => {
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
  return [];
};

const buildAgentContext = ({ current, comparison, period, source, profitability, productRisks, contributors }) => {
  const risksByProduct = new Map(productRisks.map((risk) => [risk.product, risk]));
  return {
    summary: {
      netSales: current.netSales,
      units: current.units,
      salesCount: current.salesCount,
      averageTicket: current.averageTicket,
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
      const risk = risksByProduct.get(product.name);
      return {
        name: product.name,
        quantity: product.quantity,
        netSales: product.netSales,
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
      deltaTicket: comparison.deltaTicket,
      deltaCost: comparison.deltaCost,
      deltaProfit: comparison.deltaProfit,
      deltaMargin: comparison.deltaMargin,
      deltaMarginRelative: comparison.deltaMarginRelative,
      deltaDiscounts: comparison.deltaDiscounts,
      productMixChanges: comparison.productMixChanges,
      channelMixChanges: comparison.channelMixChanges
    } : null,
    contributors,
    period,
    source
  };
};
export const inferSalesProfitabilityIntent = (question = '') => {
  const text = normalize(question);
  const containsAny = (terms) => terms.some((term) => text.includes(term));

  if (containsAny(['precio', 'subir precio', 'aumentar precio'])) return 'price_simulation';
  if (containsAny(['combo', 'juntos', 'combinacion', 'combinaciones'])) return 'combo_opportunity';
  if (containsAny(['promocion', 'descuento', 'oferta'])) return 'promotion_opportunity';
  if (containsAny(['problematico', 'problematicos', 'problema', 'afectando', 'bajo margen', 'productos malos'])) return 'product_risk';
  if (containsAny(['rentable', 'rentabilidad', 'utilidad', 'ganancia', 'gano', 'pierdo', 'perdida'])) return 'profitability_summary';
  if (containsAny(['margen', 'cambio', 'cambio mi', 'cambio el', 'subio', 'bajo', 'variacion'])) return 'explain_change';
  return 'profitability_summary';
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
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name, 'es'));
};

export const buildSalesProfitabilityAnalysis = ({
  period = {},
  currentHistory,
  previousHistory = null,
  sourceMode = 'mixed',
  intent = 'profitability_summary',
  scenario = {}
} = {}) => {
  const resolvedIntent = SALES_PROFITABILITY_INTENTS.includes(intent) ? intent : 'profitability_summary';
  const current = aggregateSales(currentHistory, period);
  const previous = previousHistory ? aggregateSales(previousHistory, period.previous || {}) : null;
  const comparison = previous ? buildComparison(current, previous) : null;
  const contributors = comparison ? buildContributors(current, previous, comparison) : [];
  const validRows = normalizeValidSales(currentHistory).rows;
  const profitability = buildProfitabilitySummary(current);
  const productRisks = buildProductRisks(current);

  let simulation = normalizeSimulationResult();
  if (resolvedIntent === 'price_simulation') simulation = normalizeSimulationResult(simulatePrice(current, scenario, period));
  if (resolvedIntent === 'promotion_opportunity') simulation = normalizeSimulationResult(simulatePromotion(current, scenario, period));
  if (resolvedIntent === 'combo_opportunity') simulation = normalizeSimulationResult(buildComboSimulation(validRows, period));

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
  if (resolvedIntent === 'explain_change' && !current.discountsKnown) {
    limitations.push('No todas las ventas tienen descuento registrado; ese factor puede estar incompleto.');
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
    ...(resolvedIntent === 'combo_opportunity' ? simulation.assumptions : [])
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
  }

  const recommendations = current.salesCount > 0
    ? fallbackRecommendation(resolvedIntent, { profitability, productRisks, contributors, simulation })
    : [];

  return {
    version: 1,
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    intent: resolvedIntent,
    status: current.salesCount > 0 ? 'completed' : 'incomplete',
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
    priceSimulation: simulation.priceSimulation,
    promotionSimulation: simulation.promotionSimulation,
    comboOpportunities: simulation.comboOpportunities,
    context: buildAgentContext({
      current,
      comparison,
      period,
      source,
      profitability,
      productRisks,
      contributors
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
