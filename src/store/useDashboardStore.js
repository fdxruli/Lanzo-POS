// src/store/useDashboardStore.js
import { create } from 'zustand';
import {
  loadData,
  saveData,
  deleteData,
  loadDataPaginated,
  queryByIndex,
  queryBatchesByProductIdAndActive, // Asegúrate de tener esto importado
  searchProductByBarcode,
  searchProductsInDB, // Asegúrate de tener esto importado
  STORES,
  initDB
} from '../services/database';

const CACHE_DURATION = 5 * 60 * 1000;

// --- HELPER 1: Estadísticas Globales (Sin cambios en lógica, solo en performance) ---
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

// --- HELPER 2: Agregación "Lazy" (OPTIMIZADO Y SEGURO) ---
async function aggregateProductsLazy(products) {
  if (!products || products.length === 0) return [];

  const CHUNK_SIZE = 10; // Procesar de 10 en 10
  const aggregated = [];

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);

    const chunkResults = await Promise.all(chunk.map(async (product) => {
      // ✅ FALLBACKS DE SEGURIDAD: Aseguramos valores válidos por defecto
      const safeProduct = {
        ...product,
        price: (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0,
        cost: (typeof product.cost === 'number' && !isNaN(product.cost)) ? product.cost : 0,
        stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0,
      };

      // Si no usa lotes, retornar directo con valores seguros
      if (!product.batchManagement?.enabled) {
        return {
          ...safeProduct,
          trackStock: product.trackStock !== false
        };
      }

      // Cargar SOLO lotes activos para este producto
      const batches = await queryBatchesByProductIdAndActive(product.id, true);

      if (!batches || batches.length === 0) {
        return {
          ...safeProduct,
          trackStock: true,
          hasBatches: false
        };
      }

      // Ordenar FIFO (Más antiguo primero)
      batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const totalStock = batches.reduce((sum, b) => sum + (b.stock || 0), 0);
      const currentBatch = batches[0];

      // ✅ PROTECCIÓN: Validar que el lote tenga precio y costo válidos
      const batchPrice = (typeof currentBatch.price === 'number' && !isNaN(currentBatch.price))
        ? currentBatch.price
        : safeProduct.price; // Fallback al precio base del producto

      const batchCost = (typeof currentBatch.cost === 'number' && !isNaN(currentBatch.cost))
        ? currentBatch.cost
        : safeProduct.cost; // Fallback al costo base

      return {
        ...safeProduct,
        stock: totalStock,
        cost: batchCost,
        price: batchPrice,
        trackStock: true,
        hasBatches: true
      };
    }));

    aggregated.push(...chunkResults);
    // Pequeña pausa para no bloquear la UI
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return aggregated;
}

export const useDashboardStore = create((set, get) => ({
  // --- ESTADO ---
  isLoading: false,
  sales: [],
  menu: [],
  rawProducts: [],
  // ¡OJO! Hemos eliminado rawBatches para ahorrar memoria

  categories: [],
  deletedItems: [],
  stats: {
    totalRevenue: 0,
    totalItemsSold: 0,
    totalNetProfit: 0,
    totalOrders: 0,
    inventoryValue: 0
  },

  // Cache para BatchManager
  batchesCache: new Map(),

  // Paginación
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

      // 1. Estadísticas globales (Scan eficiente)
      const stats = await calculateStatsOnTheFly();

      // 2. Cargar datos paginados
      const [recentSales, firstPageProducts, categories] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadData(STORES.CATEGORIES)
      ]);

      // 3. Enriquecer productos (Lazy load)
      const aggregatedMenu = await aggregateProductsLazy(firstPageProducts);

      set({
        sales: recentSales,
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

  // Cargar más productos (Paginación)
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
      // 1. Buscar por código
      const byCode = await searchProductByBarcode(query);
      if (byCode) {
        const aggregated = await aggregateProductsLazy([byCode]);
        set({ menu: aggregated, isLoading: false, hasMoreProducts: false });
        return;
      }
      // 2. Buscar por nombre
      const results = await searchProductsInDB(query);
      const aggregatedResults = await aggregateProductsLazy(results);
      set({ menu: aggregatedResults, isLoading: false, hasMoreProducts: false });
    } catch (error) {
      console.error("Error búsqueda:", error);
      set({ isLoading: false });
    }
  },

  // --- ¡NUEVO! Método para cargar lotes de UN producto específico ---
  // Se usa en BatchManager
  loadBatchesForProduct: async (productId) => {
    const { batchesCache } = get();

    // Si ya está en caché y es reciente, devolverlo (opcional: invalidación)
    // Por seguridad en edición, mejor recargar siempre de DB o invalidar caché al guardar

    // Consultamos BD
    const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);

    // Actualizamos caché
    const newCache = new Map(batchesCache);
    newCache.set(productId, batches);
    set({ batchesCache: newCache });

    return batches;
  },

  // ... (loadRecycleBin, deleteSale, restoreItem se mantienen iguales) ...
  loadRecycleBin: async () => {
    // ... código existente ...
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
    } catch (e) { set({ isLoading: false }); }
  },

  deleteSale: async (timestamp) => {
    // ... (código existente, asegúrate de importar las funciones) ...
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
    } catch (error) { console.error("Error eliminar venta:", error); }
  },

  restoreItem: async (item) => {
    // ... (código existente) ...
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
    } catch (error) { console.error("Error restaurar:", error); }
  }

}));
