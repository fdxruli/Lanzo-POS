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
  queryPosCatalogProductById,
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
let catalogReconciliationGeneration = 0;
const productReconciliationVersions = new Map();

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

const drainPendingInvalidation = (get) => {
  if (!pendingInvalidation || get().isInvalidating || get().isLoading) return;
  pendingInvalidation = false;
  lastInvalidationTime = 0;
  void Promise.resolve().then(() => get().invalidateAndReset());
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
      unsubscribeCatalogEvents = subscribeProductCatalogEvents((event) => {
        const productIds = Array.from(new Set([
          ...(Array.isArray(event?.productIds) ? event.productIds : []),
          ...(event?.productId ? [event.productId] : [])
        ].filter(Boolean)));

        if (productIds.length > 0) {
          void Promise.all(productIds.map((productId) => (
            get().reconcileProductById(productId, event)
          )));
          return;
        }
        void get().invalidateAndReset();
      });
    }
    if (initializationRefs === 1 && !get().isLoading) {
      if (get().initialized) void get().refreshCurrentView();
      else void get().loadInitialProducts();
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

  fetchPage: async (direction = 'current', reconciliationRetry = 0) => {
    const state = get();
    if (state.isLoading || isDatabaseRecoveryPending()) return false;
    const reconciliationGeneration = catalogReconciliationGeneration;

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
      if (reconciliationGeneration !== catalogReconciliationGeneration) {
        set({ isLoading: false });
        if (reconciliationRetry < 2) {
          return get().fetchPage(direction, reconciliationRetry + 1);
        }
        return false;
      }
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
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-fetch-page')) {
        Logger.error('[PosCatalogStore] Error cargando página:', error);
        set({ isLoading: false });
        drainPendingInvalidation(get);
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
  refreshCurrentView: async () => {
    if (get().isLoading || isDatabaseRecoveryPending()) return false;
    try {
      await get().refreshCategories();
      return get().fetchPage('current');
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-refresh-current-view')) {
        Logger.error('[PosCatalogStore] Error refrescando vista actual:', error);
      }
      return false;
    }
  },
  checkHasOutOfStockProducts: () => checkPosOutOfStockProducts(),
  checkHasExpiredProducts: () => checkPosExpiredProducts(),

  reconcileProductById: async (productId) => {
    if (!productId || isDatabaseRecoveryPending()) return false;

    const version = (productReconciliationVersions.get(productId) || 0) + 1;
    productReconciliationVersions.set(productId, version);
    catalogReconciliationGeneration += 1;
    const view = {
      categoryId: get().categoryId,
      outOfStockOnly: get().outOfStockOnly,
      expiredOnly: get().expiredOnly
    };

    try {
      const product = await queryPosCatalogProductById(productId, view);
      if (productReconciliationVersions.get(productId) !== version) return false;

      const current = get();
      if (
        current.categoryId !== view.categoryId
        || current.outOfStockOnly !== view.outOfStockOnly
        || current.expiredOnly !== view.expiredOnly
      ) return false;

      set((state) => {
        const existingIndex = state.items.findIndex((item) => item?.id === productId);
        const itemsWithoutProduct = state.items.filter((item) => item?.id !== productId);
        if (!product) return { items: itemsWithoutProduct };

        if (existingIndex < 0) return { items: [...itemsWithoutProduct, product] };
        const nextItems = [...itemsWithoutProduct];
        nextItems.splice(Math.min(existingIndex, nextItems.length), 0, product);
        return { items: nextItems };
      });
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-reconcile-product')) {
        Logger.error('[PosCatalogStore] Error reconciliando producto:', error);
      }
      return false;
    } finally {
      if (productReconciliationVersions.get(productId) === version) {
        productReconciliationVersions.delete(productId);
      }
    }
  },

  invalidateAndReset: () => {
    const now = Date.now();
    if (isDatabaseRecoveryPending()) {
      resetInvalidationState(set);
      return Promise.resolve(false);
    }
    if (get().isLoading) {
      pendingInvalidation = true;
      return Promise.resolve(false);
    }
    if (now - lastInvalidationTime < BURST_DEDUPE_MS) return Promise.resolve(false);
    if (get().isInvalidating) {
      pendingInvalidation = true;
      return Promise.resolve(false);
    }

    lastInvalidationTime = now;
    set({ isInvalidating: true });

    let structuralFailure = false;
    return get().refreshCurrentView()
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
