// src/store/useStatsStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
// Asegúrate que esta ruta apunte a tu nuevo index
import { loadData, saveData, saveBulk, deleteData, STORES, initDB } from '../services/db/index';
import StatsWorker from '../workers/stats.worker.js?worker';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';

// --- HELPER 1: Obtener Valor de Inventario Híbrido (Versión Dexie) ---
async function getInventoryValueOptimized(db) {
  const cached = await loadData(STORES.STATS, 'inventory_summary');

  if (cached && typeof cached.value === 'number') {
    return { value: cached.value, productCostMap: new Map() };
  }

  Logger.log("⚠️ Calculando valor de inventario desde cero...");

  let calculatedValue = Money.init(0);
  const productCostMap = new Map();

  // Usamos transacción de Dexie ('r' = readonly)
  await db.transaction('r', [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)], async () => {

    // 1. Sumar Lotes Activos
    await db.table(STORES.PRODUCT_BATCHES).filter(batch => batch.isActive && batch.stock > 0).each(batch => {
      const batchValue = Money.multiply(batch.cost, batch.stock);
      calculatedValue = Money.add(calculatedValue, batchValue);
    });

    // 2. Sumar Productos sin Lotes (Simples) y llenar Mapa de Costos
    await db.table(STORES.MENU).each(p => {
      // Guardar costo para cálculos de ventas históricas
      productCostMap.set(p.id, p.cost || 0);

      // Si NO usa lotes y tiene stock, sumamos al valor usando Money SIEMPRE
      if (!p.batchManagement?.enabled && p.trackStock && p.stock > 0) {
        const pValue = Money.multiply(p.cost || 0, p.stock);
        calculatedValue = Money.add(calculatedValue, pValue);
      }
    });
  });

  const finalValueNum = calculatedValue.round(2).toNumber();
  await saveData(STORES.STATS, { id: 'inventory_summary', value: finalValueNum });
  return { value: finalValueNum, productCostMap };
}

// --- HELPER 2: Reconstrucción Inteligente de Historial (Versión Dexie) ---
async function rebuildDailyStatsFromSales(db, productCostMap) {
  Logger.log("⚠️ Reparando historial de ganancias y ventas...");
  const dailyMap = new Map();

  await db.table(STORES.SALES).each(sale => {
    if (sale.fulfillmentStatus !== 'cancelled') {
      const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          id: dateKey,
          date: dateKey,
          revenue: Money.init(0),
          profit: Money.init(0),
          orders: 0,
          itemsSold: Money.init(0),
          hasMissingCosts: false // <-- FLAG DE AUDITORÍA FINANCIERA
        });
      }

      const dayStat = dailyMap.get(dateKey);
      dayStat.revenue = Money.add(dayStat.revenue, sale.total || 0);
      dayStat.orders += 1;

      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const qty = Money.init(item.quantity || 0);
          dayStat.itemsSold = Money.add(dayStat.itemsSold, qty);

          const realId = item.parentId || item.id;

          // REGLA: Detectar costo faltante vs costo cero legítimo
          let rawCost = item.cost ?? productCostMap.get(realId);

          if (rawCost === null || rawCost === undefined) {
            dayStat.hasMissingCosts = true;
            Logger.warn(`[Auditoría] Costo huérfano en producto ID: ${realId}. La ganancia del día ${dateKey} será inexacta.`);
            rawCost = 0; // Fallback matemático para no devolver NaN
          }

          const itemCost = Money.init(rawCost);
          const itemPrice = Money.init(item.price || 0);

          const unitProfit = Money.subtract(itemPrice, itemCost);
          const lineProfit = Money.multiply(unitProfit, qty);

          dayStat.profit = Money.add(dayStat.profit, lineProfit);
        });
      }
    }
  });

  // Delegamos la conversión estrictamente al wrapper Money
  const dailyStatsArray = Array.from(dailyMap.values()).map(stat => ({
    ...stat,
    revenue: Money.toNumber(stat.revenue),
    profit: Money.toNumber(stat.profit),
    // Para el granel mantenemos 3 decimales usando la API segura (si no la tienes en el wrapper, extraemos el valor primitivo)
    itemsSold: Number(stat.itemsSold.round(3).toString())
  }));

  if (dailyStatsArray.length > 0) {
    await saveBulk(STORES.DAILY_STATS, dailyStatsArray);
  }
  return dailyStatsArray;
}

export const useStatsStore = create((set, get) => ({
  stats: {
    totalRevenue: 0,
    totalItemsSold: 0,
    totalNetProfit: 0,
    totalOrders: 0,
    inventoryValue: null
  },
  isLoading: false,

  forceRecalculate: async () => {
    const db = await initDB();
    await deleteData(STORES.STATS, 'inventory_summary');
    await get().loadStats(true); // true = forzar reparación
  },

  loadStats: async (forceRebuild = false) => {
    set({ isLoading: true });

    try {
      // 1. Lanzar Worker para Inventario (En paralelo)
      const workerPromise = new Promise((resolve) => {
        const worker = new StatsWorker();

        worker.onmessage = (e) => {
          const { success, type, payload, error } = e.data;
          if (success && type === 'STATS_RESULT') {
            resolve(payload.inventoryValue);
            worker.terminate();
          } else if (!success || type === 'ERROR') {
            Logger.error("Worker reportó un error:", error);
            resolve(null); // <-- 2. Resolver como null explícito
            worker.terminate();
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          Logger.error("Worker falló al iniciar:", err);
          resolve(null); // <-- 3. Resolver como null explícito
        };

        worker.postMessage({ type: 'CALCULATE_STATS' });
      });

      // 2. Cargar y Sumar Historial de Ventas (En el hilo principal)
      const db = await initDB();
      let dailyStats = await loadData(STORES.DAILY_STATS);

      const hasDailyStats = dailyStats && dailyStats.length > 0;

      if (forceRebuild || !hasDailyStats) {
        const salesCount = await db.table(STORES.SALES).count();
        if (salesCount > 0) {
          const { productCostMap } = await getInventoryValueOptimized(db);
          dailyStats = await rebuildDailyStatsFromSales(db, productCostMap);
        }
      }

      // 3. Sumar los totales globales usando Money para evitar descuadres en arrays grandes
      let totalRev = Money.init(0);
      let totalProf = Money.init(0);
      let totalItems = Money.init(0);
      let totalOrders = 0;

      (dailyStats || []).forEach(day => {
        totalRev = Money.add(totalRev, day.revenue || 0);
        totalProf = Money.add(totalProf, day.profit || 0);
        totalItems = Money.add(totalItems, day.itemsSold || 0);
        totalOrders += (day.orders || 0);
      });

      // 4. Esperar el resultado del inventario
      const inventoryValue = await workerPromise;

      // 5. Actualizar el estado extrayendo los Numbers
      set({
        stats: {
          totalRevenue: totalRev.round(2).toNumber(),
          totalNetProfit: totalProf.round(2).toNumber(),
          totalOrders: totalOrders,
          totalItemsSold: totalItems.round(3).toNumber(),
          inventoryValue: inventoryValue
        },
        isLoading: false
      });

    } catch (error) {
      Logger.error("Error cargando estadísticas completas:", error);
      set({ isLoading: false });
    }
  },

  adjustInventoryValue: async (costDelta) => {
    if (costDelta === 0) return;
    try {
      const currentStats = get().stats;

      if (currentStats.inventoryValue === null) {
        Logger.warn("Se omitió el ajuste de inventario porque el valor base es desconocido (error previo).");
        return; 
      }

      // Restar/Sumar de forma segura
      let newValue = Money.add(currentStats.inventoryValue, costDelta);
      if (newValue.lt(0)) newValue = Money.init(0);

      const finalValueNum = newValue.round(2).toNumber();

      await saveData(STORES.STATS, { id: 'inventory_summary', value: finalValueNum });
      set({ stats: { ...currentStats, inventoryValue: finalValueNum } });
    } catch (e) { Logger.error("Error adjusting inventory:", e); }
  },

  updateStatsForNewSale: async (sale, costOfGoodsSold) => {
    try {
      const currentStats = get().stats;
      let saleProfit = Money.init(0);
      let itemsCount = Money.init(0);
      let hasMissingCostsThisSale = false; // <-- Nuevo control

      sale.items.forEach(item => {
        const qty = Money.init(item.quantity || 0);
        itemsCount = Money.add(itemsCount, qty);

        let rawCost = item.cost;
        if (rawCost === null || rawCost === undefined) {
          hasMissingCostsThisSale = true;
          rawCost = 0;
        }

        const itemCost = Money.init(rawCost);
        const itemPrice = Money.init(item.price || 0);

        const lineTotal = Money.multiply(itemPrice, qty);
        const lineCost = Money.multiply(itemCost, qty);

        const lineProfit = Money.subtract(lineTotal, lineCost);
        saleProfit = Money.add(saleProfit, lineProfit);
      });

      let newInventoryValue = null;
      
      if (currentStats.inventoryValue !== null) {
        newInventoryValue = Money.subtract(currentStats.inventoryValue, costOfGoodsSold);
        if (newInventoryValue.lt(0)) newInventoryValue = Money.init(0);
        newInventoryValue = Money.toNumber(newInventoryValue);
      }

      // Limpiamos las fugas de .round(2).toNumber()
      const newStats = {
        totalRevenue: Money.toNumber(Money.add(currentStats.totalRevenue, sale.total)),
        totalNetProfit: Money.toNumber(Money.add(currentStats.totalNetProfit, saleProfit)),
        totalOrders: currentStats.totalOrders + 1,
        totalItemsSold: Number(Money.add(currentStats.totalItemsSold, itemsCount).round(3).toString()),
        inventoryValue: newInventoryValue,
        // Si ya estaba manchado a nivel global, o esta venta lo mancha, se propaga el flag
        hasMissingCosts: currentStats.hasMissingCosts || hasMissingCostsThisSale
      };

      set({ stats: newStats });
      
      if (newInventoryValue !== null) {
        await saveData(STORES.STATS, { id: 'inventory_summary', value: newStats.inventoryValue });
      }

    } catch (error) {
      Logger.error("Error updating stats:", error);
    }
  }
}));