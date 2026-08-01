// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  loadCatalogCategories: vi.fn(),
  queryInventoryCatalogPage: vi.fn(),
  queryPosCatalogPage: vi.fn(),
  checkPosOutOfStockProducts: vi.fn(),
  checkPosExpiredProducts: vi.fn()
}));

const eventMocks = vi.hoisted(() => ({ subscribers: new Set() }));

vi.mock('../../services/products/productCatalogQueryService', () => queryMocks);
vi.mock('../../services/products/productCatalogEvents', () => ({
  subscribeProductCatalogEvents: vi.fn((subscriber) => {
    eventMocks.subscribers.add(subscriber);
    return () => eventMocks.subscribers.delete(subscriber);
  })
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

import { useInventoryCatalogStore } from '../useInventoryCatalogStore';
import { usePosCatalogStore } from '../usePosCatalogStore';

const inventoryInitialState = () => ({
  items: [],
  menu: [],
  categories: [],
  filters: {
    categoryId: null,
    status: 'active',
    productType: null,
    outOfStockOnly: false,
    expiredOnly: false
  },
  cursorStack: [null],
  currentPageIndex: 0,
  hasMore: true,
  isLoading: false,
  isInvalidating: false
});
const posInitialState = () => ({
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
  initialized: false
});

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryCatalogStore.setState(inventoryInitialState());
  usePosCatalogStore.setState(posInitialState());
  queryMocks.loadCatalogCategories.mockResolvedValue([]);
  queryMocks.queryInventoryCatalogPage.mockResolvedValue({ data: [], nextCursor: null });
  queryMocks.queryPosCatalogPage.mockResolvedValue({ data: [], nextCursor: null });
  queryMocks.checkPosOutOfStockProducts.mockResolvedValue(false);
  queryMocks.checkPosExpiredProducts.mockResolvedValue(false);
});

describe('Inventory/POS catalog state isolation', () => {
  it('keeps categories and administrative status filters independent', () => {
    useInventoryCatalogStore.getState().setFilters({ categoryId: 'inventory-cat', status: 'inactive' });

    expect(useInventoryCatalogStore.getState().filters).toMatchObject({
      categoryId: 'inventory-cat',
      status: 'inactive'
    });
    expect(usePosCatalogStore.getState().categoryId).toBeNull();

    usePosCatalogStore.getState().setCategoryId('pos-cat');
    expect(usePosCatalogStore.getState().categoryId).toBe('pos-cat');
    expect(useInventoryCatalogStore.getState().filters.categoryId).toBe('inventory-cat');
  });

  it('advances the inventory page without moving the POS cursor', async () => {
    useInventoryCatalogStore.setState({ cursorStack: [null, 'inventory-cursor'], hasMore: true });
    queryMocks.queryInventoryCatalogPage.mockResolvedValueOnce({
      data: [{ id: 'inventory-page-2' }],
      nextCursor: null
    });

    await useInventoryCatalogStore.getState().fetchPage('next');

    expect(useInventoryCatalogStore.getState().currentPageIndex).toBe(1);
    expect(usePosCatalogStore.getState().currentPageIndex).toBe(0);
  });

  it('refreshes either catalog without clearing the other one', async () => {
    useInventoryCatalogStore.setState({
      items: [{ id: 'inventory-old' }],
      menu: [{ id: 'inventory-old' }]
    });
    usePosCatalogStore.setState({ items: [{ id: 'pos-old' }] });
    queryMocks.queryInventoryCatalogPage.mockResolvedValueOnce({
      data: [{ id: 'inventory-new' }],
      nextCursor: null
    });

    await useInventoryCatalogStore.getState().loadInitialProducts();
    expect(usePosCatalogStore.getState().items).toEqual([{ id: 'pos-old' }]);

    queryMocks.queryPosCatalogPage.mockResolvedValueOnce({
      data: [{ id: 'pos-new' }],
      nextCursor: null
    });
    await usePosCatalogStore.getState().loadInitialProducts();
    expect(useInventoryCatalogStore.getState().items).toEqual([{ id: 'inventory-new' }]);
  });

  it('registers one subscription per store and sends a product event to both', async () => {
    const cleanupOne = usePosCatalogStore.getState().initialize();
    const cleanupTwo = usePosCatalogStore.getState().initialize();
    expect(eventMocks.subscribers.size).toBe(2);

    queryMocks.queryInventoryCatalogPage.mockResolvedValue({
      data: [{ id: 'inventory-event' }],
      nextCursor: null
    });
    queryMocks.queryPosCatalogPage.mockResolvedValue({
      data: [{ id: 'pos-event' }],
      nextCursor: null
    });

    for (const subscriber of [...eventMocks.subscribers]) {
      subscriber({ source: 'lanzo:products-sync-updated' });
    }
    await vi.waitFor(() => {
      expect(queryMocks.queryInventoryCatalogPage).toHaveBeenCalled();
      expect(queryMocks.queryPosCatalogPage).toHaveBeenCalled();
    });

    cleanupTwo();
    cleanupOne();
  });
});
