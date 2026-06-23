import { Money } from '../../utils/moneyMath';

export const FINANCIAL_QUALITY_THRESHOLDS = Object.freeze({
  WARNING_MISSING_REVENUE_PCT: 10,
  BLOCKING_MISSING_REVENUE_PCT: 15
});

export const normalizeFinancialNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    const cleaned = trimmed.replace(/[^0-9.-]+/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return Number.NaN;
    return Number(cleaned);
  }

  return Number(value);
};

export const isMissingUnitCost = (cost) => {
  if (cost === null || cost === undefined || cost === '') return true;

  const numericCost = normalizeFinancialNumber(cost);
  return !Number.isFinite(numericCost) || numericCost <= 0;
};

export const getLineRevenue = (item = {}) => {
  const qty = Money.init(normalizeFinancialNumber(item.quantity || 0));

  return item.exactTotal !== undefined && item.exactTotal !== null
    ? Money.init(normalizeFinancialNumber(item.exactTotal))
    : Money.multiply(normalizeFinancialNumber(item.price || 0), qty);
};

export const getFinancialQuality = (confirmedRevenue, unconfirmedRevenue) => {
  const confirmed = Number(confirmedRevenue || 0);
  const unconfirmed = Number(unconfirmedRevenue || 0);
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

export const summarizeFinancialSales = (sales = [], productCostMap = new Map()) => {
  const totals = {
    totalRevenue: Money.init(0),
    confirmedRevenue: Money.init(0),
    unconfirmedRevenue: Money.init(0),
    confirmedCost: Money.init(0),
    confirmedProfit: Money.init(0),
    unreliableProfitDueToMissingCosts: Money.init(0),
    totalDiscounts: Money.init(0),
    itemsSold: Money.init(0),
    missingCostItems: Money.init(0)
  };

  (sales || []).forEach((sale) => {
    totals.totalRevenue = Money.add(totals.totalRevenue, normalizeFinancialNumber(sale?.total || 0));
    totals.totalDiscounts = Money.add(totals.totalDiscounts, normalizeFinancialNumber(sale?.discount || 0));

    if (!Array.isArray(sale?.items)) return;

    sale.items.forEach((item = {}) => {
      const qty = Money.init(normalizeFinancialNumber(item.quantity || 0));
      const lineRevenue = getLineRevenue(item);
      const realId = item.parentId || item.id;
      const rawCost = item.cost ?? productCostMap.get(realId);
      const unitCost = normalizeFinancialNumber(rawCost);

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
    });
  });

  const confirmedRevenue = Money.toNumber(totals.confirmedRevenue);
  const unconfirmedRevenue = Money.toNumber(totals.unconfirmedRevenue);
  const quality = getFinancialQuality(confirmedRevenue, unconfirmedRevenue);
  const confirmedMarginPct = confirmedRevenue > 0
    ? (Money.toNumber(totals.confirmedProfit) / confirmedRevenue) * 100
    : 0;

  return {
    totalRevenue: Money.toNumber(totals.totalRevenue),
    confirmedRevenue,
    unconfirmedRevenue,
    confirmedCost: Money.toNumber(totals.confirmedCost),
    confirmedProfit: Money.toNumber(totals.confirmedProfit),
    unreliableProfitDueToMissingCosts: Money.toNumber(totals.unreliableProfitDueToMissingCosts),
    confirmedMarginPct,
    totalDiscounts: Money.toNumber(totals.totalDiscounts),
    itemsSold: Number(totals.itemsSold.round(3).toString()),
    missingCostItems: Number(totals.missingCostItems.round(3).toString()),
    ...quality
  };
};
