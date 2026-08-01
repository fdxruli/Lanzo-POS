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

import { usePosCatalogStore } from '../usePosCatalogStore';

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
