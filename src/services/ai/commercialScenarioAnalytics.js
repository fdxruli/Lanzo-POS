import { Money } from '../../utils/moneyMath';

export const WHAT_IF_CHANGE_LIMITS = Object.freeze({ minimum: -99.9, maximum: 500 });

const asFinite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const roundMoney = (value) => value === null || value === undefined ? null : Money.toNumber(value);
const roundUnits = (value) => value === null || value === undefined
  ? null
  : Number(Money.init(value).round(4).toString());
const subtract = (a, b) => Money.subtract(a, b);
const multiply = (a, b) => Money.multiply(a, b);
const divide = (a, b) => (asFinite(b) === 0 ? null : Money.divide(a, b));
const positiveGap = (target, current) => Money.init(target).minus(Money.init(current)).gt(0)
  ? roundMoney(subtract(target, current))
  : 0;
const targetState = (target, current) => current >= target ? 'achieved' : 'remaining';
const normalizedName = (value) => String(value || '').trim().toLocaleLowerCase('es-MX');
const findProduct = (products, name) => (Array.isArray(products) ? products : [])
  .find((product) => normalizedName(product.name) === normalizedName(name));
const safeRatio = (numerator, denominator) => {
  const value = divide(numerator, denominator);
  return value === null ? null : Number(value.round(6).toString());
};
const ceilPositive = (value) => Number(Money.init(value).round(0, 3).toString());
const percentChange = (current, change) => current > 0
  ? Number(Money.divide(change, current).times(100).round(2).toString())
  : null;

const baseResult = ({ type, targetValue, currentValue = null, ready, limitation = null }) => ({
  type,
  targetValue,
  currentValue,
  ready,
  state: ready && currentValue !== null ? targetState(targetValue, currentValue) : 'unavailable',
  gap: ready && currentValue !== null ? positiveGap(targetValue, currentValue) : null,
  gapPercent: ready && currentValue !== null && targetValue > 0
    ? Number(Money.divide(positiveGap(targetValue, currentValue), targetValue).times(100).round(2).toString())
    : null,
  excess: ready && currentValue !== null && currentValue > targetValue
    ? roundMoney(subtract(currentValue, targetValue))
    : 0,
  progress: ready && currentValue !== null && targetValue > 0 ? safeRatio(currentValue, targetValue) : null,
  limitation
});

export const buildGoalSimulation = ({ current = {}, scenario = {}, coverage = {} } = {}) => {
  const type = scenario.goalType;
  const targetValue = asFinite(scenario.targetValue);
  const sales = asFinite(current.netSales) ?? 0;
  const salesCount = asFinite(current.salesCount) ?? 0;
  const averageTicket = asFinite(current.averageTicket);
  const costComplete = coverage.complete === true && current.costComplete === true;
  const costKnown = asFinite(current.costOfSale);
  const profit = costComplete ? asFinite(current.profit) : null;
  const margin = costComplete ? asFinite(current.margin) : null;

  if (!type || targetValue === null) return null;

  if (type === 'revenue') {
    const gap = positiveGap(targetValue, sales);
    const requiredAverageTicket = salesCount > 0 ? roundMoney(Money.divide(targetValue, salesCount)) : null;
    const additionalTickets = gap === 0
      ? 0
      : averageTicket > 0
        ? ceilPositive(Money.divide(gap, averageTicket))
        : null;
    return {
      ...baseResult({ type, targetValue: roundMoney(targetValue), currentValue: roundMoney(sales), ready: true }),
      revenueGap: gap,
      requiredAdditionalTicketsAtCurrentTicket: additionalTickets,
      requiredAverageTicketAtCurrentTicketCount: requiredAverageTicket,
      currentSales: roundMoney(sales),
      currentTickets: salesCount,
      currentAverageTicket: roundMoney(averageTicket),
      limitations: salesCount === 0 || averageTicket === null || averageTicket <= 0
        ? ['No hay un ticket promedio positivo disponible para convertir la brecha en tickets.']
        : []
    };
  }

  if (type === 'gross_profit') {
    const ready = costComplete && sales > 0 && profit !== null && margin !== null && margin > 0;
    const limitation = !coverage.complete
      ? 'No se calcula una meta de utilidad porque faltan costos o la cobertura del periodo está incompleta.'
      : !costComplete
        ? 'No se calcula una meta de utilidad porque existen costos faltantes.'
        : !(margin > 0)
          ? 'El margen actual es cero o negativo; mantenerlo constante no permite calcular las ventas requeridas para una meta positiva de utilidad.'
          : null;
    const result = baseResult({
      type,
      targetValue: roundMoney(targetValue),
      currentValue: profit === null ? null : roundMoney(profit),
      ready,
      limitation
    });
    if (!ready) return { ...result, currentRevenue: roundMoney(sales), currentMargin: margin };

    const requiredRevenueExact = Money.divide(targetValue, margin);
    const requiredRevenue = roundMoney(requiredRevenueExact);
    const additionalRevenue = positiveGap(requiredRevenueExact, sales);
    const ticketsEquivalent = additionalRevenue === 0
      ? 0
      : averageTicket > 0
        ? ceilPositive(Money.divide(additionalRevenue, averageTicket))
        : null;
    return {
      ...result,
      currentProfit: roundMoney(profit),
      targetProfit: roundMoney(targetValue),
      profitGap: positiveGap(targetValue, profit),
      currentRevenue: roundMoney(sales),
      currentMargin: margin,
      requiredRevenue,
      additionalRevenue,
      equivalentAdditionalTickets: ticketsEquivalent,
      currentAverageTicket: roundMoney(averageTicket),
      currentTickets: salesCount,
      costOfSale: roundMoney(costKnown),
      assumptions: ['Supone que la mezcla de productos y el margen bruto actual se mantienen constantes. No es una predicción.']
    };
  }

  if (type === 'average_ticket') {
    const ready = salesCount > 0 && averageTicket !== null;
    const limitation = ready ? null : 'No hay tickets válidos en el periodo para medir un ticket promedio actual.';
    const requiredSales = ready ? roundMoney(multiply(targetValue, salesCount)) : null;
    return {
      ...baseResult({
        type,
        targetValue: roundMoney(targetValue),
        currentValue: averageTicket === null ? null : roundMoney(averageTicket),
        ready,
        limitation
      }),
      currentAverageTicket: roundMoney(averageTicket),
      ticketDifference: averageTicket === null ? null : roundMoney(subtract(targetValue, averageTicket)),
      ticketChangePercent: averageTicket > 0 ? percentChange(averageTicket, subtract(targetValue, averageTicket)) : null,
      currentTickets: salesCount,
      requiredSalesAtCurrentTicketCount: requiredSales,
      salesIncreaseAtCurrentTicketCount: ready ? roundMoney(subtract(requiredSales, sales)) : null,
      assumptions: ['Es una meta matemática que mantiene el número actual de tickets; no afirma que el cambio de comportamiento sea posible.']
    };
  }

  if (type === 'gross_margin') {
    const ready = costComplete && sales > 0 && profit !== null && margin !== null;
    const limitation = !coverage.complete || !costComplete
      ? 'No se calcula una brecha de margen porque los costos o la cobertura del periodo están incompletos.'
      : sales <= 0
        ? 'No hay ventas netas positivas para calcular el margen actual.'
        : null;
    const targetMargin = targetValue / 100;
    const requiredProfit = ready ? roundMoney(multiply(sales, targetMargin)) : null;
    return {
      ...baseResult({ type, targetValue, currentValue: margin === null ? null : margin * 100, ready, limitation }),
      currentMargin: margin,
      targetMargin,
      currentSales: roundMoney(sales),
      currentProfit: roundMoney(profit),
      requiredProfitAtCurrentSales: requiredProfit,
      additionalProfitRequired: ready ? roundMoney(subtract(requiredProfit, profit)) : null,
      assumptions: ['Mantiene las ventas actuales. El cálculo expresa una brecha y no determina si cambiar precio, costo o mezcla la cerrará.']
    };
  }

  if (type === 'product_margin') {
    const product = findProduct(current.products, scenario.productName);
    const productCostKnown = product?.costKnown === true && asFinite(product?.unitCost) !== null;
    const currentPrice = asFinite(product?.averagePrice);
    const unitCost = productCostKnown ? asFinite(product.unitCost) : null;
    const targetMargin = targetValue / 100;
    const zeroCostConflict = productCostKnown && unitCost === 0 && targetMargin < 1;
    const ready = Boolean(product && productCostKnown && currentPrice > 0 && targetMargin > 0 && targetMargin < 1 && !zeroCostConflict);
    const limitation = !product
      ? 'El producto no aparece en las ventas históricas del periodo.'
      : !productCostKnown
        ? 'No se calcula el precio objetivo porque el costo unitario del producto no está completo.'
        : !(targetMargin > 0 && targetMargin < 1)
          ? 'El margen objetivo debe ser mayor que 0% y menor que 100%.'
          : zeroCostConflict
            ? 'Con costo unitario conocido de $0, cualquier precio positivo produce margen de 100%; el precio de $0 no define un margen porcentual.'
            : !(currentPrice > 0)
              ? 'No hay un precio histórico promedio positivo para comparar.'
              : null;
    const requiredPrice = ready ? roundMoney(Money.divide(unitCost, 1 - targetMargin)) : null;
    const priceDelta = ready ? roundMoney(subtract(requiredPrice, currentPrice)) : null;
    return {
      ...baseResult({
        type,
        targetValue,
        currentValue: asFinite(product?.margin) === null ? null : product.margin * 100,
        ready,
        limitation
      }),
      productName: product?.name || scenario.productName,
      currentPrice: roundMoney(currentPrice),
      unitCost: roundMoney(unitCost),
      currentMargin: asFinite(product?.margin),
      targetMargin,
      requiredPrice,
      priceDifference: priceDelta,
      priceChangePercent: currentPrice > 0 ? percentChange(currentPrice, priceDelta) : null,
      assumptions: ['Precio matemático con costo unitario constante; no cambia el precio real ni predice la demanda.']
    };
  }

  return null;
};

export const buildWhatIfAnalysis = ({ current = {}, scenario = {}, coverage = {} } = {}) => {
  const changeType = scenario.changeType;
  const changePercent = asFinite(scenario.changePercent);
  if (!changeType || changePercent === null) return null;
  const factor = Money.init(1).plus(Money.init(changePercent).div(100));
  const limitations = ['Este escenario mantiene constantes las condiciones indicadas y no predice cómo reaccionará la demanda.'];

  if (changeType === 'sales') {
    const currentSales = asFinite(current.netSales);
    if (currentSales === null) return { changeType, changePercent, ready: false, limitations: [...limitations, 'No hay ventas netas disponibles para construir el escenario.'] };
    const simulatedSales = roundMoney(Money.init(currentSales).times(factor));
    const salesDelta = roundMoney(subtract(simulatedSales, currentSales));
    const costComplete = coverage.complete === true && current.costComplete === true;
    const currentCost = costComplete ? asFinite(current.costOfSale) : null;
    const currentProfit = costComplete ? asFinite(current.profit) : null;
    const simulatedCost = costComplete && currentCost !== null ? roundMoney(Money.init(currentCost).times(factor)) : null;
    const simulatedProfit = costComplete && currentProfit !== null ? roundMoney(Money.init(currentProfit).times(factor)) : null;
    return {
      changeType,
      changePercent,
      ready: true,
      currentSales: roundMoney(currentSales),
      simulatedSales,
      salesDelta,
      currentCost: roundMoney(currentCost),
      simulatedCost,
      currentProfit: roundMoney(currentProfit),
      simulatedProfit,
      profitDelta: simulatedProfit === null ? null : roundMoney(subtract(simulatedProfit, currentProfit)),
      currentMargin: costComplete ? asFinite(current.margin) : null,
      simulatedMargin: costComplete && currentSales > 0 ? asFinite(current.margin) : null,
      assumptions: costComplete
        ? ['Escala ventas y costos por el mismo factor; mezcla y margen se mantienen constantes.']
        : ['Escala únicamente las ventas netas; los costos incompletos no se convierten en cero.'],
      limitations: costComplete ? limitations : [...limitations, 'No se proyectan utilidad ni margen porque faltan costos en parte del periodo.']
    };
  }

  if (changeType === 'ticket') {
    const tickets = asFinite(current.salesCount) ?? 0;
    const currentTicket = asFinite(current.averageTicket);
    if (tickets <= 0 || currentTicket === null) {
      return { changeType, changePercent, ready: false, limitations: [...limitations, 'No hay tickets válidos para simular un ticket promedio.'] };
    }
    const simulatedTicketExact = Money.init(currentTicket).times(factor);
    const simulatedTicket = roundMoney(simulatedTicketExact);
    const currentSales = asFinite(current.netSales) ?? 0;
    const simulatedSales = roundMoney(simulatedTicketExact.times(tickets));
    const costComplete = coverage.complete === true && current.costComplete === true;
    const currentProfit = costComplete ? asFinite(current.profit) : null;
    const simulatedProfit = costComplete && asFinite(current.margin) !== null
      ? roundMoney(Money.init(simulatedSales).times(current.margin))
      : null;
    const simulatedCost = costComplete && simulatedProfit !== null
      ? roundMoney(subtract(simulatedSales, simulatedProfit))
      : null;
    return {
      changeType,
      changePercent,
      ready: true,
      ticketCount: tickets,
      currentTicket: roundMoney(currentTicket),
      simulatedTicket,
      currentSales: roundMoney(currentSales),
      simulatedSales,
      salesDelta: roundMoney(subtract(simulatedSales, currentSales)),
      currentProfit: roundMoney(currentProfit),
      simulatedProfit,
      profitDelta: simulatedProfit === null ? null : roundMoney(subtract(simulatedProfit, currentProfit)),
      currentCost: costComplete ? roundMoney(current.costOfSale) : null,
      simulatedCost,
      currentMargin: costComplete ? asFinite(current.margin) : null,
      simulatedMargin: costComplete && simulatedSales > 0 ? asFinite(current.margin) : null,
      assumptions: [
        'Mantiene el mismo número de tickets.',
        ...(costComplete ? ['Supone que mezcla y margen por ticket se mantienen constantes.'] : [])
      ],
      limitations: costComplete ? limitations : [...limitations, 'No se proyectan utilidad ni margen porque faltan costos en parte del periodo.']
    };
  }

  if (changeType === 'product') {
    const product = findProduct(current.products, scenario.productName);
    if (!product) {
      return { changeType, changePercent, ready: false, productName: scenario.productName || null, limitations: [...limitations, 'El producto debe existir en el historial del periodo seleccionado.'] };
    }
    const quantity = asFinite(product.quantity);
    const netSales = asFinite(product.netSales);
    if (quantity === null || quantity <= 0 || netSales === null) {
      return { changeType, changePercent, ready: false, productName: product.name, limitations: [...limitations, 'No hay unidades y ventas históricas suficientes para simular este producto.'] };
    }
    const simulatedUnits = roundUnits(Money.init(quantity).times(factor));
    const simulatedSales = roundMoney(Money.init(netSales).times(factor));
    const costKnown = product.costKnown === true && asFinite(product.cost) !== null;
    const currentCost = costKnown ? asFinite(product.cost) : null;
    const currentProfit = costKnown ? asFinite(product.profit) : null;
    const simulatedCost = costKnown ? roundMoney(Money.init(currentCost).times(factor)) : null;
    const simulatedProfit = costKnown && currentProfit !== null ? roundMoney(Money.init(currentProfit).times(factor)) : null;
    return {
      changeType,
      changePercent,
      ready: true,
      productName: product.name,
      historicalUnits: roundUnits(quantity),
      simulatedUnits,
      averagePrice: roundMoney(product.averagePrice),
      historicalSales: roundMoney(netSales),
      simulatedSales,
      salesDelta: roundMoney(subtract(simulatedSales, netSales)),
      costKnown,
      currentCost: roundMoney(currentCost),
      simulatedCost,
      currentProfit: roundMoney(currentProfit),
      simulatedProfit,
      profitDelta: simulatedProfit === null ? null : roundMoney(subtract(simulatedProfit, currentProfit)),
      currentMargin: costKnown ? asFinite(product.margin) : null,
      simulatedMargin: costKnown && simulatedSales > 0 ? asFinite(product.margin) : null,
      assumptions: ['Conserva el precio promedio histórico y permite unidades fraccionarias en el resultado matemático; no confirma que una venta real admita esa cantidad.'],
      limitations: costKnown ? limitations : [...limitations, 'El costo del producto es desconocido; utilidad y margen permanecen no disponibles.']
    };
  }

  return null;
};

const candidate = ({ type, key, priority, reasonCode, title, entity = null, evidenceKeys, metrics = {}, recommendationType = 'investigation' }) => ({
  type,
  key,
  focus: { type, key },
  priority,
  reasonCode,
  title,
  entity,
  recommendationType,
  strength: priority === 'high' ? 'strong' : priority === 'medium' ? 'moderate' : 'weak',
  metrics,
  signal: [reasonCode],
  evidenceKeys: Array.from(new Set(evidenceKeys)).slice(0, 8)
});

export const buildCommercialStrategyCandidates = ({
  current = {},
  comparison = null,
  growthSignals = {},
  productRisks = [],
  assortment = null,
  comboOpportunities = [],
  coverage = {}
} = {}) => {
  const candidates = [];
  const addCandidate = (value) => {
    if (!value.evidenceKeys.length || candidates.some((item) => item.key === value.key)) return;
    candidates.push(value);
  };

  const currentSales = asFinite(current.netSales);
  const deltaSales = asFinite(comparison?.deltaNetSales);
  const deltaSalesPercent = asFinite(comparison?.deltaNetSalesPercent);
  const previousSales = asFinite(comparison?.previousNetSales);
  const previousTickets = asFinite(comparison?.previousSalesCount);
  const deltaTickets = asFinite(comparison?.deltaSalesCount);
  const ticketDelta = asFinite(comparison?.deltaTicket);
  const deltaMargin = coverage.comparisonAvailable === true ? asFinite(comparison?.deltaMargin) : null;

  if (coverage.comparisonItemsAvailable === true && ticketDelta !== null && ticketDelta < 0
    && deltaSalesPercent !== null && previousSales > 0
    && Math.abs(deltaSalesPercent) <= 0.1 && previousTickets > 0
    && Math.abs(deltaTickets / previousTickets) <= 0.1) {
    addCandidate(candidate({
      type: 'ticket',
      key: 'ticket',
      priority: Math.abs(ticketDelta / Math.max(asFinite(comparison?.previousTicket) || 0, 1)) >= 0.1 ? 'high' : 'medium',
      reasonCode: 'ticket_down_sales_stable',
      title: 'Revisar el valor por ticket',
      evidenceKeys: ['metric:currentAverageTicket', 'metric:deltaTicket', 'metric:deltaNetSalesPercent', 'metric:deltaSalesCount'],
      metrics: { currentAverageTicket: asFinite(current.averageTicket), deltaTicket: ticketDelta, deltaNetSalesPercent: deltaSalesPercent, deltaSalesCount: deltaTickets },
      recommendationType: 'optimization'
    }));
  }

  if (coverage.comparisonDataAvailable === true && deltaSalesPercent !== null && deltaSalesPercent < 0 && currentSales !== null) {
    addCandidate(candidate({
      type: 'general',
      key: 'sales_trend',
      priority: deltaSalesPercent <= -0.1 ? 'high' : 'medium',
      reasonCode: 'sales_declining',
      title: 'Investigar la caída de ventas',
      evidenceKeys: ['comparison.deltaNetSales', 'metric:deltaNetSalesPercent'],
      metrics: { currentSales, previousSales, deltaSales, deltaSalesPercent },
      recommendationType: 'investigation'
    }));
  }

  if (deltaMargin !== null && deltaMargin < 0 && current.costComplete === true) {
    addCandidate(candidate({
      type: 'general',
      key: 'gross_margin',
      priority: deltaMargin <= -0.05 ? 'high' : 'medium',
      reasonCode: 'margin_deteriorating',
      title: 'Revisar el margen bruto',
      evidenceKeys: ['profitability.margin', 'comparison.deltaMargin', 'profitability.costCoverage'],
      metrics: { currentMargin: asFinite(current.margin), deltaMargin },
      recommendationType: 'investigation'
    }));
  }

  for (const risk of (Array.isArray(productRisks) ? productRisks : [])) {
    const name = typeof risk.product === 'string' ? risk.product : '';
    if (!name) continue;
    if (risk.riskType === 'missing_cost'
      && coverage.itemsComplete === true && coverage.paginationComplete === true && coverage.sourceComplete === true) {
      addCandidate(candidate({
        type: 'product', key: name, entity: name, priority: 'high', reasonCode: 'product_cost_missing',
        title: `Completar el costo de ${name}`,
        evidenceKeys: [`product:${name}`, 'profitability.costCoverage'],
        metrics: { currentSales: asFinite(risk.netSales), costKnown: false }, recommendationType: 'data_quality'
      }));
      continue;
    }
    if (current.costComplete !== true || !['negative_margin', 'low_margin', 'many_sales_low_profit', 'high_sales_low_contribution'].includes(risk.riskType)) continue;
    const high = risk.riskType === 'negative_margin' || risk.riskType === 'many_sales_low_profit';
    addCandidate(candidate({
      type: 'product', key: name, entity: name, priority: high ? 'high' : 'medium', reasonCode: 'product_low_margin',
      title: `Revisar costo, precio o mezcla de ${name}`,
      evidenceKeys: [`product:${name}`, 'profitability.costCoverage'],
      metrics: { currentSales: asFinite(risk.netSales), currentMargin: asFinite(risk.margin), costKnown: true },
      recommendationType: 'optimization'
    }));
  }

  for (const product of (coverage.comparisonItemsAvailable === true && Array.isArray(growthSignals.productsGrowing)
    ? growthSignals.productsGrowing
    : [])) {
    if (!product?.name || !(asFinite(product.currentSales) > 0)) continue;
    addCandidate(candidate({
      type: 'product', key: product.name, entity: product.name, priority: 'medium', reasonCode: 'product_growing',
      title: `Evaluar cómo sostener el crecimiento de ${product.name}`,
      evidenceKeys: [`product:${product.name}`, 'metric:currentNetSales'],
      metrics: { currentSales: asFinite(product.currentSales), salesDelta: asFinite(product.salesDelta) },
      recommendationType: 'growth_experiment'
    }));
  }

  const assortmentHealth = record(assortment?.health);
  const concentration = record(assortmentHealth.concentration);
  const topCategoryShare = asFinite(concentration.topCategoryShare);
  const topCategory = (Array.isArray(assortment?.categoryPerformance) ? assortment.categoryPerformance : [])[0];
  if (topCategoryShare !== null && topCategoryShare >= 0.6 && typeof topCategory?.name === 'string') {
    addCandidate(candidate({
      type: 'category', key: topCategory.name, entity: topCategory.name,
      priority: topCategoryShare >= 0.75 ? 'high' : 'medium', reasonCode: 'category_concentrated',
      title: `Revisar la concentración de ${topCategory.name}`,
      evidenceKeys: [`assortment.category:${topCategory.name}`, 'assortment.metric:topCategoryShare'],
      metrics: { currentShare: topCategoryShare, topProductShare: asFinite(topCategory.topProductShare) },
      recommendationType: 'investigation'
    }));
  }

  if (coverage.assortmentComparisonAvailable === true) {
    (Array.isArray(assortment?.categoryOpportunities) ? assortment.categoryOpportunities : []).forEach((category) => {
      if (!category?.name || !Array.isArray(category.signals) || !category.signals.includes('category_growing')
        || !(asFinite(category.salesDelta) > 0)) return;
      addCandidate(candidate({
        type: 'category', key: category.name, entity: category.name, priority: 'medium', reasonCode: 'category_growing',
        title: `Evaluar cómo sostener ${category.name}`,
        evidenceKeys: [`assortment.category:${category.name}`],
        metrics: { currentSales: asFinite(category.netSales), salesDelta: asFinite(category.salesDelta), currentShare: asFinite(category.salesShare) },
        recommendationType: 'growth_experiment'
      }));
    });
  }

  const unsold = asFinite(assortmentHealth.unsoldProducts);
  if (unsold !== null && unsold > 0 && assortment?.health?.currentSalesCoverageComplete === true) {
    addCandidate(candidate({
      type: 'general', key: 'assortment_activity', priority: 'low', reasonCode: 'products_without_sales',
      title: 'Revisar productos activos sin venta registrada',
      evidenceKeys: ['assortment.metric:unsoldProducts'],
      metrics: { unsoldProducts: unsold }, recommendationType: 'investigation'
    }));
  }

  (coverage.itemsComplete === true && coverage.paginationComplete === true && coverage.sourceComplete === true
    ? (Array.isArray(comboOpportunities) ? comboOpportunities : []).slice(0, 3)
    : []).forEach((combo, index) => {
    if (!Array.isArray(combo.products) || combo.products.length !== 2 || asFinite(combo.tickets) === null) return;
    const key = `combo:${combo.products.map((name) => String(name).slice(0, 42)).join('|')}`.slice(0, 120);
    addCandidate(candidate({
      type: 'general', key, entity: combo.products.join(' + '), priority: combo.evidenceLevel === 'high' ? 'medium' : 'low',
      reasonCode: 'historical_combo', title: `Explorar el combo histórico ${combo.products.join(' + ')}`,
      evidenceKeys: [`comboOpportunities.${index}.tickets`, `comboOpportunities.${index}.frequency`],
      metrics: { tickets: asFinite(combo.tickets), frequency: asFinite(combo.frequency) }, recommendationType: 'growth_experiment'
    }));
  });

  const priorityRank = { high: 0, medium: 1, low: 2 };
  return candidates
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
      || left.type.localeCompare(right.type)
      || left.key.localeCompare(right.key, 'es'))
    .slice(0, 8);
};

const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });

export const formatCommercialMoney = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'no disponible'
  : currencyFormatter.format(Number(value));
export const formatCommercialNumber = (value, maximumFractionDigits = 2) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'no disponible'
  : new Intl.NumberFormat('es-MX', { maximumFractionDigits }).format(Number(value));

export const summarizeGoalSimulation = (goal = {}) => {
  if (!goal.ready) {
    return {
      executiveSummary: goal.limitation || 'No hay datos suficientes para calcular esta meta con confianza.',
      explanation: 'Los valores desconocidos permanecen como no disponibles y no se convierten en cero.'
    };
  }
  if (goal.type === 'revenue') {
    return goal.state === 'achieved'
      ? {
        executiveSummary: `La meta de ventas de ${formatCommercialMoney(goal.targetValue)} ya se alcanzó; llevas ${formatCommercialMoney(goal.currentSales)}.`,
        explanation: 'La meta está alcanzada. No se recomienda crecer más sólo por haber ejecutado esta simulación.'
      }
      : {
        executiveSummary: `Llevas ${formatCommercialMoney(goal.currentSales)} de una meta de ${formatCommercialMoney(goal.targetValue)}; la brecha es ${formatCommercialMoney(goal.revenueGap)}.`,
        explanation: goal.requiredAdditionalTicketsAtCurrentTicket === null
          ? 'No hay un ticket promedio positivo para traducir la brecha a tickets adicionales.'
          : `La brecha es ${formatCommercialNumber(goal.gapPercent, 1)}% de la meta. Manteniendo el ticket promedio actual de ${formatCommercialMoney(goal.currentAverageTicket)}, serían aproximadamente ${formatCommercialNumber(goal.requiredAdditionalTicketsAtCurrentTicket, 0)} tickets adicionales. Si mantuvieras el conteo actual, el ticket promedio requerido sería ${formatCommercialMoney(goal.requiredAverageTicketAtCurrentTicketCount)}.`
      };
  }
  if (goal.type === 'gross_profit') {
    return {
      executiveSummary: goal.state === 'achieved'
        ? `La meta de utilidad bruta de ${formatCommercialMoney(goal.targetProfit)} ya se alcanzó con ${formatCommercialMoney(goal.currentProfit)}.`
        : `La utilidad bruta actual es ${formatCommercialMoney(goal.currentProfit)}; la meta de ${formatCommercialMoney(goal.targetProfit)} deja una brecha de ${formatCommercialMoney(goal.profitGap)}.`,
      explanation: `Con mezcla y margen bruto actual constantes de ${formatCommercialNumber(goal.currentMargin * 100, 1)}%, las ventas requeridas serían ${formatCommercialMoney(goal.requiredRevenue)}. Este escenario no es una predicción.`
    };
  }
  if (goal.type === 'average_ticket') {
    return {
      executiveSummary: goal.state === 'achieved'
        ? `La meta de ticket promedio de ${formatCommercialMoney(goal.targetValue)} ya se alcanzó; el valor actual es ${formatCommercialMoney(goal.currentAverageTicket)}.`
        : `El ticket promedio actual es ${formatCommercialMoney(goal.currentAverageTicket)} y la meta es ${formatCommercialMoney(goal.targetValue)}.`,
      explanation: goal.state === 'achieved'
        ? 'La meta está alcanzada. No se recomienda bajar el ticket sólo por haber ejecutado esta simulación.'
        : `Manteniendo los ${formatCommercialNumber(goal.currentTickets, 0)} tickets actuales, las ventas totales serían ${formatCommercialMoney(goal.requiredSalesAtCurrentTicketCount)}; el incremento matemático sería ${formatCommercialMoney(goal.salesIncreaseAtCurrentTicketCount)}.`
    };
  }
  if (goal.type === 'gross_margin') {
    return {
      executiveSummary: goal.state === 'achieved'
        ? `La meta de margen bruto de ${formatCommercialNumber(goal.targetValue, 1)}% ya se alcanzó; el margen actual es ${formatCommercialNumber(goal.currentMargin * 100, 1)}%.`
        : `El margen bruto actual es ${formatCommercialNumber(goal.currentMargin * 100, 1)}% y la meta es ${formatCommercialNumber(goal.targetValue, 1)}%.`,
      explanation: goal.state === 'achieved'
        ? `La utilidad requerida sobre las ventas actuales sería ${formatCommercialMoney(goal.requiredProfitAtCurrentSales)}; la utilidad observada la supera por ${formatCommercialMoney(Math.abs(goal.additionalProfitRequired))}. El cálculo no determina una receta causal.`
        : `Con ventas actuales de ${formatCommercialMoney(goal.currentSales)}, la utilidad requerida sería ${formatCommercialMoney(goal.requiredProfitAtCurrentSales)}, una brecha de ${formatCommercialMoney(goal.additionalProfitRequired)}. El cálculo no determina si cambiar precio, costo o mezcla lo lograría.`
    };
  }
  return {
    executiveSummary: goal.state === 'achieved'
      ? `${goal.productName} ya supera la meta de margen de ${formatCommercialNumber(goal.targetValue, 1)}% con un margen actual de ${formatCommercialNumber((goal.currentMargin ?? 0) * 100, 1)}%.`
      : `${goal.productName}: precio promedio histórico ${formatCommercialMoney(goal.currentPrice)}, costo unitario ${formatCommercialMoney(goal.unitCost)} y margen actual ${formatCommercialNumber((goal.currentMargin ?? 0) * 100, 1)}%.`,
    explanation: `El precio matemático para un margen de ${formatCommercialNumber(goal.targetValue, 1)}% sería ${formatCommercialMoney(goal.requiredPrice)} (diferencia ${formatCommercialMoney(goal.priceDifference)}). No cambia el precio real ni predice demanda.`
  };
};

export const summarizeWhatIfAnalysis = (simulation = {}) => {
  if (!simulation.ready) {
    return {
      executiveSummary: simulation.limitations?.[1] || 'No hay datos históricos suficientes para construir este escenario.',
      explanation: 'Completa los parámetros y usa productos con ventas históricas para calcularlo.'
    };
  }
  const label = simulation.changeType === 'sales' ? 'ventas'
    : simulation.changeType === 'ticket' ? 'ticket promedio'
      : `ventas de ${simulation.productName}`;
  const currentValue = simulation.currentSales ?? simulation.historicalSales;
  return {
    executiveSummary: `${label}: de ${formatCommercialMoney(currentValue)} a ${formatCommercialMoney(simulation.simulatedSales)} (${simulation.changePercent > 0 ? '+' : ''}${formatCommercialNumber(simulation.changePercent)}%).`,
    explanation: simulation.changeType === 'product'
      ? `Las unidades pasarían matemáticamente de ${formatCommercialNumber(simulation.historicalUnits)} a ${formatCommercialNumber(simulation.simulatedUnits)} al precio promedio histórico. No se predice demanda.`
      : simulation.changeType === 'ticket'
        ? `Supone el mismo número de ${formatCommercialNumber(simulation.ticketCount, 0)} tickets y la estructura de margen disponible. No se predice demanda.`
        : 'La simulación escala ventas y, sólo con costos completos, también la estructura de margen. No es un pronóstico.'
  };
};
