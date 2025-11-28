import { create } from 'zustand';
import {
    loadData, saveData, loadDataPaginated, searchProductByBarcode,
    searchProductsInDB, queryByIndex, STORES, initDB
} from '../services/database';

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

export const useProductStore = create((set, get) => ({
    menu: [],
    rawProducts: [],
    categories: [],
    batchesCache: new Map(),
    isLoading: false,

    // Paginación
    menuPage: 0,
    menuPageSize: 50,
    hasMoreProducts: true,

    loadInitialProducts: async () => {
        set({ isLoading: true });
        try {
            const [firstPageProducts, categories] = await Promise.all([
                loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
                loadData(STORES.CATEGORIES)
            ]);

            const aggregatedMenu = await aggregateProductsLazy(firstPageProducts); // Asegúrate de importar/definir esta función

            set({
                menu: aggregatedMenu,
                rawProducts: firstPageProducts,
                categories: categories || [],
                menuPage: 1,
                hasMoreProducts: firstPageProducts.length === 50,
                isLoading: false
            });
        } catch (error) {
            console.error("Error loading products:", error);
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
            get().loadInitialProducts();
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

    // Refrescar solo categorías si es necesario
    refreshCategories: async () => {
        const cats = await loadData(STORES.CATEGORIES);
        set({ categories: cats || [] });
    }
}));