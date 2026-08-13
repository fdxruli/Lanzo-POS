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
import { registerPosCatalogSessionResetHandler } from '../services/products/posCatalogSessionEvents';
import { getTenantRuntimeReadiness } from '../services/db/tenantRuntimeRouter';
import { localTenantAccessController } from '../services/tenant/localTenantPolicy';
import {
  CAT_DYNAMIC_EXPIRED,
  CAT_DYNAMIC_OUT_OF_STOCK,
  isDynamicPosCategory
} from '../services/products/productMenuEligibility';

const BURST_DEDUPE_MS = 300;
export const POS_CATALOG_VIEW_CACHE_LIMIT = 6;
let lastInvalidationTime = 0;
let pendingInvalidation = false;
let pendingInvalidationRuntime = null;
let lastKnownRuntime = null;
let unsubscribeCatalogEvents = null;
let initializationRefs = 0;
let catalogReconciliationGeneration = 0;
const productReconciliationVersions = new Map();
const viewCache = new Map();

export const buildPosCatalogViewKey = ({
  categoryId = null,
  outOfStockOnly = false,
  expiredOnly = false
} = {}) => {
  if (outOfStockOnly) return 'dynamic:out-of-stock';
  if (expiredOnly) return 'dynamic:expired';
  if (categoryId !== null && categoryId !== undefined) {
    return `normal:category:${String(categoryId)}`;
  }
  return 'normal:all';
};

const currentView = (state) => ({
  categoryId: state.categoryId,
  outOfStockOnly: state.outOfStockOnly,
  expiredOnly: state.expiredOnly
});

const clearViewCache = () => {
  viewCache.clear();
};

const enforceViewCacheLimit = (protectedViewKey = null) => {
  while (viewCache.size > POS_CATALOG_VIEW_CACHE_LIMIT) {
    const evictionKey = [...viewCache.keys()].find((key) => key !== protectedViewKey);
    if (!evictionKey) break;
    viewCache.delete(evictionKey);
  }
};

const writeViewCache = (viewKey, entry, protectedViewKey = viewKey) => {
  if (!viewKey) return;
  viewCache.delete(viewKey);
  viewCache.set(viewKey, {
    ...entry,
    items: [...(entry.items || [])],
    updatedAt: entry.updatedAt || Date.now()
  });
  enforceViewCacheLimit(protectedViewKey);
};

const touchCachedView = (viewKey) => {
  const entry = viewCache.get(viewKey);
  if (!entry) return null;
  viewCache.delete(viewKey);
  viewCache.set(viewKey, entry);
  return entry;
};

const cacheStateView = (state, overrides = {}) => {
  if (!state.initialized && state.loadedPageCount === 0 && state.items.length === 0) return;
  const view = currentView(state);
  const viewKey = state.viewKey || buildPosCatalogViewKey(view);
  const existing = viewCache.get(viewKey);
  writeViewCache(viewKey, {
    view,
    items: state.items,
    nextCursor: state.nextCursor,
    hasMore: state.hasMore,
    loadedPageCount: state.loadedPageCount ?? Math.max(1, state.currentPageIndex + 1),
    scrollPosition: existing?.scrollPosition ?? state.scrollPosition ?? 0,
    stale: false,
    sessionIdentity: state.sessionIdentity,
    ...overrides
  }, viewKey);
};

const markCachedViewsStale = () => {
  for (const [viewKey, entry] of viewCache) {
    viewCache.set(viewKey, { ...entry, stale: true });
  }
};

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
  set({
    isInvalidating: false,
    isLoading: false,
    isLoadingInitial: false,
    isLoadingNextPage: false,
    isRefreshing: false
  });
};

const runtimeKey = (runtime) => runtime && `${runtime.opaqueId}:${runtime.generation}`;
const captureRuntimeReadiness = () => {
  const readiness = getTenantRuntimeReadiness();
  if (readiness.ready && readiness.runtime) lastKnownRuntime = readiness.runtime;
  return readiness;
};
const isExpectedTenantLifecycleError = (error) => [
  'TENANT_RUNTIME_NOT_READY',
  'TENANT_RUNTIME_STALE_HANDLE',
  'LOCAL_TENANT_ACCESS_REQUIRED'
].includes(error?.code || error?.message);
const deferInvalidationForUnavailableRuntime = (set) => {
  const readiness = captureRuntimeReadiness();
  if (readiness.ready) return false;
  const runtime = readiness.runtime || lastKnownRuntime;
  pendingInvalidation = Boolean(runtime);
  pendingInvalidationRuntime = runtime || null;
  resetInvalidationState(set);
  return true;
};

const handleStructuralError = (error, set, context) => {
  if (!classifyDatabaseError(error).structural) return false;
  pendingInvalidation = false;
  pendingInvalidationRuntime = null;
  clearViewCache();
  resetInvalidationState(set);
  reportStructuralDatabaseErrorOnce(error, context);
  return true;
};

const drainPendingInvalidation = (get) => {
  const state = get();
  if (!pendingInvalidation || state.isRefreshing || state.isLoadingInitial || state.isLoadingNextPage) return;
  pendingInvalidation = false;
  pendingInvalidationRuntime = null;
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
  viewKey: buildPosCatalogViewKey(),
  loadedPageCount: 0,
  scrollPosition: 0,
  sessionIdentity: null,

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
        markCachedViewsStale();
        void get().invalidateAndReset();
      });
    }

    let state = get();
    if (state.initialized) {
      const cachedActiveView = touchCachedView(state.viewKey);
      if (cachedActiveView?.sessionIdentity === state.sessionIdentity) {
        set({
          items: [...cachedActiveView.items],
          nextCursor: cachedActiveView.nextCursor,
          hasMore: cachedActiveView.hasMore,
          loadedPageCount: cachedActiveView.loadedPageCount,
          scrollPosition: cachedActiveView.scrollPosition
        });
        state = get();
      }
    }
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

  destroy: ({ clearCache = true } = {}) => {
    initializationRefs = 0;
    unsubscribeCatalogEvents?.();
    unsubscribeCatalogEvents = null;
    if (clearCache) clearViewCache();
    pendingInvalidation = false;
    pendingInvalidationRuntime = null;
    lastKnownRuntime = null;
    set((state) => ({ initialized: false, requestVersion: state.requestVersion + 1 }));
  },

  setSessionIdentity: (sessionIdentity) => {
    const normalizedIdentity = sessionIdentity ? String(sessionIdentity) : null;
    const state = get();
    if (state.sessionIdentity === normalizedIdentity) return false;
    clearViewCache();
    pendingInvalidation = false;
    productReconciliationVersions.clear();
    set({
      items: [],
      categoryId: null,
      outOfStockOnly: false,
      expiredOnly: false,
      viewKey: buildPosCatalogViewKey(),
      loadedPageCount: 0,
      scrollPosition: 0,
      nextCursor: null,
      hasMore: true,
      initialized: false,
      isLoadingInitial: false,
      isLoadingNextPage: false,
      isRefreshing: false,
      isLoading: false,
      cursorStack: [null],
      currentPageIndex: 0,
      requestVersion: state.requestVersion + 1,
      sessionIdentity: normalizedIdentity
    });
    return true;
  },

  saveScrollPosition: (scrollPosition) => {
    const state = get();
    const numericPosition = Math.max(0, Number(scrollPosition) || 0);
    cacheStateView(state, { scrollPosition: numericPosition });
  },

  clearViewCache: () => {
    clearViewCache();
    set({ scrollPosition: 0 });
  },

  getViewCacheSnapshot: () => new Map(
    [...viewCache].map(([key, entry]) => [key, { ...entry, items: [...entry.items] }])
  ),

  getViewCacheDiagnostics: () => ({
    size: viewCache.size,
    keys: [...viewCache.keys()],
    limit: POS_CATALOG_VIEW_CACHE_LIMIT
  }),

  markAllCachedViewsStale: () => {
    markCachedViewsStale();
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

    cacheStateView(state);
    const nextView = { categoryId, outOfStockOnly, expiredOnly };
    const nextViewKey = buildPosCatalogViewKey(nextView);
    const cachedView = touchCachedView(nextViewKey);
    const canRestore = cachedView
      && cachedView.sessionIdentity === state.sessionIdentity;

    if (canRestore) {
      set({
        ...nextView,
        viewKey: nextViewKey,
        items: [...cachedView.items],
        nextCursor: cachedView.nextCursor,
        hasMore: cachedView.hasMore,
        loadedPageCount: cachedView.loadedPageCount,
        scrollPosition: cachedView.scrollPosition,
        cursorStack: [null, ...(cachedView.nextCursor ? [cachedView.nextCursor] : [])],
        currentPageIndex: Math.max(0, cachedView.loadedPageCount - 1),
        requestVersion: state.requestVersion + 1,
        isLoadingInitial: false,
        isLoadingNextPage: false,
        isRefreshing: false,
        isLoading: false,
        initialized: true
      });
      if (cachedView.stale) void get().refreshCurrentPages();
      return;
    }

    if (cachedView) viewCache.delete(nextViewKey);

    set({
      ...nextView,
      viewKey: nextViewKey,
      items: [],
      nextCursor: null,
      hasMore: true,
      loadedPageCount: 0,
      scrollPosition: 0,
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
    if (isDatabaseRecoveryPending() || !captureRuntimeReadiness().ready) return false;
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
        loadedPageCount: 1,
        scrollPosition: 0,
        isLoadingInitial: false,
        isLoading: false,
        initialized: true
      });
      cacheStateView(get(), { stale: false });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (isExpectedTenantLifecycleError(error)) {
        resetInvalidationState(set);
      } else if (!handleStructuralError(error, set, 'pos-catalog-load-first-page')) {
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
      || !captureRuntimeReadiness().ready
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
        loadedPageCount: current.loadedPageCount + 1,
        isLoadingNextPage: false,
        isLoading: false
      }));
      cacheStateView(get(), { stale: false });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (isExpectedTenantLifecycleError(error)) {
        resetInvalidationState(set);
      } else if (!handleStructuralError(error, set, 'pos-catalog-load-next-page')) {
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
    if (isDatabaseRecoveryPending() || !captureRuntimeReadiness().ready) return false;
    const categories = await loadCatalogCategories();
    const selectedCategoryMissing = get().categoryId
      && !isDynamicPosCategory(get().categoryId)
      && !categories.some((category) => category.id === get().categoryId);
    set({ categories, ...(selectedCategoryMissing ? { categoryId: null } : {}) });
    return true;
  },

  refreshCurrentPages: async (retry = 0) => {
    const state = get();
    if (state.isRefreshing || state.isLoadingInitial || isDatabaseRecoveryPending() || !captureRuntimeReadiness().ready) return false;
    const version = state.requestVersion + 1;
    const view = currentView(state);
    const reconciliationGeneration = catalogReconciliationGeneration;
    const targetCount = Math.max(
      Math.max(1, state.loadedPageCount) * state.pageSize,
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
        set({ isRefreshing: false, isInvalidating: false });
        get().setFilters({ categoryId: null });
        return true;
      }

      set({
        categories,
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        currentPageIndex: Math.max(0, result.pageCount - 1),
        loadedPageCount: result.pageCount,
        isRefreshing: false,
        isInvalidating: false,
        initialized: true
      });
      cacheStateView(get(), { stale: false });
      drainPendingInvalidation(get);
      return true;
    } catch (error) {
      if (isExpectedTenantLifecycleError(error)) {
        deferInvalidationForUnavailableRuntime(set);
      } else if (!handleStructuralError(error, set, 'pos-catalog-refresh-current-pages')) {
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
    if (!productId || isDatabaseRecoveryPending() || !captureRuntimeReadiness().ready) return false;
    const version = (productReconciliationVersions.get(productId) || 0) + 1;
    productReconciliationVersions.set(productId, version);
    catalogReconciliationGeneration += 1;
    const stateAtStart = get();
    cacheStateView(stateAtStart);
    if (!viewCache.has(stateAtStart.viewKey)) {
      writeViewCache(stateAtStart.viewKey, {
        view: currentView(stateAtStart),
        items: stateAtStart.items,
        nextCursor: stateAtStart.nextCursor,
        hasMore: stateAtStart.hasMore,
        loadedPageCount: stateAtStart.loadedPageCount,
        scrollPosition: stateAtStart.scrollPosition,
        stale: false,
        sessionIdentity: stateAtStart.sessionIdentity
      }, stateAtStart.viewKey);
    }
    const sessionIdentity = stateAtStart.sessionIdentity;
    const cachedViews = [...viewCache.entries()]
      .filter(([, entry]) => entry.sessionIdentity === sessionIdentity);

    try {
      const reconciledViews = await Promise.all(cachedViews.map(async ([viewKey, entry]) => ({
        viewKey,
        entry,
        product: await queryPosCatalogProductById(productId, entry.view)
      })));
      if (productReconciliationVersions.get(productId) !== version) return false;

      for (const { viewKey, entry, product } of reconciledViews) {
        writeViewCache(viewKey, {
          ...entry,
          items: reconcileCatalogItems(entry.items, productId, product),
          stale: false,
          updatedAt: Date.now()
        }, get().viewKey);
      }

      const activeState = get();
      const activeEntry = viewCache.get(activeState.viewKey);
      if (activeEntry?.sessionIdentity === activeState.sessionIdentity) {
        set({ items: [...activeEntry.items] });
      }
      return true;
    } catch (error) {
      if (isExpectedTenantLifecycleError(error)) {
        resetInvalidationState(set);
      } else if (!handleStructuralError(error, set, 'pos-catalog-reconcile-product')) {
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
    if (deferInvalidationForUnavailableRuntime(set)) return Promise.resolve(false);
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
    clearViewCache();
    pendingInvalidation = false;
    pendingInvalidationRuntime = null;
    productReconciliationVersions.clear();
    set({
      items: [],
      categoryId: null,
      outOfStockOnly: false,
      expiredOnly: false,
      viewKey: buildPosCatalogViewKey(),
      loadedPageCount: 0,
      scrollPosition: 0,
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

registerPosCatalogSessionResetHandler(() => {
  usePosCatalogStore.getState().reset();
});

localTenantAccessController.subscribe(() => {
  const readiness = captureRuntimeReadiness();
  if (!pendingInvalidation || !readiness.ready || !readiness.runtime) return;
  if (runtimeKey(readiness.runtime) !== runtimeKey(pendingInvalidationRuntime)) {
    pendingInvalidation = false;
    pendingInvalidationRuntime = null;
    return;
  }
  pendingInvalidation = false;
  pendingInvalidationRuntime = null;
  lastInvalidationTime = 0;
  void Promise.resolve().then(() => usePosCatalogStore.getState().invalidateAndReset());
});
