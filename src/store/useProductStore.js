// src/store/useProductStore.js
import { create } from 'zustand';
import {
  loadDataPaginated,
  loadData,
  searchProductByBarcode,
  searchProductsInDB,
  queryByIndex,
  STORES,
  searchProductBySKU
} from '../services/database';

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
      console.error("Error en búsqueda:", error);
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
      console.error("Error loading products:", error);
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
      console.error("Error paginando:", error);
    }
  },

  // --- GESTIÓN DE LOTES ---
  loadBatchesForProduct: async (productId) => {
    const { batchesCache } = get();
    const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);

    const newCache = new Map(batchesCache);
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
      const [allBatches, allProducts] = await Promise.all([
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.MENU)
      ]);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thresholdDate = new Date(today);
      thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

      const batchAlerts = allBatches
        .filter(batch => {
          if (!batch.expiryDate || batch.stock <= 0) return false;
          const expDate = new Date(batch.expiryDate);
          return expDate <= thresholdDate;
        })
        .map(batch => {
          const product = allProducts.find(p => p.id === batch.productId);
          const diffDays = Math.ceil((new Date(batch.expiryDate) - today) / (1000 * 60 * 60 * 24));
          return {
            id: batch.id,
            productId: batch.productId,
            productName: product ? product.name : `Producto ID: ${batch.productId}`,
            stock: batch.stock,
            expiryDate: batch.expiryDate,
            daysRemaining: diffDays,
            batchSku: batch.sku || 'Lote',
            location: batch.location || ''
          };
        });

      const productAlerts = allProducts
        .filter(p => {
            if (!p.shelfLife || !p.isActive) return false;
            if (p.trackStock && p.stock <= 0) return false;
            const expDate = new Date(p.shelfLife);
            if (isNaN(expDate.getTime())) return false;
            return expDate <= thresholdDate;
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
                location: p.location || ''
            };
        });

      return [...batchAlerts, ...productAlerts].sort((a, b) => a.daysRemaining - b.daysRemaining);
    } catch (error) {
      console.error("Error verificando caducidades:", error);
      return [];
    }
  }
}));