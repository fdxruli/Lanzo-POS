// src/store/useStatsStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
import { loadData, saveData, saveBulk, deleteData, STORES, initDB } from '../services/database';
import StatsWorker from '../workers/stats.worker.js?worker';
import Logger from '../services/Logger';

// --- HELPER 1: Obtener Valor de Inventario Híbrido ---
async function getInventoryValueOptimized(db) {
  const cached = await loadData(STORES.STATS, 'inventory_summary');

  if (cached && typeof cached.value === 'number') {
    return { value: cached.value, productCostMap: new Map() };
  }

  Logger.log("⚠️ Calculando valor de inventario desde cero...");

  let calculatedValue = 0;
  const productCostMap = new Map();

  const tx = db.transaction([STORES.PRODUCT_BATCHES, STORES.MENU], 'readonly');

  await new Promise((resolve, reject) => {
    const store = tx.objectStore(STORES.PRODUCT_BATCHES);
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const batch = cursor.value;
        if (batch.isActive && batch.stock > 0) {
          calculatedValue += roundCurrency(batch.cost * batch.stock);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });

  await new Promise((resolve, reject) => {
    const store = tx.objectStore(STORES.MENU);
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const p = cursor.value;
        productCostMap.set(p.id, p.cost || 0);
        if (!p.batchManagement?.enabled && p.trackStock && p.stock > 0) {
          calculatedValue += roundCurrency((p.cost || 0) * p.stock);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });

  await saveData(STORES.STATS, { id: 'inventory_summary', value: calculatedValue });
  return { value: calculatedValue, productCostMap };
}

// --- HELPER 2: Reconstrucción Inteligente de Historial ---
async function rebuildDailyStatsFromSales(db, productCostMap) {
  Logger.log("⚠️ Reparando historial de ganancias y ventas...");
  const dailyMap = new Map();

  await new Promise((resolve) => {
    const tx = db.transaction(STORES.SALES, 'readonly');
    const cursorReq = tx.objectStore(STORES.SALES).openCursor();

    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const sale = cursor.value;
        if (sale.fulfillmentStatus !== 'cancelled') {
          const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];

          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, { id:dateKey, date: dateKey, revenue: 0, profit: 0, orders: 0, itemsSold: 0 });
          }

          const dayStat = dailyMap.get(dateKey);
          dayStat.revenue += (sale.total || 0);
          dayStat.orders += 1;

          if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
              const qty = parseFloat(item.quantity) || 0;
              dayStat.itemsSold += qty;
              let itemCost = parseFloat(item.cost);
              if (isNaN(itemCost) || itemCost === 0) {
                const realId = item.parentId || item.id;
                itemCost = productCostMap.get(realId) || 0;
              }
              const itemPrice = parseFloat(item.price) || 0;
              const profit = roundCurrency(itemPrice - itemCost) * qty;
              dayStat.profit += profit;
            });
          }
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  const dailyStatsArray = Array.from(dailyMap.values());
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
    inventoryValue: 0
  },
  isLoading: false,

  forceRecalculate: async () => {
    const db = await initDB();
    await deleteData(STORES.STATS, 'inventory_summary');
    await get().loadStats(true); // true = forzar reparación
  },

  // --- FUNCIÓN CORREGIDA ---
  loadStats: async (forceRebuild = false) => {
    set({ isLoading: true });

    try {
      // 1. Lanzar Worker para Inventario (En paralelo)
      const workerPromise = new Promise((resolve, reject) => {
          const worker = new StatsWorker();
          worker.onmessage = (e) => {
            const { success, payload } = e.data;
            if (success && e.data.type === 'STATS_RESULT') {
              resolve(payload.inventoryValue);
              worker.terminate();
            }
          };
          worker.onerror = (err) => {
             worker.terminate();
             // Si falla el worker, resolvemos con 0 para no romper todo
             Logger.error("Worker failed", err);
             resolve(0); 
          };
          worker.postMessage({ type: 'CALCULATE_STATS' });
      });

      // 2. Cargar y Sumar Historial de Ventas (En el hilo principal)
      const db = await initDB();
      let dailyStats = await loadData(STORES.DAILY_STATS);

      // Lógica de autoreparación: Si no hay stats pero hay ventas, o si se fuerza
      const hasDailyStats = dailyStats && dailyStats.length > 0;
      
      if (forceRebuild || !hasDailyStats) {
         // Verificamos si hay ventas para reconstruir
         const salesCountRequest = db.transaction(STORES.SALES).objectStore(STORES.SALES).count();
         
         const salesCount = await new Promise((resolve) => {
            salesCountRequest.onsuccess = () => resolve(salesCountRequest.result);
            salesCountRequest.onerror = () => resolve(0);
         });

         if (salesCount > 0) {
            // Necesitamos reconstruir 'daily_stats' leyendo todas las ventas
            const { productCostMap } = await getInventoryValueOptimized(db);
            dailyStats = await rebuildDailyStatsFromSales(db, productCostMap);
         }
      }

      // 3. Sumar los totales globales
      const totals = (dailyStats || []).reduce((acc, day) => ({
          totalRevenue: acc.totalRevenue + (day.revenue || 0),
          totalNetProfit: acc.totalNetProfit + (day.profit || 0),
          totalOrders: acc.totalOrders + (day.orders || 0),
          totalItemsSold: acc.totalItemsSold + (day.itemsSold || 0),
      }), { totalRevenue: 0, totalNetProfit: 0, totalOrders: 0, totalItemsSold: 0 });

      // 4. Esperar el resultado del inventario
      const inventoryValue = await workerPromise;

      // 5. Actualizar el estado con TODO (Totales históricos + Inventario actual)
      set({
        stats: {
          ...totals,
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
      let newValue = (currentStats.inventoryValue || 0) + costDelta;
      if (newValue < 0) newValue = 0;

      await saveData(STORES.STATS, { id: 'inventory_summary', value: newValue });
      set({ stats: { ...currentStats, inventoryValue: newValue } });
    } catch (e) { Logger.error("Error adjusting inventory:", e); }
  },

  updateStatsForNewSale: async (sale, costOfGoodsSold) => {
    try {
      const currentStats = get().stats;
      let saleProfit = 0;
      let itemsCount = 0;

      sale.items.forEach(item => {
        itemsCount += (item.quantity || 0);
        const itemCost = item.cost || 0;
        const lineTotal = roundCurrency(item.price * item.quantity);
        const lineCost = roundCurrency(itemCost * item.quantity);
        saleProfit += (lineTotal - lineCost);
      });

      let newInventoryValue = (currentStats.inventoryValue || 0) - costOfGoodsSold;
      if (newInventoryValue < 0) newInventoryValue = 0;

      const newStats = {
        totalRevenue: roundCurrency(currentStats.totalRevenue + sale.total),
        totalNetProfit: roundCurrency(currentStats.totalNetProfit + saleProfit),
        totalOrders: currentStats.totalOrders + 1,
        totalItemsSold: currentStats.totalItemsSold + itemsCount,
        inventoryValue: newInventoryValue
      };

      set({ stats: newStats });
      await saveData(STORES.STATS, { id: 'inventory_summary', value: newInventoryValue });

    } catch (error) {
      Logger.error("Error updating stats:", error);
    }
  }
}));