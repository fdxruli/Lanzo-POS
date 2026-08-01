import { create } from 'zustand';
import Logger from '../services/Logger';
import {
  classifyDatabaseError,
  isDatabaseRecoveryPending,
  reportStructuralDatabaseErrorOnce
} from '../services/db/databaseRecoveryState';
import {
  checkPosExpiredProducts,
  checkPosOutOfStockProducts,
  loadCatalogCategories,
  queryPosCatalogPage
} from '../services/products/productCatalogQueryService';
import { subscribeProductCatalogEvents } from '../services/products/productCatalogEvents';
import {
  CAT_DYNAMIC_EXPIRED,
  CAT_DYNAMIC_OUT_OF_STOCK,
  isDynamicPosCategory
} from '../services/products/productMenuEligibility';

const BURST_DEDUPE_MS = 300;
let lastInvalidationTime = 0;
let pendingInvalidation = false;
let unsubscribeCatalogEvents = null;
let initializationRefs = 0;

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

export const usePosCatalogStore = create((set, get) => ({
  items: [],
  categories: [],
  categoryId: null,
  outOfStockOnly: false,
  expiredOnly: false,
  cursorStack: [null],
  currentPageIndex: 0,
  hasMore: true,
  isLoading: false,
  isInvalidating: false,
  initialized: false,

  initialize: () => {
    initializationRefs += 1;
    if (!unsubscribeCatalogEvents) {
      unsubscribeCatalogEvents = subscribeProductCatalogEvents(() => {
        void get().invalidateAndReset();
      });
    }
    if (!get().initialized && !get().isLoading) void get().loadInitialProducts();

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
    set({ initialized: false });
  },

  setFilters: (filters = {}) => {
    let categoryId = 'categoryId' in filters ? filters.categoryId : get().categoryId;
    let outOfStockOnly = 'outOfStockOnly' in filters
      ? Boolean(filters.outOfStockOnly)
      : get().outOfStockOnly;
    let expiredOnly = 'expiredOnly' in filters
      ? Boolean(filters.expiredOnly)
      : get().expiredOnly;

    if (categoryId === CAT_DYNAMIC_OUT_OF_STOCK) {
      categoryId = null;
      outOfStockOnly = true;
      expiredOnly = false;
    } else if (categoryId === CAT_DYNAMIC_EXPIRED) {
      categoryId = null;
      outOfStockOnly = false;
      expiredOnly = true;
    } else if ('categoryId' in filters) {
      outOfStockOnly = false;
      expiredOnly = false;
    }

    const current = get();
    if (
      categoryId === current.categoryId
      && outOfStockOnly === current.outOfStockOnly
      && expiredOnly === current.expiredOnly
    ) return;

    set({
      categoryId,
      outOfStockOnly,
      expiredOnly,
      items: [],
      cursorStack: [null],
      currentPageIndex: 0,
      hasMore: true
    });
    void get().fetchPage('current');
  },

  setCategoryId: (categoryId) => get().setFilters({ categoryId }),

  fetchPage: async (direction = 'current') => {
    const state = get();
    if (state.isLoading || isDatabaseRecoveryPending()) return false;

    let targetPageIndex = state.currentPageIndex;
    if (direction === 'next' && state.hasMore) targetPageIndex += 1;
    else if (direction === 'prev') targetPageIndex = Math.max(0, targetPageIndex - 1);

    set({ isLoading: true });
    try {
      const targetCursor = state.cursorStack[targetPageIndex] ?? null;
      const { data, nextCursor } = await queryPosCatalogPage({
        cursor: targetCursor,
        categoryId: state.categoryId,
        outOfStockOnly: state.outOfStockOnly,
        expiredOnly: state.expiredOnly
      });
      const cursorStack = [...state.cursorStack];
      if (nextCursor) cursorStack[targetPageIndex + 1] = nextCursor;
      set({
        items: data,
        cursorStack,
        currentPageIndex: targetPageIndex,
        hasMore: Boolean(nextCursor),
        isLoading: false,
        initialized: true
      });
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-fetch-page')) {
        Logger.error('[PosCatalogStore] Error cargando página:', error);
        set({ isLoading: false });
      }
      return false;
    }
  },

  loadNextPage: () => get().fetchPage('next'),

  refreshCategories: async () => {
    if (isDatabaseRecoveryPending()) return false;
    const categories = await loadCatalogCategories();
    const selectedCategoryMissing = get().categoryId
      && !isDynamicPosCategory(get().categoryId)
      && !categories.some((category) => category.id === get().categoryId);
    set({
      categories,
      ...(selectedCategoryMissing ? { categoryId: null } : {})
    });
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
      if (!handleStructuralError(error, set, 'pos-catalog-load-initial')) {
        Logger.error('[PosCatalogStore] Error inicializando:', error);
        set({ isLoading: false });
      }
      return false;
    }
  },

  refreshCatalog: () => get().loadInitialProducts(),
  checkHasOutOfStockProducts: () => checkPosOutOfStockProducts(),
  checkHasExpiredProducts: () => checkPosExpiredProducts(),

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
        structuralFailure = handleStructuralError(error, set, 'pos-catalog-invalidation');
        if (!structuralFailure) Logger.error('[PosCatalogStore] Error invalidando:', error);
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
