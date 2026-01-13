// src/store/useProductStore.js
import { create } from 'zustand';
import {
  loadDataPaginated,
  loadData,
  searchProductByBarcode,
  searchProductsInDB,
  queryByIndex,
  STORES,
  searchProductBySKU,
  recycleData,
  saveDataSafe,
  getExpiringBatchesInRange,
  queryBatchesByProductIdAndActive
} from '../services/database';
import Logger from '../services/Logger';

export const useProductStore = create((set, get) => ({
  menu: [],
  rawProducts: [], // Mantenido por compatibilidad con BatchManager
  categories: [],
  batchesCache: new Map(),
  isLoading: false,

  // Paginación
  menuPage: 0,
  menuPageSize: 50,
  hasMoreProducts: true,

  // --- BÚSQUEDA ROBUSTA (Código de Barras -> SKU -> Nombre) ---
  searchProducts: async (query) => {
    if (!query || query.trim().length < 2) {
      get().loadInitialProducts();
      return;
    }
    set({ isLoading: true });
    try {
      let results = [];
      // Intento 1: Buscar por código de barras (Búsqueda exacta y rápida)
      const byCode = await searchProductByBarcode(query);
      if (byCode) {
        results = [byCode];
      } else {
        // Intento 2: Buscar por SKU
        const bySKU = await searchProductBySKU(query);
        if (bySKU) {
          results = [bySKU];
        } else {
          // Intento 3: Buscar por nombre en la BD (Búsqueda parcial)
          results = await searchProductsInDB(query);
        }
      }

      // --- CORRECCIÓN 1: Actualizamos rawProducts también ---
      // Esto hace que BatchManager vea los resultados de la búsqueda
      set({
        menu: results,
        rawProducts: results,
        isLoading: false,
        hasMoreProducts: false
      });

    } catch (error) {
      Logger.error("Error en búsqueda:", error);
      set({ isLoading: false });
    }
  },

  scanProductFast: async (barcode) => {
    if (!barcode) return null;

    try {
      // A. Búsqueda Principal
      let product = await searchProductByBarcode(barcode);

      // B. Fallback: Búsqueda por SKU (Variantes)
      if (!product) {
        product = await searchProductBySKU(barcode);
      }

      if (!product) return null;

      // C. LÓGICA DE LOTES (FIFO) - Centralizada aquí
      // Si el producto gestiona lotes, buscamos el precio del lote más antiguo
      if (product.batchManagement?.enabled) {
        try {
          // Traemos lotes activos
          const activeBatches = await queryBatchesByProductIdAndActive(product.id, true);

          if (activeBatches && activeBatches.length > 0) {
            // Ordenar FIFO (Primero en entrar, primero en salir)
            activeBatches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const currentBatch = activeBatches[0];

            // Inyectamos el precio y costo del lote real
            return {
              ...product,
              price: parseFloat(currentBatch.price) || product.price,
              cost: parseFloat(currentBatch.cost) || product.cost,
              batchId: currentBatch.id, // Importante para descontar stock correctamente
              stock: currentBatch.stock // Stock visual del lote
            };
          }
        } catch (batchError) {
          Logger.warn("Error resolviendo lote en FastScan:", batchError);
        }
      }

      // Si no hay lotes o falló, devolvemos el producto base
      return product;

    } catch (error) {
      Logger.error("Error en Fast Scan:", error);
      return null;
    }
  },

  deleteProduct: async (productId) => {
    // Confirmación simple
    if (!window.confirm("¿Estás seguro de mover este producto a la Papelera?")) return;

    set({ isLoading: true });
    try {
      // Usamos la función maestra 'recycleData'
      const result = await recycleData(
        STORES.MENU,           // Origen
        STORES.DELETED_MENU,   // Destino
        productId,             // ID
        "Eliminado desde Catálogo" // Razón
      );

      if (result.success) {
        // Actualizar estado local
        const newMenu = get().menu.filter(p => p.id !== productId);
        set({
          menu: newMenu,
          rawProducts: newMenu, // Importante sincronizar ambos
          isLoading: false
        });
        // Opcional: Mostrar mensaje de éxito
        // alert("Producto enviado a la papelera"); 
      } else {
        alert("Error al eliminar: " + (result.message || "No encontrado"));
        set({ isLoading: false });
      }
    } catch (error) {
      console.error("Error eliminando producto:", error);
      set({ isLoading: false });
    }
  },

  deleteCategory: async (categoryId) => {
    if (!window.confirm("¿Eliminar categoría? Los productos dentro quedarán 'Sin Categoría'.")) return;

    set({ isLoading: true });
    try {
      // 1. Primero respaldamos en Papelera (Auditoría)
      const categories = get().categories;
      const catToDelete = categories.find(c => c.id === categoryId);

      if (catToDelete) {
        const deletedCat = {
          ...catToDelete,
          deletedTimestamp: new Date().toISOString(),
          deletedReason: "Categoría eliminada y desvinculada"
        };
        await saveDataSafe(STORES.DELETED_CATEGORIES, deletedCat);
      }

      // 2. Ejecutamos el borrado en cascada (Borra la cat y limpia los productos)
      // Usamos la función especial que ya tenías en database.js
      const result = await deleteCategoryCascading(categoryId);

      if (result.success) {
        // 3. Actualizar UI
        set({
          categories: categories.filter(c => c.id !== categoryId),
          isLoading: false
        });

        // Recargamos productos para reflejar que ya no tienen esa categoría
        get().loadInitialProducts();
      }
    } catch (error) {
      console.error("Error eliminando categoría:", error);
      set({ isLoading: false });
    }
  },

  // --- CARGA INICIAL (Paginada) ---
  loadInitialProducts: async () => {
    set({ isLoading: true });
    try {
      const [productsPage, categories] = await Promise.all([
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadDataPaginated(STORES.CATEGORIES)
      ]);

      set({
        menu: productsPage,
        rawProducts: productsPage, // Sincronizado
        categories: categories || [],
        menuPage: 1,
        hasMoreProducts: productsPage.length === 50,
        isLoading: false
      });
    } catch (error) {
      Logger.error("Error loading products:", error);
      set({ isLoading: false });
    }
  },

  // --- PAGINACIÓN (Scroll Infinito) ---
  loadMoreProducts: async () => {
    const { menuPage, menuPageSize, hasMoreProducts, menu } = get();
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

      // --- CORRECCIÓN 2: Filtrar duplicados ---
      // Esto arregla el error de que el botón de editar no sirva después del item 50
      const currentIds = new Set(menu.map(p => p.id));
      const uniqueNextPage = nextPage.filter(p => !currentIds.has(p.id));

      const newFullList = [...menu, ...uniqueNextPage];

      set({
        menu: newFullList,
        rawProducts: newFullList, // --- CORRECCIÓN 3: Sincronizar rawProducts ---
        menuPage: menuPage + 1,
        hasMoreProducts: nextPage.length === menuPageSize
      });
    } catch (error) {
      Logger.error("Error paginando:", error);
    }
  },

  // --- GESTIÓN DE LOTES (SIN CACHÉ OBSOLETO) ---
  loadBatchesForProduct: async (productId) => {
    // 🔧 CORRECCIÓN CRÍTICA: NO usar caché para lotes
    // Los lotes cambian constantemente con las ventas, así que SIEMPRE
    // debemos leer desde la BD para tener datos frescos.

    const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);

    // Opcional: Actualizar caché solo para referencia, pero NO lo usamos como fuente de verdad
    const newCache = new Map(get().batchesCache);
    newCache.set(productId, batches);
    set({ batchesCache: newCache });

    return batches;
  },

  refreshCategories: async () => {
    const cats = await loadData(STORES.CATEGORIES);
    set({ categories: cats || [] });
  },

  // --- FUNCIONALIDAD 1: STOCK BAJO ---
  getLowStockProducts: () => {
    const { menu } = get();
    return menu.filter(p =>
      p.isActive !== false &&
      p.trackStock &&
      p.minStock > 0 &&
      p.stock <= p.minStock
    ).map(p => {
      const targetStock = p.maxStock && p.maxStock > p.minStock
        ? p.maxStock
        : (p.minStock * 2);
      const deficit = targetStock - p.stock;
      return {
        id: p.id,
        name: p.name,
        currentStock: p.stock,
        minStock: p.minStock,
        maxStock: p.maxStock || targetStock,
        suggestedOrder: Math.ceil(deficit),
        supplierName: p.supplier || 'Proveedor General',
        unit: p.saleType === 'bulk' ? (p.bulkData?.purchase?.unit || 'kg') : 'pza'
      };
    });
  },

  // --- FUNCIONALIDAD 2: CADUCIDAD ---
  getExpiringProducts: async (daysThreshold = 30) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Calculamos fecha límite (Hoy + 30 días)
      const thresholdDate = new Date(today);
      thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
      const thresholdIso = thresholdDate.toISOString();

      // 1. CARGA INTELIGENTE: Solo lotes en riesgo y lista de productos (para nombres)
      const [riskBatches, allProducts] = await Promise.all([
        getExpiringBatchesInRange(thresholdIso), // <--- La magia de velocidad ocurre aquí
        loadData(STORES.MENU)
      ]);

      // 2. Mapeo de Lotes (Batches)
      const batchAlerts = riskBatches.map(batch => {
        const product = allProducts.find(p => p.id === batch.productId);
        const expDate = new Date(batch.expiryDate);
        const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

        return {
          id: batch.id,
          productId: batch.productId,
          productName: product ? product.name : `Producto Eliminado (${batch.sku || '?'})`,
          stock: batch.stock,
          expiryDate: batch.expiryDate,
          daysRemaining: diffDays,
          batchSku: batch.sku || 'Lote',
          location: batch.location || (product?.location || ''),
          type: 'Lote'
        };
      });

      // 3. Mapeo de Productos Simples (Sin Lotes)
      // Estos son pocos, así que el filtro en memoria está bien
      const productAlerts = allProducts
        .filter(p => {
          if (!p.shelfLife || !p.isActive) return false;
          if (p.trackStock && p.stock <= 0) return false;
          const expDate = new Date(p.shelfLife);
          if (isNaN(expDate.getTime())) return false;
          return expDate <= thresholdDate; // Comparación de fechas
        })
        .map(p => {
          const diffDays = Math.ceil((new Date(p.shelfLife) - today) / (1000 * 60 * 60 * 24));
          return {
            id: p.id,
            productId: p.id,
            productName: p.name,
            stock: p.stock,
            expiryDate: p.shelfLife,
            daysRemaining: diffDays,
            batchSku: 'General',
            location: p.location || '',
            type: 'Producto'
          };
        });

      // Unir y ordenar por urgencia
      return [...batchAlerts, ...productAlerts].sort((a, b) => a.daysRemaining - b.daysRemaining);

    } catch (error) {
      Logger.error("Error verificando caducidades:", error);
      return [];
    }
  }
}));