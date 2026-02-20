import { create } from 'zustand';
import {
  deleteCategoryCascading,
  loadData,
  loadDataPaginated,
  recycleData,
  saveDataSafe,
  searchProductByBarcode,
  searchProductsInDB,
  searchProductBySKU,
  STORES
} from '../services/database';
import Logger from '../services/Logger';

export const useProductStore = create((set, get) => ({
  menu: [],
  rawProducts: [],
  categories: [],
  isLoading: false,

  menuPage: 0,
  menuPageSize: 50,
  hasMoreProducts: true,

  searchProducts: async (query) => {
    if (!query || query.trim().length < 2) {
      get().loadInitialProducts();
      return;
    }

    set({ isLoading: true });
    try {
      let results = [];
      const byCode = await searchProductByBarcode(query);

      if (byCode) {
        results = [byCode];
      } else {
        const bySKU = await searchProductBySKU(query);
        if (bySKU) {
          results = [bySKU];
        } else {
          results = await searchProductsInDB(query);
        }
      }

      set({
        menu: results,
        rawProducts: results,
        isLoading: false,
        hasMoreProducts: false
      });
    } catch (error) {
      Logger.error('Error en busqueda:', error);
      set({ isLoading: false });
    }
  },

  deleteProduct: async (productId) => {
    if (!window.confirm('¿Estas seguro de mover este producto a la Papelera?')) return;

    set({ isLoading: true });
    try {
      const result = await recycleData(
        STORES.MENU,
        STORES.DELETED_MENU,
        productId,
        'Eliminado desde Catalogo'
      );

      if (result.success) {
        const newMenu = get().menu.filter((product) => product.id !== productId);
        set({
          menu: newMenu,
          rawProducts: newMenu,
          isLoading: false
        });
      } else {
        alert(`Error al eliminar: ${result.message || 'No encontrado'}`);
        set({ isLoading: false });
      }
    } catch (error) {
      Logger.error('Error eliminando producto:', error);
      set({ isLoading: false });
    }
  },

  deleteCategory: async (categoryId) => {
    if (!window.confirm("¿Eliminar categoria? Los productos dentro quedaran 'Sin Categoria'.")) {
      return;
    }

    set({ isLoading: true });
    try {
      const categories = get().categories;
      const categoryToDelete = categories.find((category) => category.id === categoryId);

      // Ejecutar primero la eliminación real
      const result = await deleteCategoryCascading(categoryId);

      if (result.success) {
        // Solo si tuvo éxito, creamos el registro en la papelera
        if (categoryToDelete) {
          await saveDataSafe(STORES.DELETED_CATEGORIES, {
            ...categoryToDelete,
            deletedTimestamp: new Date().toISOString(),
            deletedReason: 'Categoria eliminada y desvinculada'
          });
        }

        set({
          categories: categories.filter((category) => category.id !== categoryId),
          isLoading: false
        });
        get().loadInitialProducts();
      } else {
        // Bloquear el fallo silencioso
        alert(`No se pudo eliminar la categoría: ${result.message || 'Error desconocido'}`);
        set({ isLoading: false });
      }
    } catch (error) {
      Logger.error('Error eliminando categoria:', error);
      alert('Error crítico al intentar eliminar la categoría.');
      set({ isLoading: false });
    }
  },

  loadInitialProducts: async () => {
    set({ isLoading: true });
    try {
      const [productsPage, categories] = await Promise.all([
        loadDataPaginated(STORES.MENU, { limit: 50, offset: 0 }),
        loadDataPaginated(STORES.CATEGORIES)
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
      Logger.error('Error loading products:', error);
      set({ isLoading: false });
    }
  },

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

      const currentIds = new Set(menu.map((product) => product.id));
      const uniqueNextPage = nextPage.filter((product) => !currentIds.has(product.id));
      const newFullList = [...menu, ...uniqueNextPage];

      set({
        menu: newFullList,
        rawProducts: newFullList,
        menuPage: menuPage + 1,
        hasMoreProducts: nextPage.length === menuPageSize
      });
    } catch (error) {
      Logger.error('Error paginando:', error);
    }
  },

  refreshCategories: async () => {
    const categories = await loadData(STORES.CATEGORIES);
    set({ categories: categories || [] });
  }
}));

