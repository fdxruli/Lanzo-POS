// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  loadDataPaginated: vi.fn(),
  softDeleteWithCascadeSafe: vi.fn(),
  tableToArray: vi.fn(),
  db: {
    table: vi.fn(() => ({
      toArray: (...args) => databaseMocks.tableToArray(...args)
    }))
  },
  STORES: { MENU: 'menu', DELETED_MENU: 'deleted_menu' }
}));

const categoryMocks = vi.hoisted(() => ({
  getActiveCategories: vi.fn()
}));

const recoveryMocks = vi.hoisted(() => ({
  pending: false,
  reportStructuralDatabaseErrorOnce: vi.fn()
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock('../../services/database', () => databaseMocks);
vi.mock('../../services/db/general', () => ({ categoriesRepository: categoryMocks }));
vi.mock('../../services/Logger', () => ({ default: loggerMocks }));
vi.mock('../../services/db/databaseRecoveryState', () => ({
  isDatabaseRecoveryPending: () => recoveryMocks.pending,
  classifyDatabaseError: (error) => ({
    structural: error?.name === 'UpgradeError' || error?.name === 'DatabaseClosedError',
    code: 'DB_PRIMARY_KEY_MISMATCH',
    retryable: true,
    requiresMigration: true
  }),
  reportStructuralDatabaseErrorOnce: recoveryMocks.reportStructuralDatabaseErrorOnce
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));
vi.mock('../../services/products/productMenuEligibility', () => ({
  CAT_DYNAMIC_EXPIRED: '__expired__',
  CAT_DYNAMIC_OUT_OF_STOCK: '__out__',
  checkHasExpiredProductsForPosMenu: vi.fn(),
  isDynamicPosCategory: vi.fn(() => false)
}));

import { useProductStore } from '../useProductStore';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  recoveryMocks.pending = false;
  databaseMocks.loadDataPaginated.mockResolvedValue({ data: [], nextCursor: null });
  databaseMocks.tableToArray.mockResolvedValue([]);
  useProductStore.setState({
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
    loadedPageCount: 1,
    requestVersion: 0,
    initialized: true,
    isLoadingInitial: false,
    isLoadingNextPage: false,
    isRefreshing: false,
    isLoading: false,
    isInvalidating: false,
    cursorStack: [null],
    currentPageIndex: 0,
    hasMore: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProductStore structural recovery ownership', () => {
  it('clears the mutex and pending retry after a structural refetch failure', async () => {
    const categories = deferred();
    categoryMocks.getActiveCategories.mockReturnValueOnce(categories.promise);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    const first = useProductStore.getState().invalidateAndReset();
    useProductStore.getState().invalidateAndReset();
    expect(useProductStore.getState().isInvalidating).toBe(true);

    const error = new Error('Not yet support for changing primary key');
    error.name = 'UpgradeError';
    categories.reject(error);
    await first;

    expect(useProductStore.getState().isInvalidating).toBe(false);
    expect(useProductStore.getState().isLoading).toBe(false);
    expect(categoryMocks.getActiveCategories).toHaveBeenCalledTimes(1);
    expect(databaseMocks.db.table).not.toHaveBeenCalled();
    expect(recoveryMocks.reportStructuralDatabaseErrorOnce).toHaveBeenCalledTimes(1);
    expect(loggerMocks.debug).not.toHaveBeenCalledWith('[ProductStore] Invalidation complete');
  });

  it('makes wake-up and direct invalidation events no-op while recovery is pending', async () => {
    recoveryMocks.pending = true;

    await useProductStore.getState().invalidateAndReset();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new CustomEvent('lanzo:products-sync-updated', { detail: { id: 1 } }));

    expect(categoryMocks.getActiveCategories).not.toHaveBeenCalled();
    expect(databaseMocks.db.table).not.toHaveBeenCalled();
    expect(useProductStore.getState().isInvalidating).toBe(false);
    expect(useProductStore.getState().isLoading).toBe(false);
  });

  it('resumes normal invalidation after recovery returns to ready', async () => {
    recoveryMocks.pending = false;
    categoryMocks.getActiveCategories.mockResolvedValueOnce([{ id: 'cat-1', sortOrder: 1 }]);
    vi.spyOn(Date, 'now').mockReturnValue(100_000);

    await useProductStore.getState().invalidateAndReset();

    expect(categoryMocks.getActiveCategories).toHaveBeenCalledTimes(1);
    expect(databaseMocks.db.table).toHaveBeenCalledTimes(1);
    expect(useProductStore.getState().isInvalidating).toBe(false);
  });
});
