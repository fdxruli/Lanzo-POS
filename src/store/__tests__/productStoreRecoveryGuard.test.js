import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalInvalidate = vi.hoisted(() => vi.fn());
const productState = vi.hoisted(() => ({
  invalidateAndReset: originalInvalidate,
  isInvalidating: true,
  isLoading: true
}));
const productStoreMock = vi.hoisted(() => ({
  getState: vi.fn(() => productState),
  setState: vi.fn((patch) => Object.assign(productState, patch))
}));

vi.mock('../useProductStore', () => ({
  useProductStore: productStoreMock
}));

import {
  clearDatabaseRecoveryState,
  setDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import {
  installProductStoreRecoveryGuard,
  resetProductStoreRecoveryGuardForTests
} from '../productStoreRecoveryGuard';

beforeEach(() => {
  vi.clearAllMocks();
  originalInvalidate.mockReset();
  productState.invalidateAndReset = originalInvalidate;
  productState.isInvalidating = true;
  productState.isLoading = true;
  clearDatabaseRecoveryState();
  resetProductStoreRecoveryGuardForTests();
});

describe('ProductStore recovery guard', () => {
  it('collapses focus/visibility/pageshow/broadcast-like invalidations to zero retries', () => {
    installProductStoreRecoveryGuard();
    setDatabaseRecoveryState({
      status: 'recovery_required',
      errorCode: 'DB_PRIMARY_KEY_MISMATCH',
      databaseName: 'LanzoDB1',
      affectedStores: ['sales', 'deleted_sales'],
      existingKeyPaths: { sales: 'timestamp', deleted_sales: 'timestamp' },
      expectedKeyPaths: { sales: 'id', deleted_sales: 'id' },
      isRetryable: true,
      requiresMigration: true
    });

    const guarded = productState.invalidateAndReset;
    guarded('focus');
    guarded('visibilitychange');
    guarded('pageshow');
    guarded('BroadcastChannel');

    expect(originalInvalidate).not.toHaveBeenCalled();
    expect(productState.isInvalidating).toBe(false);
    expect(productState.isLoading).toBe(false);

    clearDatabaseRecoveryState();
    guarded('manual-retry-after-recovery');
    expect(originalInvalidate).toHaveBeenCalledTimes(1);
  });
});
