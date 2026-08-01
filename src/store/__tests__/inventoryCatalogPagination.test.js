// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  INVENTORY_CATALOG_PAGE_SIZE: 50,
  compareInventoryCatalogProducts: (left, right) => String(right.id).localeCompare(String(left.id)),
  loadCatalogCategories: vi.fn(),
  queryInventoryCatalogPage: vi.fn(),
  queryInventoryCatalogProductById: vi.fn()
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

import { useInventoryCatalogStore } from '../useInventoryCatalogStore';

const initialState = () => ({
  items: [],
  menu: [],
  categories: [],
  filters: {
    categoryId: null,
    status: 'active',
    productType: 'sellable',
    outOfStockOnly: false,
    expiredOnly: false
  },
  pageSize: 50,
  nextCursor: null,
  hasMore: true,
  loadedPageCount: 0,
  requestVersion: 0,
  initialized: false,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  isRefreshing: false,
  cursorStack: [null],
  currentPageIndex: 0,
  isLoading: false,
  isInvalidating: false
});

const makeProducts = (start, count) => Array.from({ length: count }, (_, index) => ({
  id: `product-${String(start + index).padStart(3, '0')}`,
  createdAt: '2026-08-01T12:00:00.000Z',
  productType: 'sellable',
  isActive: true
}));

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryCatalogStore.setState(initialState());
  queryMocks.loadCatalogCategories.mockResolvedValue([]);
  queryMocks.queryInventoryCatalogPage.mockResolvedValue({
    data: [],
    nextCursor: null,
    hasMore: false
  });
  queryMocks.queryInventoryCatalogProductById.mockResolvedValue(null);
});

describe('Inventory catalog accumulation and concurrency', () => {
  it('accumulates 50 + 2 products instead of replacing the first page', async () => {
    const firstPage = makeProducts(0, 50);
    const secondPage = makeProducts(50, 2);
    queryMocks.queryInventoryCatalogPage
      .mockResolvedValueOnce({
        data: firstPage,
        nextCursor: { createdAt: '2026-08-01T12:00:00.000Z', id: 'product-000' },
        hasMore: true
      })
      .mockResolvedValueOnce({ data: secondPage, nextCursor: null, hasMore: false });

    await useInventoryCatalogStore.getState().loadFirstPage();
    await useInventoryCatalogStore.getState().loadNextPage();

    expect(useInventoryCatalogStore.getState().items).toHaveLength(52);
    expect(new Set(useInventoryCatalogStore.getState().items.map(({ id }) => id)).size).toBe(52);
    expect(useInventoryCatalogStore.getState().hasMore).toBe(false);
  });

  it('coalesces two rapid next-page requests into one effective query', async () => {
    let resolvePage;
    const pendingPage = new Promise((resolve) => { resolvePage = resolve; });
    useInventoryCatalogStore.setState({
      items: makeProducts(0, 50),
      menu: makeProducts(0, 50),
      nextCursor: { createdAt: '2026-08-01T12:00:00.000Z', id: 'product-000' },
      hasMore: true,
      loadedPageCount: 1,
      initialized: true
    });
    queryMocks.queryInventoryCatalogPage.mockReturnValueOnce(pendingPage);

    const first = useInventoryCatalogStore.getState().loadNextPage();
    const second = useInventoryCatalogStore.getState().loadNextPage();
    expect(queryMocks.queryInventoryCatalogPage).toHaveBeenCalledTimes(1);

    resolvePage({ data: makeProducts(50, 2), nextCursor: null, hasMore: false });
    await Promise.all([first, second]);
    expect(useInventoryCatalogStore.getState().items).toHaveLength(52);
  });

  it('ignores a stale category response after the view changes', async () => {
    let resolveOldView;
    const oldView = new Promise((resolve) => { resolveOldView = resolve; });
    queryMocks.queryInventoryCatalogPage.mockImplementation(({ categoryId }) => {
      if (categoryId === 'old-category') return oldView;
      return Promise.resolve({
        data: [{ id: 'new-category-product', categoryId: 'new-category' }],
        nextCursor: null,
        hasMore: false
      });
    });

    useInventoryCatalogStore.getState().setFilters({ categoryId: 'old-category' });
    await vi.waitFor(() => expect(queryMocks.queryInventoryCatalogPage).toHaveBeenCalledTimes(1));
    useInventoryCatalogStore.getState().setFilters({ categoryId: 'new-category' });
    await vi.waitFor(() => {
      expect(useInventoryCatalogStore.getState().items).toEqual([
        { id: 'new-category-product', categoryId: 'new-category' }
      ]);
    });

    resolveOldView({
      data: [{ id: 'stale-product', categoryId: 'old-category' }],
      nextCursor: null,
      hasMore: false
    });
    await Promise.resolve();
    expect(useInventoryCatalogStore.getState().items.map(({ id }) => id))
      .toEqual(['new-category-product']);
  });

  it('reconciles edits, category changes, deletion and productType changes by id', async () => {
    useInventoryCatalogStore.setState({
      items: [{ id: 'product-1', name: 'Old', categoryId: 'selected' }],
      menu: [{ id: 'product-1', name: 'Old', categoryId: 'selected' }],
      filters: { ...initialState().filters, categoryId: 'selected' },
      initialized: true
    });

    queryMocks.queryInventoryCatalogProductById.mockResolvedValueOnce({
      id: 'product-1',
      name: 'Updated',
      categoryId: 'selected'
    });
    await useInventoryCatalogStore.getState().reconcileProductById('product-1');
    expect(useInventoryCatalogStore.getState().items[0].name).toBe('Updated');

    queryMocks.queryInventoryCatalogProductById.mockResolvedValueOnce(null);
    await useInventoryCatalogStore.getState().reconcileProductById('product-1');
    expect(useInventoryCatalogStore.getState().items).toEqual([]);

    queryMocks.queryInventoryCatalogProductById.mockResolvedValueOnce({
      id: 'product-2',
      name: 'New sellable',
      categoryId: 'selected',
      productType: 'sellable'
    });
    await useInventoryCatalogStore.getState().reconcileProductById('product-2');
    expect(useInventoryCatalogStore.getState().items.map(({ id }) => id)).toEqual(['product-2']);
  });
});
