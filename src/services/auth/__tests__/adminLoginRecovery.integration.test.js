import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  cache: new Map(),
  profile: vi.fn(),
  login: vi.fn(),
  verify: vi.fn(),
  offline: vi.fn(),
  ready: vi.fn(),
  save: vi.fn(),
  hydrate: vi.fn(),
  handoff: vi.fn(),
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_a', generation: 1 },
  device: 'device-a',
  foreignContext: null
}));

vi.mock('../../db/tenantRuntimeRouter', () => ({
  db: { table: () => ({ get: async (key) => ({ value: io.cache.get(key) }) }) },
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: io.tenant }),
  isTenantRuntimeError: (error) => error?.code?.startsWith('TENANT_RUNTIME_')
}));
vi.mock('../../supabase', () => ({
  adminLoginOnDevice: io.login,
  verifyAdminSession: io.verify,
  hasValidOfflineAdminSession: io.offline,
  getAdminOfflineAuthorization: async (...args) => {
    const locallyAllowed = await io.offline(...args);
    const proof = io.cache.get('last_valid_admin_session');
    const serverExpiry = proof?.expiresAt ? Date.parse(proof.expiresAt) : null;
    const expiryValid = Number.isFinite(serverExpiry) && serverExpiry > Date.now();
    const eligible = locallyAllowed && expiryValid;
    return {
      eligible,
      reason: eligible ? 'authorized' : 'server_session_expired',
      effectiveExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      effectiveNow: Date.now()
    };
  },
  getStableDeviceId: async () => io.device,
  clearStaffSessionCache: async () => {},
  hasAdminSessionToken: async () => Boolean(io.cache.get('admin_session_token')),
  hasStaffSessionToken: async () => false,
  verifyStaffSession: vi.fn(),
  clearAdminSessionCache: async () => io.cache.clear(),
  adminLogoutSession: async () => io.cache.clear(),
  adminTakeoverFreeDevice: io.login,
  enrollAdminOwnerOnDevice: io.login,
  activateLicense: vi.fn(),
  getBusinessProfile: io.profile,
  revalidateLicense: vi.fn(),
  saveBusinessProfile: vi.fn()
}));
vi.mock('../../database', () => ({
  loadData: async (_store, key) => io.cache.get(key),
  saveData: async (_store, data) => { io.save(data); io.cache.set(data.id, data); },
  STORES: { COMPANY: 'company' }
}));
vi.mock('../../db/databaseRuntime', () => ({ ensureLocalDatabaseReady: io.ready, prepareLocalDatabase: io.ready }));
vi.mock('../../licenseStorage', () => ({
  saveLicenseToStorage: async () => {},
  getLicenseFromStorage: async () => ({ ...remote().details, admin_identity_required: true,
    admin_user: remote().admin_user, localExpiry: new Date(Date.now() + 3600000).toISOString() })
}));
vi.mock('../../storage/imageUploadService', () => ({ IMAGE_UPLOAD_PURPOSES: {}, uploadImageFile: vi.fn() }));
vi.mock('../../tenant/localTenantGuard', () => ({
  initializeLocalTenantGuard: vi.fn(),
  assertLocalTenantAccess: async () => {},
  assertLocalTenantSyncAccess: async () => {},
  isLocalTenantAccessError: (error) => error?.code?.startsWith('LOCAL_TENANT_'),
  lockLocalTenantAccess: vi.fn()
}));
vi.mock('../../tenant/tenantScopedStorage', () => ({
  hydrateTenantStorageConsumers: io.hydrate, resumeTenantStorageWrites: vi.fn()
}));
vi.mock('../actorScopedStorage', () => ({
  prepareActorScopedStorage: async () => ({}), activateActorScopedStorage: vi.fn(),
  resumeActorScopedStorageWrites: vi.fn(), suspendActorScopedStorageWrites: vi.fn(),
  invalidateActorScopedStorage: vi.fn(),
  subscribeActorScopedStorage: (callback) => { io.foreignContext = callback; }
}));
vi.mock('../actorOperationalHandoff', () => ({
  configureActorOperationalPersistence: vi.fn(), installActorOperationalHandoffGuards: async () => {},
  refreshPersistedActorCheckoutOwnership: async () => [], assertActorOperationalHandoffClear: io.handoff,
  rebindActorOperationalOwnership: vi.fn()
}));

import { actorRuntimeController } from '../actorRuntimeController';
import { lockActorRuntime } from '../actorSessionRuntimeBridge';
import { createLicenseAdminActions } from '../../../store/slices/license/licenseAdminActions';
import { createProfileSlice } from '../../../store/slices/createProfileSlice';
import { createLicenseBootstrapActions } from '../../../store/slices/license/licenseBootstrapActions';
import { createLicenseProcessingActions } from '../../../store/slices/license/licenseProcessingActions';

const credentials = { username: 'owner', password: 'fixture-only' };
const profile = { license_key: 'LIC-A', business_name: 'Business A', business_type: ['abarrotes'] };
const remote = () => ({
  success: true, admin_user: { id: 'admin-a', username: 'owner' },
  session: { id: 'session-a' }, device_id: 'device-a',
  details: { license_key: 'LIC-A', plan_code: 'free_trial', device_role: 'admin' }
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const harness = () => {
  const state = { appStatus: 'admin_login_required', adminLoginLicenseKey: 'LIC-A',
    licenseDetails: { license_key: 'LIC-A' }, currentDeviceRole: 'admin', stopLicenseSync: vi.fn(), _validateInBackground: vi.fn() };
  const set = (patch) => Object.assign(state, patch);
  const get = () => state;
  Object.assign(state, createProfileSlice(set, get), createLicenseAdminActions({ set, get }));
  Object.assign(state, createLicenseBootstrapActions({ set, get }), createLicenseProcessingActions({
    set, get, clearLocalLicenseSession: vi.fn(), hasStaffValidationContext: () => false
  }));
  return state;
};

beforeEach(() => {
  vi.clearAllMocks();
  io.cache.clear();
  io.tenant = { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_a', generation: 1 };
  io.device = 'device-a';
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  lockActorRuntime('test_reset');
  io.ready.mockResolvedValue(undefined);
  io.hydrate.mockResolvedValue([]);
  io.handoff.mockReset();
  io.offline.mockResolvedValue(true);
  io.login.mockImplementation(async ({ beforeLocalPersistence }) => {
    await beforeLocalPersistence?.({ license_key: 'LIC-A' });
    io.cache.set('admin_session_token', 'fixture-token');
    io.cache.set('admin_session_id', 'session-a');
    io.cache.set('last_valid_admin_session', { validatedAt: Date.now(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    return remote();
  });
  io.verify.mockImplementation(async () => ({ ...remote(), valid: true }));
  io.profile.mockResolvedValue({ success: true, data: profile });
});
afterEach(() => vi.unstubAllGlobals());

describe('AUTH-R1 real Admin coordinator / ActorRuntime / bridge / profile integration', () => {
  it.each(['free_trial', 'pro_monthly'])('AUTH-01/02 publishes a coherent %s session', async (plan) => {
    const state = harness();
    state.licenseDetails.plan_code = plan;
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: true });
    expect(state.appStatus).toBe('ready');
    expect(actorRuntimeController.assertGranted().actorType).toBe('admin');
  });

  it('AUTH-06/11/32/35 reproduces a silent null after GRANTED and resumes without a second login', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false, code: 'NETWORK_ERROR' });
    const first = await state.handleAdminLogin(credentials);
    const initialRuntime = actorRuntimeController.getState();
    const pending = state.pendingAdminSessionResult;
    const generation = initialRuntime.generation;
    const second = await state.handleAdminLogin(credentials);
    expect(first).toMatchObject({ success: false, remoteAuthenticated: true, recoveryRequired: true });
    expect(pending).not.toBeNull();
    expect(initialRuntime.status).toBe('granted');
    expect(second).toMatchObject({ success: true });
    expect(io.login).toHaveBeenCalledTimes(1);
    expect(actorRuntimeController.getState().generation).toBe(generation);
    expect(state.appStatus).toBe('ready');
  });

  it('AUTH-11 exposes the original second-click HANDOFF_REQUIRED sequence as a regression', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    const second = await state.handleAdminLogin(credentials);
    expect(second.code).not.toBe('ACTOR_HANDOFF_REQUIRED');
    expect(second).toMatchObject({ success: true });
  });

  it.each(['INVALID_ADMIN_CREDENTIALS', 'ONLINE_REQUIRED', 'FREE_DEVICE_TAKEOVER_REQUIRED'])('AUTH-03/04/19 respects %s', async (code) => {
    const state = harness();
    io.login.mockResolvedValue({ success: false, code });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false, code });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(io.profile).not.toHaveBeenCalled();
  });

  it('AUTH-05/10/33 resumes a thrown preparation failure without registration', async () => {
    const state = harness();
    const load = state._loadProfile;
    state._loadProfile = vi.fn().mockRejectedValueOnce(new Error('profile timeout')).mockImplementation(load);
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false, recoveryRequired: true });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: true });
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it.each(['ADMIN_SESSION_INVALID', 'ADMIN_SESSION_REQUIRED'])('AUTH-18 honors authoritative %s even if connectivity drops', async (code) => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    io.verify.mockImplementation(async () => {
      navigator.onLine = false;
      return { valid: false, success: false, code };
    });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false, outcome: 'AUTHENTICATION_REQUIRED' });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it.each(['session', 'device', 'ambiguous', 'identity', 'expired', 'invalid-expiry'])('AUTH-17/18/22/25 rejects changed %s evidence', async (changed) => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    if (changed === 'session') io.cache.set('admin_session_id', 'session-b');
    if (changed === 'device') io.device = 'device-b';
    if (changed === 'ambiguous') io.cache.set('staff_session_token', 'staff-token');
    if (changed === 'identity') state.currentAdminUser = { id: 'other-admin' };
    if (changed === 'expired') io.cache.set('last_valid_admin_session', { validatedAt: Date.now(), expiresAt: '2020-01-01' });
    if (changed === 'invalid-expiry') io.cache.set('last_valid_admin_session', { validatedAt: Date.now(), expiresAt: 'not-a-date' });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(state.appStatus).not.toBe('ready');
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-23 never locks a newer granted actor from an obsolete recovery', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    lockActorRuntime('explicit_handoff');
    actorRuntimeController.beginAuthentication({ actorType: 'staff' });
    actorRuntimeController.grant({ actorType: 'staff', actorId: 'staff-b', sessionId: 'staff-session', deviceRef: 'device-a' });
    const generation = actorRuntimeController.getState().generation;
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'staff', generation });
    expect(io.verify).not.toHaveBeenCalled();
  });

  it('AUTH-09 discards a profile arriving after logout without cache writes', async () => {
    const state = harness();
    const wait = deferred();
    io.profile.mockReturnValueOnce(wait.promise);
    const login = state.handleAdminLogin(credentials);
    await vi.waitFor(() => expect(io.profile).toHaveBeenCalled());
    await state.logoutAdmin();
    wait.resolve({ success: true, data: profile });
    expect(await login).toMatchObject({ success: false });
    expect(io.save).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(state.currentAdminUser).toBeNull();
  });

  it('AUTH-29 recovers offline only under the existing valid offline-session contract', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    navigator.onLine = false;
    io.cache.set('company:LIC-A', { ...profile, name: 'Business A' });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: true });
    expect(io.verify).not.toHaveBeenCalled();
  });

  it('AUTH-30 rejects an expired offline session', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    navigator.onLine = false;
    io.offline.mockResolvedValue(false);
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it('AUTH-25 cannot reuse authority invalidated by a second tab', async () => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    io.foreignContext({ type: 'foreign_context', tenantOpaqueId: 'tenant-a' });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it('AUTH-24 revalidates an existing remote session after IndexedDB recovery', async () => {
    const state = harness();
    const error = new Error('Not yet support for changing primary key');
    error.name = 'UpgradeError';
    io.ready.mockRejectedValueOnce(error);
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false, localRecoveryRequired: true });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: true });
    expect(io.verify).toHaveBeenCalledTimes(1);
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-06 accepts Setup only after confirmed absence and explicit enrollment context', async () => {
    const state = harness();
    state.ownerEnrollmentContext = 'existing_license';
    io.profile.mockResolvedValueOnce({ success: false, code: 'PROFILE_NOT_FOUND' });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: true, outcome: 'SETUP_REQUIRED' });
    expect(state.appStatus).toBe('setup_required');
  });

  it('AUTH-20 rejects a mismatched result before publishing another business', async () => {
    const state = harness();
    io.login.mockResolvedValueOnce({ ...remote(), details: { license_key: 'LIC-B' } });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false });
    expect(state.licenseDetails.license_key).toBe('LIC-A');
    expect(state.currentAdminUser).toBeNull();
  });

  it('AUTH-14 reload restores real authority and offers recovery for a missing profile', async () => {
    const state = harness();
    await state.handleAdminLogin(credentials);
    const reloaded = harness();
    reloaded.appStatus = 'loading';
    io.cache.delete('company:LIC-A');
    io.cache.delete('company');
    io.profile.mockResolvedValueOnce({ success: false });
    expect(await reloaded.initializeApp({ force: true })).toMatchObject({ status: 'admin_login_required' });
    expect(reloaded.pendingAdminSessionResult).not.toBeNull();
    expect(await reloaded.resumeAdminSessionPreparation()).toMatchObject({ success: true });
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-23 late handoff preparation cannot grant or lock a subsequent actor', async () => {
    const state = harness();
    const wait = deferred();
    io.hydrate.mockReturnValueOnce(wait.promise);
    const login = state.handleAdminLogin(credentials);
    await vi.waitFor(() => expect(io.hydrate).toHaveBeenCalled());
    lockActorRuntime('explicit_handoff');
    actorRuntimeController.beginAuthentication({ actorType: 'staff' });
    actorRuntimeController.grant({ actorType: 'staff', actorId: 'staff-b', sessionId: 'staff-b-session' });
    wait.resolve([]);
    expect(await login).toMatchObject({ success: false });
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'staff', actorId: 'staff-b' });
    expect(io.profile).not.toHaveBeenCalled();
  });

  it('AUTH-26 preserves the unresolved financial handoff barrier', async () => {
    const state = harness();
    io.handoff.mockImplementationOnce(() => { throw Object.assign(new Error('Pending checkout'), { code: 'ACTOR_OPERATIONAL_HANDOFF_REQUIRED' }); });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(io.profile).not.toHaveBeenCalled();
  });

  it('AUTH-13 does not restart bootstrap while a remote login is pending', async () => {
    const state = harness();
    const wait = deferred();
    const loginIO = io.login.getMockImplementation();
    io.login.mockImplementationOnce(async (args) => { await wait.promise; return loginIO(args); });
    const login = state.handleAdminLogin(credentials);
    await vi.waitFor(() => expect(io.login).toHaveBeenCalledTimes(1));
    expect(await state.initializeApp({ force: true })).toMatchObject({ code: 'ADMIN_AUTH_IN_PROGRESS' });
    wait.resolve();
    expect(await login).toMatchObject({ success: true });
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-12/14 does not authenticate again while restored preparation is pending', async () => {
    const state = harness();
    await state.handleAdminLogin(credentials);
    io.profile.mockClear();
    const reloaded = harness();
    reloaded.appStatus = 'loading';
    const wait = deferred();
    io.profile.mockReturnValueOnce(wait.promise);
    const bootstrap = reloaded.initializeApp({ force: true });
    await vi.waitFor(() => expect(io.profile).toHaveBeenCalledTimes(1));
    expect(await reloaded.handleAdminLogin(credentials)).toMatchObject({ success: false, code: 'ADMIN_AUTH_IN_PROGRESS' });
    wait.resolve({ success: true, data: profile });
    expect(await bootstrap).toMatchObject({ status: 'ready' });
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-12/13 rejects a concurrent submission without another RPC', async () => {
    const state = harness();
    const wait = deferred();
    io.login.mockReturnValueOnce(wait.promise);
    const first = state.handleAdminLogin(credentials);
    await vi.waitFor(() => expect(io.login).toHaveBeenCalledTimes(1));
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false, code: 'ADMIN_AUTH_IN_PROGRESS' });
    wait.resolve({ success: false, code: 'INVALID_CREDENTIALS' });
    await first;
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('AUTH-20/21/34 discards a late old-tenant response before credential persistence', async () => {
    const state = harness();
    const wait = deferred();
    io.login.mockImplementationOnce(async ({ beforeLocalPersistence }) => {
      await wait.promise;
      await beforeLocalPersistence({ license_key: 'LIC-A' });
      return remote();
    });
    const first = state.handleAdminLogin(credentials);
    await vi.waitFor(() => expect(io.login).toHaveBeenCalledTimes(1));
    state.adminLoginLicenseKey = 'LIC-B';
    state.licenseDetails = { license_key: 'LIC-B' };
    lockActorRuntime('license_changed');
    wait.resolve();
    expect(await first).toMatchObject({ success: false });
    expect(io.save).not.toHaveBeenCalled();
    expect(state.licenseDetails.license_key).toBe('LIC-B');
    expect(state.currentAdminUser).toBeUndefined();
  });

  it('AUTH-07/08 synchronizes the UI when a usable memory profile survives a network failure', async () => {
    const state = harness();
    state.companyProfile = { ...profile, name: 'Business A' };
    io.profile.mockResolvedValue({ success: false });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: true });
    expect(state.appStatus).toBe('ready');
  });
  it.each(['admin', 'session'])('rejects changed server %s evidence before recovery credential persistence', async (changed) => {
    const state = harness();
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    const persist = vi.fn();
    io.verify.mockImplementationOnce(async (_licenseKey, options) => {
      await options.beforeLocalPersistence({ success: true, license_key: 'LIC-A',
        admin_user: { id: changed === 'admin' ? 'admin-b' : 'admin-a' },
        admin_session_id: changed === 'session' ? 'session-b' : 'session-a' });
      persist();
      return { ...remote(), valid: true };
    });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(persist).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it.each([['pro_monthly', 'free_trial'], ['free_trial', 'pro_monthly']])('AUTH-27/28 keeps verified %s -> %s plan details during recovery', async (from, to) => {
    const state = harness();
    const login = io.login.getMockImplementation();
    io.login.mockImplementationOnce(async (args) => { const result = await login(args); return { ...result, details: { ...result.details, plan_code: from, features: { cloud_sync: from !== 'free_trial' } } }; });
    io.profile.mockResolvedValueOnce({ success: false });
    await state.handleAdminLogin(credentials);
    const generation = actorRuntimeController.getState().generation;
    io.verify.mockResolvedValueOnce({ ...remote(), valid: true, details: { ...remote().details, plan_code: to, features: { cloud_sync: to !== 'free_trial' } } });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: true });
    expect(state.licenseDetails).toMatchObject({ plan_code: to, features: { cloud_sync: to !== 'free_trial' } });
    expect(actorRuntimeController.getState()).toMatchObject({ generation, actorId: 'admin-a', sessionId: 'session-a' });
    expect(io.login).toHaveBeenCalledTimes(1);
  });

  it('requires the original canonical session id for a locked pre-grant retry', async () => {
    const state = harness();
    const error = Object.assign(new Error('old schema'), { name: 'UpgradeError' });
    io.ready.mockRejectedValueOnce(error);
    await state.handleAdminLogin(credentials);
    const persist = vi.fn();
    io.verify.mockImplementationOnce(async (_key, options) => {
      await options.beforeLocalPersistence({ success: true, admin_user: { id: 'admin-a' }, admin_session_id: 'different-session' });
      persist();
      return { ...remote(), valid: true };
    });
    expect(await state.resumeAdminSessionPreparation()).toMatchObject({ success: false });
    expect(persist).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it('AUTH-03/18 treats explicit valid:false as denial even with success:true', async () => {
    const state = harness();
    io.login.mockResolvedValueOnce({ success: true, valid: false, code: 'ADMIN_SESSION_INVALID' });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: false, code: 'ADMIN_SESSION_INVALID' });
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(io.profile).not.toHaveBeenCalled();
  });

  it('AUTH-07/11/35 reconciles a granted Admin with a desynchronized login view and no pending marker', async () => {
    const state = harness();
    await state.handleAdminLogin(credentials);
    const generation = actorRuntimeController.getState().generation;
    state.appStatus = 'admin_login_required';
    state.pendingAdminSessionResult = null;
    io.profile.mockResolvedValueOnce({ success: false });
    expect(await state.handleAdminLogin(credentials)).toMatchObject({ success: true });
    expect(io.login).toHaveBeenCalledTimes(1);
    expect(io.verify).toHaveBeenCalledTimes(1);
    expect(actorRuntimeController.getState().generation).toBe(generation);
    expect(state.appStatus).toBe('ready');
  });

  it.each(['username', 'license', 'staff', 'session'])('does not recover an unmarked granted session with changed %s', async (changed) => {
    const state = harness();
    await state.handleAdminLogin(credentials);
    state.appStatus = 'admin_login_required';
    state.pendingAdminSessionResult = null;
    if (changed === 'license') state.adminLoginLicenseKey = 'LIC-B';
    if (changed === 'session') io.cache.set('admin_session_id', 'session-b');
    if (changed === 'staff') {
      lockActorRuntime('explicit_test_handoff');
      actorRuntimeController.beginAuthentication({ actorType: 'staff' });
      actorRuntimeController.grant({ actorType: 'staff', actorId: 'staff-b', sessionId: 'staff-session' });
      state.currentDeviceRole = 'staff';
    }
    expect(await state.handleAdminLogin({ ...credentials, username: changed === 'username' ? 'other-owner' : 'owner' })).toMatchObject({ success: false });
    expect(state.appStatus).not.toBe('ready');
    expect(io.login).toHaveBeenCalledTimes(1);
    if (changed === 'staff') expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorType: 'staff', actorId: 'staff-b' });
  });

});
