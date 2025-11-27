// src/store/useDashboardStore.js
import { create } from 'zustand';
import { roundCurrency } from '../services/utils';
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

  // 1. Intentar cargar estadísticas pre-calculadas (CACHE)
  let cachedStats = await loadData(STORES.STATS, 'sales_summary');

  // Si no existe caché, inicializamos en ceros para calcular desde el principio
  if (!cachedStats) {
    cachedStats = {
      id: 'sales_summary',
      totalRevenue: 0,
      totalNetProfit: 0,
      totalOrders: 0,
      totalItemsSold: 0
    };

    // RE-CÁLCULO INICIAL (Solo se hace una vez tras la actualización)
    await new Promise((resolve) => {
      const tx = db.transaction(STORES.SALES, 'readonly');
      const cursorReq = tx.objectStore(STORES.SALES).openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const sale = cursor.value;
          if (sale.fulfillmentStatus !== 'cancelled') {
            // CORRECCIÓN:
            cachedStats.totalRevenue = roundCurrency(cachedStats.totalRevenue + (sale.total || 0));
            cachedStats.totalOrders++;
            if (sale.items && Array.isArray(sale.items)) {
              sale.items.forEach(item => {
                cachedStats.totalItemsSold += (item.quantity || 0);
                const itemCost = item.cost || 0;
                const profit = (item.price - itemCost) * item.quantity;
                // CORRECCIÓN:
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

    // Guardamos el cálculo inicial para el futuro
    await saveData(STORES.STATS, cachedStats);
  }

  // 2. Calcular Valor de Inventario en Tiempo Real 
  // (Esto siempre debe ser fresco porque el stock cambia sin ventas, ej. mermas/compras)
  let inventoryValue = 0;
  await new Promise((resolve) => {
    const tx = db.transaction(STORES.PRODUCT_BATCHES, 'readonly');
    const cursorReq = tx.objectStore(STORES.PRODUCT_BATCHES).openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const batch = cursor.value;
        // Manejo compatible de booleanos
        const isActive = batch.isActive === true || batch.isActive === 1;
        if (isActive && batch.stock > 0) {
          inventoryValue += (batch.cost * batch.stock);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  // Retornamos la fusión de Historial (Caché) + Actualidad (Inventario)
  return { ...cachedStats, inventoryValue };
}

async function aggregateProductsLazy(products) {
  if (!products || products.length === 0) return [];

  // Procesamos en bloques para mantener la interfaz fluida
  const CHUNK_SIZE = 50;
  const aggregated = [];

  // Aseguramos conexión a BD una sola vez para la operación
  const db = await initDB();

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);

    // 1. Identificamos qué productos de este bloque realmente necesitan buscar lotes
    const productsNeedingBatches = chunk.filter(p => p.batchManagement?.enabled);

    // Mapa para guardar los resultados de la BD temporalmente: { 'prod-123': [Lote1, Lote2] }
    const batchesMap = new Map();

    // 2. Si hay productos que requieren lotes, hacemos UNA sola transacción para todos ellos
    if (productsNeedingBatches.length > 0) {
      await new Promise((resolve) => {
        const transaction = db.transaction([STORES.PRODUCT_BATCHES], 'readonly');
        const store = transaction.objectStore(STORES.PRODUCT_BATCHES);
        const index = store.index('productId');

        let completedRequests = 0;
        const totalRequests = productsNeedingBatches.length;

        productsNeedingBatches.forEach(product => {
          const request = index.getAll(product.id); // Trae todos los lotes de este ID

          request.onsuccess = (e) => {
            const batches = e.target.result || [];
            // Filtramos en memoria (más rápido que múltiples consultas a DB)
            const activeBatches = batches.filter(b => {
              // Manejamos compatibilidad de booleanos (true/1)
              return (b.isActive === true || b.isActive === 1) && b.stock > 0;
            });

            if (activeBatches.length > 0) {
              batchesMap.set(product.id, activeBatches);
            }

            completedRequests++;
            if (completedRequests === totalRequests) resolve();
          };

          request.onerror = (e) => {
            console.error("Error fetching batch for", product.id, e);
            completedRequests++;
            if (completedRequests === totalRequests) resolve();
          };
        });
      });
    }

    // 3. Construimos el resultado final usando los datos que ya tenemos en memoria
    const chunkResults = chunk.map(product => {
      // Caso A: Producto simple (sin lotes)
      if (!product.batchManagement?.enabled) {
        return {
          ...product,
          stock: product.stock || 0,
          cost: product.cost || 0,
          price: product.price || 0,
          trackStock: product.trackStock !== false
        };
      }

      // Caso B: Producto con lotes (usamos el mapa pre-cargado)
      const batches = batchesMap.get(product.id);

      if (!batches || batches.length === 0) {
        return {
          ...product,
          stock: 0,
          cost: product.cost || 0, // Fallback al costo base
          price: product.price || 0,
          trackStock: true,
          hasBatches: false
        };
      }

      // Lógica FIFO: Ordenar por fecha de creación (más antiguo primero)
      batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const totalStock = batches.reduce((sum, b) => sum + (b.stock || 0), 0);
      const currentBatch = batches[0]; // El lote activo es el primero (FIFO)

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

    // "Yield" al event loop para no congelar la UI si hay muchos productos
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
      const [recentSales, firstPageProducts, categories, wasteData] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadData(STORES.CATEGORIES),
        loadData(STORES.WASTE)
      ]);

      const sortedWaste = (wasteData || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // 3. Enriquecer productos (Lazy load)
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

  updateStatsWithSale: async (sale) => {
    try {
      // 1. Cargar stats actuales
      let stats = await loadData(STORES.STATS, 'sales_summary');
      if (!stats) return; // Si no existen, el próximo loadAllData las creará

      // 2. Calcular métricas de ESTA venta
      let saleProfit = 0;
      let saleItems = 0;

      sale.items.forEach(item => {
        saleItems += (item.quantity || 0);
        const itemCost = item.cost || 0;
        saleProfit += (item.price - itemCost) * item.quantity;
      });

      // 3. Actualizar acumuladores
      const newStats = {
        ...stats,
        totalRevenue: roundCurrency(stats.totalRevenue + sale.total),
        totalNetProfit: roundCurrency(stats.totalNetProfit + saleProfit),
        totalOrders: stats.totalOrders + 1,
        totalItemsSold: stats.totalItemsSold + saleItems
      };

      // 4. Guardar rápido en BD y Estado
      await saveData(STORES.STATS, newStats);

      // Actualizamos el estado local para que el Dashboard se vea actualizado si entramos
      const currentStats = get().stats;
      set({
        stats: {
          ...currentStats,
          ...newStats
          // Nota: inventoryValue no se actualiza aquí, se actualizará al recargar o
          // podríamos restarlo manualmente, pero es hilar muy fino.
        }
      });

    } catch (error) {
      console.error("Error actualizando estadísticas incrementales:", error);
    }
  },

  loadRecycleBin: async () => {
    // ... código existente ...
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
    try {
      // 2. LÓGICA DE RESTAURACIÓN ACTUALIZADA
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        // Borramos propiedades visuales extra antes de guardar
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
        // Nota: Restaurar un pedido NO restaura el stock automáticamente (sería muy complejo),
        // solo lo devuelve al historial.

      } else if (item.type === 'Categoría') { // <--- NUEVA LÓGICA
        delete item.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
        await saveData(STORES.CATEGORIES, cleanItem);
        await deleteData(STORES.DELETED_CATEGORIES, item.id);
      }

      // Recargar todo
      await get().loadRecycleBin();
      get().loadAllData(true);
      
    } catch (error) { console.error("Error restaurar:", error); }
  },

  getTotalPrice: () => {
    const { order } = get();
    const rawTotal = order.reduce((sum, item) => {
      if (item.quantity && item.quantity > 0) {
        // Calculamos el subtotal de la línea sin redondear aún para mantener precisión en granel
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0);

    // 2. APLICAR REDONDEO AL FINAL
    return roundCurrency(rawTotal);
  },
}));