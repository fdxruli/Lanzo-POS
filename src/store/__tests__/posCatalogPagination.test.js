// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  POS_CATALOG_PAGE_SIZE: 50,
  comparePosCatalogProducts: (left, right) => (
    String(right.createdAt).localeCompare(String(left.createdAt))
    || String(right.id).localeCompare(String(left.id))
  ),
  loadCatalogCategories: vi.fn(),
  queryPosCatalogPage: vi.fn(),
  queryPosCatalogProductById: vi.fn(),
  checkPosOutOfStockProducts: vi.fn(),
  checkPosExpiredProducts: vi.fn()
}));

vi.mock('../../services/products/productCatalogQueryService', () => queryMocks);
vi.mock('../../services/products/productCatalogEvents', () => ({
  subscribeProductCatalogEvents: vi.fn(() => () => {})
}));
vi.mock('../../services/db/databaseRecoveryState', () => ({
  classifyDatabaseError: () => ({ structural: false }),
  isDatabaseRecoveryPending: () => false,
  reportStructuralDatabaseErrorOnce: vi.fn()
}));
vi.mock('../../services/Logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../services/products/productMenuEligibility', () => ({
  CAT_DYNAMIC_EXPIRED: '__expired__',
  CAT_DYNAMIC_OUT_OF_STOCK: '__out__',
  isDynamicPosCategory: (value) => value === '__expired__' || value === '__out__'
}));

import { notifyPosCatalogSessionReset } from '../../services/products/posCatalogSessionEvents';
import { buildPosCatalogViewKey, usePosCatalogStore } from '../usePosCatalogStore';

const makeProducts = (start, count, categoryId = 'general') => Array.from(
  { length: count },
  (_, offset) => {
    const number = start + offset;
    return {
      id: `product-${String(number).padStart(3, '0')}`,
      name: `Product ${number}`,
      categoryId,
      createdAt: `2026-01-${String(number + 1).padStart(2, '0')}T00:00:00.000Z`,
      isActive: true,
      stock: 10
    };
  }
);

const resetStore = (overrides = {}) => {
  usePosCatalogStore.getState().destroy();
  usePosCatalogStore.setState({
    items: [],
    categories: [],
    categoryId: null,
    outOfStockOnly: false,
    expiredOnly: false,
    pageSize: 50,
    nextCursor: null,
    hasMore: true,
    isLoadingInitial: false,
    isLoadingNextPage: false,
    isRefreshing: false,
    initialized: false,
    requestVersion: 0,
    viewKey: 'normal:all',
    loadedPageCount: 0,
    scrollPosition: 0,
    sessionIdentity: 'license-a',
    cursorStack: [null],
    currentPageIndex: 0,
    isLoading: false,
    isInvalidating: false,
    ...overrides
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  queryMocks.loadCatalogCategories.mockResolvedValue([]);
  queryMocks.queryPosCatalogProductById.mockResolvedValue(null);
  queryMocks.checkPosOutOfStockProducts.mockResolvedValue(false);
  queryMocks.checkPosExpiredProducts.mockResolvedValue(false);
  resetStore();
});

const waitForView = async (viewKey) => {
  await vi.waitFor(() => {
    expect(usePosCatalogStore.getState().viewKey).toBe(viewKey);
    expect(usePosCatalogStore.getState().isLoadingInitial).toBe(false);
  });
};

describe('real cumulative POS catalog pagination', () => {
  it('keeps the first 50 products and accumulates the next 50 without duplicates', async () => {
    const firstPage = makeProducts(0, 50);
    const secondPage = makeProducts(50, 50);
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: firstPage, nextCursor: { sortValue: 'cursor-1', id: '50' }, hasMore: true })
      .mockResolvedValueOnce({ data: secondPage, nextCursor: null, hasMore: false });

    await usePosCatalogStore.getState().loadFirstPage();
    await usePosCatalogStore.getState().loadNextPage();

    const state = usePosCatalogStore.getState();
    expect(state.items).toHaveLength(100);
    expect(new Set(state.items.map(({ id }) => id)).size).toBe(100);
    expect(firstPage.every(({ id }) => state.items.some((item) => item.id === id))).toBe(true);
    expect(state.hasMore).toBe(false);

    await usePosCatalogStore.getState().loadNextPage();
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(2);
  });

  it('deduplicates an overlapping product while preserving canonical order', async () => {
    const firstPage = makeProducts(0, 50);
    const secondPage = [firstPage[49], ...makeProducts(50, 49)];
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: firstPage, nextCursor: { sortValue: 'cursor-1', id: '50' }, hasMore: true })
      .mockResolvedValueOnce({ data: secondPage, nextCursor: null, hasMore: false });

    await usePosCatalogStore.getState().loadFirstPage();
    await usePosCatalogStore.getState().loadNextPage();

    expect(usePosCatalogStore.getState().items).toHaveLength(99);
    expect(new Set(usePosCatalogStore.getState().items.map(({ id }) => id)).size).toBe(99);
  });

  it('coalesces concurrent next-page requests into one IndexedDB query', async () => {
    let resolveNext;
    const nextPage = new Promise((resolve) => { resolveNext = resolve; });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 50), nextCursor: { sortValue: 'cursor-1', id: '50' }, hasMore: true })
      .mockReturnValueOnce(nextPage);
    await usePosCatalogStore.getState().loadFirstPage();

    const firstRequest = usePosCatalogStore.getState().loadNextPage();
    const duplicateRequest = usePosCatalogStore.getState().loadNextPage();
    expect(usePosCatalogStore.getState().isLoadingNextPage).toBe(true);
    resolveNext({ data: makeProducts(50, 10), nextCursor: null, hasMore: false });

    await Promise.all([firstRequest, duplicateRequest]);
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(2);
    expect(usePosCatalogStore.getState().items).toHaveLength(60);
    expect(usePosCatalogStore.getState().isLoadingNextPage).toBe(false);
  });

  it('ignores a late page from the previous category', async () => {
    let resolveCategoryA;
    const categoryA = new Promise((resolve) => { resolveCategoryA = resolve; });
    queryMocks.queryPosCatalogPage.mockImplementation(({ categoryId }) => {
      if (categoryId === 'a') return categoryA;
      return Promise.resolve({ data: makeProducts(0, 3, 'b'), nextCursor: null, hasMore: false });
    });
    resetStore({ categoryId: 'a' });

    const pendingA = usePosCatalogStore.getState().loadFirstPage();
    usePosCatalogStore.getState().setFilters({ categoryId: 'b' });
    await vi.waitFor(() => {
      expect(usePosCatalogStore.getState().items.every((item) => item.categoryId === 'b')).toBe(true);
      expect(usePosCatalogStore.getState().items).toHaveLength(3);
    });
    resolveCategoryA({ data: makeProducts(0, 3, 'a'), nextCursor: null, hasMore: false });
    await pendingA;

    expect(usePosCatalogStore.getState().categoryId).toBe('b');
    expect(usePosCatalogStore.getState().items.every((item) => item.categoryId === 'b')).toBe(true);
  });

  it('releases the next-page loading state after an IndexedDB error', async () => {
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 50), nextCursor: { sortValue: 'cursor-1', id: '50' }, hasMore: true })
      .mockRejectedValueOnce(new Error('offline IndexedDB read failed'));
    await usePosCatalogStore.getState().loadFirstPage();

    await expect(usePosCatalogStore.getState().loadNextPage()).resolves.toBe(false);
    expect(usePosCatalogStore.getState()).toMatchObject({
      isLoadingNextPage: false,
      isLoading: false
    });
    expect(usePosCatalogStore.getState().items).toHaveLength(50);
  });

  it('keeps multiple loaded pages visible during a silent reentry refresh', async () => {
    let resolveRefresh;
    const refreshPage = new Promise((resolve) => { resolveRefresh = resolve; });
    resetStore({ items: makeProducts(0, 100), initialized: true, hasMore: false });
    queryMocks.queryPosCatalogPage.mockReturnValueOnce(refreshPage);

    const refresh = usePosCatalogStore.getState().refreshCurrentPages();
    expect(usePosCatalogStore.getState().items).toHaveLength(100);
    expect(usePosCatalogStore.getState().isRefreshing).toBe(true);
    resolveRefresh({ data: makeProducts(0, 50), nextCursor: null, hasMore: false });
    await refresh;

    expect(usePosCatalogStore.getState().items).toHaveLength(50);
    expect(usePosCatalogStore.getState().isRefreshing).toBe(false);
  });
});

describe('session cache for POS catalog views', () => {
  it('builds deterministic and isolated normal and dynamic view keys', () => {
    expect(buildPosCatalogViewKey()).toBe('normal:all');
    expect(buildPosCatalogViewKey({ categoryId: 'a' })).toBe('normal:category:a');
    expect(buildPosCatalogViewKey({ outOfStockOnly: true })).toBe('dynamic:out-of-stock');
    expect(buildPosCatalogViewKey({ expiredOnly: true })).toBe('dynamic:expired');
  });

  it('adds exactly one five-product page per effective loadNextPage trigger', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 5), nextCursor: { sortValue: 'c1', id: '5' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(5, 5), nextCursor: { sortValue: 'c2', id: '10' }, hasMore: true });
    await usePosCatalogStore.getState().loadFirstPage();
    const callsBefore = queryMocks.queryPosCatalogPage.mock.calls.length;

    await usePosCatalogStore.getState().loadNextPage();
    expect(usePosCatalogStore.getState().items).toHaveLength(10);
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('restores three pageSize=5 pages from Todos without querying them again', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 5), nextCursor: { sortValue: 'c1', id: '5' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(5, 5), nextCursor: { sortValue: 'c2', id: '10' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(10, 5), nextCursor: { sortValue: 'c3', id: '15' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(100, 3, 'a'), nextCursor: null, hasMore: false });

    await usePosCatalogStore.getState().loadFirstPage();
    await usePosCatalogStore.getState().loadNextPage();
    await usePosCatalogStore.getState().loadNextPage();
    const allState = usePosCatalogStore.getState();
    expect(allState.items).toHaveLength(15);
    expect(allState.loadedPageCount).toBe(3);

    allState.setFilters({ categoryId: 'a' });
    await waitForView('normal:category:a');
    expect(usePosCatalogStore.getState().items).toHaveLength(3);
    const callsBeforeRestore = queryMocks.queryPosCatalogPage.mock.calls.length;

    usePosCatalogStore.getState().setFilters({ categoryId: null });
    expect(usePosCatalogStore.getState()).toMatchObject({
      viewKey: 'normal:all',
      nextCursor: { sortValue: 'c3', id: '15' },
      hasMore: true,
      loadedPageCount: 3,
      isLoadingInitial: false
    });
    expect(usePosCatalogStore.getState().items).toHaveLength(15);
    expect(new Set(usePosCatalogStore.getState().items.map(({ id }) => id)).size).toBe(15);
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(callsBeforeRestore);
  });

  it('keeps category A and B pages isolated while alternating A to B to A', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 5, 'a'), nextCursor: { sortValue: 'a1', id: '5' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(5, 5, 'a'), nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: makeProducts(20, 5, 'b'), nextCursor: { sortValue: 'b1', id: '25' }, hasMore: true })
      .mockResolvedValueOnce({ data: makeProducts(25, 5, 'b'), nextCursor: null, hasMore: false });

    usePosCatalogStore.getState().setFilters({ categoryId: 'a' });
    await waitForView('normal:category:a');
    await usePosCatalogStore.getState().loadNextPage();
    usePosCatalogStore.getState().setFilters({ categoryId: 'b' });
    await waitForView('normal:category:b');
    await usePosCatalogStore.getState().loadNextPage();
    const callsBeforeRestore = queryMocks.queryPosCatalogPage.mock.calls.length;

    usePosCatalogStore.getState().setFilters({ categoryId: 'a' });
    expect(usePosCatalogStore.getState().items).toHaveLength(10);
    expect(usePosCatalogStore.getState().items.every(({ categoryId }) => categoryId === 'a')).toBe(true);
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(callsBeforeRestore);

    usePosCatalogStore.getState().setFilters({ categoryId: 'b' });
    expect(usePosCatalogStore.getState().items).toHaveLength(10);
    expect(usePosCatalogStore.getState().items.every(({ categoryId }) => categoryId === 'b')).toBe(true);
  });

  it('stores and restores scroll position with the cached view', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 5), nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: makeProducts(20, 2, 'a'), nextCursor: null, hasMore: false });
    await usePosCatalogStore.getState().loadFirstPage();
    usePosCatalogStore.getState().saveScrollPosition(640);
    usePosCatalogStore.getState().setFilters({ categoryId: 'a' });
    await waitForView('normal:category:a');
    usePosCatalogStore.getState().setFilters({ categoryId: null });
    expect(usePosCatalogStore.getState().scrollPosition).toBe(640);
  });

  it('restores a stale cached view immediately and refreshes it silently', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.loadCatalogCategories.mockResolvedValue([{ id: 'a', name: 'A' }]);
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: makeProducts(0, 2), nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: makeProducts(10, 2, 'a'), nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: makeProducts(10, 2, 'a').map((item) => ({ ...item, name: 'Refreshed' })), nextCursor: null, hasMore: false });
    await usePosCatalogStore.getState().loadFirstPage();
    usePosCatalogStore.getState().setFilters({ categoryId: 'a' });
    await waitForView('normal:category:a');
    usePosCatalogStore.getState().setFilters({ categoryId: null });
    usePosCatalogStore.getState().markAllCachedViewsStale();

    usePosCatalogStore.getState().setFilters({ categoryId: 'a' });
    expect(usePosCatalogStore.getState().items[0].name).toBe('Product 10');
    expect(usePosCatalogStore.getState().isRefreshing).toBe(true);
    await vi.waitFor(() => {
      expect(usePosCatalogStore.getState().items[0].name).toBe('Refreshed');
    });
    expect(usePosCatalogStore.getState().isLoadingInitial).toBe(false);
  });

  it('reconciles edits, removals, reactivation and category moves in cached views', async () => {
    const original = makeProducts(0, 1, 'a')[0];
    resetStore({
      pageSize: 5,
      categoryId: 'a',
      viewKey: 'normal:category:a'
    });
    queryMocks.queryPosCatalogPage
      .mockResolvedValueOnce({ data: [original], nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ data: [original], nextCursor: null, hasMore: false });
    await usePosCatalogStore.getState().loadFirstPage();
    usePosCatalogStore.getState().setFilters({ categoryId: 'b' });
    await waitForView('normal:category:b');
    usePosCatalogStore.getState().setFilters({ categoryId: null });
    await waitForView('normal:all');

    const updated = { ...original, name: 'Updated', price: 99 };
    queryMocks.queryPosCatalogProductById.mockImplementation(async (_id, view) => (
      view.categoryId === 'b' ? null : updated
    ));
    await usePosCatalogStore.getState().reconcileProductById(original.id);
    let cache = usePosCatalogStore.getState().getViewCacheSnapshot();
    expect(cache.get('normal:category:a').items[0].name).toBe('Updated');
    expect(cache.get('normal:all').items[0].price).toBe(99);
    expect(cache.get('normal:category:b').items).toEqual([]);

    queryMocks.queryPosCatalogProductById.mockResolvedValue(null);
    await usePosCatalogStore.getState().reconcileProductById(original.id);
    cache = usePosCatalogStore.getState().getViewCacheSnapshot();
    expect([...cache.values()].every((entry) => entry.items.every(({ id }) => id !== original.id))).toBe(true);

    const moved = { ...updated, categoryId: 'b' };
    queryMocks.queryPosCatalogProductById.mockImplementation(async (_id, view) => (
      view.categoryId === 'a' ? null : moved
    ));
    await usePosCatalogStore.getState().reconcileProductById(original.id);
    cache = usePosCatalogStore.getState().getViewCacheSnapshot();
    expect(cache.get('normal:category:a').items).toEqual([]);
    expect(cache.get('normal:category:b').items.map(({ id }) => id)).toEqual([original.id]);
    expect(cache.get('normal:all').items.map(({ id }) => id)).toEqual([original.id]);
  });

  it('enforces a six-view LRU and never keeps data across license identities', async () => {
    resetStore({ pageSize: 5, sessionIdentity: 'license-a' });
    queryMocks.queryPosCatalogPage.mockImplementation(async ({ categoryId }) => ({
      data: makeProducts(Number(String(categoryId).replace('cat-', '')) || 0, 1, categoryId),
      nextCursor: null,
      hasMore: false
    }));

    for (let index = 1; index <= 7; index += 1) {
      usePosCatalogStore.getState().setFilters({ categoryId: `cat-${index}` });
      await waitForView(`normal:category:cat-${index}`);
    }
    const diagnostics = usePosCatalogStore.getState().getViewCacheDiagnostics();
    expect(diagnostics.size).toBe(6);
    expect(diagnostics.keys).toContain('normal:category:cat-7');
    expect(diagnostics.keys).not.toContain('normal:all');

    usePosCatalogStore.getState().setSessionIdentity('license-b');
    expect(usePosCatalogStore.getState().getViewCacheDiagnostics().size).toBe(0);
    expect(usePosCatalogStore.getState()).toMatchObject({
      sessionIdentity: 'license-b',
      items: [],
      viewKey: 'normal:all'
    });
  });

  it('clears every cached view on an explicit logout/session reset event', async () => {
    resetStore({ pageSize: 5 });
    queryMocks.queryPosCatalogPage.mockResolvedValue({
      data: makeProducts(0, 5), nextCursor: null, hasMore: false
    });
    await usePosCatalogStore.getState().loadFirstPage();
    expect(usePosCatalogStore.getState().getViewCacheDiagnostics().size).toBe(1);

    notifyPosCatalogSessionReset();
    expect(usePosCatalogStore.getState().getViewCacheDiagnostics().size).toBe(0);
    expect(usePosCatalogStore.getState().items).toEqual([]);
  });
});
