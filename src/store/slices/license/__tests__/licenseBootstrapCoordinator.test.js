import { describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({ prepareLocalDatabase: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  getLicenseFromStorage: vi.fn(),
  saveLicenseToStorage: vi.fn()
}));
const supabaseMocks = vi.hoisted(() => ({
  revalidateLicense: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  hasStaffSessionToken: vi.fn(),
  verifyStaffSession: vi.fn(),
  hasAdminSessionToken: vi.fn(),
  hasValidOfflineAdminSession: vi.fn(),
  verifyAdminSession: vi.fn()
}));

vi.mock('../../../../services/db/databaseRuntime', () => runtimeMocks);
vi.mock('../../../../services/licenseStorage', () => storageMocks);
vi.mock('../../../../services/supabase', () => supabaseMocks);
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  lockLocalTenantAccess: vi.fn(),
  runWithLocalTenantSyncLease: vi.fn(async (_source, _options, operation) => operation())
}));

import { createLicenseBootstrapActions, getInitializeAppCoordinatorState } from '../licenseBootstrapActions';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('initializeApp coordinator', () => {
  it('shares one promise between concurrent StrictMode-style calls', async () => {
    const gate = deferred();
    runtimeMocks.prepareLocalDatabase.mockReturnValueOnce(gate.promise);
    storageMocks.getLicenseFromStorage.mockResolvedValue({
      license_key: 'BOOTSTRAP-COORDINATOR-TEST',
      device_role: 'unknown'
    });

    const state = { appStatus: 'loading' };
    const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    const get = () => state;
    Object.assign(state, createLicenseBootstrapActions({ set, get }));

    const first = state.initializeApp();
    const second = state.initializeApp();

    expect(second).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtimeMocks.prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(getInitializeAppCoordinatorState()).toBe('running');

    gate.resolve({ ready: true });
    await expect(first).resolves.toEqual({ status: 'license_access_required' });

    expect(state.appStatus).toBe('license_access_required');
    expect(state._isInitializing).toBe(false);
    expect(getInitializeAppCoordinatorState()).toBe('ready');
  });

  it('keeps the pre-license boundary before any tenant database preparation', async () => {
    vi.clearAllMocks();
    storageMocks.getLicenseFromStorage.mockResolvedValue(null);
    const state = { appStatus: 'loading' };
    const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    const get = () => state;
    Object.assign(state, createLicenseBootstrapActions({ set, get }));

    await expect(state.initializeApp()).resolves.toEqual({ status: 'unauthenticated' });
    expect(runtimeMocks.prepareLocalDatabase).not.toHaveBeenCalled();
  });
});
