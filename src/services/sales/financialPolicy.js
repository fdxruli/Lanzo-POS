import { Money } from '../../utils/moneyMath';

export const FINANCIAL_QUALITY_THRESHOLDS = Object.freeze({
  WARNING_MISSING_REVENUE_PCT: 10,
  BLOCKING_MISSING_REVENUE_PCT: 15
});

export const SALE_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  CANCELLED: 'cancelled'
});

export const PAYMENT_METHODS = Object.freeze({
  CASH: 'efectivo',
  CREDIT: 'fiado',
  CARD: 'tarjeta',
  TRANSFER: 'transferencia'
});

export const normalizeFinancialNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    const cleaned = trimmed.replace(/[^0-9.-]+/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return Number.NaN;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  try {
    const parsed = Money.toNumber(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
};

export const isMissingUnitCost = (cost) => {
  if (cost === null || cost === undefined || cost === '') return true;

  const numericCost = normalizeFinancialNumber(cost, Number.NaN);
  return !Number.isFinite(numericCost) || numericCost <= 0;
};

const isClosedSale = (sale = {}) => sale.status === SALE_STATUS.CLOSED || sale.status === 'completed';
const isCancelledSale = (sale = {}) => sale.status === SALE_STATUS.CANCELLED;

const getLineSubtotal = (item = {}) => {
  if (item.exactTotal !== undefined && item.exactTotal !== null) return Money.init(normalizeFinancialNumber(item.exactTotal));
  if (item.lineSubtotal !== undefined && item.lineSubtotal !== null) return Money.init(normalizeFinancialNumber(item.lineSubtotal));
  if (item.subtotal !== undefined && item.subtotal !== null) return Money.init(normalizeFinancialNumber(item.subtotal));
  return Money.multiply(normalizeFinancialNumber(item.price || 0), normalizeFinancialNumber(item.quantity || 0));
};

const getLineDiscount = (item = {}) => {
  const discount = item.discount && typeof item.discount === 'object' ? item.discount.amount : item.discount;
  return Money.init(normalizeFinancialNumber(item.discountAmount ?? item.discount_amount ?? discount, 0));
};

export const getLineRevenue = (item = {}) => {
  if (item.lineTotal !== undefined && item.lineTotal !== null) return Money.init(normalizeFinancialNumber(item.lineTotal));
  if (item.line_total !== undefined && item.line_total !== null) return Money.init(normalizeFinancialNumber(item.line_total));

  const subtotal = getLineSubtotal(item);
  const discount = getLineDiscount(item);
  const net = Money.subtract(subtotal, discount);
  return net.lt(0) ? Money.init(0) : net;
};

export const getFinancialQuality = (confirmedRevenue, unconfirmedRevenue) => {
  const confirmed = normalizeFinancialNumber(confirmedRevenue, 0);
  const unconfirmed = normalizeFinancialNumber(unconfirmedRevenue, 0);
  const revenueWithCostSignal = confirmed + unconfirmed;

  if (revenueWithCostSignal <= 0) {
    return {
      reportReliabilityPct: 100,
      missingCostRevenuePct: 0,
      qualityStatus: 'ok',
      hasMissingCosts: false,
      shouldWarn: false,
      shouldBlockProfitAnalysis: false
    };
  }

  const missingCostRevenuePct = (unconfirmed / revenueWithCostSignal) * 100;
  const reportReliabilityPct = 100 - missingCostRevenuePct;
  const shouldBlockProfitAnalysis =
    missingCostRevenuePct > FINANCIAL_QUALITY_THRESHOLDS.BLOCKING_MISSING_REVENUE_PCT;
  const shouldWarn =
    shouldBlockProfitAnalysis ||
    missingCostRevenuePct > FINANCIAL_QUALITY_THRESHOLDS.WARNING_MISSING_REVENUE_PCT;

  return {
    reportReliabilityPct,
    missingCostRevenuePct,
    qualityStatus: shouldBlockProfitAnalysis ? 'blocked' : shouldWarn ? 'warning' : 'ok',
    hasMissingCosts: unconfirmed > 0,
    shouldWarn,
    shouldBlockProfitAnalysis
  };
};

const getLineCost = (item = {}) => {
  const quantity = normalizeFinancialNumber(item.quantity, 0);
  const unitCost = normalizeFinancialNumber(item.cost ?? item.unitCost, 0);
  return Money.multiply(unitCost, quantity);
};

const getSaleDiscount = (sale = {}) => normalizeFinancialNumber(
  sale.discountTotal ?? sale.discount_total ?? sale.discount,
  0
);

export const summarizeFinancialSales = (sales = [], productCostMap = new Map()) => {
  const totals = {
    totalSales: 0,
    totalRevenue: Money.init(0),
    grossRevenue: Money.init(0),
    totalDiscounts: Money.init(0),
    totalCost: Money.init(0),
    grossProfit: Money.init(0),
    confirmedRevenue: Money.init(0),
    unconfirmedRevenue: Money.init(0),
    confirmedCost: Money.init(0),
    confirmedProfit: Money.init(0),
    unreliableProfitDueToMissingCosts: Money.init(0),
    itemsSold: Money.init(0),
    missingCostItems: Money.init(0)
  };

  (sales || []).forEach((sale = {}) => {
    if (!isClosedSale(sale) || isCancelledSale(sale)) return;

    totals.totalSales += 1;
    const items = Array.isArray(sale.items) ? sale.items : [];
    const saleGross = sale.subtotal !== undefined && sale.subtotal !== null
      ? Money.init(normalizeFinancialNumber(sale.subtotal))
      : items.reduce((sum, item) => Money.add(sum, getLineSubtotal(item)), Money.init(0));
    const saleNet = Money.init(normalizeFinancialNumber(
      sale.total,
      items.reduce((sum, item) => Money.toNumber(Money.add(sum, getLineRevenue(item))), 0)
    ));
    const saleDiscount = Money.init(getSaleDiscount(sale));

    totals.totalRevenue = Money.add(totals.totalRevenue, saleNet);
    totals.grossRevenue = Money.add(totals.grossRevenue, saleGross);
    totals.totalDiscounts = Money.add(totals.totalDiscounts, saleDiscount);

    items.forEach((item = {}) => {
      const qty = Money.init(normalizeFinancialNumber(item.quantity || 0));
      const lineRevenue = getLineRevenue(item);
      const realId = item.parentId || item.id;
      const rawCost = item.cost ?? productCostMap.get(realId);
      const unitCost = normalizeFinancialNumber(rawCost, 0);

      totals.itemsSold = Money.add(totals.itemsSold, qty);

      if (isMissingUnitCost(rawCost)) {
        totals.unconfirmedRevenue = Money.add(totals.unconfirmedRevenue, lineRevenue);
        totals.unreliableProfitDueToMissingCosts = Money.add(
          totals.unreliableProfitDueToMissingCosts,
          lineRevenue
        );
        totals.missingCostItems = Money.add(totals.missingCostItems, qty);
        return;
      }

      const lineCost = Money.multiply(unitCost, qty);
      totals.confirmedRevenue = Money.add(totals.confirmedRevenue, lineRevenue);
      totals.confirmedCost = Money.add(totals.confirmedCost, lineCost);
      totals.confirmedProfit = Money.add(totals.confirmedProfit, Money.subtract(lineRevenue, lineCost));
      totals.totalCost = Money.add(totals.totalCost, lineCost);
    });
  });

  const confirmedRevenue = Money.toNumber(totals.confirmedRevenue);
  const unconfirmedRevenue = Money.toNumber(totals.unconfirmedRevenue);
  const quality = getFinancialQuality(confirmedRevenue, unconfirmedRevenue);
  const totalRevenue = Money.toNumber(totals.totalRevenue);
  const totalCost = Money.toNumber(totals.totalCost);
  const confirmedMarginPct = confirmedRevenue > 0
    ? (Money.toNumber(totals.confirmedProfit) / confirmedRevenue) * 100
    : 0;

  return {
    totalSales: totals.totalSales,
    totalRevenue,
    grossRevenue: Money.toNumber(totals.grossRevenue),
    totalDiscounts: Money.toNumber(totals.totalDiscounts),
    totalCost,
    grossProfit: Money.toNumber(Money.subtract(totalRevenue, totalCost)),
    confirmedRevenue,
    unconfirmedRevenue,
    confirmedCost: Money.toNumber(totals.confirmedCost),
    confirmedProfit: Money.toNumber(totals.confirmedProfit),
    unreliableProfitDueToMissingCosts: Money.toNumber(totals.unreliableProfitDueToMissingCosts),
    confirmedMarginPct,
    itemsSold: Number(totals.itemsSold.round(3).toString()),
    missingCostItems: Number(totals.missingCostItems.round(3).toString()),
    ...quality
  };
};

export default {
  FINANCIAL_QUALITY_THRESHOLDS,
  PAYMENT_METHODS,
  SALE_STATUS,
  getFinancialQuality,
  getLineRevenue,
  isMissingUnitCost,
  normalizeFinancialNumber,
  summarizeFinancialSales
};
