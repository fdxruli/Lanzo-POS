import { create } from 'zustand';
import {
  loadData,
  saveDataSafe,
  deleteDataSafe,
  bulkDeleteSafe,
  STORES
} from '../services/database';
import Logger from '../services/Logger';
import { restoreDeletedSale } from '../services/salesService';
import { showMessageModal } from '../services/utils';

const RECYCLE_BIN_LIMIT = 50;

const getDeletedDate = (item = {}) => item.deletedTimestamp || item.deletedAt || 0;

const getItemKey = (item = {}) => item.uniqueId || item.id || item.timestamp;

const paginateItems = (items = [], pageIndex = 0) => {
  const safePageIndex = Math.max(0, Number(pageIndex) || 0);
  const start = safePageIndex * RECYCLE_BIN_LIMIT;
  const deletedItems = items.slice(start, start + RECYCLE_BIN_LIMIT);

  return {
    deletedItems,
    currentPageIndex: safePageIndex,
    totalItems: items.length,
    hasPrev: safePageIndex > 0,
    hasMore: start + RECYCLE_BIN_LIMIT < items.length
  };
};

const removeFromState = (state, item) => {
  const key = getItemKey(item);
  const allDeletedItems = state.allDeletedItems.filter((current) => getItemKey(current) !== key);
  const page = paginateItems(allDeletedItems, state.currentPageIndex);

  if (page.deletedItems.length === 0 && page.currentPageIndex > 0) {
    return {
      allDeletedItems,
      ...paginateItems(allDeletedItems, page.currentPageIndex - 1)
    };
  }

  return {
    allDeletedItems,
    ...page
  };
};

export const useRecycleBinStore = create((set, get) => ({
  allDeletedItems: [],
  deletedItems: [],
  currentPageIndex: 0,
  totalItems: 0,
  hasPrev: false,
  hasMore: false,
  isLoading: false,

  loadRecycleBin: async (pageIndex = 0) => {
    set({ isLoading: true });
    try {
      const [delMenu, delCust, delSales, delCats] = await Promise.all([
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES),
        loadData(STORES.DELETED_CATEGORIES)
      ]);

      const allDeletedItems = [
        ...(delMenu || []).map((p) => ({ ...p, type: 'Producto', uniqueId: p.id, mainLabel: p.name })),
        ...(delCust || []).map((c) => ({ ...c, type: 'Cliente', uniqueId: c.id, mainLabel: c.name })),
        ...(delSales || []).map((s) => ({
          ...s,
          type: 'Pedido',
          uniqueId: s.id || s.timestamp,
          mainLabel: `Pedido $${s.total}`
        })),
        ...(delCats || []).map((c) => ({ ...c, type: 'Categoria', uniqueId: c.id, mainLabel: c.name }))
      ].sort((a, b) => new Date(getDeletedDate(b)) - new Date(getDeletedDate(a)));

      set({
        allDeletedItems,
        ...paginateItems(allDeletedItems, pageIndex),
        isLoading: false
      });
    } catch (error) {
      Logger.error('Error cargando papelera', error);
      set({ isLoading: false });
    }
  },

  fetchRecycleBinPage: async (direction = 'current') => {
    const state = get();
    let pageIndex = state.currentPageIndex;

    if (direction === 'next') {
      if (!state.hasMore) return;
      pageIndex += 1;
    } else if (direction === 'prev') {
      if (!state.hasPrev) return;
      pageIndex -= 1;
    }

    const page = paginateItems(state.allDeletedItems, pageIndex);
    set(page);
  },

  restoreItem: async (item) => {
    set({ isLoading: true });
    try {
      if (item.type === 'Pedido') {
        const result = await restoreDeletedSale(item.id || item.timestamp);
        if (!result.success) {
          throw new Error(result.message || 'No se pudo restaurar la venta.');
        }

        set((state) => removeFromState(state, item));
        return result;
      }

      const itemToRestore = structuredClone(item);
      delete itemToRestore.deletedTimestamp;
      delete itemToRestore.deletedAt;
      delete itemToRestore.deletedReason;
      delete itemToRestore.originalStore;
      delete itemToRestore.type;
      delete itemToRestore.uniqueId;
      delete itemToRestore.mainLabel;

      let targetStore = '';
      let trashStore = '';
      const key = item.id;

      switch (item.type) {
        case 'Producto':
          targetStore = STORES.MENU;
          trashStore = STORES.DELETED_MENU;
          itemToRestore.isActive = true;
          break;
        case 'Cliente':
          targetStore = STORES.CUSTOMERS;
          trashStore = STORES.DELETED_CUSTOMERS;
          break;
        case 'Categoria':
          targetStore = STORES.CATEGORIES;
          trashStore = STORES.DELETED_CATEGORIES;
          itemToRestore.isActive = true;
          break;
        default:
          throw new Error('Tipo desconocido para restaurar');
      }

      const saveResult = await saveDataSafe(targetStore, itemToRestore);

      if (!saveResult.success) {
        throw new Error(saveResult.error?.message || 'No se pudo restaurar el elemento.');
      }

      await deleteDataSafe(trashStore, key);
      set((state) => removeFromState(state, item));
      return { success: true };
    } catch (error) {
      Logger.error('Error restaurando:', error);
      return { success: false, message: error.message || 'Error inesperado al restaurar.' };
    } finally {
      set({ isLoading: false });
    }
  },

  permanentlyDelete: async (item) => {
    set({ isLoading: true });
    try {
      let trashStore = '';
      let key = item.id;

      switch (item.type) {
        case 'Producto':
          trashStore = STORES.DELETED_MENU;
          break;
        case 'Cliente':
          trashStore = STORES.DELETED_CUSTOMERS;
          break;
        case 'Categoria':
          trashStore = STORES.DELETED_CATEGORIES;
          break;
        case 'Pedido':
          trashStore = STORES.DELETED_SALES;
          key = item.id || item.timestamp;
          break;
        default:
          throw new Error('Tipo desconocido para eliminar');
      }

      await deleteDataSafe(trashStore, key);
      set((state) => removeFromState(state, item));
    } catch (error) {
      Logger.error('Error eliminando permanentemente', error);
      showMessageModal('Error al eliminar el archivo permanentemente.', null, { type: 'error' });
    } finally {
      set({ isLoading: false });
    }
  },

  emptyBin: async () => {
    set({ isLoading: true });
    try {
      const { allDeletedItems } = get();
      if (allDeletedItems.length === 0) return;

      const itemsByStore = {
        [STORES.DELETED_MENU]: [],
        [STORES.DELETED_CUSTOMERS]: [],
        [STORES.DELETED_CATEGORIES]: [],
        [STORES.DELETED_SALES]: []
      };

      allDeletedItems.forEach((item) => {
        switch (item.type) {
          case 'Producto':
            itemsByStore[STORES.DELETED_MENU].push(item.id);
            break;
          case 'Cliente':
            itemsByStore[STORES.DELETED_CUSTOMERS].push(item.id);
            break;
          case 'Categoria':
            itemsByStore[STORES.DELETED_CATEGORIES].push(item.id);
            break;
          case 'Pedido':
            itemsByStore[STORES.DELETED_SALES].push(item.id || item.timestamp);
            break;
          default:
            break;
        }
      });

      const deletePromises = Object.entries(itemsByStore)
        .filter(([, keys]) => keys.length > 0)
        .map(([store, keys]) => bulkDeleteSafe(store, keys));

      await Promise.all(deletePromises);

      set({
        allDeletedItems: [],
        deletedItems: [],
        currentPageIndex: 0,
        totalItems: 0,
        hasPrev: false,
        hasMore: false
      });
    } catch (error) {
      Logger.error('Error vaciando papelera', error);
      showMessageModal('Hubo un problema al intentar vaciar la papelera.', null, { type: 'error' });
    } finally {
      set({ isLoading: false });
    }
  }
}));
