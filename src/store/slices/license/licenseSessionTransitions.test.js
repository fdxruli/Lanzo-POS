import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  hasAdminSessionToken: vi.fn(),
  hasStaffSessionToken: vi.fn(),
  hasValidOfflineAdminSession: vi.fn(),
  verifyAdminSession: vi.fn(),
  verifyStaffSession: vi.fn(),
  revalidateLicense: vi.fn(),
  activateLicense: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  staffLoginOnDevice: vi.fn(),
  staffLogoutSession: vi.fn(),
  adminLogoutSession: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  getLicenseFromStorage: vi.fn(),
  ensureLocalDatabaseReady: vi.fn(),
  prepareLocalDatabase: vi.fn(),
  beginActorRuntimeAuthentication: vi.fn(),
  grantAuthenticatedActorRuntime: vi.fn(),
  restoreActorRuntimeFromCurrentSessionCache: vi.fn(),
  lockActorRuntime: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  clearStaffSessionCache: mocks.clearStaffSessionCache,
  hasAdminSessionToken: mocks.hasAdminSessionToken,
  hasStaffSessionToken: mocks.hasStaffSessionToken,
  hasValidOfflineAdminSession: mocks.hasValidOfflineAdminSession,
  verifyAdminSession: mocks.verifyAdminSession,
  verifyStaffSession: mocks.verifyStaffSession,
  revalidateLicense: mocks.revalidateLicense,
  activateLicense: mocks.activateLicense,
  adminLoginOnDevice: mocks.adminLoginOnDevice,
  staffLoginOnDevice: mocks.staffLoginOnDevice,
  staffLogoutSession: mocks.staffLogoutSession,
  adminLogoutSession: mocks.adminLogoutSession
}));
vi.mock('../../../services/auth/actorSessionRuntimeBridge', () => ({
  ACTOR_SESSION_AMBIGUOUS: 'ACTOR_SESSION_AMBIGUOUS',
  beginActorRuntimeAuthentication: mocks.beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime: mocks.grantAuthenticatedActorRuntime,
  restoreActorRuntimeFromCurrentSessionCache: mocks.restoreActorRuntimeFromCurrentSessionCache,
  lockActorRuntime: mocks.lockActorRuntime
}));
vi.mock('../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage,
  getLicenseFromStorage: mocks.getLicenseFromStorage
}));
vi.mock('../../../services/db/databaseRuntime', () => ({
  ensureLocalDatabaseReady: mocks.ensureLocalDatabaseReady,
  prepareLocalDatabase: mocks.prepareLocalDatabase
}));
vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  lockLocalTenantAccess: vi.fn(),
  runWithLocalTenantSyncLease: vi.fn(async (_source, _options, operation) => operation())
}));

import { createLicenseAdminActions } from './licenseAdminActions';
import { createLicenseBootstrapActions } from './licenseBootstrapActions';
import { createLicenseProcessingActions } from './licenseProcessingActions';
import { createLicenseStaffActions } from './licenseStaffActions';

const proLicense = (device_role = 'admin') => ({
  license_key: 'TEST-LICENSE-ACTOR-TRANSITION',
  device_role,
  plan_code: 'pro',
  max_devices: 2,
  status: 'active',
  localExpiry: new Date(Date.now() + 60_000).toISOString()
});

const modernFreeLicense = (overrides = {}) => ({
  license_key: 'TEST-FREE-MODERN-ACTOR',
  device_role: 'admin',
  plan_code: 'free_trial',
  max_devices: 1,
  status: 'active',
  valid: true,
  features: { staff_roles: false },
  admin_user: { id: 'admin-free-1', username: 'owner' },
  localExpiry: new Date(Date.now() + 60_000).toISOString(),
  ...overrides
});

const legacyFreeLicense = (overrides = {}) => ({
  license_key: 'TEST-FREE-LEGACY',
  device_role: 'admin',
  plan_code: 'free_trial',
  max_devices: 1,
  status: 'active',
  valid: true,
  features: { staff_roles: false },
  localExpiry: new Date(Date.now() + 60_000).toISOString(),
  ...overrides
});

const createStore = (initial = {}) => {
  const state = {
    appStatus: 'loading',
    licenseDetails: proLicense(),
    stopLicenseSync: vi.fn(),
    refreshLicenseSyncMode: vi.fn(),
    _validateInBackground: vi.fn(),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    _requireLicenseChange: vi.fn(),
    clearLocalLicenseSession: vi.fn(),
    ...initial
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;
  Object.assign(state,
    createLicenseAdminActions({ set, get }),
    createLicenseStaffActions({ set, get }),
    createLicenseBootstrapActions({ set, get }),
    createLicenseProcessingActions({
      set,
      get,
      clearLocalLicenseSession: state.clearLocalLicenseSession,
      hasStaffValidationContext: async () => false
    })
  );
  return state;
};

describe('canonical actor session transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.hasAdminSessionToken.mockResolvedValue(true);
    mocks.hasStaffSessionToken.mockResolvedValue(true);
    mocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    mocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    mocks.clearAdminSessionCache.mockResolvedValue(undefined);
    mocks.clearStaffSessionCache.mockResolvedValue(undefined);
    mocks.saveLicenseToStorage.mockResolvedValue(undefined);
    mocks.grantAuthenticatedActorRuntime.mockResolvedValue({ status: 'granted' });
    mocks.restoreActorRuntimeFromCurrentSessionCache.mockResolvedValue({ status: 'granted' });
  });

  it('restores admin after staff → admin → reload once the explicit login cleared the staff cache', async () => {
    const state = createStore({ appStatus: 'admin_login_required' });
    mocks.adminLoginOnDevice.mockResolvedValue({
      success: true,
      admin_user: { id: 'admin-1', username: 'owner' },
      details: proLicense('admin')
    });
    await expect(state.handleAdminLogin({ username: 'owner', password: 'synthetic' })).resolves.toMatchObject({
      success: true
    });
    expect(mocks.beginActorRuntimeAuthentication).toHaveBeenCalledWith('admin');
    expect(mocks.grantAuthenticatedActorRuntime).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: expect.objectContaining({ id: 'admin-1' })
    });
    expect(mocks.clearStaffSessionCache).toHaveBeenCalled();
    expect(state.licenseDetails.device_role).toBe('admin');

    mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
    mocks.verifyAdminSession.mockResolvedValue({
      valid: true,
      admin_user: { id: 'admin-1' },
      details: proLicense('admin')
    });
    await state.initializeApp();
    expect(mocks.prepareLocalDatabase).toHaveBeenCalled();
    expect(mocks.verifyAdminSession).toHaveBeenCalledWith(
      state.licenseDetails.license_key,
      expect.objectContaining({ beforeLocalPersistence: expect.any(Function) })
    );
    expect(mocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: expect.objectContaining({ id: 'admin-1' })
    });
    expect(mocks.verifyStaffSession).not.toHaveBeenCalled();
    expect(state.appStatus).toBe('ready');
  });

  it('restores staff after admin → staff → reload once the explicit login cleared the admin cache', async () => {
    const state = createStore({
      appStatus: 'staff_login_required',
      licenseDetails: proLicense('admin'),
      staffLoginLicenseKey: proLicense().license_key
    });
    mocks.staffLoginOnDevice.mockResolvedValue({
      success: true,
      staff_user: { id: 'staff-1', username: 'cashier', permissions: ['sales.create'] },
      details: proLicense('staff')
    });
    await expect(state.handleStaffLogin({ username: 'cashier', password: 'synthetic' })).resolves.toMatchObject({
      success: true
    });
    expect(mocks.beginActorRuntimeAuthentication).toHaveBeenCalledWith('staff');
    expect(mocks.grantAuthenticatedActorRuntime).toHaveBeenCalledWith({
      actorType: 'staff',
      actor: expect.objectContaining({ id: 'staff-1' })
    });
    expect(mocks.clearAdminSessionCache).toHaveBeenCalled();
    expect(state.licenseDetails.device_role).toBe('staff');

    mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
    mocks.verifyStaffSession.mockResolvedValue({ valid: true, staff_user: { id: 'staff-1' } });
    await state.initializeApp();
    expect(mocks.prepareLocalDatabase).toHaveBeenCalled();
    expect(mocks.verifyStaffSession).toHaveBeenCalledWith(state.licenseDetails.license_key);
    expect(mocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'staff',
      actor: expect.objectContaining({ id: 'staff-1' })
    });
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(state.appStatus).toBe('ready');
  });

  it('uses server discovery instead of selecting a role from either residual token', async () => {
    const state = createStore();
    const ambiguous = { ...proLicense(), device_role: null };
    mocks.getLicenseFromStorage.mockResolvedValue(ambiguous);
    state.discoverAdminAccess = vi.fn(async () => {
      state.appStatus = 'admin_login_required';
    });
    await state.initializeApp();
    expect(mocks.prepareLocalDatabase).toHaveBeenCalled();
    expect(state.discoverAdminAccess).toHaveBeenCalledWith(ambiguous.license_key);
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(mocks.verifyStaffSession).not.toHaveBeenCalled();
  });

  it('restores a modern FREE owner as a real Admin actor and persists the cutover marker', async () => {
    const state = createStore();
    const free = modernFreeLicense();
    mocks.getLicenseFromStorage.mockResolvedValue(free);
    mocks.verifyAdminSession.mockResolvedValue({
      valid: true,
      admin_user: { id: 'admin-free-1', username: 'owner' },
      details: { ...free, admin_user: undefined }
    });

    await state.initializeApp();

    expect(mocks.verifyAdminSession).toHaveBeenCalledWith(
      free.license_key,
      expect.objectContaining({ beforeLocalPersistence: expect.any(Function) })
    );
    expect(mocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: expect.objectContaining({ id: 'admin-free-1' })
    });
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      plan_code: 'free_trial',
      admin_identity_required: true,
      admin_user: expect.objectContaining({ id: 'admin-free-1' })
    }));
    expect(state.currentAdminUser).toMatchObject({ id: 'admin-free-1' });
    expect(state.licenseDetails.admin_identity_required).toBe(true);
    expect(state.appStatus).toBe('ready');
  });

  it('keeps modern FREE authentication-required after an invalid Admin session instead of falling back to legacy', async () => {
    const state = createStore();
    const free = modernFreeLicense();
    mocks.getLicenseFromStorage.mockResolvedValue(free);
    mocks.verifyAdminSession.mockResolvedValue({
      valid: false,
      code: 'ADMIN_SESSION_INVALID',
      message: 'Inicia sesión nuevamente.'
    });

    await state.initializeApp();

    expect(state.appStatus).toBe('admin_login_required');
    expect(state.licenseDetails.admin_identity_required).toBe(true);
    expect(state.currentAdminUser).toBeNull();
    expect(state._processOfflineMode).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.hasStaffSessionToken.mockResolvedValue(false);
    mocks.hasAdminSessionToken.mockResolvedValue(false);
    mocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
    state.discoverAdminAccess = vi.fn(async () => {
      state.appStatus = 'admin_login_required';
    });

    await state.initializeApp();

    expect(state.discoverAdminAccess).toHaveBeenCalledWith(free.license_key);
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });

  it('preserves FREE legacy local-owner bootstrap without creating or verifying an Admin actor', async () => {
    const state = createStore();
    const free = legacyFreeLicense();
    mocks.getLicenseFromStorage.mockResolvedValue(free);

    await state.initializeApp();

    expect(state._processOfflineMode).toHaveBeenCalledWith(free);
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(mocks.restoreActorRuntimeFromCurrentSessionCache).not.toHaveBeenCalled();
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalledWith(expect.objectContaining({
      admin_identity_required: true
    }));
  });

  it('moves a trusted admin from FREE to enrollment immediately without a reload', async () => {
    const state = createStore({
      appStatus: 'ready',
      licenseDetails: { ...proLicense('admin'), plan_code: 'free_trial', max_devices: 1 }
    });
    mocks.hasAdminSessionToken.mockResolvedValue(false);
    state.discoverAdminAccess = vi.fn(async () => {
      state.appStatus = 'admin_enrollment_required';
    });
    const remotePro = { ...proLicense('admin'), valid: true, plan_code: 'pro', max_devices: 2 };
    await state._processServerValidation(remotePro, state.licenseDetails, { reason: 'test_hot_upgrade' });
    expect(state.stopLicenseSync).toHaveBeenCalled();
    expect(mocks.clearStaffSessionCache).toHaveBeenCalled();
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({ plan_code: 'pro' }));
    expect(state.discoverAdminAccess).toHaveBeenCalledWith(remotePro.license_key);
    expect(state.appStatus).toBe('admin_enrollment_required');
    expect(state._loadProfile).not.toHaveBeenCalled();
  });

  it('preserves modern Admin identity and session semantics across PRO → FREE downgrade', async () => {
    const localPro = {
      ...proLicense('admin'),
      valid: true,
      admin_identity_required: true,
      admin_user: { id: 'admin-stable-1', username: 'owner' }
    };
    const state = createStore({
      appStatus: 'ready',
      licenseDetails: localPro,
      currentDeviceRole: 'admin',
      currentAdminUser: localPro.admin_user
    });
    const remoteFree = {
      license_key: localPro.license_key,
      device_role: 'admin',
      plan_code: 'free_trial',
      max_devices: 1,
      valid: true,
      status: 'active',
      features: { staff_roles: false }
    };

    await state._processServerValidation(remoteFree, localPro, { reason: 'test_pro_to_free' });

    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(state.licenseDetails).toMatchObject({
      plan_code: 'free_trial',
      admin_identity_required: true,
      admin_user: { id: 'admin-stable-1' }
    });
    expect(state.currentAdminUser).toMatchObject({ id: 'admin-stable-1' });
  });
});
