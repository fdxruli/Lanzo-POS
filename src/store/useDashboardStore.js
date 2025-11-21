// src/store/useDashboardStore.js
import { create } from 'zustand';
import {
  loadData,
  saveData,
  deleteData,
  loadDataPaginated,
  queryByIndex,
  searchProductByBarcode,
  STORES,
  initDB
} from '../services/database';

// Duración del caché para evitar recargas innecesarias (5 minutos)
const CACHE_DURATION = 5 * 60 * 1000;

// --- HELPER 1: Calcular estadísticas globales "al vuelo" ---
// Recorre la BD con un cursor (sin cargar objetos en RAM) para sumar totales.
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
            // Calculamos utilidad estimada basada en el costo guardado en la venta
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

// --- HELPER 2: Agregación Optimizada (SOLUCIÓN CRÍTICA) ---
// Consulta a la BD solo los lotes necesarios para los productos visibles.
// Evita la iteración O(n*m) masiva.
// Procesa en chunks para evitar saturar IndexedDB con demasiadas transacciones simultáneas.
async function aggregateProductsWithBatchesOptimized(products, chunkSize = 20) {
  if (!products || products.length === 0) return [];

  const aggregated = [];
  
  // Procesar en chunks para evitar saturar IndexedDB
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    
    // Procesar este chunk en paralelo
    const chunkResults = await Promise.all(chunk.map(async (product) => {

      // 1. Consultamos solo los lotes de ESTE producto usando el índice 'productId'
      // Esto es muy rápido gracias a IndexedDB
      const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', product.id);

      // 2. Ordenar TODOS los lotes una sola vez (para usar después)
      const sortedBatches = batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // 3. Filtrar solo activos con stock (ya ordenados)
      const activeBatches = sortedBatches.filter(b => b.isActive && b.stock > 0);

      // 4. Calcular totales
      const totalStock = activeBatches.reduce((sum, b) => sum + (b.stock || 0), 0);

      // 5. Determinar precio y costo a mostrar
      const displayPrice = activeBatches.length > 0 ? activeBatches[0].price : (product.price || 0);

      let displayCost = 0;
      if (activeBatches.length > 0) {
        displayCost = activeBatches[0].cost;
      } else if (sortedBatches.length > 0) {
        // Si no hay activos, usar el último lote histórico (ya está ordenado, tomar el primero)
        displayCost = sortedBatches[0].cost;
      } else {
        displayCost = product.cost || 0;
      }

      // 6. Retornar producto enriquecido
      return {
        ...product,
        stock: totalStock,
        price: displayPrice,
        cost: displayCost,
        trackStock: true, // Asumimos true si usa sistema de lotes
        batchCount: batches.length,
        hasBatches: activeBatches.length > 0
      };
    }));

    aggregated.push(...chunkResults);
  }

  return aggregated;
}

export const useDashboardStore = create((set, get) => ({
  // --- ESTADO ---
  isLoading: false,

  // Datos Paginados (Lo que se ve en pantalla)
  sales: [],
  menu: [],
  rawProducts: [], // Copia "cruda" de los productos cargados (para edición)
  rawBatches: [], // Copia "cruda" de los lotes (para cálculos de inventario)

  // Datos Globales
  categories: [],
  deletedItems: [], // Papelera (se carga bajo demanda)

  // Estadísticas (Calculadas globalmente)
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

    // Cache check: Si los datos son recientes, no recargar
    if (!forceRefresh && lastFullLoad && (now - lastFullLoad) < CACHE_DURATION) {
      console.log('⏳ Dashboard: Usando datos en caché.');
      return;
    }

    if (isLoading) return;
    set({ isLoading: true });

    try {
      console.time('CargaDashboardOptimizado');

      // A. Cargar Estadísticas Globales (Escaneo ligero)
      const stats = await calculateStatsOnTheFly();

      // B. Cargar Listas Paginadas (Solo lo visible)
      const [recentSales, firstPageProducts, categories, allBatches] = await Promise.all([
        // Últimas 50 ventas
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),

        // Primera página de productos (50)
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),

        loadData(STORES.CATEGORIES),
        
        // Cargar todos los lotes (necesarios para cálculo de inventario)
        loadData(STORES.PRODUCT_BATCHES)
      ]);

      // C. Procesar Productos (Unir con lotes bajo demanda)
      const aggregatedMenu = await aggregateProductsWithBatchesOptimized(firstPageProducts);

      set({
        sales: recentSales, // Solo las recientes para la lista visual
        stats: stats,       // Totales reales de toda la BD
        menu: aggregatedMenu,
        rawProducts: firstPageProducts,
        rawBatches: allBatches || [], // Guardar lotes para cálculos
        categories: categories || [],

        // Reset paginación
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

  // 2. Cargar más productos (Scroll Infinito)
  loadMoreProducts: async () => {
    const { menuPage, menuPageSize, hasMoreProducts, menu, rawProducts } = get();

    if (!hasMoreProducts) return;

    try {
      // Cargar siguiente página cruda
      const nextPage = await loadDataPaginated(STORES.MENU, {
        limit: menuPageSize,
        offset: menuPage * menuPageSize
      });

      if (nextPage.length === 0) {
        set({ hasMoreProducts: false });
        return;
      }

      // Enriquecer solo la nueva página con sus lotes
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

  searchProducts: async (query) => {
    if (!query || query.trim().length < 2) {
      // Si está vacío, volvemos a la carga paginada normal
      get().loadAllData(true);
      return;
    }

    set({ isLoading: true });
    try {
      // 1. Búsqueda por CÓDIGO DE BARRAS (Optimizada usando índice)
      const byCode = await searchProductByBarcode(query);

      if (byCode) {
        // Si encontramos por código, enriquecemos con lotes y mostramos
        const aggregatedResult = await aggregateProductsWithBatchesOptimized([byCode]);
        set({ menu: aggregatedResult, isLoading: false, hasMoreProducts: false });
        return;
      }

      // 2. Búsqueda por NOMBRE (Usando el índice optimizado)
      const results = await searchProductsInDB(query);

      // 3. Enriquecer con lotes (para mostrar stock real)
      const aggregatedResults = await aggregateProductsWithBatchesOptimized(results);

      set({
        menu: aggregatedResults,
        isLoading: false,
        hasMoreProducts: false // En búsqueda no paginamos igual
      });

    } catch (error) {
      console.error("Error en búsqueda:", error);
      set({ isLoading: false });
    }
  },

  // 4. Cargar Papelera (Bajo demanda)
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
      // Buscar venta (en memoria o en BD)
      let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) {
        const allSales = await loadData(STORES.SALES);
        saleToDelete = allSales.find(s => s.timestamp === timestamp);
      }

      if (!saleToDelete) return;

      // 1. Restaurar Stock
      for (const item of saleToDelete.items) {
        if (item.batchesUsed) {
          for (const batchInfo of item.batchesUsed) {
            // Cargar lote específico directamente de BD
            const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
            if (batch) {
              batch.stock += batchInfo.quantity;
              batch.isActive = true;
              await saveData(STORES.PRODUCT_BATCHES, batch);
            }
          }
        }
      }

      // 2. Mover a papelera
      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);

      // 3. Recargar datos (para actualizar stats e inventario)
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
        // Al restaurar pedido, solo lo movemos, NO volvemos a descontar stock automáticamente
        // (es complejo saber de qué lote sacar). Se restaura como registro histórico.
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