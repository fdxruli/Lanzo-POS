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
  comparePosCatalogProducts,
  loadCatalogCategories,
  POS_CATALOG_PAGE_SIZE,
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

const currentView = (state) => ({
  categoryId: state.categoryId,
  outOfStockOnly: state.outOfStockOnly,
  expiredOnly: state.expiredOnly
});

const isSameView = (state, view) => (
  state.categoryId === view.categoryId
  && state.outOfStockOnly === view.outOfStockOnly
  && state.expiredOnly === view.expiredOnly
);

const mergeCatalogItems = (...groups) => {
  const byId = new Map();
  for (const item of groups.flat()) {
    if (item?.id) byId.set(item.id, item);
  }
  return [...byId.values()].sort(comparePosCatalogProducts);
};

const resetInvalidationState = (set) => {
  pendingInvalidation = false;
  set({
    isInvalidating: false,
    isLoading: false,
    isLoadingInitial: false,
    isLoadingNextPage: false,
    isRefreshing: false
  });
};

const handleStructuralError = (error, set, context) => {
  if (!classifyDatabaseError(error).structural) return false;
  resetInvalidationState(set);
  reportStructuralDatabaseErrorOnce(error, context);
  return true;
};

const drainPendingInvalidation = (get) => {
  const state = get();
  if (!pendingInvalidation || state.isRefreshing || state.isLoadingInitial || state.isLoadingNextPage) return;
  pendingInvalidation = false;
  lastInvalidationTime = 0;
  void Promise.resolve().then(() => get().invalidateAndReset());
};

const queryVisiblePages = async ({ view, pageSize, targetCount }) => {
  const items = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && items.length < targetCount) {
    const result = await queryPosCatalogPage({ ...view, cursor, pageSize });
    items.push(...result.data);
    cursor = result.nextCursor;
    hasMore = result.hasMore;
    pageCount += 1;
  }

  return {
    items: mergeCatalogItems(items),
    nextCursor: cursor,
    hasMore,
    pageCount
  };
};

export const usePosCatalogStore = create((set, get) => ({
  items: [],
  categories: [],
  categoryId: null,
  outOfStockOnly: false,
  expiredOnly: false,
  pageSize: POS_CATALOG_PAGE_SIZE,
  nextCursor: null,
  hasMore: true,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  isRefreshing: false,
  initialized: false,
  requestVersion: 0,

  // Kept as compatibility diagnostics for callers/tests from the previous pager.
  cursorStack: [null],
  currentPageIndex: 0,
  isLoading: false,
  isInvalidating: false,

  initialize: () => {
    initializationRefs += 1;
    if (!unsubscribeCatalogEvents) {
      unsubscribeCatalogEvents = subscribeProductCatalogEvents((event) => {
        const productIds = Array.from(new Set([
          ...(Array.isArray(event?.productIds) ? event.productIds : []),
          ...(event?.productId ? [event.productId] : [])
        ].filter(Boolean)));

        if (productIds.length > 0) {
          void Promise.all(productIds.map((productId) => get().reconcileProductById(productId)));
          return;
        }
        void get().invalidateAndReset();
      });
    }

    const state = get();
    if (
      initializationRefs === 1
      && !state.isLoading
      && !state.isLoadingInitial
      && !state.isLoadingNextPage
      && !state.isRefreshing
    ) {
      if (get().initialized) void get().refreshCurrentPages();
      else void get().loadFirstPage({ includeCategories: true });
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
    set((state) => ({ initialized: false, requestVersion: state.requestVersion + 1 }));
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

    const state = get();
    if (
      categoryId === state.categoryId
      && outOfStockOnly === state.outOfStockOnly
      && expiredOnly === state.expiredOnly
    ) return;

    set({
      categoryId,
      outOfStockOnly,
      expiredOnly,
      items: [],
      nextCursor: null,
      hasMore: true,
      cursorStack: [null],
      currentPageIndex: 0,
      requestVersion: state.requestVersion + 1,
      isLoadingNextPage: false,
      isRefreshing: false
    });
    void get().loadFirstPage();
  },

  setCategory: (categoryId) => get().setFilters({ categoryId }),
  setCategoryId: (categoryId) => get().setFilters({ categoryId }),

  loadFirstPage: async ({ includeCategories = false } = {}) => {
    if (isDatabaseRecoveryPending()) return false;
    const version = get().requestVersion + 1;
    const view = currentView(get());
    const pageSize = get().pageSize;
    set({
      requestVersion: version,
      isLoadingInitial: true,
      isLoading: true,
      isLoadingNextPage: false,
      nextCursor: null,
      hasMore: true
    });

    try {
      const [result, categories] = await Promise.all([
        queryPosCatalogPage({ ...view, cursor: null, pageSize }),
        includeCategories ? loadCatalogCategories() : Promise.resolve(null)
      ]);
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;

      set({
        items: result.data,
        ...(categories ? { categories } : {}),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        cursorStack: [null, ...(result.nextCursor ? [result.nextCursor] : [])],
        currentPageIndex: 0,
        isLoadingInitial: false,
        isLoading: false,
        initialized: true
      });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-load-first-page')) {
        Logger.error('[PosCatalogStore] Error cargando primera página:', error);
        if (get().requestVersion === version) set({ isLoadingInitial: false, isLoading: false });
      }
      return false;
    } finally {
      if (get().requestVersion === version) set({ isLoadingInitial: false, isLoading: false });
    }
  },

  loadNextPage: async () => {
    const state = get();
    if (
      !state.hasMore
      || state.isLoadingNextPage
      || state.isLoadingInitial
      || state.isRefreshing
      || isDatabaseRecoveryPending()
    ) return false;

    const version = state.requestVersion;
    const view = currentView(state);
    const cursor = state.nextCursor;
    set({ isLoadingNextPage: true, isLoading: true });
    try {
      const result = await queryPosCatalogPage({
        ...view,
        cursor,
        pageSize: state.pageSize
      });
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;

      set((current) => ({
        items: mergeCatalogItems(current.items, result.data),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        cursorStack: [...current.cursorStack, ...(result.nextCursor ? [result.nextCursor] : [])],
        currentPageIndex: current.currentPageIndex + 1,
        isLoadingNextPage: false,
        isLoading: false
      }));
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-load-next-page')) {
        Logger.error('[PosCatalogStore] Error cargando página siguiente:', error);
      }
      return false;
    } finally {
      if (get().requestVersion === version) set({ isLoadingNextPage: false, isLoading: false });
    }
  },

  fetchPage: (direction = 'current') => (
    direction === 'next' ? get().loadNextPage() : get().loadFirstPage()
  ),

  refreshCategories: async () => {
    if (isDatabaseRecoveryPending()) return false;
    const categories = await loadCatalogCategories();
    const selectedCategoryMissing = get().categoryId
      && !isDynamicPosCategory(get().categoryId)
      && !categories.some((category) => category.id === get().categoryId);
    set({ categories, ...(selectedCategoryMissing ? { categoryId: null } : {}) });
    return true;
  },

  refreshCurrentPages: async (retry = 0) => {
    const state = get();
    if (state.isRefreshing || state.isLoadingInitial || isDatabaseRecoveryPending()) return false;
    const version = state.requestVersion + 1;
    const view = currentView(state);
    const reconciliationGeneration = catalogReconciliationGeneration;
    const targetCount = Math.max(
      (Math.max(0, state.currentPageIndex) + 1) * state.pageSize,
      state.pageSize
    );
    set({ requestVersion: version, isRefreshing: true, isInvalidating: true });

    try {
      const [categories, result] = await Promise.all([
        loadCatalogCategories(),
        queryVisiblePages({ view, pageSize: state.pageSize, targetCount })
      ]);
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;
      if (reconciliationGeneration !== catalogReconciliationGeneration) {
        set({ isRefreshing: false, isInvalidating: false });
        return retry < 2 ? get().refreshCurrentPages(retry + 1) : false;
      }

      const selectedCategoryMissing = view.categoryId
        && !categories.some((category) => category.id === view.categoryId);
      if (selectedCategoryMissing) {
        set({ categoryId: null, isRefreshing: false, isInvalidating: false });
        return get().loadFirstPage();
      }

      set({
        categories,
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        currentPageIndex: Math.max(0, result.pageCount - 1),
        isRefreshing: false,
        isInvalidating: false,
        initialized: true
      });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'pos-catalog-refresh-current-pages')) {
        Logger.error('[PosCatalogStore] Error refrescando páginas visibles:', error);
      }
      return false;
    } finally {
      if (get().requestVersion === version) set({ isRefreshing: false, isInvalidating: false });
    }
  },

  loadInitialProducts: () => get().loadFirstPage({ includeCategories: true }),
  refreshCatalog: () => get().refreshCurrentPages(),
  refreshCurrentView: () => get().refreshCurrentPages(),
  checkHasOutOfStockProducts: () => checkPosOutOfStockProducts(),
  checkHasExpiredProducts: () => checkPosExpiredProducts(),

  reconcileProductById: async (productId) => {
    if (!productId || isDatabaseRecoveryPending()) return false;
    const version = (productReconciliationVersions.get(productId) || 0) + 1;
    productReconciliationVersions.set(productId, version);
    catalogReconciliationGeneration += 1;
    const view = currentView(get());

    try {
      const product = await queryPosCatalogProductById(productId, view);
      if (productReconciliationVersions.get(productId) !== version) return false;
      if (!isSameView(get(), view)) return false;

      set((state) => {
        const existingIndex = state.items.findIndex((item) => item?.id === productId);
        if (!product) {
          return { items: state.items.filter((item) => item?.id !== productId) };
        }
        if (existingIndex < 0) return { items: mergeCatalogItems(state.items, [product]) };

        const existing = state.items[existingIndex];
        const items = state.items.filter((item) => item?.id !== productId);
        items.splice(Math.min(existingIndex, items.length), 0, product);
        return {
          items: existing?.createdAt === product.createdAt
            ? items
            : mergeCatalogItems(items)
        };
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
    const state = get();
    if (isDatabaseRecoveryPending()) {
      resetInvalidationState(set);
      return Promise.resolve(false);
    }
    if (state.isRefreshing || state.isLoadingInitial || state.isLoadingNextPage) {
      pendingInvalidation = true;
      return Promise.resolve(false);
    }
    if (now - lastInvalidationTime < BURST_DEDUPE_MS) return Promise.resolve(false);

    lastInvalidationTime = now;
    return get().refreshCurrentPages().finally(() => {
      if (pendingInvalidation) {
        pendingInvalidation = false;
        lastInvalidationTime = 0;
        void get().invalidateAndReset();
      }
    });
  },

  reset: () => {
    const version = get().requestVersion + 1;
    set({
      items: [],
      nextCursor: null,
      hasMore: true,
      isLoadingInitial: false,
      isLoadingNextPage: false,
      isRefreshing: false,
      isLoading: false,
      initialized: false,
      cursorStack: [null],
      currentPageIndex: 0,
      requestVersion: version
    });
  }
}));
