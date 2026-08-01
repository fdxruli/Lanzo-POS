// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  loadCatalogCategories: vi.fn(),
  queryInventoryCatalogPage: vi.fn(),
  queryPosCatalogPage: vi.fn(),
  queryPosCatalogProductById: vi.fn(),
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

const product = (overrides = {}) => ({
  id: 'electrolit',
  name: 'Electrolit',
  price: 20,
  categoryId: 'drinks',
  productType: 'sellable',
  isActive: true,
  ...overrides
});

const resetPos = (overrides = {}) => {
  usePosCatalogStore.getState().destroy();
  usePosCatalogStore.setState({
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
    ...overrides
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  eventMocks.subscribers.clear();
  queryMocks.loadCatalogCategories.mockResolvedValue([]);
  queryMocks.queryInventoryCatalogPage.mockResolvedValue({ data: [], nextCursor: null });
  queryMocks.queryPosCatalogPage.mockResolvedValue({ data: [], nextCursor: null });
  queryMocks.queryPosCatalogProductById.mockResolvedValue(null);
  queryMocks.checkPosOutOfStockProducts.mockResolvedValue(false);
  queryMocks.checkPosExpiredProducts.mockResolvedValue(false);
  resetPos();
  useInventoryCatalogStore.setState({
    items: [product({ name: 'Inventory product' })],
    menu: [product({ name: 'Inventory product' })],
    filters: {
      categoryId: 'inventory-category',
      status: 'inactive',
      productType: null,
      outOfStockOnly: false,
      expiredOnly: false
    }
  });
});

describe('POS catalog product reconciliation', () => {
  it('updates a visible card name immediately from a directed catalog event', async () => {
    resetPos({ items: [product()], categoryId: 'drinks', initialized: true, isLoading: true });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product({ name: 'Electrolit Fresa' }));
    const before = new Set(eventMocks.subscribers);
    const cleanup = usePosCatalogStore.getState().initialize();
    usePosCatalogStore.setState({ isLoading: false });
    const posSubscriber = [...eventMocks.subscribers].find((subscriber) => !before.has(subscriber));

    posSubscriber({
      productId: 'electrolit',
      productIds: ['electrolit'],
      operation: 'updated',
      source: 'productRepository.saveProduct.local',
      timestamp: 10
    });

    await vi.waitFor(() => {
      expect(usePosCatalogStore.getState().items[0].name).toBe('Electrolit Fresa');
    });
    expect(usePosCatalogStore.getState().categoryId).toBe('drinks');
    cleanup();
  });

  it('updates the price without moving the card', async () => {
    resetPos({ items: [product(), product({ id: 'water', name: 'Water' })] });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product({ price: 24 }));

    await usePosCatalogStore.getState().reconcileProductById('electrolit');

    expect(usePosCatalogStore.getState().items.map((item) => item.id)).toEqual(['electrolit', 'water']);
    expect(usePosCatalogStore.getState().items[0].price).toBe(24);
  });

  it('removes a deactivated product without changing the selected category', async () => {
    resetPos({ items: [product()], categoryId: 'drinks' });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(null);

    await usePosCatalogStore.getState().reconcileProductById('electrolit');

    expect(usePosCatalogStore.getState().items).toEqual([]);
    expect(usePosCatalogStore.getState().categoryId).toBe('drinks');
  });

  it('inserts a reactivated product into the current view', async () => {
    resetPos({ items: [], categoryId: 'drinks' });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product());

    await usePosCatalogStore.getState().reconcileProductById('electrolit');

    expect(usePosCatalogStore.getState().items).toEqual([product()]);
  });

  it.each([
    ['online', 'productRepository.saveProduct'],
    ['offline', 'productRepository.saveProduct.pending']
  ])('inserts a product created %s without changing category', async (_mode, source) => {
    resetPos({ items: [], categoryId: 'drinks', initialized: true, isLoading: true });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product({ id: 'new-product' }));
    const before = new Set(eventMocks.subscribers);
    const cleanup = usePosCatalogStore.getState().initialize();
    usePosCatalogStore.setState({ isLoading: false });
    const posSubscriber = [...eventMocks.subscribers].find((subscriber) => !before.has(subscriber));

    posSubscriber({
      productId: 'new-product',
      productIds: ['new-product'],
      operation: 'created',
      source,
      timestamp: 20
    });

    await vi.waitFor(() => {
      expect(usePosCatalogStore.getState().items.map((item) => item.id)).toEqual(['new-product']);
    });
    expect(usePosCatalogStore.getState().categoryId).toBe('drinks');
    cleanup();
  });

  it('removes a deleted product', async () => {
    resetPos({ items: [product()] });
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    expect(usePosCatalogStore.getState().items).toEqual([]);
  });

  it('moves a product between category views without leaking it into the old view', async () => {
    resetPos({ items: [product()], categoryId: 'drinks' });
    queryMocks.queryPosCatalogProductById.mockResolvedValueOnce(null);
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    expect(usePosCatalogStore.getState().items).toEqual([]);

    usePosCatalogStore.setState({ categoryId: 'sports', items: [] });
    queryMocks.queryPosCatalogProductById.mockResolvedValueOnce(product({ categoryId: 'sports' }));
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    expect(usePosCatalogStore.getState().items[0].categoryId).toBe('sports');
  });

  it('applies ingredient-to-sellable eligibility changes in both directions', async () => {
    resetPos({ items: [] });
    queryMocks.queryPosCatalogProductById.mockResolvedValueOnce(product());
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    expect(usePosCatalogStore.getState().items).toHaveLength(1);

    queryMocks.queryPosCatalogProductById.mockResolvedValueOnce(null);
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    expect(usePosCatalogStore.getState().items).toEqual([]);
  });

  it('keeps only the newest response for repeated events and deduplicates by id', async () => {
    let resolveOld;
    const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
    queryMocks.queryPosCatalogProductById
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(product({ name: 'Newest', price: 30 }));
    resetPos({ items: [product(), product()] });

    const oldRequest = usePosCatalogStore.getState().reconcileProductById('electrolit');
    const newRequest = usePosCatalogStore.getState().reconcileProductById('electrolit');
    await newRequest;
    resolveOld(product({ name: 'Stale', price: 10 }));
    await oldRequest;

    expect(usePosCatalogStore.getState().items).toEqual([product({ name: 'Newest', price: 30 })]);
  });

  it('does not let an older full-view response overwrite a newer directed mutation', async () => {
    let resolveOldPage;
    const oldPage = new Promise((resolve) => { resolveOldPage = resolve; });
    resetPos({ items: [product()], initialized: true });
    queryMocks.queryPosCatalogPage
      .mockReturnValueOnce(oldPage)
      .mockResolvedValueOnce({
        data: [product({ name: 'Newest' })],
        nextCursor: null
      });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product({ name: 'Newest' }));

    const refresh = usePosCatalogStore.getState().refreshCurrentView();
    await vi.waitFor(() => expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(1));
    await usePosCatalogStore.getState().reconcileProductById('electrolit');
    resolveOldPage({ data: [product({ name: 'Stale' })], nextCursor: null });
    await refresh;

    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(2);
    expect(usePosCatalogStore.getState().items[0].name).toBe('Newest');
  });

  it('does not insert a product excluded from the selected category', async () => {
    resetPos({ items: [], categoryId: 'drinks' });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(null);
    await usePosCatalogStore.getState().reconcileProductById('other-category');
    expect(usePosCatalogStore.getState().items).toEqual([]);
  });

  it('coalesces generic event bursts and keeps the current page visible while refreshing', async () => {
    let resolveCurrentPage;
    const currentPage = new Promise((resolve) => { resolveCurrentPage = resolve; });
    resetPos({
      items: [product({ name: 'Visible while loading' })],
      categoryId: 'drinks',
      cursorStack: [null, 'page-2-cursor'],
      currentPageIndex: 1,
      hasMore: false,
      initialized: true
    });
    queryMocks.loadCatalogCategories.mockResolvedValue([{ id: 'drinks', name: 'Drinks' }]);
    queryMocks.queryPosCatalogPage
      .mockReturnValueOnce(currentPage)
      .mockResolvedValueOnce({
        data: [product({ name: 'Refreshed once' })],
        nextCursor: null
      });

    const refresh = usePosCatalogStore.getState().refreshCurrentView();
    await vi.waitFor(() => expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(1));
    const before = new Set(eventMocks.subscribers);
    const cleanup = usePosCatalogStore.getState().initialize();
    const posSubscriber = [...eventMocks.subscribers].find((subscriber) => !before.has(subscriber));
    posSubscriber({ source: 'legacy-event', productIds: [] });
    posSubscriber({ source: 'legacy-event', productIds: [] });

    expect(usePosCatalogStore.getState().items[0].name).toBe('Visible while loading');
    expect(usePosCatalogStore.getState()).toMatchObject({
      categoryId: 'drinks',
      cursorStack: [null, 'page-2-cursor'],
      currentPageIndex: 1,
      hasMore: false
    });

    resolveCurrentPage({ data: [product({ name: 'First response' })], nextCursor: null });
    await refresh;
    await vi.waitFor(() => {
      expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(2);
      expect(usePosCatalogStore.getState().items[0].name).toBe('Refreshed once');
    });
    expect(queryMocks.queryPosCatalogPage).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('preserves POS navigation, cart-like state, and Inventory state', async () => {
    const inventoryBefore = useInventoryCatalogStore.getState();
    const cart = [{ productId: 'cart-product', quantity: 2 }];
    resetPos({
      items: [product()],
      categoryId: 'drinks',
      outOfStockOnly: false,
      expiredOnly: false,
      cursorStack: [null, 'cursor-2'],
      currentPageIndex: 1,
      hasMore: false,
      cart
    });
    queryMocks.queryPosCatalogProductById.mockResolvedValue(product({ name: 'Updated' }));

    await usePosCatalogStore.getState().reconcileProductById('electrolit');

    expect(usePosCatalogStore.getState()).toMatchObject({
      categoryId: 'drinks',
      cursorStack: [null, 'cursor-2'],
      currentPageIndex: 1,
      hasMore: false,
      cart
    });
    expect(useInventoryCatalogStore.getState().items).toEqual(inventoryBefore.items);
    expect(useInventoryCatalogStore.getState().filters).toEqual(inventoryBefore.filters);
  });

  it('refreshes the current page on reentry after events were missed while unmounted', async () => {
    resetPos({ items: [product()], categoryId: 'drinks', initialized: true });
    queryMocks.loadCatalogCategories.mockResolvedValue([{ id: 'drinks', name: 'Drinks' }]);
    queryMocks.queryPosCatalogPage.mockResolvedValue({
      data: [product({ name: 'Changed while away' })],
      nextCursor: 'next-cursor'
    });

    const cleanup = usePosCatalogStore.getState().initialize();

    await vi.waitFor(() => {
      expect(usePosCatalogStore.getState().items[0].name).toBe('Changed while away');
    });
    expect(usePosCatalogStore.getState().categoryId).toBe('drinks');
    cleanup();
  });
});
