// src/store/useStatsStore.js
import { create } from 'zustand';
import { loadData, saveData, deleteData, STORES, initDB } from '../services/db/index';
import StatsWorker from '../workers/stats.worker.js?worker';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import {
  buildDailyStatsFromSales,
  buildProductCostMap,
  isFinanciallyClosedSale,
  rebuildDailyStatsCacheFromSales
} from '../services/sales/financialStats';

async function getInventoryValueOptimized(db) {
  const productCostMap = await buildProductCostMap(db, STORES);
  const cached = await loadData(STORES.STATS, 'inventory_summary');

  if (cached && typeof cached.value === 'number') {
    return { value: cached.value, productCostMap };
  }

  Logger.log('Calculando valor de inventario desde cero...');

  let calculatedValue = Money.init(0);

  await db.transaction('r', [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)], async () => {
    await db.table(STORES.PRODUCT_BATCHES)
      .filter(batch => batch.isActive && batch.stock > 0)
      .each((batch) => {
        const batchValue = Money.multiply(batch.cost, batch.stock);
        calculatedValue = Money.add(calculatedValue, batchValue);
      });

    await db.table(STORES.MENU).each((product) => {
      if (!product.batchManagement?.enabled && product.trackStock && product.stock > 0) {
        const productValue = Money.multiply(product.cost || 0, product.stock);
        calculatedValue = Money.add(calculatedValue, productValue);
      }
    });
  });

  const finalValueNum = calculatedValue.round(2).toNumber();
  await saveData(STORES.STATS, { id: 'inventory_summary', value: finalValueNum });
  return { value: finalValueNum, productCostMap };
}

async function persistDailyStatsForSale(sale, productCostMap) {
  const [saleDayStat] = buildDailyStatsFromSales([sale], productCostMap, Logger);

  if (!saleDayStat) {
    return null;
  }

  const existingDay = await loadData(STORES.DAILY_STATS, saleDayStat.id);
  if (!existingDay) {
    await saveData(STORES.DAILY_STATS, saleDayStat);
    return saleDayStat;
  }

  const mergedDay = {
    ...existingDay,
    id: saleDayStat.id,
    date: saleDayStat.date,
    revenue: Money.toNumber(Money.add(existingDay.revenue || 0, saleDayStat.revenue || 0)),
    profit: Money.toNumber(Money.add(existingDay.profit || 0, saleDayStat.profit || 0)),
    orders: (existingDay.orders || 0) + (saleDayStat.orders || 0),
    itemsSold: Number(Money.add(existingDay.itemsSold || 0, saleDayStat.itemsSold || 0).round(3).toString()),
    hasMissingCosts: Boolean(existingDay.hasMissingCosts || saleDayStat.hasMissingCosts)
  };

  await saveData(STORES.DAILY_STATS, mergedDay);
  return saleDayStat;
}

export const useStatsStore = create((set, get) => ({
  stats: {
    totalRevenue: 0,
    totalItemsSold: 0,
    totalNetProfit: 0,
    totalOrders: 0,
    inventoryValue: null,
    hasMissingCosts: false
  },
  isLoading: false,

  forceRecalculate: async () => {
    await deleteData(STORES.STATS, 'inventory_summary');
    await get().loadStats(true);
  },

  rebuildFinancialStats: async () => {
    try {
      const db = await initDB();
      const productCostMap = await buildProductCostMap(db, STORES);
      await rebuildDailyStatsCacheFromSales(db, STORES, productCostMap, Logger);
      await get().loadStats(false);
    } catch (error) {
      Logger.error('Error reconstruyendo metricas financieras:', error);
      throw error;
    }
  },

  loadStats: async (forceRebuild = false) => {
    set({ isLoading: true });

    try {
      const workerPromise = new Promise((resolve) => {
        const worker = new StatsWorker();

        worker.onmessage = (event) => {
          const { success, type, payload, error } = event.data;
          if (success && type === 'STATS_RESULT') {
            resolve(payload.inventoryValue);
            worker.terminate();
            return;
          }

          Logger.error('Worker reporto un error:', error);
          resolve(null);
          worker.terminate();
        };

        worker.onerror = (error) => {
          worker.terminate();
          Logger.error('Worker fallo al iniciar:', error);
          resolve(null);
        };

        worker.postMessage({ type: 'CALCULATE_STATS' });
      });

      const db = await initDB();
      let dailyStats = await loadData(STORES.DAILY_STATS);
      const hasDailyStats = Array.isArray(dailyStats) && dailyStats.length > 0;

      if (forceRebuild || !hasDailyStats) {
        const { productCostMap } = await getInventoryValueOptimized(db);
        dailyStats = await rebuildDailyStatsCacheFromSales(db, STORES, productCostMap, Logger);
      }

      let totalRevenue = Money.init(0);
      let totalNetProfit = Money.init(0);
      let totalItemsSold = Money.init(0);
      let totalOrders = 0;
      let hasMissingCosts = false;

      (dailyStats || []).forEach((day) => {
        totalRevenue = Money.add(totalRevenue, day.revenue || 0);
        totalNetProfit = Money.add(totalNetProfit, day.profit || 0);
        totalItemsSold = Money.add(totalItemsSold, day.itemsSold || 0);
        totalOrders += (day.orders || 0);
        hasMissingCosts = hasMissingCosts || Boolean(day.hasMissingCosts);
      });

      const inventoryValue = await workerPromise;

      set({
        stats: {
          totalRevenue: totalRevenue.round(2).toNumber(),
          totalNetProfit: totalNetProfit.round(2).toNumber(),
          totalOrders,
          totalItemsSold: totalItemsSold.round(3).toNumber(),
          inventoryValue,
          hasMissingCosts
        },
        isLoading: false
      });
    } catch (error) {
      Logger.error('Error cargando estadisticas completas:', error);
      set({ isLoading: false });
    }
  },

  adjustInventoryValue: async (costDelta) => {
    if (costDelta === 0) return;

    try {
      const currentStats = get().stats;

      if (currentStats.inventoryValue === null) {
        Logger.warn('Se omitio el ajuste de inventario porque el valor base es desconocido.');
        return;
      }

      let newValue = Money.add(currentStats.inventoryValue, costDelta);
      if (newValue.lt(0)) newValue = Money.init(0);

      const finalValueNum = newValue.round(2).toNumber();
      await saveData(STORES.STATS, { id: 'inventory_summary', value: finalValueNum });
      set({ stats: { ...currentStats, inventoryValue: finalValueNum } });
    } catch (error) {
      Logger.error('Error adjusting inventory:', error);
    }
  },

  updateStatsForNewSale: async (sale, costOfGoodsSold) => {
    if (!isFinanciallyClosedSale(sale)) {
      return;
    }

    try {
      const db = await initDB();
      const productCostMap = await buildProductCostMap(db, STORES);
      const saleDayStat = await persistDailyStatsForSale(sale, productCostMap);

      if (!saleDayStat) {
        return;
      }

      const currentStats = get().stats;
      let newInventoryValue = null;

      if (currentStats.inventoryValue !== null) {
        newInventoryValue = Money.subtract(currentStats.inventoryValue, costOfGoodsSold);
        if (newInventoryValue.lt(0)) newInventoryValue = Money.init(0);
        newInventoryValue = Money.toNumber(newInventoryValue);
      }

      const newStats = {
        totalRevenue: Money.toNumber(Money.add(currentStats.totalRevenue, saleDayStat.revenue)),
        totalNetProfit: Money.toNumber(Money.add(currentStats.totalNetProfit, saleDayStat.profit)),
        totalOrders: currentStats.totalOrders + (saleDayStat.orders || 0),
        totalItemsSold: Number(Money.add(currentStats.totalItemsSold, saleDayStat.itemsSold).round(3).toString()),
        inventoryValue: newInventoryValue,
        hasMissingCosts: Boolean(currentStats.hasMissingCosts || saleDayStat.hasMissingCosts)
      };

      set({ stats: newStats });

      if (newInventoryValue !== null) {
        await saveData(STORES.STATS, { id: 'inventory_summary', value: newStats.inventoryValue });
      }
    } catch (error) {
      Logger.error('Error updating stats:', error);
    }
  }
}));
