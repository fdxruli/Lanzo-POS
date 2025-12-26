// src/store/useStatsStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
import { loadData, saveData, saveBulk, deleteData, STORES, initDB } from '../services/database';
import StatsWorker from '../workers/stats.worker.js?worker';

// --- HELPER 1: Obtener Valor de Inventario Híbrido ---
// Suma Lotes (Sistema nuevo) + Productos Simples (Sistema viejo) para que no salga en 0
async function getInventoryValueOptimized(db) {
  // 1. Intentamos leer el caché primero
  const cached = await loadData(STORES.STATS, 'inventory_summary');

  // Si existe y es reciente (podrías agregar timestamp), lo usamos
  // Por ahora, confiamos en el caché si existe, ya que las ventas lo actualizan.
  if (cached && typeof cached.value === 'number') {
    // Retornamos el valor y un mapa vacío (ya no cargamos costos en memoria masivamente)
    // Nota: Si necesitas productCostMap para otra cosa, habrá que cargarlo bajo demanda.
    return { value: cached.value, productCostMap: new Map() };
  }

  console.log("⚠️ Calculando valor de inventario desde cero (primera vez o caché perdido)...");

  let calculatedValue = 0;
  const productCostMap = new Map();

  // 2. Procesamos Lotes usando CURSORES (No carga todo el array en RAM)
  const tx = db.transaction([STORES.PRODUCT_BATCHES, STORES.MENU], 'readonly');

  // Promesa para lotes
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

  // 3. Procesamos Productos Simples (Legacy)
  await new Promise((resolve, reject) => {
    const store = tx.objectStore(STORES.MENU);
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const p = cursor.value;
        // Guardamos costo para el mapa (útil para reparaciones)
        productCostMap.set(p.id, p.cost || 0);

        // Si es producto simple (sin gestión de lotes activa)
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

  // 4. Guardamos el resultado en caché para la próxima
  await saveData(STORES.STATS, { id: 'inventory_summary', value: calculatedValue });

  return { value: calculatedValue, productCostMap };
}

// --- HELPER 2: Reconstrucción Inteligente de Historial ---
async function rebuildDailyStatsFromSales(db, productCostMap) {
  console.log("⚠️ Reparando historial de ganancias y ventas...");

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

          // Calcular ganancia reparando datos faltantes
          if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
              const qty = parseFloat(item.quantity) || 0;
              dayStat.itemsSold += qty;

              // 1. Intentamos usar el costo guardado en la venta
              let itemCost = parseFloat(item.cost);

              // 2. Si no existe o es inválido, usamos el costo ACTUAL del producto (del mapa)
              if (isNaN(itemCost) || itemCost === 0) {
                const realId = item.parentId || item.id;
                itemCost = productCostMap.get(realId) || 0;
              }

              // Calcular utilidad
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

  // Limpiamos la tabla vieja antes de guardar la reparada
  if (dailyStatsArray.length > 0) {
    // Nota: Esto sobrescribe datos diarios previos para corregir los negativos
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

  // Acción para forzar recálculo manual (útil para el botón de "Refrescar")
  forceRecalculate: async () => {
    const db = await initDB();
    // Borramos caché diaria para obligar al rebuild
    await deleteData(STORES.STATS, 'inventory_summary');
    // El rebuild ocurrirá automáticamente al llamar loadStats abajo, 
    // pero podemos limpiar DAILY_STATS si es necesario (opcional, rebuild lo sobrescribe)
    await get().loadStats(true); // true = forzar reparación
  },

  loadStats: async () => {
    set({ isLoading: true });
    
    // Instanciamos el Worker
    const worker = new StatsWorker();

    worker.onmessage = (e) => {
      const { success, payload } = e.data;
      if (success && e.data.type === 'STATS_RESULT') {
        
        // Aquí mezclas con tus otras estadísticas cargadas normalmente
        // (puedes mover también la carga de ventas al worker si quieres)
        set((state) => ({
          stats: { 
            ...state.stats, 
            inventoryValue: payload.inventoryValue 
          },
          isLoading: false
        }));
        
        worker.terminate(); // Matamos el worker al terminar para ahorrar recursos
      }
    };

    // Iniciamos el trabajo
    worker.postMessage({ type: 'CALCULATE_STATS' });
    
    // Nota: Puedes mantener la carga de 'daily_stats' (que es ligera) aquí en el main thread
    // o moverla también al worker.
  },

  adjustInventoryValue: async (costDelta) => {
    if (costDelta === 0) return;
    try {
      const currentStats = get().stats;
      let newValue = (currentStats.inventoryValue || 0) + costDelta;
      if (newValue < 0) newValue = 0;

      await saveData(STORES.STATS, { id: 'inventory_summary', value: newValue });
      set({ stats: { ...currentStats, inventoryValue: newValue } });
    } catch (e) { console.error("Error adjusting inventory:", e); }
  },

  updateStatsForNewSale: async (sale, costOfGoodsSold) => {
    // Esta función actualiza la vista en tiempo real sin recargar DB
    try {
      const currentStats = get().stats;
      let saleProfit = 0;
      let itemsCount = 0;

      sale.items.forEach(item => {
        itemsCount += (item.quantity || 0);
        // Si el item viene sin costo (venta rápida), usamos 0 para no romper la suma
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
      console.error("Error updating stats:", error);
    }
  }
}));