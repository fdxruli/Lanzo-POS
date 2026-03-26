import { Money } from '../../utils/moneyMath';

export const SALE_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  CANCELLED: 'cancelled'
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

export function buildDailyStatsFromSales(sales, productCostMap = new Map(), logger = console) {
  const dailyMap = new Map();

  (sales || []).forEach((sale) => {
    if (!isFinanciallyClosedSale(sale)) return;

    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        id: dateKey,
        date: dateKey,
        revenue: Money.init(0),
        validRevenue: Money.init(0), // Nuevo: ingresos aplicables a la ganancia
        profit: Money.init(0),
        orders: 0,
        itemsSold: Money.init(0),
        hasMissingCosts: false
      });
    }

    const dayStat = dailyMap.get(dateKey);
    dayStat.revenue = Money.add(dayStat.revenue, sale.total || 0);
    dayStat.orders += 1;

    if (!Array.isArray(sale.items)) return;

    sale.items.forEach((item) => {
      const qty = Money.init(item.quantity || 0);
      dayStat.itemsSold = Money.add(dayStat.itemsSold, qty);

      const lineRevenue = Money.multiply(item.price || 0, qty);
      const realId = item.parentId || item.id;
      let rawCost = item.cost ?? productCostMap.get(realId);

      // Exclusión Estricta: Si no hay costo o es exactamente 0
      if (rawCost === null || rawCost === undefined || rawCost === '' || Number(rawCost) === 0) {
        dayStat.hasMissingCosts = true;
      } else {
        dayStat.validRevenue = Money.add(dayStat.validRevenue, lineRevenue);
        const unitProfit = Money.subtract(item.price || 0, rawCost);
        const lineProfit = Money.multiply(unitProfit, qty);
        dayStat.profit = Money.add(dayStat.profit, lineProfit);
      }
    });
  });

  return Array.from(dailyMap.values()).map((stat) => ({
    ...stat,
    revenue: Money.toNumber(stat.revenue),
    validRevenue: Money.toNumber(stat.validRevenue), // Exportado al objeto final
    profit: Money.toNumber(stat.profit),
    itemsSold: Number(stat.itemsSold.round(3).toString())
  }));
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
