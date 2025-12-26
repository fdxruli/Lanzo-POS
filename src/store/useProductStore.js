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
  rawProducts: [], // Mantenido por compatibilidad
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
      // Intento 1: Buscar por código de barras (Búsqueda exacta y rápida)
      const byCode = await searchProductByBarcode(query);
      if (byCode) {
        set({ menu: [byCode], isLoading: false, hasMoreProducts: false });
        return;
      }

      // Intento 2: Buscar por SKU (Para variantes específicas de ropa/ferretería)
      const bySKU = await searchProductBySKU(query);
      if (bySKU) {
        set({ menu: [bySKU], isLoading: false, hasMoreProducts: false });
        return;
      }

      // Intento 3: Buscar por nombre en la BD (Búsqueda parcial)
      const results = await searchProductsInDB(query);
      set({ menu: results, isLoading: false, hasMoreProducts: false });
    } catch (error) {
      console.error("Error en búsqueda:", error);
      set({ isLoading: false });
    }
  },

  // --- CARGA INICIAL (Paginada) ---
  loadInitialProducts: async () => {
    set({ isLoading: true });
    try {
      // Carga paralela de productos y categorías para optimizar tiempo
      const [productsPage, categories] = await Promise.all([
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadDataPaginated(STORES.CATEGORIES) // Cargamos categorías base
      ]);

      set({
        menu: productsPage,
        rawProducts: productsPage,
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

      // --- CORRECCIÓN: Filtrar duplicados antes de agregar ---
      const existingIds = new Set(menu.map(p => p.id));
      const uniqueNextPage = nextPage.filter(p => !existingIds.has(p.id));

      set({
        menu: [...menu, ...uniqueNextPage],
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
    // Cargamos lotes específicos desde la BD
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

  // --- FUNCIONALIDAD 1: PRODUCTOS CON STOCK BAJO (Reabastecimiento) ---
  getLowStockProducts: () => {
    const { menu } = get();

    // Filtramos productos activos, que controlan stock y están bajo el mínimo
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

  // --- FUNCIONALIDAD 2: ALERTAS DE CADUCIDAD (MEJORADA) ---
  /**
   * Obtiene tanto LOTES como PRODUCTOS DIRECTOS que están por vencer.
   * @param {number} daysThreshold - Días de anticipación para la alerta (default 30)
   */
  getExpiringProducts: async (daysThreshold = 30) => {
    try {
      // 1. Cargamos TODOS los datos necesarios en paralelo (Lotes y Productos)
      // Necesitamos cargar todos los productos de todos modos para obtener nombres,
      // así que aprovechamos para buscar 'shelfLife' ahí.
      const [allBatches, allProducts] = await Promise.all([
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.MENU)
      ]);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thresholdDate = new Date(today);
      thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

      // 2. Procesar LOTES (Lógica existente)
      const batchAlerts = allBatches
        .filter(batch => {
          if (!batch.expiryDate || batch.stock <= 0) return false;
          const expDate = new Date(batch.expiryDate);
          return expDate <= thresholdDate;
        })
        .map(batch => {
          const product = allProducts.find(p => p.id === batch.productId);
          const productName = product ? product.name : `Producto ID: ${batch.productId}`;
          const expDate = new Date(batch.expiryDate);
          const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

          return {
            id: batch.id,
            productId: batch.productId,
            productName: productName,
            stock: batch.stock,
            expiryDate: batch.expiryDate,
            daysRemaining: diffDays,
            batchSku: batch.sku || 'Lote', // En la columna SKU saldrá el código del lote
            location: batch.location || ''
          };
        });

      // 3. Procesar PRODUCTOS SIMPLES (Nueva lógica: shelfLife)
      const productAlerts = allProducts
        .filter(p => {
          // Debe tener shelfLife, estar activo, y fecha válida
          if (!p.shelfLife || !p.isActive) return false;

          // Si controla stock, ignoramos si ya no hay (opcional, para no alertar basura)
          if (p.trackStock && p.stock <= 0) return false;

          const expDate = new Date(p.shelfLife);
          if (isNaN(expDate.getTime())) return false; // Fecha inválida

          return expDate <= thresholdDate;
        })
        .map(p => {
          const expDate = new Date(p.shelfLife);
          const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

          return {
            id: p.id, // Usamos ID del producto
            productId: p.id,
            productName: p.name,
            stock: p.stock,
            expiryDate: p.shelfLife,
            daysRemaining: diffDays,
            batchSku: 'General', // Etiqueta visual para indicar que no es un lote específico
            location: p.location || ''
          };
        });

      // 4. Combinar y Ordenar por urgencia
      const report = [...batchAlerts, ...productAlerts];
      return report.sort((a, b) => a.daysRemaining - b.daysRemaining);

    } catch (error) {
      console.error("Error verificando caducidades:", error);
      return [];
    }
  }
}));
