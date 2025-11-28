// src/store/useDashboardStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
import {
  loadData,
  saveData,
  deleteData,
  loadDataPaginated,
  queryByIndex,
  searchProductByBarcode,
  searchProductsInDB,
  STORES,
  initDB
} from '../services/database';

const CACHE_DURATION = 5 * 60 * 1000;

// --- HELPER: Obtener Valor de Inventario (OPTIMIZADO) ---
// En lugar de iterar siempre, busca un valor guardado. Solo itera si no existe.
async function getInventoryValue(db) {
  // 1. Intentar leer el valor pre-calculado de la tabla de estadísticas
  const cached = await loadData(STORES.STATS, 'inventory_summary');
  
  if (cached && typeof cached.value === 'number') {
    return cached.value;
  }

  // 2. FALLBACK: Si no existe (primera vez tras actualización), calculamos todo.
  // Esto es una operación pesada (O(N)), pero solo ocurrirá UNA vez.
  console.log('📊 Calculando valor de inventario inicial (Full Scan)...');
  let calculatedValue = 0;
  
  await new Promise((resolve) => {
    const tx = db.transaction(STORES.PRODUCT_BATCHES, 'readonly');
    const cursorReq = tx.objectStore(STORES.PRODUCT_BATCHES).openCursor();
    
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const batch = cursor.value;
        // Compatibilidad booleanos (true/1)
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

  // Guardamos el cálculo inicial para no tener que hacerlo de nuevo
  await saveData(STORES.STATS, { id: 'inventory_summary', value: calculatedValue });
  return calculatedValue;
}

// --- HELPER: Estadísticas Globales ---
async function calculateStatsOnTheFly() {
  const db = await initDB();

  // 1. Cargar estadísticas de ventas (Caché existente)
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

  // 2. Obtener Valor de Inventario usando la función optimizada
  const inventoryValue = await getInventoryValue(db);

  // Retornamos la fusión de Historial (Caché) + Inventario Actual
  return { ...cachedStats, inventoryValue };
}

// --- HELPER: Lazy Loading de Productos (Sin cambios, ya estaba bien) ---
async function aggregateProductsLazy(products) {
  if (!products || products.length === 0) return [];
  const CHUNK_SIZE = 50;
  const aggregated = [];
  const db = await initDB();

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);
    const productsNeedingBatches = chunk.filter(p => p.batchManagement?.enabled);
    const batchesMap = new Map();

    if (productsNeedingBatches.length > 0) {
      await new Promise((resolve) => {
        const transaction = db.transaction([STORES.PRODUCT_BATCHES], 'readonly');
        const store = transaction.objectStore(STORES.PRODUCT_BATCHES);
        const index = store.index('productId');
        let completedRequests = 0;
        const totalRequests = productsNeedingBatches.length;

        productsNeedingBatches.forEach(product => {
          const request = index.getAll(product.id);
          request.onsuccess = (e) => {
            const batches = e.target.result || [];
            const activeBatches = batches.filter(b => {
              return (b.isActive === true || b.isActive === 1) && b.stock > 0;
            });
            if (activeBatches.length > 0) {
              batchesMap.set(product.id, activeBatches);
            }
            completedRequests++;
            if (completedRequests === totalRequests) resolve();
          };
          request.onerror = (e) => {
            console.error("Error fetching batch", e);
            completedRequests++;
            if (completedRequests === totalRequests) resolve();
          };
        });
      });
    }

    const chunkResults = chunk.map(product => {
      if (!product.batchManagement?.enabled) {
        return {
          ...product,
          stock: product.stock || 0,
          cost: product.cost || 0,
          price: product.price || 0,
          trackStock: product.trackStock !== false
        };
      }
      const batches = batchesMap.get(product.id);
      if (!batches || batches.length === 0) {
        return {
          ...product,
          stock: 0,
          cost: product.cost || 0,
          price: product.price || 0,
          trackStock: true,
          hasBatches: false
        };
      }
      batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const totalStock = batches.reduce((sum, b) => sum + (b.stock || 0), 0);
      const currentBatch = batches[0];
      return {
        ...product,
        stock: totalStock,
        cost: currentBatch.cost,
        price: currentBatch.price,
        trackStock: true,
        hasBatches: true
      };
    });
    aggregated.push(...chunkResults);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return aggregated;
}

export const useDashboardStore = create((set, get) => ({
  isLoading: false,
  sales: [],
  menu: [],
  rawProducts: [],
  wasteLogs: [],
  categories: [],
  deletedItems: [],
  stats: {
    totalRevenue: 0,
    totalItemsSold: 0,
    totalNetProfit: 0,
    totalOrders: 0,
    inventoryValue: 0
  },
  batchesCache: new Map(),
  lastFullLoad: null,
  menuPage: 0,
  menuPageSize: 50,
  hasMoreProducts: true,

  // --- ACCIONES ---

  loadAllData: async (forceRefresh = false) => {
    const { lastFullLoad, isLoading } = get();
    const now = Date.now();

    if (!forceRefresh && lastFullLoad && (now - lastFullLoad) < CACHE_DURATION) {
      console.log('⏳ Dashboard: Usando caché.');
      return;
    }

    if (isLoading) return;
    set({ isLoading: true });

    try {
      console.time('CargaDashboard');
      
      // 1. Estadísticas (Ahora es rápido porque lee caché)
      const stats = await calculateStatsOnTheFly();

      const [recentSales, firstPageProducts, categories, wasteData] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadData(STORES.CATEGORIES),
        loadData(STORES.WASTE)
      ]);

      const sortedWaste = (wasteData || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const aggregatedMenu = await aggregateProductsLazy(firstPageProducts);

      set({
        sales: recentSales,
        wasteLogs: sortedWaste,
        stats: stats,
        menu: aggregatedMenu,
        rawProducts: firstPageProducts,
        categories: categories || [],
        menuPage: 1,
        hasMoreProducts: firstPageProducts.length === 50,
        lastFullLoad: now,
        isLoading: false
      });
      console.timeEnd('CargaDashboard');
    } catch (error) {
      console.error("Error cargando dashboard:", error);
      set({ isLoading: false });
    }
  },

  loadMoreProducts: async () => {
    const { menuPage, menuPageSize, hasMoreProducts, menu, rawProducts } = get();
    if (!hasMoreProducts) return;
    try {
      const nextPage = await loadDataPaginated(STORES.MENU, {
        limit: menuPageSize,
        offset: menuPage * menuPageSize
      });
      if (nextPage.length === 0) {
        set({ hasMoreProducts: false });
        return;
      }
      const aggregatedNextPage = await aggregateProductsLazy(nextPage);
      set({
        menu: [...menu, ...aggregatedNextPage],
        rawProducts: [...rawProducts, ...nextPage],
        menuPage: menuPage + 1,
        hasMoreProducts: nextPage.length === menuPageSize
      });
    } catch (error) {
      console.error("Error paginando:", error);
    }
  },

  searchProducts: async (query) => {
    if (!query || query.trim().length < 2) {
      get().loadAllData(true);
      return;
    }
    set({ isLoading: true });
    try {
      const byCode = await searchProductByBarcode(query);
      if (byCode) {
        const aggregated = await aggregateProductsLazy([byCode]);
        set({ menu: aggregated, isLoading: false, hasMoreProducts: false });
        return;
      }
      const results = await searchProductsInDB(query);
      const aggregatedResults = await aggregateProductsLazy(results);
      set({ menu: aggregatedResults, isLoading: false, hasMoreProducts: false });
    } catch (error) {
      console.error("Error búsqueda:", error);
      set({ isLoading: false });
    }
  },

  loadBatchesForProduct: async (productId) => {
    const { batchesCache } = get();
    const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
    const newCache = new Map(batchesCache);
    newCache.set(productId, batches);
    set({ batchesCache: newCache });
    return batches;
  },

  // --- ¡NUEVO! ACCIÓN PARA ACTUALIZAR EL INVENTARIO INCREMENTALMENTE ---
  // Se debe llamar desde BatchManager o WasteModal cuando cambia el stock
  adjustInventoryValue: async (costDelta) => {
    if (costDelta === 0) return;
    try {
      // 1. Obtener valor actual del estado
      const currentStats = get().stats;
      
      // 2. Si es la primera vez y está en 0, quizás deberíamos cargar de DB primero, 
      // pero asumiremos que loadAllData ya corrió.
      const newValue = (currentStats.inventoryValue || 0) + costDelta;

      // 3. Actualizar DB (Persistencia)
      await saveData(STORES.STATS, { id: 'inventory_summary', value: newValue });

      // 4. Actualizar UI (Store)
      set({ stats: { ...currentStats, inventoryValue: newValue } });
      
      console.log(`💰 Inventario actualizado: ${costDelta > 0 ? '+' : ''}$${costDelta.toFixed(2)}`);
    } catch (e) { console.error("Error ajustando inventario:", e); }
  },

  updateStatsWithSale: async (sale) => {
    try {
      let stats = await loadData(STORES.STATS, 'sales_summary');
      if (!stats) return; 

      let saleProfit = 0;
      let saleItems = 0;
      let costOfGoodsSold = 0; // Costo total de lo que salió

      sale.items.forEach(item => {
        saleItems += (item.quantity || 0);
        const itemCost = item.cost || 0;
        const totalLineCost = itemCost * item.quantity;
        
        saleProfit += (item.price * item.quantity) - totalLineCost;
        costOfGoodsSold += totalLineCost;
      });

      const newStats = {
        ...stats,
        totalRevenue: roundCurrency(stats.totalRevenue + sale.total),
        totalNetProfit: roundCurrency(stats.totalNetProfit + saleProfit),
        totalOrders: stats.totalOrders + 1,
        totalItemsSold: stats.totalItemsSold + saleItems
      };

      await saveData(STORES.STATS, newStats);

      // --- AQUÍ ACTUALIZAMOS EL VALOR DEL INVENTARIO TAMBIÉN ---
      // Como salió mercancía, restamos su costo al valor total
      await get().adjustInventoryValue(-costOfGoodsSold);

      const currentStats = get().stats;
      set({
        stats: {
          ...currentStats,
          ...newStats
          // inventoryValue ya se actualizó via adjustInventoryValue
        }
      });

    } catch (error) {
      console.error("Error actualizando estadísticas incrementales:", error);
    }
  },

  loadRecycleBin: async () => {
    set({ isLoading: true });
    try {
      const [delMenu, delCust, delSales, delCats] = await Promise.all([
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES),
        loadData(STORES.DELETED_CATEGORIES)
      ]);
      const allMovements = [
        ...delMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...delCust.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...delSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido $${s.total}` })),
        ...(delCats || []).map(c => ({ ...c, type: 'Categoría', uniqueId: c.id, mainLabel: c.name, subLabel: 'Organización' }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));
      set({ deletedItems: allMovements, isLoading: false });
    } catch (e) { set({ isLoading: false }); }
  },

  deleteSale: async (timestamp) => {
    if (!window.confirm('¿Restaurar stock y eliminar venta?')) return;
    try {
      let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) {
        const allSales = await loadData(STORES.SALES);
        saleToDelete = allSales.find(s => s.timestamp === timestamp);
      }
      if (!saleToDelete) return;
      
      let restoredInventoryValue = 0;

      for (const item of saleToDelete.items) {
        if (item.batchesUsed) {
          for (const batchInfo of item.batchesUsed) {
            const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
            if (batch) {
              batch.stock += batchInfo.quantity;
              batch.isActive = true;
              await saveData(STORES.PRODUCT_BATCHES, batch);
              
              // Sumamos al valor recuperado
              restoredInventoryValue += (batch.cost * batchInfo.quantity);
            }
          }
        }
      }
      
      // Restauramos el valor del inventario
      await get().adjustInventoryValue(restoredInventoryValue);

      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);
      get().loadAllData(true);
    } catch (error) { console.error("Error eliminar venta:", error); }
  },

  restoreItem: async (item) => {
    try {
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
        await saveData(STORES.MENU, cleanItem);
        await deleteData(STORES.DELETED_MENU, item.id);
      } else if (item.type === 'Cliente') {
        delete item.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
        await saveData(STORES.CUSTOMERS, cleanItem);
        await deleteData(STORES.DELETED_CUSTOMERS, item.id);
      } else if (item.type === 'Pedido') {
        delete item.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
        await saveData(STORES.SALES, cleanItem);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      } else if (item.type === 'Categoría') {
        delete item.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
        await saveData(STORES.CATEGORIES, cleanItem);
        await deleteData(STORES.DELETED_CATEGORIES, item.id);
      }
      await get().loadRecycleBin();
      get().loadAllData(true);
    } catch (error) { console.error("Error restaurar:", error); }
  },

  getTotalPrice: () => {
    const { order } = get();
    const rawTotal = order.reduce((sum, item) => {
      if (item.quantity && item.quantity > 0) {
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0);
    return roundCurrency(rawTotal);
  },
}));