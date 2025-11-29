// src/store/useStatsStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
import { loadData, saveData, STORES, initDB } from '../services/database';

// --- HELPER: Obtener Valor de Inventario ---
async function getInventoryValue(db) {
  // ELIMINAMOS LA CACHÉ AGRESIVA QUE CAUSABA EL ERROR
  // Antes, si el sistema veía un "0" guardado, no volvía a contar. 
  // Ahora forzamos el recálculo real siempre que se entra al dashboard.
  
  // Fallback: Cálculo inicial (Suma real de todos los lotes)
  let calculatedValue = 0;
  
  await new Promise((resolve) => {
    const tx = db.transaction(STORES.PRODUCT_BATCHES, 'readonly');
    const cursorReq = tx.objectStore(STORES.PRODUCT_BATCHES).openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const batch = cursor.value;
        // Compatibilidad con booleanos 1/0/true/false
        const isActive = batch.isActive === true || batch.isActive === 1;
        
        if (isActive && batch.stock > 0) {
          calculatedValue += (batch.cost * batch.stock);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  // Guardamos el valor corregido para referencia futura
  await saveData(STORES.STATS, { id: 'inventory_summary', value: calculatedValue });
  return calculatedValue;
}

// --- HELPER: Cálculo On-The-Fly ---
async function calculateStatsOnTheFly() {
  const db = await initDB();

  // 1. Cargar estadísticas de ventas
  let cachedStats = await loadData(STORES.STATS, 'sales_summary');

  // Inicialización si no existe caché de ventas
  if (!cachedStats) {
    cachedStats = {
      id: 'sales_summary',
      totalRevenue: 0,
      totalNetProfit: 0,
      totalOrders: 0,
      totalItemsSold: 0
    };

    // Cálculo inicial de ventas (Solo una vez)
    await new Promise((resolve) => {
      const tx = db.transaction(STORES.SALES, 'readonly');
      const cursorReq = tx.objectStore(STORES.SALES).openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const sale = cursor.value;
          if (sale.fulfillmentStatus !== 'cancelled') {
            cachedStats.totalRevenue = roundCurrency(cachedStats.totalRevenue + (sale.total || 0));
            cachedStats.totalOrders++;
            if (sale.items && Array.isArray(sale.items)) {
              sale.items.forEach(item => {
                cachedStats.totalItemsSold += (item.quantity || 0);
                const itemCost = item.cost || 0;
                const profit = (item.price - itemCost) * item.quantity;
                cachedStats.totalNetProfit = roundCurrency(cachedStats.totalNetProfit + profit);
              });
            }
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
    await saveData(STORES.STATS, cachedStats);
  }

  // 2. Obtener Valor de Inventario usando la función blindada
  const inventoryValue = await getInventoryValue(db);

  return { ...cachedStats, inventoryValue };
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

  loadStats: async () => {
    set({ isLoading: true });
    try {
      const stats = await calculateStatsOnTheFly();
      set({ stats, isLoading: false });
    } catch (error) {
      console.error("Error loading stats:", error);
      set({ isLoading: false });
    }
  },

  adjustInventoryValue: async (costDelta) => {
    if (costDelta === 0) return;
    try {
      const currentStats = get().stats;
      let newValue = (currentStats.inventoryValue || 0) + costDelta;
      
      // Protección extra: Nunca permitir negativos en la UI
      if (newValue < 0) newValue = 0; 

      await saveData(STORES.STATS, { id: 'inventory_summary', value: newValue });
      set({ stats: { ...currentStats, inventoryValue: newValue } });
    } catch (e) { console.error("Error adjusting inventory:", e); }
  },

  updateStatsForNewSale: async (sale, costOfGoodsSold) => {
    try {
      const currentStats = get().stats;
      let saleProfit = 0;
      let itemsCount = 0;
      
      sale.items.forEach(item => {
          itemsCount += item.quantity || 0;
          const itemCost = item.cost || 0;
          saleProfit += (item.price * item.quantity) - (itemCost * item.quantity);
      });

      // Calculamos nuevo valor de inventario
      let newInventoryValue = (currentStats.inventoryValue || 0) - costOfGoodsSold;
      if (newInventoryValue < 0) newInventoryValue = 0; 

      const newStats = {
          ...currentStats,
          totalRevenue: roundCurrency(currentStats.totalRevenue + sale.total),
          totalNetProfit: roundCurrency(currentStats.totalNetProfit + saleProfit),
          totalOrders: currentStats.totalOrders + 1,
          totalItemsSold: currentStats.totalItemsSold + itemsCount,
          inventoryValue: newInventoryValue
      };

      // 2. GUARDAR ESTADÍSTICAS Y LOG
      await Promise.all([
        saveData(STORES.STATS, { ...newStats, id: 'sales_summary' }),
        saveData(STORES.STATS, { id: 'inventory_summary', value: newStats.inventoryValue }),
      ]);
      
      set({ stats: newStats });
    
    } catch (error) {
      console.error("Error updating stats:", error);
    }
  }
}));