import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const actorMocks = vi.hoisted(() => ({
  beginActorRuntimeAuthentication: vi.fn(),
  grantAuthenticatedActorRuntime: vi.fn(),
  lockActorRuntime: vi.fn()
}));

vi.mock('../../../../services/db/databaseRuntime', () => runtimeMocks);
vi.mock('../../../../services/licenseStorage', () => storageMocks);
vi.mock('../../../../services/supabase', () => supabaseMocks);
vi.mock('../../../../services/auth/actorSessionRuntimeBridge', () => actorMocks);
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

const createState = (initial = {}) => {
  const state = {
    appStatus: 'loading',
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    _validateInBackground: vi.fn(),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    discoverAdminAccess: vi.fn(),
    _requireLicenseChange: vi.fn(),
    _requireAdminLogin: vi.fn(),
    ...initial
  };
  const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  const get = () => state;
  Object.assign(state, createLicenseBootstrapActions({ set, get }));
  return state;
};

describe('initializeApp coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    storageMocks.saveLicenseToStorage.mockResolvedValue(undefined);
    supabaseMocks.clearAdminSessionCache.mockResolvedValue(undefined);
    supabaseMocks.clearStaffSessionCache.mockResolvedValue(undefined);
    supabaseMocks.hasStaffSessionToken.mockResolvedValue(false);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(false);
    supabaseMocks.hasValidOfflineAdminSession.mockResolvedValue(false);
    actorMocks.grantAuthenticatedActorRuntime.mockResolvedValue({ status: 'granted' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('shares one promise between concurrent StrictMode-style calls', async () => {
    const gate = deferred();
    runtimeMocks.prepareLocalDatabase.mockReturnValueOnce(gate.promise);
    storageMocks.getLicenseFromStorage.mockResolvedValue({
      license_key: 'BOOTSTRAP-COORDINATOR-TEST',
      device_role: 'unknown'
    });

    const state = createState();

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

    expect(actorMocks.lockActorRuntime).toHaveBeenCalledWith('application_bootstrap');
    expect(state.appStatus).toBe('license_access_required');
    expect(state._isInitializing).toBe(false);
    expect(getInitializeAppCoordinatorState()).toBe('ready');
  });

  it('keeps the pre-license boundary before any tenant database preparation', async () => {
    storageMocks.getLicenseFromStorage.mockResolvedValue(null);
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'unauthenticated' });
    expect(actorMocks.lockActorRuntime).toHaveBeenCalledWith('application_bootstrap');
    expect(runtimeMocks.prepareLocalDatabase).not.toHaveBeenCalled();
  });

  it('restores GRANTED staff authority only after the stored staff session verifies', async () => {
    const localLicense = {
      license_key: 'BOOT-STAFF',
      device_role: 'staff',
      plan_code: 'pro',
      max_devices: 2,
      staff_user: { id: 'staff-old' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasStaffSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyStaffSession.mockResolvedValue({
      valid: true,
      staff_user: { id: 'staff-verified', permissions: ['sales.create'] }
    });
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'ready' });

    expect(runtimeMocks.prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(actorMocks.beginActorRuntimeAuthentication).toHaveBeenCalledWith('staff');
    expect(actorMocks.grantAuthenticatedActorRuntime).toHaveBeenCalledWith({
      actorType: 'staff',
      actor: { id: 'staff-verified', permissions: ['sales.create'] }
    });
    expect(state.currentStaffUser.id).toBe('staff-verified');
  });

  it('restores GRANTED admin authority only after the stored admin session verifies', async () => {
    const localLicense = {
      license_key: 'BOOT-ADMIN',
      device_role: 'admin',
      plan_code: 'pro',
      max_devices: 2,
      admin_user: { id: 'admin-old' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      valid: true,
      admin_user: { id: 'admin-verified' },
      details: { license_key: 'BOOT-ADMIN', plan_code: 'pro', max_devices: 2 }
    });
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'ready' });

    expect(runtimeMocks.prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(actorMocks.beginActorRuntimeAuthentication).toHaveBeenCalledWith('admin');
    expect(actorMocks.grantAuthenticatedActorRuntime).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: { id: 'admin-verified' }
    });
    expect(state.currentAdminUser.id).toBe('admin-verified');
  });

  it('fails closed to admin login when offline cache cannot bind stable actor authority', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    storageMocks.getLicenseFromStorage.mockResolvedValue({
      license_key: 'BOOT-ADMIN-OFFLINE',
      device_role: 'admin',
      plan_code: 'pro',
      max_devices: 2,
      admin_user: { id: 'admin-offline' }
    });
    supabaseMocks.hasValidOfflineAdminSession.mockResolvedValue(true);
    actorMocks.grantAuthenticatedActorRuntime.mockRejectedValueOnce(Object.assign(
      new Error('ACTOR_SESSION_REQUIRED'),
      { code: 'ACTOR_SESSION_REQUIRED' }
    ));
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'admin_login_required' });

    expect(actorMocks.lockActorRuntime).toHaveBeenCalledWith('admin_session_restore_failed');
    expect(supabaseMocks.clearAdminSessionCache).toHaveBeenCalled();
    expect(state.currentAdminUser).toBeNull();
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });
});
