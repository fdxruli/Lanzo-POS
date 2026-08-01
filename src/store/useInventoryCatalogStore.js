import { create } from 'zustand';
import Logger from '../services/Logger';
import {
  classifyDatabaseError,
  isDatabaseRecoveryPending,
  reportStructuralDatabaseErrorOnce
} from '../services/db/databaseRecoveryState';
import {
  loadCatalogCategories,
  queryInventoryCatalogPage
} from '../services/products/productCatalogQueryService';
import { subscribeProductCatalogEvents } from '../services/products/productCatalogEvents';

const BURST_DEDUPE_MS = 300;
let lastInvalidationTime = 0;
let pendingInvalidation = false;
let unsubscribeCatalogEvents = null;
let initializationRefs = 0;

const initialFilters = {
  categoryId: null,
  status: 'active',
  productType: null,
  outOfStockOnly: false,
  expiredOnly: false
};

const resetInvalidationState = (set) => {
  pendingInvalidation = false;
  set({ isInvalidating: false, isLoading: false });
};

const handleStructuralError = (error, set, context) => {
  if (!classifyDatabaseError(error).structural) return false;
  resetInvalidationState(set);
  reportStructuralDatabaseErrorOnce(error, context);
  return true;
};

const setItems = (items) => ({ items, menu: items });

export const useInventoryCatalogStore = create((set, get) => ({
  items: [],
  menu: [],
  categories: [],
  filters: { ...initialFilters },
  cursorStack: [null],
  currentPageIndex: 0,
  hasMore: true,
  isLoading: false,
  isInvalidating: false,

  initialize: () => {
    initializationRefs += 1;
    if (!unsubscribeCatalogEvents) {
      unsubscribeCatalogEvents = subscribeProductCatalogEvents(() => {
        void get().invalidateAndReset();
      });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      initializationRefs = Math.max(0, initializationRefs - 1);
      if (initializationRefs === 0) {
        unsubscribeCatalogEvents?.();
        unsubscribeCatalogEvents = null;
      }
    };
  },

  destroy: () => {
    initializationRefs = 0;
    unsubscribeCatalogEvents?.();
    unsubscribeCatalogEvents = null;
  },

  setFilters: (newFilters = {}) => {
    const { searchTerm, ...safeFilters } = newFilters;
    void searchTerm;
    if (Object.keys(safeFilters).length === 0) return;
    const currentFilters = get().filters;
    const filters = { ...currentFilters, ...safeFilters };
    if (Object.keys(filters).every((key) => filters[key] === currentFilters[key])) return;

    set({
      filters,
      ...setItems([]),
      cursorStack: [null],
      currentPageIndex: 0,
      hasMore: true
    });
    void get().fetchPage('current');
  },

  fetchPage: async (direction = 'current') => {
    const state = get();
    if (state.isLoading || isDatabaseRecoveryPending()) return false;

    let targetPageIndex = state.currentPageIndex;
    if (direction === 'next' && state.hasMore) targetPageIndex += 1;
    else if (direction === 'prev') targetPageIndex = Math.max(0, targetPageIndex - 1);

    set({ isLoading: true });
    try {
      const targetCursor = state.cursorStack[targetPageIndex] ?? null;
      const { data, nextCursor } = await queryInventoryCatalogPage({
        cursor: targetCursor,
        categoryId: state.filters.categoryId,
        outOfStockOnly: state.filters.outOfStockOnly,
        expiredOnly: state.filters.expiredOnly,
        status: state.filters.status,
        productType: state.filters.productType
      });
      const cursorStack = [...state.cursorStack];
      if (nextCursor) cursorStack[targetPageIndex + 1] = nextCursor;
      set({
        ...setItems(data),
        cursorStack,
        currentPageIndex: targetPageIndex,
        hasMore: Boolean(nextCursor),
        isLoading: false
      });
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-fetch-page')) {
        Logger.error('[InventoryCatalogStore] Error cargando página:', error);
        set({ isLoading: false });
      }
      return false;
    }
  },

  refreshCategories: async () => {
    if (isDatabaseRecoveryPending()) return false;
    const categories = await loadCatalogCategories();
    set({ categories });
    return true;
  },

  loadInitialProducts: async () => {
    if (get().isLoading || isDatabaseRecoveryPending()) return false;
    set({ isLoading: true });
    try {
      const categories = await loadCatalogCategories();
      set({ categories, isLoading: false });
      return await get().fetchPage('current');
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-load-initial')) {
        Logger.error('[InventoryCatalogStore] Error inicializando:', error);
        set({ isLoading: false });
      }
      return false;
    }
  },

  invalidateAndReset: () => {
    const now = Date.now();
    if (isDatabaseRecoveryPending()) {
      resetInvalidationState(set);
      return Promise.resolve(false);
    }
    if (now - lastInvalidationTime < BURST_DEDUPE_MS) return Promise.resolve(false);
    if (get().isInvalidating) {
      pendingInvalidation = true;
      return Promise.resolve(false);
    }

    lastInvalidationTime = now;
    set({
      isInvalidating: true,
      cursorStack: [null],
      currentPageIndex: 0,
      hasMore: true
    });

    let structuralFailure = false;
    return get().refreshCategories()
      .then(() => get().fetchPage('current'))
      .catch((error) => {
        structuralFailure = handleStructuralError(error, set, 'inventory-catalog-invalidation');
        if (!structuralFailure) Logger.error('[InventoryCatalogStore] Error invalidando:', error);
        return false;
      })
      .finally(() => {
        if (structuralFailure || isDatabaseRecoveryPending()) {
          resetInvalidationState(set);
          return;
        }
        set({ isInvalidating: false, isLoading: false });
        if (pendingInvalidation) {
          pendingInvalidation = false;
          lastInvalidationTime = 0;
          void get().invalidateAndReset();
        }
      });
  }
}));

if (typeof window !== 'undefined') {
  useInventoryCatalogStore.getState().initialize();
}
