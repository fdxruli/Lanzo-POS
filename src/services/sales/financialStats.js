import { Money } from '../../utils/moneyMath';
import { getFinancialQuality, getLineRevenue, isMissingUnitCost, normalizeFinancialNumber } from './financialPolicy';

export const SALE_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
  REQUIRES_REVIEW: 'requires_review'
});

export const getLegacyFinancialSaleStatus = (sale) => (
  sale?.fulfillmentStatus === 'cancelled'
    ? SALE_STATUS.CANCELLED
    : SALE_STATUS.CLOSED
);

export const isFinanciallyClosedSale = (sale) => sale?.status === SALE_STATUS.CLOSED;

export async function buildProductCostMap(db, stores) {
  const productCostMap = new Map();

  await db.table(stores.MENU).each((product) => {
    productCostMap.set(product.id, product.cost || 0);
  });

  return productCostMap;
}

export function buildDailyStatsFromSales(sales, productCostMap = new Map(), _logger = console) {
  const dailyMap = new Map();

  (sales || []).forEach((sale) => {
    if (!isFinanciallyClosedSale(sale)) return;

    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        id: dateKey,
        date: dateKey,
        revenue: Money.init(0),
        validRevenue: Money.init(0),
        unconfirmedRevenue: Money.init(0),
        unreliableProfitDueToMissingCosts: Money.init(0),
        profit: Money.init(0),
        orders: 0,
        itemsSold: Money.init(0),
        hasMissingCosts: false
      });
    }

    const dayStat = dailyMap.get(dateKey);
    dayStat.revenue = Money.add(dayStat.revenue, normalizeFinancialNumber(sale.total || 0));
    dayStat.orders += 1;

    if (!Array.isArray(sale.items)) return;

    sale.items.forEach((item) => {
      const qty = Money.init(item.quantity || 0);
      dayStat.itemsSold = Money.add(dayStat.itemsSold, qty);

      const lineRevenue = getLineRevenue(item);
      const realId = item.parentId || item.id;
      const rawCost = item.cost ?? productCostMap.get(realId);
      const unitCost = normalizeFinancialNumber(rawCost);

      if (isMissingUnitCost(rawCost)) {
        dayStat.hasMissingCosts = true;
        dayStat.unconfirmedRevenue = Money.add(dayStat.unconfirmedRevenue, lineRevenue);
        dayStat.unreliableProfitDueToMissingCosts = Money.add(
          dayStat.unreliableProfitDueToMissingCosts,
          lineRevenue
        );
        return;
      }

      dayStat.validRevenue = Money.add(dayStat.validRevenue, lineRevenue);
      const lineCost = Money.multiply(unitCost, qty);
      const lineProfit = Money.subtract(lineRevenue, lineCost);
      dayStat.profit = Money.add(dayStat.profit, lineProfit);
    });
  });

  return Array.from(dailyMap.values()).map((stat) => {
    const validRevenue = Money.toNumber(stat.validRevenue);
    const unconfirmedRevenue = Money.toNumber(stat.unconfirmedRevenue);

    return {
      ...stat,
      revenue: Money.toNumber(stat.revenue),
      validRevenue,
      unconfirmedRevenue,
      unreliableProfitDueToMissingCosts: Money.toNumber(stat.unreliableProfitDueToMissingCosts),
      profit: Money.toNumber(stat.profit),
      itemsSold: Number(stat.itemsSold.round(3).toString()),
      ...getFinancialQuality(validRevenue, unconfirmedRevenue)
    };
  });
}

export async function rebuildDailyStatsCacheFromSales(db, stores, productCostMap = new Map(), logger = console) {
  const sales = await db.table(stores.SALES).toArray();
  const dailyStatsArray = buildDailyStatsFromSales(sales, productCostMap, logger);

  await db.transaction('rw', [db.table(stores.DAILY_STATS)], async () => {
    await db.table(stores.DAILY_STATS).clear();

    if (dailyStatsArray.length > 0) {
      await db.table(stores.DAILY_STATS).bulkPut(dailyStatsArray);
    }
  });

  return dailyStatsArray;
}
