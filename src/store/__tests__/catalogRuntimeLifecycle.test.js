// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readiness: { ready: true, runtime: { opaqueId: 'tenant-a', generation: 1 } },
  tenantListener: null,
  catalogListener: null,
  queryPage: vi.fn(),
  categories: vi.fn(),
  errors: vi.fn()
}));

vi.mock('../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => mocks.readiness
}));
vi.mock('../../services/tenant/localTenantPolicy', () => ({
  localTenantAccessController: { subscribe: (listener) => { mocks.tenantListener = listener; return () => {}; } }
}));
vi.mock('../../services/products/productCatalogEvents', () => ({
  subscribeProductCatalogEvents: (listener) => { mocks.catalogListener = listener; return () => {}; }
}));
vi.mock('../../services/products/productCatalogQueryService', () => ({
  INVENTORY_CATALOG_PAGE_SIZE: 50,
  compareInventoryCatalogProducts: () => 0,
  loadCatalogCategories: mocks.categories,
  queryInventoryCatalogPage: mocks.queryPage,
  queryInventoryCatalogProductById: vi.fn()
}));
vi.mock('../../services/db/databaseRecoveryState', () => ({
  classifyDatabaseError: () => ({ structural: false }),
  isDatabaseRecoveryPending: () => false,
  reportStructuralDatabaseErrorOnce: vi.fn()
}));
vi.mock('../../services/Logger', () => ({ default: { error: mocks.errors, warn: vi.fn(), log: vi.fn() } }));

import { useInventoryCatalogStore } from '../useInventoryCatalogStore';

const resetStore = () => useInventoryCatalogStore.setState({
  items: [], menu: [], categories: [],
  filters: { categoryId: null, status: 'active', productType: null, outOfStockOnly: false, expiredOnly: false },
  nextCursor: null, hasMore: false, loadedPageCount: 1, requestVersion: 0, initialized: true,
  isLoadingInitial: false, isLoadingNextPage: false, isRefreshing: false,
  cursorStack: [null], currentPageIndex: 0, isLoading: false, isInvalidating: false
});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('inventory catalog tenant runtime lifecycle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.readiness = { ready: true, runtime: { opaqueId: 'tenant-a', generation: 1 } };
    mocks.categories.mockResolvedValue([]);
    mocks.queryPage.mockResolvedValue({ data: [{ id: 'a-only' }], nextCursor: null, hasMore: false });
    resetStore();
    await useInventoryCatalogStore.getState().refreshCurrentPages();
  });

  it('does not read or log during a closed runtime and replays once only for the same tenant generation', async () => {
    mocks.queryPage.mockClear();
    mocks.categories.mockClear();
    mocks.readiness = { ready: false, runtime: null };
    mocks.catalogListener({ type: 'wake-up' });
    await flush();

    expect(mocks.queryPage).not.toHaveBeenCalled();
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.errors).not.toHaveBeenCalled();
    expect(useInventoryCatalogStore.getState()).toMatchObject({
      isLoading: false, isRefreshing: false, isInvalidating: false
    });

    mocks.readiness = { ready: true, runtime: { opaqueId: 'tenant-a', generation: 1 } };
    mocks.tenantListener();
    await flush();
    expect(mocks.queryPage).toHaveBeenCalledTimes(1);
    expect(mocks.categories).toHaveBeenCalledTimes(1);
  });

  it('drops a deferred A invalidation when B becomes ready', async () => {
    mocks.queryPage.mockClear();
    mocks.categories.mockClear();
    mocks.readiness = { ready: false, runtime: null };
    mocks.catalogListener({ type: 'wake-up' });
    await flush();

    mocks.readiness = { ready: true, runtime: { opaqueId: 'tenant-b', generation: 2 } };
    mocks.tenantListener();
    await flush();
    expect(mocks.queryPage).not.toHaveBeenCalled();
    expect(mocks.categories).not.toHaveBeenCalled();
  });
});
