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
    storageMocks.getLicenseFromStorage.mockResolvedValue(null);

    const state = { appStatus: 'loading' };
    const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    const get = () => state;
    Object.assign(state, createLicenseBootstrapActions({ set, get }));

    const first = state.initializeApp();
    const second = state.initializeApp();

    expect(second).toBe(first);
    expect(runtimeMocks.prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(getInitializeAppCoordinatorState()).toBe('running');

    gate.resolve({ ready: true });
    await expect(first).resolves.toEqual({ status: 'unauthenticated' });

    expect(state.appStatus).toBe('unauthenticated');
    expect(state._isInitializing).toBe(false);
    expect(getInitializeAppCoordinatorState()).toBe('ready');
  });
});
