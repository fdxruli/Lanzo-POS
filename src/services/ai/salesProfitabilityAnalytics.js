import { COMMERCIAL_AGENT_KEYS } from './commercialAgentContract';

export const SALES_PROFITABILITY_INTENTS = Object.freeze([
  'explain_change',
  'product_risk',
  'price_simulation',
  'combo_opportunity',
  'promotion_opportunity'
]);

const DEFAULT_COST_COVERAGE = 0;
const MAX_PRODUCTS = 20;
const MAX_CHANNELS = 12;
const MIN_COMBO_TICKETS = 3;
const LOW_MARGIN_THRESHOLD = 0.2;

const CANCELLED_STATUSES = new Set([
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

const EXCLUDED_ECOMMERCE_SOURCES = new Set([
  'ecommerce_order',
  'ecommerce_pending',
  'ecommerce_rejected',
  'ecommerce_cancelled',
  'rejected',
  'cancelled'
]);

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

const isExcludedSale = (sale) => {
  const status = normalizedStatus(sale);
  const source = normalizedSource(sale);
  return CANCELLED_STATUSES.has(status)
    || CANCELLED_STATUSES.has(source)
    || source.includes('shadow')
    || EXCLUDED_ECOMMERCE_SOURCES.has(source)
    || Boolean(sale?.cancelledAt || sale?.cancelled_at || sale?.cancellationId || sale?.cancellation_id);
};

const ecommerceKey = (sale) => safeText(
  sale?.ecommerceOrderId
    ?? sale?.ecommerce_order_id
    ?? sale?.ecommerceOrderCode
    ?? sale?.ecommerce_order_code,
  null,
  100
);

const prefersConvertedSale = (sale) => {
  const source = normalizedSource(sale);
  return source.includes('converted') || source.includes('pos') || source.includes('committed');
};

export const normalizeValidSales = (history) => {
  const rows = extractRows(history);
  const excluded = [];
  const candidates = [];

  rows.forEach((row) => {
    if (!asRecord(row) || isExcludedSale(row)) {
      excluded.push(row);
      return;
    }
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
    if (prefersConvertedSale(row) && !prefersConvertedSale(deduped[existingIndex])) {
      deduped[existingIndex] = row;
    }
  });

  return {
    rows: deduped,
    excludedCount: excluded.length,
    ecommerceDuplicates,
    rawCount: rows.length
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
  const currentCostRate = current.costComplete && current.netSales > 0 ? current.costOfSale / current.netSales : null;
  const previousCostRate = previous.costComplete && previous.netSales > 0 ? previous.costOfSale / previous.netSales : null;
  const costRateDelta = delta(currentCostRate, previousCostRate);
  if (costRateDelta !== null && Math.abs(costRateDelta) > 0.0001) {
    contributors.push({
      label: 'costo de venta',
      contribution: costRateDelta,
      direction: costRateDelta > 0 ? 'negative' : 'positive',
      explanation: `La tasa de costo cambió ${formatPercent(costRateDelta)}.`
    });
  }

  const mixDelta = delta(current.lowMarginSalesShare, previous.lowMarginSalesShare);
  if (mixDelta !== null && Math.abs(mixDelta) > 0.0001) {
    contributors.push({
      label: 'mezcla de productos de bajo margen',
      contribution: mixDelta,
      direction: mixDelta > 0 ? 'negative' : 'positive',
      explanation: `La participación de ventas de bajo margen cambió ${formatPercent(mixDelta)}.`
    });
  }

  const currentDiscountRate = current.netSales > 0 && current.discountsKnown ? current.discounts / current.netSales : null;
  const previousDiscountRate = previous.netSales > 0 && previous.discountsKnown ? previous.discounts / previous.netSales : null;
  const discountDelta = delta(currentDiscountRate, previousDiscountRate);
  if (discountDelta !== null && Math.abs(discountDelta) > 0.0001) {
    contributors.push({
      label: 'descuentos',
      contribution: discountDelta,
      direction: discountDelta > 0 ? 'negative' : 'positive',
      explanation: `La tasa de descuento cambió ${formatPercent(discountDelta)}.`
    });
  }

  comparison.channelMixChanges.slice(0, 2).forEach((channel) => {
    if (Math.abs(channel.deltaShare || 0) > 0.05) {
      contributors.push({
        label: `canal ${channel.channel}`,
        contribution: channel.deltaShare,
        direction: 'context',
        explanation: `La participación del canal cambió ${formatPercent(channel.deltaShare)}.`
      });
    }
  });

  return contributors.slice(0, 4);
};

const sourceModeToContractSource = (mode) => {
  if (mode === 'cloud' || mode === 'cloud_final') return 'cloud';
  if (mode === 'local') return 'local';
  return 'mixed';
};

const chooseProduct = (aggregate, scenario = {}) => {
  const requested = normalize(scenario.productName ?? scenario.product ?? '');
  return aggregate.products.find((product) => normalize(product.name) === requested)
    || aggregate.products.find((product) => normalize(product.name).includes(requested) && requested)
    || aggregate.products[0]
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
  if (!product) return { scenarios: [], limitations: ['No hay productos vendidos en el periodo para simular un precio.'] };
  const currentPrice = positiveNumberOrNull(scenario.currentPrice) || positiveNumberOrNull(product.averagePrice);
  const newPrice = positiveNumberOrNull(scenario.newPrice);
  const unitCost = numberOrNull(scenario.unitCost) ?? product.unitCost;
  const volume = positiveNumberOrNull(scenario.historicalVolume) || product.quantity;
  if (currentPrice === null || newPrice === null || unitCost === null || volume === null) {
    return {
      scenarios: [],
      limitations: ['Se requiere precio actual, nuevo precio, costo unitario y volumen histórico con datos confiables.']
    };
  }
  const currentProfit = (currentPrice - unitCost) * volume;
  const sameVolumeProfit = (newPrice - unitCost) * volume;
  const breakEvenVolume = newPrice > unitCost && currentProfit > 0 ? currentProfit / (newPrice - unitCost) : null;
  const scenarios = buildVolumeScenarios({ currentPrice, newPrice, unitCost, volume, baselineProfit: currentProfit });
  return {
    product: product.name,
    scenarios,
    calculations: [
      calculation('Precio actual', currentPrice, 'precio actual', period),
      calculation('Nuevo precio', newPrice, 'precio simulado', period),
      calculation('Utilidad actual', currentProfit, '(precio actual - costo unitario) × volumen histórico', period),
      calculation('Utilidad simulada con el mismo volumen', sameVolumeProfit, '(nuevo precio - costo unitario) × volumen histórico', period),
      calculation('Margen actual', currentPrice > 0 ? (currentPrice - unitCost) / currentPrice : null, 'utilidad actual / ventas actuales', period, 'sales_history', formatPercent),
      calculation('Margen simulado', newPrice > 0 ? (newPrice - unitCost) / newPrice : null, 'utilidad simulada / ventas simuladas', period, 'simulation', formatPercent),
      calculation('Volumen de equilibrio para conservar la utilidad actual', breakEvenVolume, 'utilidad actual / (nuevo precio - costo unitario)', period, 'simulation', formatNumber)
    ],
    assumptions: ['La simulación usa el volumen histórico como referencia.', 'Los escenarios de -10% y +10% son escenarios, no predicciones de demanda.'],
    limitations: newPrice <= unitCost ? ['El nuevo precio no deja utilidad unitaria positiva; no hay punto de equilibrio finito.'] : []
  };
};

const simulatePromotion = (aggregate, scenario, period) => {
  const product = chooseProduct(aggregate, scenario);
  if (!product) return { scenarios: [], limitations: ['No hay productos vendidos en el periodo para simular una promoción.'] };
  const currentPrice = positiveNumberOrNull(scenario.currentPrice) || positiveNumberOrNull(product.averagePrice);
  const discountPercent = numberOrNull(scenario.discountPercent);
  const promotionalPrice = positiveNumberOrNull(scenario.promotionalPrice)
    || (currentPrice !== null && discountPercent !== null ? currentPrice * (1 - discountPercent / 100) : null);
  const unitCost = numberOrNull(scenario.unitCost) ?? product.unitCost;
  const volume = positiveNumberOrNull(scenario.historicalVolume) || product.quantity;
  if (currentPrice === null || promotionalPrice === null || unitCost === null || volume === null) {
    return { scenarios: [], limitations: ['Se requiere precio actual, descuento o precio promocional, costo y volumen histórico.'] };
  }
  const currentProfit = (currentPrice - unitCost) * volume;
  const promotionalUnitProfit = promotionalPrice - unitCost;
  const unitsToCompensate = promotionalUnitProfit > 0 ? currentProfit / promotionalUnitProfit : null;
  const scenarios = buildVolumeScenarios({
    currentPrice,
    newPrice: promotionalPrice,
    unitCost,
    volume,
    baselineProfit: currentProfit,
  });
  return {
    product: product.name,
    scenarios,
    calculations: [
      calculation('Precio promocional', promotionalPrice, 'precio actual × (1 - descuento / 100)', period),
      calculation('Descuento aplicado', currentPrice > 0 ? (currentPrice - promotionalPrice) / currentPrice : null, '(precio actual - precio promocional) / precio actual', period, 'simulation', formatPercent),
      calculation('Margen promocional', promotionalPrice > 0 ? promotionalUnitProfit / promotionalPrice : null, '(precio promocional - costo unitario) / precio promocional', period, 'simulation', formatPercent),
      calculation('Unidades para compensar la utilidad actual', unitsToCompensate, 'utilidad actual / utilidad unitaria promocional', period, 'simulation', formatNumber)
    ],
    assumptions: ['La utilidad base usa el volumen histórico.', 'Los escenarios de volumen son ilustrativos; no estiman elasticidad.'],
    limitations: promotionalUnitProfit <= 0 ? ['La promoción no deja utilidad unitaria positiva.'] : []
  };
};

const buildComboSimulation = (validRows, aggregate, period) => {
  const pairMap = new Map();
  const ticketCount = validRows.length;
  validRows.map(normalizeSale).forEach((sale) => {
    const uniqueItems = Array.from(new Set(sale.items.map((item) => item.name))).sort();
    for (let i = 0; i < uniqueItems.length; i += 1) {
      for (let j = i + 1; j < uniqueItems.length; j += 1) {
        const key = `${uniqueItems[i]}\u0000${uniqueItems[j]}`;
        pairMap.set(key, (pairMap.get(key) || 0) + 1);
      }
    }
  });

  const candidates = Array.from(pairMap.entries())
    .map(([key, count]) => {
      const [first, second] = key.split('\u0000');
      const products = [aggregate.products.find((product) => product.name === first), aggregate.products.find((product) => product.name === second)];
      const price = products.every(Boolean) ? products.reduce((sum, product) => sum + (product.averagePrice || 0), 0) : null;
      const cost = products.every((product) => product?.unitCost !== null)
        ? products.reduce((sum, product) => sum + (product.unitCost || 0), 0)
        : null;
      const comboPrice = price !== null ? price * 0.95 : null;
      const profit = comboPrice !== null && cost !== null ? comboPrice - cost : null;
      return {
        products: [first, second],
        tickets: count,
        frequency: ticketCount > 0 ? count / ticketCount : 0,
        individualPrice: price,
        cost,
        comboPrice,
        discount: price !== null ? 0.05 : null,
        profit,
        margin: comboPrice > 0 && profit !== null ? profit / comboPrice : null,
        breakEvenTickets: profit > 0 ? 1 / profit : null
      };
    })
    .filter((candidate) => candidate.tickets >= MIN_COMBO_TICKETS)
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 5);

  if (!candidates.length) {
    return {
      scenarios: [],
      calculations: [],
      assumptions: ['Se requiere observar al menos tres tickets con la misma combinación para mostrar una oportunidad.'],
      limitations: ['No hay datos suficientes para recomendar un combo con confianza.']
    };
  }

  return {
    scenarios: candidates,
    calculations: candidates.slice(0, 3).flatMap((candidate) => [
      calculation(`Frecuencia conjunta: ${candidate.products.join(' + ')}`, candidate.frequency, 'tickets con ambos productos / tickets válidos', period, 'sales_history', formatPercent),
      calculation(`Precio simulado del combo: ${candidate.products.join(' + ')}`, candidate.comboPrice, 'suma de precios individuales × (1 - 5%)', period, 'simulation'),
      calculation(`Margen simulado del combo: ${candidate.products.join(' + ')}`, candidate.margin, 'utilidad del combo / precio del combo', period, 'simulation', formatPercent)
    ]),
    assumptions: ['El precio del combo usa un descuento ilustrativo de 5%; debe confirmarse antes de cualquier acción.', 'La frecuencia conjunta describe asociación histórica, no causalidad.'],
    limitations: candidates.some((candidate) => candidate.margin === null) ? ['Algunos productos no tienen costo registrado; el margen del combo puede estar incompleto.'] : []
  };
};

const buildAgentContext = ({ current, comparison, period, source }) => ({
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
    ecommerceDuplicates: current.meta.ecommerceDuplicates
  },
  products: current.products.map((product) => ({
    name: product.name,
    quantity: product.quantity,
    netSales: product.netSales,
    unitCost: product.unitCost,
    profit: product.profit,
    margin: product.margin,
    averagePrice: product.averagePrice,
    costKnown: product.costKnown
  })),
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
    deltaDiscounts: comparison.deltaDiscounts,
    productMixChanges: comparison.productMixChanges,
    channelMixChanges: comparison.channelMixChanges
  } : null,
  period,
  source
});

export const inferSalesProfitabilityIntent = (question = '') => {
  const text = normalize(question);
  if (text.includes('precio') || text.includes('subir') || text.includes('aumentar')) return 'price_simulation';
  if (text.includes('combo') || text.includes('juntos') || text.includes('combin')) return 'combo_opportunity';
  if (text.includes('promoc') || text.includes('descuento')) return 'promotion_opportunity';
  if (text.includes('problem') || text.includes('afect') || text.includes('bajo margen')) return 'product_risk';
  return 'explain_change';
};

export const buildSalesProfitabilityAnalysis = ({
  period = {},
  currentHistory,
  previousHistory = null,
  sourceMode = 'mixed',
  intent = 'explain_change',
  scenario = {}
} = {}) => {
  const current = aggregateSales(currentHistory, period);
  const previous = previousHistory ? aggregateSales(previousHistory, period.previous || {}) : null;
  const comparison = previous ? buildComparison(current, previous) : null;
  const contributors = comparison ? buildContributors(current, previous, comparison) : [];
  const validRows = normalizeValidSales(currentHistory).rows;
  const deterministicCalculations = [
    calculation('Ventas netas', current.netSales, 'suma de totales de líneas de ventas válidas', period),
    calculation('Unidades vendidas', current.units, 'suma de cantidades de productos en ventas válidas', period, 'sales_history', formatNumber),
    calculation('Número de ventas', current.salesCount, 'conteo de ventas válidas', period, 'sales_history', formatNumber),
    calculation('Ticket promedio', current.averageTicket, 'ventas netas / número de ventas', period),
    calculation('Costo de venta', current.costComplete ? current.costOfSale : null, 'suma de (costo unitario × cantidad)', period),
    calculation('Utilidad bruta', current.profit, 'ventas netas - costo de venta', period),
    calculation('Margen bruto', current.margin, 'utilidad bruta / ventas netas', period, 'sales_history', formatPercent),
    calculation('Descuentos', current.discountsKnown ? current.discounts : null, 'suma de descuentos registrados', period)
  ];

  if (comparison) {
    deterministicCalculations.push(
      calculation('Cambio de ventas netas', comparison.deltaNetSales, 'ventas netas del periodo actual - periodo anterior', period),
      calculation('Cambio de utilidad', comparison.deltaProfit, 'utilidad actual - utilidad anterior', period),
      calculation('Cambio de margen', comparison.deltaMargin, 'margen actual - margen anterior', period, 'comparison', formatPercent),
      calculation('Cambio de descuentos', comparison.deltaDiscounts, 'descuentos actuales - descuentos anteriores', period)
    );
  }

  let simulation = { scenarios: [], calculations: [], assumptions: [], limitations: [] };
  if (intent === 'price_simulation') simulation = simulatePrice(current, scenario, period);
  if (intent === 'promotion_opportunity') simulation = simulatePromotion(current, scenario, period);
  if (intent === 'combo_opportunity') simulation = buildComboSimulation(validRows, current, period);

  const limitations = [
    ...(current.costComplete ? [] : [`Faltan costos unitarios en ${current.missingCostLines} líneas de producto; utilidad y margen no se calculan completamente.`]),
    ...(current.discountsKnown ? [] : ['No todas las ventas tienen descuento registrado; el total de descuentos puede estar incompleto.']),
    ...(comparison ? [] : ['No se proporcionó un periodo anterior comparable.']),
    ...simulation.limitations
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
    complete: current.salesCount > 0 && current.costComplete
  };
  const confidence = current.salesCount === 0 || current.costCoverage < 0.7
    ? 'low'
    : (current.costComplete && comparison ? 'high' : 'medium');
  const productFacts = current.products.slice(0, 6).map((product) => ({
    label: product.name,
    quantity: product.quantity,
    netSales: product.netSales,
    margin: product.margin,
    costKnown: product.costKnown
  }));
  const executiveSummary = current.salesCount === 0
    ? 'No hay ventas válidas suficientes en el periodo seleccionado para generar un análisis confiable.'
    : comparison?.deltaMargin !== null && comparison?.deltaMargin !== undefined
      ? `El margen cambió ${formatPercent(comparison.deltaMargin)} y las ventas netas cambiaron ${formatMoney(comparison.deltaNetSales)} frente al periodo anterior.`
      : `Se analizaron ${formatNumber(current.salesCount, 0)} ventas válidas por ${formatMoney(current.netSales)}.`;

  return {
    version: 1,
    agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
    status: current.salesCount > 0 ? 'completed' : 'incomplete',
    executiveSummary,
    answer: executiveSummary,
    explanation: contributors.length
      ? `Los principales movimientos observados son: ${contributors.map((item) => item.explanation).join(' ')}`
      : 'No hay evidencia comparativa suficiente para atribuir el cambio a un factor específico.',
    facts: productFacts,
    calculations: [...deterministicCalculations, ...simulation.calculations],
    assumptions: [
      'La zona horaria del negocio se respeta al construir el periodo seleccionado.',
      'Las asociaciones históricas no prueban causalidad.',
      ...simulation.assumptions
    ],
    scenarios: simulation.scenarios,
    recommendations: current.salesCount > 0 ? [{
      title: intent === 'price_simulation' ? 'Validar el escenario antes de cambiar precios' : 'Revisar los productos de mayor impacto',
      explanation: 'Usa la evidencia y confirma cualquier cambio manualmente; esta respuesta no ejecuta acciones.',
      expectedImpact: 'Por determinar con una prueba comercial controlada.',
      effort: 'medium',
      evidence: contributors.length ? contributors.map((item) => item.label) : ['ventas válidas del periodo'],
      requiresConfirmation: true
    }] : [],
    limitations,
    confidence,
    source,
    coverage,
    citations: [],
    contributors,
    context: buildAgentContext({ current, comparison, period, source }),
    current,
    previous,
    comparison
  };
};

export const buildPeriodRange = ({ days = 30, end = new Date() } = {}) => {
  const endDate = new Date(end);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - Math.max(Number(days) || 30, 1) + 1);
  const toDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  return { from: toDate(startDate), to: toDate(endDate), days: Math.max(Number(days) || 30, 1) };
};

export const buildPreviousPeriod = (period = {}) => {
  const days = Math.max(Number(period.days) || 30, 1);
  const end = new Date(`${period.from || period.to || new Date().toISOString().slice(0, 10)}T00:00:00`);
  end.setDate(end.getDate() - 1);
  const previous = buildPeriodRange({ days, end });
  return { ...previous, label: 'Periodo anterior comparable' };
};

export const formatAnalysisValue = { formatMoney, formatNumber, formatPercent };
