import { create } from 'zustand';
import Logger from '../services/Logger';
import {
  classifyDatabaseError,
  isDatabaseRecoveryPending,
  reportStructuralDatabaseErrorOnce
} from '../services/db/databaseRecoveryState';
import {
  compareInventoryCatalogProducts,
  INVENTORY_CATALOG_PAGE_SIZE,
  loadCatalogCategories,
  queryInventoryCatalogPage,
  queryInventoryCatalogProductById
} from '../services/products/productCatalogQueryService';
import { subscribeProductCatalogEvents } from '../services/products/productCatalogEvents';

const BURST_DEDUPE_MS = 300;
let lastInvalidationTime = 0;
let pendingInvalidation = false;
let unsubscribeCatalogEvents = null;
let initializationRefs = 0;
let catalogReconciliationGeneration = 0;
const productReconciliationVersions = new Map();

const initialFilters = {
  categoryId: null,
  status: 'active',
  productType: null,
  outOfStockOnly: false,
  expiredOnly: false
};

const currentView = (state) => ({ ...state.filters });

const isSameView = (state, view) => (
  Object.keys(initialFilters).every((key) => state.filters[key] === view[key])
);

const mergeCatalogItems = (...groups) => {
  const byId = new Map();
  for (const item of groups.flat()) {
    if (item?.id) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareInventoryCatalogProducts);
};

const reconcileCatalogItems = (items, productId, product) => {
  const existingIndex = items.findIndex((item) => item?.id === productId);
  if (!product) return items.filter((item) => item?.id !== productId);
  if (existingIndex < 0) return mergeCatalogItems(items, [product]);

  const existing = items[existingIndex];
  const nextItems = items.filter((item) => item?.id !== productId);
  nextItems.splice(Math.min(existingIndex, nextItems.length), 0, product);
  return existing?.createdAt === product.createdAt
    ? nextItems
    : mergeCatalogItems(nextItems);
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
  if (!pendingInvalidation || state.isRefreshing || state.isLoadingInitial || state.isLoadingNextPage) {
    return;
  }
  pendingInvalidation = false;
  lastInvalidationTime = 0;
  void Promise.resolve().then(() => get().invalidateAndReset());
};

const queryVisiblePages = async ({ view, pageSize, targetPageCount }) => {
  const items = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && pageCount < targetPageCount) {
    const result = await queryInventoryCatalogPage({ ...view, cursor, pageSize });
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

export const useInventoryCatalogStore = create((set, get) => ({
  items: [],
  menu: [],
  categories: [],
  filters: { ...initialFilters },
  pageSize: INVENTORY_CATALOG_PAGE_SIZE,
  nextCursor: null,
  hasMore: true,
  loadedPageCount: 0,
  requestVersion: 0,
  initialized: false,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  isRefreshing: false,

  // Compatibility diagnostics for consumers of the previous pager.
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
    productReconciliationVersions.clear();
    set((state) => ({ initialized: false, requestVersion: state.requestVersion + 1 }));
  },

  setFilters: (newFilters = {}) => {
    const { searchTerm, ...safeFilters } = newFilters;
    void searchTerm;
    if (Object.keys(safeFilters).length === 0) return false;

    const state = get();
    const filters = { ...state.filters, ...safeFilters };
    if (Object.keys(initialFilters).every((key) => filters[key] === state.filters[key])) {
      return false;
    }

    set({
      filters,
      items: [],
      menu: [],
      nextCursor: null,
      cursorStack: [null],
      currentPageIndex: 0,
      loadedPageCount: 0,
      hasMore: true,
      requestVersion: state.requestVersion + 1,
      isLoadingNextPage: false,
      isRefreshing: false
    });
    void get().loadFirstPage();
    return true;
  },

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
      const categories = includeCategories ? await loadCatalogCategories() : null;
      const result = await queryInventoryCatalogPage({ ...view, cursor: null, pageSize });
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;

      set({
        items: result.data,
        menu: result.data,
        ...(categories ? { categories } : {}),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        cursorStack: [null, ...(result.nextCursor ? [result.nextCursor] : [])],
        currentPageIndex: 0,
        loadedPageCount: 1,
        isLoadingInitial: false,
        isLoading: false,
        initialized: true
      });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-load-first-page')) {
        Logger.error('[InventoryCatalogStore] Error cargando primera página:', error);
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
    set({ isLoadingNextPage: true, isLoading: true });
    try {
      const result = await queryInventoryCatalogPage({
        ...view,
        cursor: state.nextCursor,
        pageSize: state.pageSize
      });
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;

      set((current) => {
        const items = mergeCatalogItems(current.items, result.data);
        return {
          items,
          menu: items,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          cursorStack: [...current.cursorStack, ...(result.nextCursor ? [result.nextCursor] : [])],
          currentPageIndex: current.currentPageIndex + 1,
          loadedPageCount: current.loadedPageCount + 1,
          isLoadingNextPage: false,
          isLoading: false
        };
      });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-load-next-page')) {
        Logger.error('[InventoryCatalogStore] Error cargando página siguiente:', error);
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
    const selectedCategoryMissing = get().filters.categoryId
      && !categories.some((category) => category.id === get().filters.categoryId);
    set((state) => ({
      categories,
      ...(selectedCategoryMissing ? {
        filters: { ...state.filters, categoryId: null },
        requestVersion: state.requestVersion + 1
      } : {})
    }));
    return true;
  },

  refreshCurrentPages: async ({ includeCategories = true } = {}) => {
    const state = get();
    if (state.isRefreshing || state.isLoadingInitial || isDatabaseRecoveryPending()) return false;
    const version = state.requestVersion + 1;
    const view = currentView(state);
    const reconciliationGeneration = catalogReconciliationGeneration;
    const targetPageCount = Math.max(1, state.loadedPageCount);
    set({
      requestVersion: version,
      isRefreshing: true,
      isInvalidating: true,
      isLoading: true
    });

    try {
      const categories = includeCategories ? await loadCatalogCategories() : null;
      const result = await queryVisiblePages({
        view,
        pageSize: state.pageSize,
        targetPageCount
      });
      if (get().requestVersion !== version || !isSameView(get(), view)) return false;
      if (reconciliationGeneration !== catalogReconciliationGeneration) {
        set({ isRefreshing: false, isInvalidating: false, isLoading: false });
        return get().refreshCurrentPages({ includeCategories });
      }

      const selectedCategoryMissing = view.categoryId
        && categories
        && !categories.some((category) => category.id === view.categoryId);
      if (selectedCategoryMissing) {
        set({ isRefreshing: false, isInvalidating: false, isLoading: false });
        get().setFilters({ categoryId: null });
        return true;
      }

      set({
        items: result.items,
        menu: result.items,
        ...(categories ? { categories } : {}),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        cursorStack: [null, ...(result.nextCursor ? [result.nextCursor] : [])],
        currentPageIndex: Math.max(0, result.pageCount - 1),
        loadedPageCount: result.pageCount,
        isRefreshing: false,
        isInvalidating: false,
        isLoading: false,
        initialized: true
      });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-refresh-current-pages')) {
        Logger.error('[InventoryCatalogStore] Error refrescando páginas visibles:', error);
      }
      return false;
    } finally {
      if (get().requestVersion === version) {
        set({ isRefreshing: false, isInvalidating: false, isLoading: false });
      }
    }
  },

  loadInitialProducts: () => (
    get().initialized || get().items.length > 0
      ? get().refreshCurrentPages({ includeCategories: true })
      : get().loadFirstPage({ includeCategories: true })
  ),

  reconcileProductById: async (productId) => {
    if (!productId || isDatabaseRecoveryPending()) return false;
    const version = (productReconciliationVersions.get(productId) || 0) + 1;
    productReconciliationVersions.set(productId, version);
    catalogReconciliationGeneration += 1;
    const stateAtStart = get();
    const view = currentView(stateAtStart);
    const requestVersion = stateAtStart.requestVersion;

    try {
      const product = await queryInventoryCatalogProductById(productId, view);
      if (productReconciliationVersions.get(productId) !== version) return false;
      if (get().requestVersion !== requestVersion || !isSameView(get(), view)) return false;

      set((state) => {
        const items = reconcileCatalogItems(state.items, productId, product);
        return { items, menu: items };
      });
      return true;
    } catch (error) {
      if (!handleStructuralError(error, set, 'inventory-catalog-reconcile-product')) {
        Logger.error('[InventoryCatalogStore] Error reconciliando producto:', error);
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
    return get().refreshCurrentPages({ includeCategories: true }).finally(() => {
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
