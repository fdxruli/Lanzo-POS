// src/store/useDashboardStore.js - ✅ VERSIÓN CORREGIDA
import { create } from 'zustand';
import {
  loadData,
  saveData,
  deleteData,
  loadDataPaginated,
  queryByIndex,
  STORES,
  initDB
} from '../services/database';

// ✅ AÑADIDO: Import de la función que faltaba
import { searchProductsInDB } from '../services/database';

// Duración del caché para evitar recargas innecesarias (5 minutos)
const CACHE_DURATION = 5 * 60 * 1000;

// --- HELPER 1: Calcular estadísticas globales "al vuelo" ---
async function calculateStatsOnTheFly() {
  const db = await initDB();

  let totalRevenue = 0;
  let totalNetProfit = 0;
  let totalOrders = 0;
  let totalItemsSold = 0;
  let inventoryValue = 0;

  // A. Sumar Ventas
  await new Promise((resolve) => {
    const tx = db.transaction(STORES.SALES, 'readonly');
    const cursorReq = tx.objectStore(STORES.SALES).openCursor();

    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const sale = cursor.value;
        totalRevenue += (sale.total || 0);
        totalOrders++;

        if (sale.items && Array.isArray(sale.items)) {
          sale.items.forEach(item => {
            totalItemsSold += (item.quantity || 0);
            const itemCost = item.cost || 0;
            const itemProfit = (item.price - itemCost) * item.quantity;
            totalNetProfit += itemProfit;
          });
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  // B. Sumar Valor Inventario (Solo lotes activos)
  await new Promise((resolve) => {
    const tx = db.transaction(STORES.PRODUCT_BATCHES, 'readonly');
    const cursorReq = tx.objectStore(STORES.PRODUCT_BATCHES).openCursor();

    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const batch = cursor.value;
        if (batch.isActive && batch.stock > 0) {
          inventoryValue += (batch.cost * batch.stock);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  return { totalRevenue, totalNetProfit, totalOrders, totalItemsSold, inventoryValue };
}

// --- HELPER 2: Agregación Optimizada ---
async function aggregateProductsWithBatchesOptimized(products) {
  const aggregated = await Promise.all(products.map(async (product) => {
    const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', product.id);

    const activeBatches = batches
      .filter(b => b.isActive && b.stock > 0)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalStock = activeBatches.reduce((sum, b) => sum + (b.stock || 0), 0);

    const displayPrice = activeBatches.length > 0 ? activeBatches[0].price : (product.price || 0);

    let displayCost = 0;
    if (activeBatches.length > 0) {
      displayCost = activeBatches[0].cost;
    } else {
      const lastBatch = batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      displayCost = lastBatch ? lastBatch.cost : (product.cost || 0);
    }

    return {
      ...product,
      stock: totalStock,
      price: displayPrice,
      cost: displayCost,
      trackStock: true,
      batchCount: batches.length,
      hasBatches: activeBatches.length > 0
    };
  }));

  return aggregated;
}

export const useDashboardStore = create((set, get) => ({
  // --- ESTADO ---
  isLoading: false,

  // Datos Paginados
  sales: [],
  menu: [],
  rawProducts: [],
  
  // ✅ AÑADIDO: rawBatches que faltaba
  rawBatches: [],

  // Datos Globales
  categories: [],
  deletedItems: [],

  // Estadísticas
  stats: {
    totalRevenue: 0,
    totalItemsSold: 0,
    totalNetProfit: 0,
    totalOrders: 0,
    inventoryValue: 0
  },

  // Control de Paginación y Caché
  lastFullLoad: null,
  menuPage: 0,
  menuPageSize: 50,
  hasMoreProducts: true,

  // --- ACCIONES ---

  // 1. Carga Inicial Inteligente
  loadAllData: async (forceRefresh = false) => {
    const { lastFullLoad, isLoading } = get();
    const now = Date.now();

    if (!forceRefresh && lastFullLoad && (now - lastFullLoad) < CACHE_DURATION) {
      console.log('⏳ Dashboard: Usando datos en caché.');
      return;
    }

    if (isLoading) return;
    set({ isLoading: true });

    try {
      console.time('CargaDashboardOptimizado');

      const stats = await calculateStatsOnTheFly();

      // ✅ MODIFICADO: Ahora también cargamos rawBatches
      const [recentSales, firstPageProducts, categories, allBatches] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadData(STORES.CATEGORIES),
        loadData(STORES.PRODUCT_BATCHES) // ✅ CARGAMOS LOTES
      ]);

      const aggregatedMenu = await aggregateProductsWithBatchesOptimized(firstPageProducts);

      set({
        sales: recentSales,
        stats: stats,
        menu: aggregatedMenu,
        rawProducts: firstPageProducts,
        rawBatches: allBatches || [], // ✅ GUARDAMOS EN EL ESTADO
        categories: categories || [],

        menuPage: 1,
        hasMoreProducts: firstPageProducts.length === 50,

        lastFullLoad: now,
        isLoading: false
      });

      console.timeEnd('CargaDashboardOptimizado');

    } catch (error) {
      console.error("Error cargando dashboard:", error);
      set({ isLoading: false });
    }
  },

  // 2. Cargar más productos
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

      const aggregatedNextPage = await aggregateProductsWithBatchesOptimized(nextPage);

      set({
        menu: [...menu, ...aggregatedNextPage],
        rawProducts: [...rawProducts, ...nextPage],
        menuPage: menuPage + 1,
        hasMoreProducts: nextPage.length === menuPageSize
      });
    } catch (error) {
      console.error("Error paginando productos:", error);
    }
  },

  // ✅ CORREGIDO: Ahora usa la función importada correctamente
  searchProducts: async (query) => {
    if (!query || query.trim().length < 2) {
      get().loadAllData(true);
      return;
    }

    set({ isLoading: true });
    try {
      // Búsqueda por código de barras
      const allMenu = await loadData(STORES.MENU);
      const byCode = allMenu.find(p => p.barcode === query);

      if (byCode) {
        const enriched = await aggregateProductsWithBatchesOptimized([byCode]);
        set({ menu: enriched, isLoading: false });
        return;
      }

      // ✅ AHORA SÍ FUNCIONA (está importada arriba)
      const results = await searchProductsInDB(query);
      const aggregatedResults = await aggregateProductsWithBatchesOptimized(results);

      set({
        menu: aggregatedResults,
        isLoading: false,
        hasMoreProducts: false
      });

    } catch (error) {
      console.error("Error en búsqueda:", error);
      set({ isLoading: false });
    }
  },

  // 4. Cargar Papelera
  loadRecycleBin: async () => {
    set({ isLoading: true });
    try {
      const [delMenu, delCust, delSales] = await Promise.all([
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES)
      ]);

      const allMovements = [
        ...delMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...delCust.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...delSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido $${s.total}` }))
      ];

      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));

      set({ deletedItems: allMovements, isLoading: false });
    } catch (e) {
      console.error("Error cargando papelera:", e);
      set({ isLoading: false });
    }
  },

  // --- ACCIONES DE MODIFICACIÓN ---

  deleteSale: async (timestamp) => {
    if (!window.confirm('¿Restaurar stock y eliminar venta?')) return;

    try {
      let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) {
        const allSales = await loadData(STORES.SALES);
        saleToDelete = allSales.find(s => s.timestamp === timestamp);
      }

      if (!saleToDelete) return;

      for (const item of saleToDelete.items) {
        if (item.batchesUsed) {
          for (const batchInfo of item.batchesUsed) {
            const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
            if (batch) {
              batch.stock += batchInfo.quantity;
              batch.isActive = true;
              await saveData(STORES.PRODUCT_BATCHES, batch);
            }
          }
        }
      }

      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);

      get().loadAllData(true);

    } catch (error) {
      console.error("Error al eliminar venta:", error);
    }
  },

  restoreItem: async (item) => {
    try {
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        await saveData(STORES.MENU, item);
        await deleteData(STORES.DELETED_MENU, item.id);
      } else if (item.type === 'Cliente') {
        delete item.deletedTimestamp;
        await saveData(STORES.CUSTOMERS, item);
        await deleteData(STORES.DELETED_CUSTOMERS, item.id);
      } else if (item.type === 'Pedido') {
        delete item.deletedTimestamp;
        await saveData(STORES.SALES, item);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      }

      await get().loadRecycleBin();
      get().loadAllData(true);

    } catch (error) {
      console.error("Error restaurando item:", error);
    }
  }

}));
