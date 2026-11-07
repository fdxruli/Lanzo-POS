// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidateLicense: vi.fn(), verifyStaffSession: vi.fn(), verifyAdminSession: vi.fn(),
  clearAdminSessionCache: vi.fn(), clearStaffSessionCache: vi.fn(),
  restoreActor: vi.fn(), hasStaffSessionToken: vi.fn(), getAdminOfflineAuthorization: vi.fn()
}));
const tenant = vi.hoisted(() => ({ opaqueId: 'tenant-test', databaseName: 'LanzoDB_t_test', generation: 1 }));
vi.mock('../../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock('../../../../services/utils', () => ({
  checkInternetConnection: async () => true, showMessageModal: vi.fn(),
  isLocalStorageEnabled: () => true,
  safeLocalStorageSet: (key, value) => { localStorage.setItem(key, value); return true; }
}));
vi.mock('../../../../services/supabase', () => mocks);
vi.mock('../../../../services/db/databaseRuntime', () => ({ prepareLocalDatabase: vi.fn() }));
vi.mock('../../../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: tenant })
}));
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: vi.fn(), assertLocalTenantAccess: vi.fn(),
  initializeLocalTenantGuard: vi.fn(), lockLocalTenantAccess: vi.fn(),
  isLocalTenantAccessError: () => false,
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation()
}));
vi.mock('../../../../services/auth/actorSessionRuntimeBridge', async () => {
  const { actorRuntimeController: runtime } = await import('../../../../services/auth/actorRuntimeController');
  return {
    lockActorRuntime: (reason) => runtime.lock(reason),
    beginActorRuntimeAuthentication: (actorType) => runtime.beginAuthentication({ actorType }),
    restoreActorRuntimeFromCurrentSessionCache: mocks.restoreActor,
    grantAuthenticatedActorRuntime: vi.fn(),
    assertAuthenticatedActorSessionCurrent: vi.fn(),
    refreshAuthenticatedAdminSessionAuthorization: vi.fn()
  };
});

import { actorRuntimeController as runtime } from '../../../../services/auth/actorRuntimeController';
import { clearActorAuthorityRecovery } from '../../../../services/auth/actorAuthorityRecovery';
import { readActorAccess } from '../../../../services/auth/actorAccessPolicy';
import { evaluateSettingsAccess } from '../../../../services/auth/settingsAccessPolicy';
import { ROUTE_PERMISSIONS } from '../../../../services/auth/routePermissions';
import { SESSION_VERIFICATION_STATUS } from '../../../../services/auth/sessionVerification';
import { canAccessCloudNotificationCenter } from '../../../../services/notifications/notificationAccess';
import { getLicenseFromStorage, saveLicenseToStorage } from '../../../../services/licenseStorage';
import { createLicenseProcessingActions } from '../licenseProcessingActions';
import { createLicenseIntegrityActions } from '../licenseIntegrityActions';
import { createLicenseBackgroundValidationActions } from '../licenseBackgroundValidationActions';
import { createLicenseBootstrapActions } from '../licenseBootstrapActions';
import { requiresAdminIdentity } from '../licenseGuards';

const staff = { id: 'staff-prueba', username: 'prueba', permissions: {
  pos: true, cash_register: false, products: false, inventory: false,
  settings: false, license: false, devices: false, sync: false, notifications: false
} };
const license = (overrides = {}) => ({
  license_key: 'TEST-EL-BALON', license_id: 'license-test', valid: true, status: 'active',
  device_mode: 'shared', device_role: 'staff', staff_user: structuredClone(staff),
  plan_code: 'pro_monthly', admin_identity_required: true, max_devices: 5,
  features: { cloud_pos_sync: true, notification_center: true, cloud_notifications: true },
  localExpiry: new Date(Date.now() + 86400000).toISOString(),
  ...overrides
});
// Representative verify_device_license_unified response: physical device
// metadata, no actor/session grant, and no Staff payload on shared terminals.
const validation = (overrides = {}) => ({
  ...license(), device_role: 'admin', staff_user: null, ...overrides
});
const grant = (actorType = 'staff', actor = staff) => {
  if (runtime.getState().status !== 'authenticating') runtime.beginAuthentication({ actorType });
  const granted = runtime.grant({
    actorType, actorId: actor.id, sessionId: `${actorType}-session`, deviceRef: 'device-test',
    permissions: actor.permissions,
    authorizationExpiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  clearActorAuthorityRecovery();
  return granted;
};
const harness = (details = license()) => {
  const state = {
    appStatus: 'ready', licenseStatus: 'active', licenseDetails: details,
    currentDeviceRole: details.device_role, currentStaffUser: details.staff_user,
    currentAdminUser: details.admin_user || null, companyProfile: { license_key: details.license_key },
    licenseSyncMode: 'hybrid_polling', stopLicenseSync: vi.fn(),
    refreshLicenseSyncMode: vi.fn(), _requireLicenseChange: vi.fn(),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    logout: vi.fn(async () => { runtime.lock('logged_out'); state.appStatus = 'unauthenticated'; })
  };
  const set = (patch) => Object.assign(state, patch);
  const get = () => state;
  const deps = { set, get, hasStaffValidationContext: async () => true,
    clearLocalLicenseSession: vi.fn() };
  Object.assign(state, createLicenseProcessingActions(deps), createLicenseIntegrityActions(deps),
    createLicenseBackgroundValidationActions(deps), createLicenseBootstrapActions(deps));
  state._requireStaffLogin = vi.fn(async () => {
    runtime.lock('staff_login_required'); state.currentStaffUser = null; state.appStatus = 'staff_login_required';
  });
  return state;
};
const expectOnlyPos = (state) => {
  const access = readActorAccess(state);
  expect(access.isAdmin).toBe(false);
  expect(access.canAccessPermission('pos')).toBe(true);
  for (const route of ['/caja', '/productos']) {
    expect([ROUTE_PERMISSIONS[route]].flat().some(access.canAccessPermission)).toBe(false);
  }
  expect(evaluateSettingsAccess({ actorAccess: access, runtimeSnapshot: access.runtimeSnapshot }).canEnterSettings).toBe(false);
  expect(canAccessCloudNotificationCenter(state.licenseDetails, access)).toBe(false);
  expect(state.currentDeviceRole).toBe('staff');
  expect(state.currentStaffUser.id).toBe(staff.id);
};
const revalidate = async (state, path) => {
  if (path === 'background') {
    await state._validateInBackground(state.licenseDetails.license_key, { reason: 'staff_login' });
  } else {
    return state.verifySessionIntegrity({ forceRemote: true, allowLocalOnly: false });
  }
};

describe('license metadata preserves the authenticated actor', () => {
  beforeEach(async () => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
    runtime.lock('test_reset'); clearActorAuthorityRecovery();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.revalidateLicense.mockResolvedValue(validation());
    mocks.hasStaffSessionToken.mockResolvedValue(true);
    mocks.verifyStaffSession.mockResolvedValue({ valid: true, staff_user: staff });
    mocks.restoreActor.mockImplementation(async ({ actorType, actor }) => grant(actorType, actor));
    await saveLicenseToStorage(license());
    grant();
  });
  afterEach(() => { runtime.lock('test_reset'); clearActorAuthorityRecovery(); });

  it.each(['background', 'integrity'])('%s: shared Staff retains only POS through revalidation and a verified reload', async (path) => {
    const state = harness();
    expectOnlyPos(state);
    const generation = runtime.getState().generation;
    await revalidate(state, path);
    expectOnlyPos(state);
    expect(runtime.getState().generation).toBe(generation);
    expect(await getLicenseFromStorage()).toMatchObject({ device_role: 'staff', staff_user: staff });
    expect(mocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();

    // Run the actual bootstrap selector against the real signed storage record.
    runtime.lock('application_bootstrap');
    const reloaded = harness(await getLicenseFromStorage());
    reloaded.appStatus = 'loading';
    reloaded._validateInBackground = vi.fn();
    await expect(reloaded.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });
    expect(mocks.verifyStaffSession).toHaveBeenCalledWith('TEST-EL-BALON', expect.any(Object));
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expectOnlyPos(reloaded);
  });

  it.each(['background', 'integrity'])('%s: normal Admin keeps its authenticated identity', async (path) => {
    const details = license({ device_role: 'admin', staff_user: null, admin_user: { id: 'admin-test' } });
    await saveLicenseToStorage(details);
    runtime.lock('actor_switch'); grant('admin', details.admin_user);
    const state = harness(details);
    await revalidate(state, path);
    expect(state.refreshLicenseSyncMode).toHaveBeenCalled();
    expect(readActorAccess(state).isAdmin).toBe(true);
    expect(readActorAccess(state).canAccessPermission('settings')).toBe(true);
    expect((await getLicenseFromStorage()).admin_user).toEqual(details.admin_user);
  });

  it.each(['background', 'integrity'])('%s: legacy Admin metadata does not initiate an identity upgrade', async (path) => {
    const details = license({ device_role: 'admin', staff_user: null,
      plan_code: 'free_trial', admin_identity_required: false, max_devices: 1, features: {} });
    await saveLicenseToStorage(details);
    runtime.lock('actor_switch'); grant('admin', { id: 'admin-test' });
    const state = harness(details);
    state.currentAdminUser = { id: 'admin-test' };
    mocks.revalidateLicense.mockResolvedValue({ ...details });
    expect(requiresAdminIdentity(details)).toBe(false);
    await revalidate(state, path);
    expect(requiresAdminIdentity(await getLicenseFromStorage())).toBe(false);
    expect(state.stopLicenseSync).not.toHaveBeenCalled();
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(mocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(state.refreshLicenseSyncMode).toHaveBeenCalled();
    expect(readActorAccess(state).isAdmin).toBe(true);
  });

  it.each(['background', 'integrity'])('%s: Staff-only consumes matching Staff permission removals', async (path) => {
    const details = license({ device_mode: 'staff_only' });
    await saveLicenseToStorage(details);
    const state = harness(details);
    mocks.revalidateLicense.mockResolvedValue(validation({
      device_mode: 'staff_only', device_role: 'staff',
      staff_user: { ...staff, permissions: { ...staff.permissions, pos: false } }
    }));
    await revalidate(state, path);
    expect(state.currentDeviceRole).toBe('staff');
    expect(readActorAccess(state).canAccessPermission('pos')).toBe(false);
    expect((await getLicenseFromStorage()).staff_user.permissions.pos).toBe(false);
  });

  it.each(['background', 'integrity'])('%s: Staff-only preserves its normal POS session', async (path) => {
    const details = license({ device_mode: 'staff_only' });
    await saveLicenseToStorage(details);
    const state = harness(details);
    mocks.revalidateLicense.mockResolvedValue(validation({ device_mode: 'staff_only', device_role: 'staff', staff_user: staff }));
    await revalidate(state, path);
    expectOnlyPos(state);
  });

  it.each(['background', 'integrity'])('%s: rejects a response from another tenant', async (path) => {
    const state = harness();
    const before = await getLicenseFromStorage();
    mocks.revalidateLicense.mockResolvedValue(validation({ license_key: 'OTHER', license_id: 'other' }));
    await revalidate(state, path);
    expect(await getLicenseFromStorage()).toEqual(before);
    expect(state.licenseDetails.license_key).toBe(before.license_key);
  });

  it.each(['background', 'integrity'])('%s: Admin device metadata cannot select or grant an actor without a session', async (path) => {
    runtime.lock('no_session');
    const details = license({ device_role: null, staff_user: null });
    await saveLicenseToStorage(details);
    const state = harness(details);
    await revalidate(state, path);
    expect(state.currentDeviceRole).toBeNull();
    expect((await getLicenseFromStorage()).device_role).toBeNull();
    expect(readActorAccess(state).isAuthorizedActor).toBe(false);
    expect(runtime.getState().status).toBe('locked');
  });

  for (const path of ['background', 'integrity']) {
    it.each(['STAFF_SESSION_REVOKED', 'STAFF_SESSION_INVALID', 'DEVICE_TOKEN_INVALID', 'DEVICE_NOT_ALLOWED'])(
      `${path}: %s remains blocked despite Admin device metadata`, async (code) => {
        const state = harness();
        mocks.revalidateLicense.mockResolvedValue(validation({ valid: false, reason: code }));
        await revalidate(state, path);
        expect(readActorAccess(state).canAccessPermission('pos')).toBe(false);
        expect(readActorAccess(state).isAdmin).toBe(false);
        expect(runtime.getState().status).toBe('locked');
      }
    );
  }

  it('revalidates Staff on reload and blocks a revoked session instead of trusting persisted identity', async () => {
    mocks.verifyStaffSession.mockResolvedValue({ valid: false, code: 'STAFF_SESSION_REVOKED',
      verificationStatus: SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL });
    const state = harness(await getLicenseFromStorage());
    state.appStatus = 'loading'; state._validateInBackground = vi.fn();
    await state.initializeApp({ force: true });
    expect(state.appStatus).toBe('staff_login_required');
    expect(state._requireStaffLogin).toHaveBeenCalled();
    expect(readActorAccess(state).canAccessPermission('pos')).toBe(false);
    expect(mocks.restoreActor).not.toHaveBeenCalled();
  });
});
