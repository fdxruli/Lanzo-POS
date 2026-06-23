import { db, STORES } from './db/dexie';
import { isFinanciallyClosedSale } from './sales/financialStats';
import { Money } from '../utils/moneyMath';
import { getFinancialQuality, getLineRevenue, isMissingUnitCost, normalizeFinancialNumber } from './sales/financialPolicy';

const DEFAULT_REBUILD_WINDOW_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toIsoDateKey = (value) => new Date(value).toISOString().split('T')[0];

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const normalizeRebuildRange = ({
  startDate = null,
  endDate = null,
  days = DEFAULT_REBUILD_WINDOW_DAYS,
  fullHistory = false
} = {}) => {
  if (fullHistory) {
    return {
      fullHistory: true,
      startIso: null,
      endIso: null,
      startDateKey: null,
      endDateKey: null
    };
  }

  let effectiveStart;
  let effectiveEnd;

  if (startDate || endDate) {
    effectiveStart = startDate ? startOfDay(startDate) : new Date(0);
    effectiveEnd = endDate ? endOfDay(endDate) : endOfDay(new Date());
  } else {
    const safeDays = Math.max(1, Number(days) || DEFAULT_REBUILD_WINDOW_DAYS);
    effectiveEnd = endOfDay(new Date());
    effectiveStart = startOfDay(new Date(effectiveEnd.getTime() - ((safeDays - 1) * DAY_IN_MS)));
  }

  if (effectiveStart.getTime() > effectiveEnd.getTime()) {
    throw new Error('La fecha inicial no puede ser mayor a la fecha final.');
  }

  return {
    fullHistory: false,
    startIso: effectiveStart.toISOString(),
    endIso: effectiveEnd.toISOString(),
    startDateKey: toIsoDateKey(effectiveStart),
    endDateKey: toIsoDateKey(effectiveEnd)
  };
};

const loadSalesForRebuild = async ({ fullHistory, startIso, endIso }) => {
  if (fullHistory) {
    return db.table(STORES.SALES).toArray();
  }

  if (startIso && endIso) {
    return db.table(STORES.SALES)
      .where('timestamp')
      .between(startIso, endIso, true, true)
      .toArray();
  }

  if (startIso) {
    return db.table(STORES.SALES)
      .where('timestamp')
      .aboveOrEqual(startIso)
      .toArray();
  }

  if (endIso) {
    return db.table(STORES.SALES)
      .where('timestamp')
      .belowOrEqual(endIso)
      .toArray();
  }

  return db.table(STORES.SALES).toArray();
};

const buildDailyStatsFromTicketHistory = (sales = []) => {
  const dailyMap = new Map();
  let processedOrders = 0;
  let anomaliesFound = 0;

  (sales || []).forEach((sale) => {
    if (!isFinanciallyClosedSale(sale)) return;
    if (!sale?.timestamp || Number.isNaN(Date.parse(sale.timestamp))) return;

    processedOrders += 1;

    const dateKey = toIsoDateKey(sale.timestamp);
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
      const qty = Money.init(item?.quantity || 0);
      const qtyNumber = Number(qty.round(3).toString());
      const lineRevenue = getLineRevenue(item);
      const rawCost = item?.cost;
      const unitCost = normalizeFinancialNumber(rawCost);

      dayStat.itemsSold = Money.add(dayStat.itemsSold, qty);

      if (isMissingUnitCost(rawCost)) {
        dayStat.hasMissingCosts = true;
        dayStat.unconfirmedRevenue = Money.add(dayStat.unconfirmedRevenue, lineRevenue);
        dayStat.unreliableProfitDueToMissingCosts = Money.add(
          dayStat.unreliableProfitDueToMissingCosts,
          lineRevenue
        );
        anomaliesFound += qtyNumber > 0 ? qtyNumber : 0;
        return;
      }

      const lineCost = Money.multiply(unitCost, qty);
      dayStat.validRevenue = Money.add(dayStat.validRevenue, lineRevenue);
      dayStat.profit = Money.add(dayStat.profit, Money.subtract(lineRevenue, lineCost));
    });
  });

  return {
    processedOrders,
    anomaliesFound,
    dailyStats: Array.from(dailyMap.values()).map((stat) => ({
      ...stat,
      revenue: Money.toNumber(stat.revenue),
      validRevenue: Money.toNumber(stat.validRevenue),
      unconfirmedRevenue: Money.toNumber(stat.unconfirmedRevenue),
      unreliableProfitDueToMissingCosts: Money.toNumber(stat.unreliableProfitDueToMissingCosts),
      profit: Money.toNumber(stat.profit),
      itemsSold: Number(stat.itemsSold.round(3).toString()),
      ...getFinancialQuality(
        Money.toNumber(stat.validRevenue),
        Money.toNumber(stat.unconfirmedRevenue)
      )
    }))
  };
};

/**
 * HERRAMIENTA 1: SINCRONIZADOR MAESTRO DE STOCK
 * Corrige discrepancias entre: Stock del Producto Padre vs. Suma de sus Lotes.
 * La "Verdad Absoluta" serán siempre los Lotes (Batches).
 */
const fixStockInconsistencies = async () => {
  let corrections = 0;
  const log = [];

  try {
    await db.transaction('rw', [db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)], async () => {
      const allProducts = await db.table(STORES.MENU).toArray();

      for (const product of allProducts) {
        // Si el producto no gestiona stock, verificar si tiene lotes activos que purgar
        if (!product.trackStock) {
          const batches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId').equals(product.id)
            .toArray();

          const activeBatches = batches.filter(batch => batch.isActive);
          if (activeBatches.length > 0) {
            // Desactivar lotes huérfanos para que no inflen reportes de inventario
            for (const batch of activeBatches) {
              await db.table(STORES.PRODUCT_BATCHES).update(batch.id, {
                isActive: false,
                stock: 0,
                updatedAt: new Date().toISOString()
              });
              log.push(`Desactivado lote huérfano ${batch.id} del producto ${product.name}`);
            }
            corrections++;
          }
          continue;
        }

        const batches = await db.table(STORES.PRODUCT_BATCHES)
          .where('productId').equals(product.id)
          .toArray();

        if (!product.batchManagement?.enabled && batches.length === 0) {
          continue;
        }

        const realStock = batches
          .filter(batch => batch.isActive && batch.stock > 0)
          .reduce((sum, batch) => sum + Number(batch.stock), 0);

        const difference = Math.abs(product.stock - realStock);
        if (difference <= 0.001) continue;

        log.push(`Corregido ${product.name}: Decia ${product.stock}, Realidad ${realStock}`);

        await db.table(STORES.MENU).update(product.id, {
          stock: realStock,
          hasBatches: true,
          updatedAt: new Date().toISOString()
        });
        corrections++;
      }
    });

    return {
      success: true,
      message: `Se corrigieron ${corrections} productos con stock desfasado.`,
      details: log
    };
  } catch (error) {
    console.error('Error en fixStockInconsistencies:', error);
    return { success: false, message: error.message };
  }
};

/**
 * HERRAMIENTA 2: RECONSTRUCTOR DE GANANCIAS (HISTORICO)
 * Borra las estadisticas diarias y las reconstruye desde ventas cerradas.
 */
const rebuildDailyStats = async (options = {}) => {
  try {
    const range = normalizeRebuildRange(options);
    const sales = await loadSalesForRebuild(range);
    const {
      dailyStats,
      processedOrders,
      anomaliesFound
    } = buildDailyStatsFromTicketHistory(sales);

    await db.transaction('rw', [db.table(STORES.DAILY_STATS)], async () => {
      if (range.fullHistory) {
        await db.table(STORES.DAILY_STATS).clear();
      } else {
        await db.table(STORES.DAILY_STATS)
          .where('id')
          .between(range.startDateKey, range.endDateKey, true, true)
          .delete();
      }

      if (dailyStats.length > 0) {
        await db.table(STORES.DAILY_STATS).bulkPut(dailyStats);
      }
    });

    const rangeLabel = range.fullHistory
      ? 'todo el historial'
      : `${range.startDateKey} a ${range.endDateKey}`;
    const anomalyLabel = anomaliesFound > 0
      ? ` Se encontraron ${anomaliesFound} productos vendidos sin costo registrado; quedaron fuera de utilidad confirmada.`
      : '';

    return {
      success: true,
      processedOrders,
      anomaliesFound,
      range,
      message: `Historial reconstruido exitosamente para ${rangeLabel} (${processedOrders} ventas cerradas procesadas).${anomalyLabel}`
    };
  } catch (error) {
    console.error('Error en rebuildDailyStats:', error);
    return { success: false, message: error.message };
  }
};

/**
 * Objeto de herramientas de mantenimiento con nombres que coinciden con la UI
 */
export const maintenanceTools = {
  fixStock: fixStockInconsistencies,
  rebuildStats: rebuildDailyStats
};

// Exportaciones individuales para compatibilidad
export { fixStockInconsistencies, rebuildDailyStats };
