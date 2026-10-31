import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ close: vi.fn(), report: vi.fn(), snapshot: vi.fn(), tenantLease: vi.fn(), runtime: { status: 'granted', generation: 1 } }));
vi.mock('../../sync/syncConstants', () => ({ getLicenseKeyFromDetails: () => 'lic-1', isRestaurantOrdersCloudEnabled: () => true }));
vi.mock('../../restaurant/restaurantOrdersRepository', () => ({ restaurantOrdersRepository: { closeRestaurantOrderAfterCheckout: mocks.close } }));
vi.mock('../../auth/actorAuthorityRecovery', () => ({ reportActorAuthorityError: mocks.report, getActorAuthorityRecoverySnapshot: mocks.snapshot }));
vi.mock('../../auth/actorRuntimeController', () => ({ ACTOR_RUNTIME_STATUS: { GRANTED: 'granted' }, actorRuntimeController: {
  getState: () => mocks.runtime,
  capture: () => {
    if (mocks.runtime.status !== 'granted') throw Object.assign(new Error('ACTOR_CONTEXT_LOCKED'), { code: 'ACTOR_CONTEXT_LOCKED' });
    const generation = mocks.runtime.generation;
    return { assertCurrent: () => {
      if (mocks.runtime.status !== 'granted' || generation !== mocks.runtime.generation) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    } };
  }
} }));
vi.mock('../../../utils/businessType', () => ({ CANONICAL_BUSINESS_TYPES: { FOOD_SERVICE: 'food_service' } }));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: vi.fn(async () => undefined),
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: mocks.tenantLease
}));
vi.mock('../../tenant/tenantScopedStorage', () => ({
  getTenantStorageItem: (key) => window.localStorage.getItem(key),
  setTenantStorageItem: (key, value) => window.localStorage.setItem(key, value)
}));

import {
  closeRestaurantCloudOrderAfterSuccessfulPayment,
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment,
  retryPendingRestaurantCloudOrderCloses
} from '../../restaurant/restaurantOrderCheckoutClose';

const STORAGE_KEY = 'lanzo:restaurant-order-close-pending:v1';
const features = { activeRubros: ['food_service'], hasTables: true };
const licenseDetails = { valid: true };
const readPending = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
const authError = (message = 'DEVICE_TOKEN_INVALID') => ({ code: 'P0001', message });
const seedPending = () => window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{
  licenseKey: 'lic-1', localOrderId: 'table-1', paidSaleId: 'sale-1', paidTotal: 100,
  idempotencyKey: 'restaurant:checkout-close:table-1:sale-1', paymentSummary: { amountPaid: 100 }, retryCount: 0
}]));

describe('restaurant close authority failures never auto replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtime = { status: 'granted', generation: 1 };
    mocks.tenantLease.mockImplementation(async (_source, _options, operation) => operation());
    const values = new Map();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value))
    } });
    vi.stubGlobal('navigator', { onLine: true });
    mocks.snapshot.mockReturnValue(null);
    mocks.report.mockReturnValue(true);
    mocks.close.mockResolvedValue({ success: true });
  });

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'])('does not enqueue %s after a successful sale', async (code) => {
    mocks.close.mockRejectedValue(authError(code));
    const result = await closeRestaurantCloudOrderAfterSuccessfulPayment({
      localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features
    });
    expect(result).toMatchObject({ success: false, retryable: false, reauthenticationRequired: true, pendingSaved: false });
    expect(result.message).not.toContain(code);
    expect(readPending()).toEqual([]);
    mocks.close.mockResolvedValue({ success: true });
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue an auth failure returned by split close', async () => {
    mocks.close.mockResolvedValue({ success: false, code: 'DEVICE_TOKEN_INVALID' });
    const result = await closeRestaurantCloudOrderAfterSuccessfulSplitPayment({
      localOrderId: 'table-1', splitResult: { splitGroupId: 'split-1' }, licenseDetails, features
    });
    expect(result).toMatchObject({ success: false, retryable: false, reauthenticationRequired: true });
    expect(readPending()).toEqual([]);
  });

  it('marks a deferred close before RPC and preserves it for manual recovery after auth rejection', async () => {
    seedPending();
    mocks.close.mockImplementation(async () => {
      expect(readPending()[0].manualRetryRequired).toBe(true);
      throw authError();
    });
    const result = await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(result).toMatchObject({ success: false, reauthenticationRequired: true, closed: 0, failed: 1 });
    expect(readPending()).toHaveLength(1);
    expect(readPending()[0]).toMatchObject({ localOrderId: 'table-1', paidSaleId: 'sale-1', manualRetryRequired: true });
    mocks.close.mockResolvedValue({ success: true });
    mocks.snapshot.mockReturnValue(null); // Explicit reauth has finished.
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(readPending()).toHaveLength(1);
  });

  it('does not dispatch background closes while authority recovery is active', async () => {
    seedPending();
    mocks.snapshot.mockReturnValue({ requiresReauthentication: true });
    const before = readPending();
    await expect(retryPendingRestaurantCloudOrderCloses({ licenseDetails, features })).resolves.toMatchObject({ skipped: true });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(readPending()).toEqual(before);
  });

  it('does not dispatch a new post-sale close while recovery is active', async () => {
    mocks.snapshot.mockReturnValue({ requiresReauthentication: true });
    await expect(closeRestaurantCloudOrderAfterSuccessfulPayment({
      localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features
    })).resolves.toMatchObject({ success: false, retryable: false, reauthenticationRequired: true });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(readPending()).toEqual([]);
  });

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED', 'ACTOR_PERMISSION_DENIED', 'CLOUD_REQUEST_RESPONSE_STALE'])('does not enqueue %s or request a simple reauth', async (code) => {
    mocks.close.mockRejectedValue({ code, message: code });
    mocks.report.mockReturnValue(false);
    const result = await closeRestaurantCloudOrderAfterSuccessfulPayment({
      localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features
    });
    expect(result).toMatchObject({ success: false, retryable: false, reauthenticationRequired: false });
    expect(readPending()).toEqual([]);
  });

  it('allows an explicit post-reauth close to resolve the preserved manual row once', async () => {
    seedPending();
    const row = readPending()[0];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ ...row, manualRetryRequired: true }]));
    await closeRestaurantCloudOrderAfterSuccessfulPayment({
      localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(readPending()).toEqual([]);
  });

  it('freezes an existing pending row when an explicit close loses authority', async () => {
    seedPending();
    mocks.close.mockRejectedValue(authError());
    await closeRestaurantCloudOrderAfterSuccessfulPayment({
      localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features
    });
    expect(readPending()[0]).toMatchObject({ manualRetryRequired: true });
    mocks.close.mockResolvedValue({ success: true });
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('never emits a deferred write if the manual marker cannot be persisted', async () => {
    seedPending();
    window.localStorage.setItem = vi.fn();
    await expect(retryPendingRestaurantCloudOrderCloses({ licenseDetails, features })).resolves.toMatchObject({ success: false, closed: 0 });
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('keeps ordinary transport recovery retryable', async () => {
    seedPending();
    mocks.report.mockReturnValue(false);
    mocks.close.mockRejectedValue(new Error('NETWORK_ERROR'));
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(readPending()[0]).toMatchObject({ retryCount: 1, manualRetryRequired: false });
    mocks.close.mockResolvedValue({ success: true });
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(mocks.close).toHaveBeenCalledTimes(2);
    expect(readPending()).toEqual([]);
  });

  it.each(['admin_actor_logged_out', 'device_authorization_blocked', 'device_integrity_rejected'])('blocks background and post-sale closes for %s with no recovery snapshot', async (reason) => {
    seedPending();
    const before = readPending();
    mocks.runtime = { status: 'locked', generation: 2, reason };
    await expect(retryPendingRestaurantCloudOrderCloses({ licenseDetails, features })).resolves.toMatchObject({ success: false, skipped: true });
    await expect(closeRestaurantCloudOrderAfterSuccessfulPayment({ localOrderId: 'table-1', saleResult: { id: 'sale-1' }, licenseDetails, features })).resolves.toMatchObject({ success: false, retryable: false, reauthenticationRequired: false });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(readPending()).toEqual(before);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.tenantLease).not.toHaveBeenCalled();
  });

  it('does not turn an old close error into auth recovery or a retry after a new grant', async () => {
    seedPending();
    let complete;
    mocks.close.mockImplementation(() => new Promise((_resolve, reject) => { complete = reject; }));
    const pending = retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    mocks.runtime = { status: 'granted', generation: 3 };
    complete(authError());
    await expect(pending).resolves.toMatchObject({ success: false, retryable: false, reauthenticationRequired: false });
    expect(mocks.report).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'DEVICE_TOKEN_INVALID' }), expect.anything());
    expect(readPending()[0]).toMatchObject({ manualRetryRequired: true, retryCount: 0 });
    await retryPendingRestaurantCloudOrderCloses({ licenseDetails, features });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
