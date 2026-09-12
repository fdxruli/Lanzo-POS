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

vi.mock('../../../../services/supabase', () => ({
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
  adminLogoutSession: mocks.adminLogoutSession,
  enrollAdminOwnerOnDevice: vi.fn()
}));
vi.mock('../../../../services/auth/actorSessionRuntimeBridge', () => ({
  ACTOR_SESSION_AMBIGUOUS: 'ACTOR_SESSION_AMBIGUOUS',
  beginActorRuntimeAuthentication: mocks.beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime: mocks.grantAuthenticatedActorRuntime,
  restoreActorRuntimeFromCurrentSessionCache: mocks.restoreActorRuntimeFromCurrentSessionCache,
  lockActorRuntime: mocks.lockActorRuntime
}));
vi.mock('../../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage,
  getLicenseFromStorage: mocks.getLicenseFromStorage
}));
vi.mock('../../../../services/db/databaseRuntime', () => ({
  ensureLocalDatabaseReady: mocks.ensureLocalDatabaseReady,
  prepareLocalDatabase: mocks.prepareLocalDatabase
}));
vi.mock('../../../../services/Logger', () => ({
  default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  lockLocalTenantAccess: vi.fn(),
  runWithLocalTenantSyncLease: vi.fn(async (_source, _options, operation) => operation())
}));

import { createLicenseAdminActions } from '../licenseAdminActions';
import { createLicenseBootstrapActions } from '../licenseBootstrapActions';
import { createLicenseProcessingActions } from '../licenseProcessingActions';
import { createLicenseStaffActions } from '../licenseStaffActions';

const modernPro = {
  license_key: 'TEST-PRO-FREE-EXPIRED-CUTOVER',
  device_role: 'admin',
  plan_code: 'pro_monthly',
  max_devices: 2,
  status: 'active',
  valid: true,
  features: { staff_roles: true },
  admin_identity_required: true,
  admin_user: { id: 'admin-stable-1', username: 'owner' },
  localExpiry: new Date(Date.now() + 60_000).toISOString()
};

const freeDowngrade = {
  license_key: modernPro.license_key,
  device_role: 'admin',
  plan_code: 'free_trial',
  max_devices: 1,
  status: 'active',
  valid: true,
  features: { staff_roles: false }
};

const createStore = () => {
  const state = {
    appStatus: 'ready',
    licenseDetails: modernPro,
    currentDeviceRole: 'admin',
    currentAdminUser: modernPro.admin_user,
    currentStaffUser: null,
    stopLicenseSync: vi.fn(),
    refreshLicenseSyncMode: vi.fn(),
    _validateInBackground: vi.fn(),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    _requireLicenseChange: vi.fn(),
    clearLocalLicenseSession: vi.fn()
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
  state._processOfflineMode = vi.fn(async () => { state.appStatus = 'ready'; });
  return state;
};

describe('modern Admin cutover across PRO to FREE expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.hasAdminSessionToken.mockResolvedValue(true);
    mocks.hasStaffSessionToken.mockResolvedValue(false);
    mocks.hasValidOfflineAdminSession.mockResolvedValue(false);
    mocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    mocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    mocks.clearAdminSessionCache.mockResolvedValue(undefined);
    mocks.clearStaffSessionCache.mockResolvedValue(undefined);
    mocks.saveLicenseToStorage.mockResolvedValue(undefined);
    mocks.grantAuthenticatedActorRuntime.mockResolvedValue({ status: 'granted' });
    mocks.restoreActorRuntimeFromCurrentSessionCache.mockResolvedValue({ status: 'granted' });
  });

  it('keeps Admin login required after PRO → FREE when the Admin session is later removed and discovery receives a stale legacy response', async () => {
    const state = createStore();

    await state._processServerValidation(freeDowngrade, modernPro, {
      reason: 'test_pro_to_free_then_session_expiry'
    });

    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(state.licenseDetails).toMatchObject({
      plan_code: 'free_trial',
      admin_identity_required: true,
      admin_user: { id: 'admin-stable-1' }
    });

    const storedFree = state.licenseDetails;
    state._processOfflineMode.mockClear();
    mocks.lockActorRuntime.mockClear();
    mocks.hasAdminSessionToken.mockResolvedValue(false);
    mocks.getLicenseFromStorage.mockResolvedValue(storedFree);
    mocks.activateLicense.mockResolvedValue({
      valid: true,
      details: {
        ...freeDowngrade,
        admin_user: null
      }
    });
    state.appStatus = 'loading';
    state.currentAdminUser = null;

    await state.initializeApp({ force: true });

    expect(mocks.activateLicense).toHaveBeenCalledWith(
      modernPro.license_key,
      expect.objectContaining({ beforeLocalPersistence: expect.any(Function) })
    );
    expect(state.appStatus).toBe('admin_login_required');
    expect(state.currentAdminUser).toBeNull();
    expect(state.licenseDetails).toMatchObject({
      plan_code: 'free_trial',
      admin_identity_required: true,
      admin_user: null
    });
    expect(state._processOfflineMode).not.toHaveBeenCalled();
    expect(mocks.lockActorRuntime).toHaveBeenCalledWith('admin_login_required');
    expect(mocks.lockActorRuntime).not.toHaveBeenCalledWith('legacy_admin_without_actor_session');
  });
});