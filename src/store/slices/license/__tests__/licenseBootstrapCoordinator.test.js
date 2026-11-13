import { createClient } from '@supabase/supabase-js';
import { classifySessionVerificationResponse } from '../../../../services/auth/sessionVerification';
import { evaluateAdminOfflineAuthorization } from '../../../../services/auth/adminOfflineAuthorization';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({ prepareLocalDatabase: vi.fn(), ensureLocalDatabaseReady: vi.fn(async () => undefined) }));
const storageMocks = vi.hoisted(() => ({
  getLicenseFromStorage: vi.fn(),
  saveLicenseToStorage: vi.fn()
}));
const supabaseMocks = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  revalidateLicense: vi.fn(),
  getBusinessProfile: vi.fn(),
  saveBusinessProfile: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  hasStaffSessionToken: vi.fn(),
  verifyStaffSession: vi.fn(),
  hasAdminSessionToken: vi.fn(),
  getAdminOfflineAuthorization: vi.fn(),
  verifyAdminSession: vi.fn()
}));
const actorMocks = vi.hoisted(() => ({
  ACTOR_SESSION_AMBIGUOUS: 'ACTOR_SESSION_AMBIGUOUS',
  beginActorRuntimeAuthentication: vi.fn(),
  restoreActorRuntimeFromCurrentSessionCache: vi.fn(),
  lockActorRuntime: vi.fn(),
  assertAuthenticatedActorSessionCurrent: vi.fn(async () => true),
  refreshAuthenticatedAdminSessionAuthorization: vi.fn(async () => true),
  grantAuthenticatedActorRuntime: vi.fn()
}));

const profileStorage = vi.hoisted(() => ({
  loadData: vi.fn(async () => null),
  saveData: vi.fn(async () => undefined)
}));
vi.mock('../../../../services/database', () => ({
  ...profileStorage, STORES: { COMPANY: 'company' }
}));
vi.mock('../../../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo' }, uploadImageFile: vi.fn()
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
import { createLicenseAdminActions } from '../licenseAdminActions';
import { createProfileSlice } from '../../createProfileSlice';
import * as tenantGuard from '../../../../services/tenant/localTenantGuard';
import * as tenantRouter from '../../../../services/db/tenantRuntimeRouter';
import { actorRuntimeController } from '../../../../services/auth/actorRuntimeController';

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
  it('P2-03 keeps valid v2 Admin authority on the same session while offline', async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const localLicense = {
      license_key: 'P2-03-FIXTURE',
      license_id: 'license-p2-03',
      device_id: 'device-p2-03',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'free_trial',
      admin_user: { id: 'admin-p2-03' },
      localExpiry: expiresAt
    };
    const evidence = {
      version: 2,
      validatedAt: now - 60_000,
      expiresAt,
      sessionId: 'existing-session-p2-03',
      sessionTokenDigest: 'existing-session-digest',
      adminUserId: 'admin-p2-03',
      licenseId: 'license-p2-03',
      deviceId: 'device-p2-03',
      deviceRef: 'device-ref-p2-03',
      deviceTokenDigest: 'device-digest-p2-03',
      tenantOpaqueId: 'tenant-p2-03'
    };
    const evidenceBefore = structuredClone(evidence);
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.getAdminOfflineAuthorization.mockImplementation(async ({ license, adminUser }) => (
      evaluateAdminOfflineAuthorization({
        now,
        evidence,
        license,
        adminUser,
        credentials: {
          adminToken: 'fixture-existing-token',
          adminSessionId: evidence.sessionId,
          adminTokenDigest: evidence.sessionTokenDigest
        },
        deviceRef: evidence.deviceRef,
        deviceTokenDigest: evidence.deviceTokenDigest,
        tenantOpaqueId: evidence.tenantOpaqueId,
        tenantBinding: { tenantIdentity: 'license-id:license-p2-03' }
      })
    ));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const state = createState();

    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });

    expect(supabaseMocks.getAdminOfflineAuthorization).toHaveBeenCalledWith({
      license: localLicense,
      adminUser: localLicense.admin_user
    });
    expect(evidence.sessionId).toBe('existing-session-p2-03');
    expect(evidence).toEqual(evidenceBefore);
    expect(supabaseMocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: localLicense.admin_user
    });
    expect(state._processOfflineMode).toHaveBeenCalledWith(localLicense);
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(storageMocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(state._requireAdminLogin).not.toHaveBeenCalled();
  });

  it('P2-04/05 restores bounded v2 Admin authority with Wi-Fi active, then verifies the same session on reconnect', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = Date.now();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const localLicense = { license_key: 'BOOT-ADMIN', license_id: 'license-a', device_id: 'device-a',
      device_role: 'admin', admin_identity_required: true, plan_code: 'free_trial', max_devices: 1,
      admin_user: { id: 'admin-a' }, localExpiry: expiresAt };
    const evidence = { version: 2, validatedAt: now - 3600000, expiresAt,
      sessionId: 'session-a', sessionTokenDigest: 'admin-digest', adminUserId: 'admin-a',
      licenseId: 'license-a', deviceId: 'device-a', deviceRef: 'device-ref-a',
      deviceTokenDigest: 'device-digest', tenantOpaqueId: 'tenant-a' };
    const proofBefore = structuredClone(evidence);
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, valid: true,
        admin_user: localLicense.admin_user, details: localLicense }), { status: 200 }));
    const client = createClient('https://transport-fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch }
    });
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockImplementation(async () => {
      const response = await client.rpc('verify_admin_session', {});
      return { ...response.data, ...classifySessionVerificationResponse('admin', response) };
    });
    supabaseMocks.getAdminOfflineAuthorization.mockImplementation(async ({ license, adminUser, verificationResult }) => (
      evaluateAdminOfflineAuthorization({ now, evidence, license, adminUser, verificationResult,
        credentials: { adminToken: 'fixture-token', adminSessionId: 'session-a', adminTokenDigest: 'admin-digest' },
        deviceRef: 'device-ref-a', deviceTokenDigest: 'device-digest', tenantOpaqueId: 'tenant-a',
        tenantBinding: { tenantIdentity: 'license-id:license-a' } })
    ));
    const state = createState();
    expect(navigator.onLine).toBe(true);
    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });
    expect(state.currentAdminUser).toEqual({ id: 'admin-a' });
    expect(state._processOfflineMode).toHaveBeenCalledWith(localLicense);
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({ actorType: 'admin', actor: { id: 'admin-a' } });
    expect(supabaseMocks.getAdminOfflineAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      verificationResult: expect.objectContaining({ verificationStatus: 'transport_unavailable' })
    }));
    expect(evidence).toEqual(proofBefore);
    expect(storageMocks.saveLicenseToStorage).not.toHaveBeenCalled();
    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });
    expect(state._loadProfile).toHaveBeenCalledTimes(1);
    expect(state._requireAdminLogin).not.toHaveBeenCalled();
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(storageMocks.saveLicenseToStorage).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) expect(url).toContain('/rest/v1/rpc/verify_admin_session');
    const diagnostics = consoleWarn.mock.calls
      .filter(([label, entry]) => label === '[AdminAuth]' && entry?.phase?.startsWith('admin_'))
      .map(([, entry]) => entry);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'admin_bootstrap_verification_gate',
      category: 'transport',
      status: 'transport_unavailable',
      code: 'SESSION_TRANSPORT_UNAVAILABLE',
      httpStatus: 0,
      continuityEligible: true
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'admin_offline_authorization_decision',
      category: 'offline_authorization',
      status: 'eligible',
      eligibilityReason: 'authorized'
    }));
    expect(JSON.stringify(diagnostics)).not.toMatch(/BOOT-ADMIN|fixture-token|session-a|admin-digest|device-digest|tenant-a|admin-a/);
  });

  it('keeps gateway failures ineligible before offline evidence or Actor Runtime restoration', async () => {
    const licenseKeySentinel = 'PRIVATE-LICENSE-SENTINEL';
    const adminIdSentinel = 'PRIVATE-ADMIN-SENTINEL';
    const localLicense = {
      license_key: licenseKeySentinel,
      license_id: 'private-license-id',
      device_id: 'private-device-id',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'free_trial',
      admin_user: { id: adminIdSentinel },
      localExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'server_error',
      code: 'SESSION_GATEWAY_HTTP_403',
      httpStatus: 403
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = createState();

    await state.initializeApp({ force: true });

    expect(supabaseMocks.getAdminOfflineAuthorization).not.toHaveBeenCalled();
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(state._requireAdminLogin).not.toHaveBeenCalled();
    const diagnostic = consoleWarn.mock.calls
      .map(([label, entry]) => label === '[AdminAuth]' ? entry : null)
      .find((entry) => entry?.phase === 'admin_bootstrap_verification_gate');
    expect(diagnostic).toEqual({
      phase: 'admin_bootstrap_verification_gate',
      category: 'server',
      status: 'server_error',
      code: 'SESSION_GATEWAY_HTTP_403',
      httpStatus: 403,
      continuityEligible: false
    });
    expect(JSON.stringify(diagnostic)).not.toContain(licenseKeySentinel);
    expect(JSON.stringify(diagnostic)).not.toContain(adminIdSentinel);
  });

  it('distinguishes an eligible transport failure from a later Actor Runtime restore failure', async () => {
    const localLicense = {
      license_key: 'P2-04-ACTOR-FIXTURE',
      license_id: 'license-actor',
      device_id: 'device-actor',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'free_trial',
      admin_user: { id: 'admin-actor' },
      localExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'transport_unavailable',
      code: 'SESSION_TRANSPORT_UNAVAILABLE',
      httpStatus: 0
    });
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: true, reason: 'authorized' });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockRejectedValue(Object.assign(
      new Error('private actor fixture detail'),
      { code: 'ACTOR_RUNTIME_RESTORE_FAILED' }
    ));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = createState();

    await state.initializeApp({ force: true });

    const diagnostics = consoleWarn.mock.calls
      .filter(([label, entry]) => label === '[AdminAuth]' && entry?.phase?.startsWith('admin_'))
      .map(([, entry]) => entry);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'admin_bootstrap_verification_gate',
      category: 'transport',
      code: 'SESSION_TRANSPORT_UNAVAILABLE',
      httpStatus: 0,
      continuityEligible: true
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'admin_offline_authorization_decision',
      category: 'offline_authorization',
      eligibilityReason: 'authorized'
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'admin_actor_runtime_restore_failed',
      category: 'actor_runtime',
      status: 'failed',
      code: 'ACTOR_RUNTIME_RESTORE_FAILED'
    }));
    expect(state._processOfflineMode).not.toHaveBeenCalled();
    expect(state.adminLoginError).toMatchObject({
      code: 'ACTOR_RUNTIME_RESTORE_FAILED',
      verificationStatus: 'invalid_response'
    });
    expect(JSON.stringify(diagnostics)).not.toContain('private actor fixture detail');
    expect(JSON.stringify(diagnostics)).not.toContain('P2-04-ACTOR-FIXTURE');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    actorRuntimeController.lock('test_reset');
    runtimeMocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    storageMocks.saveLicenseToStorage.mockResolvedValue(undefined);
    supabaseMocks.clearAdminSessionCache.mockResolvedValue(undefined);
    supabaseMocks.clearStaffSessionCache.mockResolvedValue(undefined);
    supabaseMocks.hasStaffSessionToken.mockResolvedValue(false);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(false);
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: false, reason: 'evidence_missing' });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockImplementation(async () => ({
      generation: actorRuntimeController.getState().generation
    }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  const legacyFreeLicense = () => ({
    license_key: 'LEGACY-FREE-BOOT-TEST',
    device_role: 'admin',
    plan_code: 'free_trial',
    max_devices: 1,
    features: { staff_roles: false },
    valid: true
  });

  it('requires online owner discovery instead of marking legacy Free ready', async () => {
    const license = legacyFreeLicense();
    storageMocks.getLicenseFromStorage.mockResolvedValue(license);
    const state = createState({ discoverAdminAccess: vi.fn() });
    state.discoverAdminAccess.mockImplementation(async () => {
      state.appStatus = 'admin_enrollment_required';
      return { success: false, enrollmentRequired: true };
    });

    await expect(state.initializeApp({ force: true }))
      .resolves.toEqual({ status: 'admin_enrollment_required' });
    expect(state.discoverAdminAccess).toHaveBeenCalledWith(license.license_key);
    expect(state._processOfflineMode).not.toHaveBeenCalled();
    expect(state.currentAdminUser).toBeNull();
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it('keeps unidentified legacy Free blocked offline with a visible retry state', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    storageMocks.getLicenseFromStorage.mockResolvedValue(legacyFreeLicense());
    const state = createState({ discoverAdminAccess: vi.fn() });

    await expect(state.initializeApp({ force: true }))
      .resolves.toEqual({ status: 'admin_login_required' });
    expect(state.adminLoginError).toMatchObject({
      code: 'SESSION_VERIFICATION_INCONCLUSIVE',
      verificationStatus: 'transport_unavailable'
    });
    expect(state.currentAdminUser).toBeNull();
    expect(state._processOfflineMode).not.toHaveBeenCalled();
    expect(state.discoverAdminAccess).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it('can retry owner discovery online without deleting local license data', async () => {
    const license = legacyFreeLicense();
    storageMocks.getLicenseFromStorage.mockResolvedValue(license);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const state = createState({ discoverAdminAccess: vi.fn() });
    await state.initializeApp({ force: true });
    expect(state.appStatus).toBe('admin_login_required');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    state.discoverAdminAccess.mockImplementation(async () => {
      state.appStatus = 'admin_enrollment_required';
      return { success: false, enrollmentRequired: true };
    });
    await expect(state.initializeApp({ force: true }))
      .resolves.toEqual({ status: 'admin_enrollment_required' });
    expect(state.discoverAdminAccess).toHaveBeenCalledTimes(1);
    expect(storageMocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });

  it('uses existing owner enrollment with the original local license context', async () => {
    const license = legacyFreeLicense();
    const state = createState({ licenseDetails: license });
    const set = (patch) => Object.assign(state, patch);
    state.discoverAdminAccess = createLicenseAdminActions({ set, get: () => state }).discoverAdminAccess;
    supabaseMocks.activateLicense.mockResolvedValue({
      valid: false,
      admin_enrollment_required: true,
      code: 'ADMIN_ENROLLMENT_REQUIRED',
      details: { license_key: license.license_key, device_role: 'admin', plan_code: 'free_trial' }
    });

    await expect(state.discoverAdminAccess(license.license_key))
      .resolves.toMatchObject({ enrollmentRequired: true });
    expect(state.appStatus).toBe('admin_enrollment_required');
    expect(state.ownerEnrollmentContext).toBe('existing_license');
    expect(state.licenseDetails).toMatchObject({
      license_key: license.license_key, admin_identity_required: true,
      max_devices: 1
    });
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });

  it.each([
    ['legacy positive device response', { valid: true, details: legacyFreeLicense() }, 'ADMIN_IDENTITY_REQUIRED'],
    ['device not eligible for enrollment', {
      valid: false, code: 'ADMIN_ENROLLMENT_NOT_ALLOWED'
    }, 'ADMIN_ENROLLMENT_NOT_ALLOWED']
  ])('never grants Admin for %s', async (_label, result, expectedCode) => {
    const license = legacyFreeLicense();
    const state = createState({ licenseDetails: license });
    const set = (patch) => Object.assign(state, patch);
    state.discoverAdminAccess = createLicenseAdminActions({ set, get: () => state }).discoverAdminAccess;
    supabaseMocks.activateLicense.mockResolvedValue(result);

    await expect(state.discoverAdminAccess(license.license_key))
      .resolves.toMatchObject({ success: false, supportRequired: true });
    expect(state._requireAdminLogin).toHaveBeenCalledWith(
      expect.objectContaining({ license_key: license.license_key }),
      expect.objectContaining({ code: expectedCode })
    );
    expect(state._processOfflineMode).not.toHaveBeenCalled();
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
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'staff',
      actor: { id: 'staff-verified', permissions: ['sales.create'] }
    });
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
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
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: { id: 'admin-verified' }
    });
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(state.currentAdminUser.id).toBe('admin-verified');
  });

  it.each(['admin', 'staff'])('leaves loading with a protected checkout owned by another session (%s)', async (role) => {
    const license = {
      license_key: 'BOOT-HANDOFF-FIXTURE',
      device_role: role,
      admin_identity_required: role === 'admin',
      plan_code: 'pro',
      max_devices: 2,
      ...(role === 'admin' ? { admin_user: { id: 'admin-previous' } } : { staff_user: { id: 'staff-previous' } })
    };
    const verifiedActor = { id: role === 'admin' ? 'admin-verified' : 'staff-verified' };
    storageMocks.getLicenseFromStorage.mockResolvedValue(license);
    if (role === 'admin') {
      supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
      supabaseMocks.verifyAdminSession.mockResolvedValue({
        valid: true, admin_user: verifiedActor, details: license
      });
    } else {
      supabaseMocks.hasStaffSessionToken.mockResolvedValue(true);
      supabaseMocks.verifyStaffSession.mockResolvedValue({
        valid: true, staff_user: verifiedActor
      });
    }
    // Reproduce the real bridge lifecycle: authentication begins, handoff
    // fails on protected checkout ownership, then the bridge locks its actor.
    actorMocks.beginActorRuntimeAuthentication.mockImplementationOnce((actorType) => {
      actorRuntimeController.beginAuthentication({ actorType });
    });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockImplementationOnce(async () => {
      actorRuntimeController.beginHandoffCheck();
      actorRuntimeController.lock('actor_handoff_failed');
      throw Object.assign(new Error('protected checkout is owned by another actor'), {
        code: 'ACTOR_HANDOFF_CHECKOUT_OWNED'
      });
    });

    const state = createState();
    await expect(state.initializeApp()).resolves.toEqual({ status: `${role}_login_required` });
    expect(state.appStatus).toBe(`${role}_login_required`);
    expect(state[`${role}LoginError`]).toMatchObject({
      code: 'ACTOR_RUNTIME_RESTORE_FAILED',
      reasonCode: 'ACTOR_HANDOFF_CHECKOUT_OWNED'
    });
    expect(state[`${role}LoginMessage`]).toMatch(/cobros protegidos/i);
    expect(state._isInitializing).toBe(false);
    expect(state._loadProfile).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
  });

  it('does not accept a foreign actor epoch as an owned checkout rejection', async () => {
    const license = {
      license_key: 'BOOT-FOREIGN-HANDOFF',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'pro',
      admin_user: { id: 'admin-fixture' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(license);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      valid: true, admin_user: license.admin_user, details: license
    });
    actorMocks.beginActorRuntimeAuthentication.mockImplementationOnce((actorType) => {
      actorRuntimeController.beginAuthentication({ actorType });
    });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockImplementationOnce(async () => {
      actorRuntimeController.lock('actor_context_changed_in_other_tab');
      throw Object.assign(new Error('stale handoff'), { code: 'ACTOR_HANDOFF_CHECKOUT_OWNED' });
    });

    const state = createState();
    await expect(state.initializeApp()).resolves.toMatchObject({
      status: 'loading',
      code: 'BOOTSTRAP_CONTEXT_STALE'
    });
    expect(state.adminLoginError).toBeNull();
    expect(state._loadProfile).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState().status).toBe('locked');
  });

  it('preserves Admin credentials on inconclusive verification and retries without login', async () => {
    const localLicense = {
      license_key: 'BOOT-ADMIN-RETRY',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'pro',
      admin_user: { id: 'admin-cached' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'transport_unavailable',
      code: 'SESSION_TRANSPORT_UNAVAILABLE'
    });
    const state = createState({ _requireAdminLogin: vi.fn() });

    await expect(state.initializeApp()).resolves.toMatchObject({ status: 'admin_login_required' });
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(state._requireAdminLogin).not.toHaveBeenCalled();
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).not.toHaveBeenCalled();
    expect(state.adminLoginError).toMatchObject({
      code: 'SESSION_VERIFICATION_INCONCLUSIVE',
      verificationStatus: 'transport_unavailable'
    });

    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: true,
      valid: true,
      admin_user: { id: 'admin-cached' },
      details: { license_key: localLicense.license_key, plan_code: 'pro' }
    });
    await expect(state.initializeApp()).resolves.toEqual({ status: 'ready' });
    expect(supabaseMocks.verifyAdminSession).toHaveBeenCalledTimes(2);
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
  });

  it('restores eligible Admin locally after a transient server error with navigator.onLine true', async () => {
    const localLicense = {
      license_key: 'BOOT-ADMIN-5XX',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'free_trial',
      admin_user: { id: 'admin-cached' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'server_error',
      code: 'SESSION_SERVER_HTTP_503'
    });
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({
      eligible: true,
      reason: 'authorized',
      effectiveExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      effectiveNow: Date.now()
    });
    const state = createState();

    await expect(state.initializeApp()).resolves.toMatchObject({ status: 'ready' });
    expect(navigator.onLine).toBe(true);
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: { id: 'admin-cached' }
    });
    expect(state._processOfflineMode).toHaveBeenCalledWith(localLicense);
  });

  it('does not enter Admin continuity on an ambiguous gateway authorization error', async () => {
    const localLicense = {
      license_key: 'BOOT-ADMIN-401',
      device_role: 'admin',
      admin_identity_required: true,
      plan_code: 'free_trial',
      admin_user: { id: 'admin-cached' }
    };
    storageMocks.getLicenseFromStorage.mockResolvedValue(localLicense);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'server_error',
      code: 'SESSION_GATEWAY_HTTP_401'
    });
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({
      eligible: true,
      reason: 'authorized',
      effectiveExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      effectiveNow: Date.now()
    });
    const state = createState();

    await expect(state.initializeApp()).resolves.toMatchObject({ status: 'admin_login_required' });
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).not.toHaveBeenCalled();
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });

  it('keeps Staff online-only while preserving credentials on transport failure', async () => {
    storageMocks.getLicenseFromStorage.mockResolvedValue({
      license_key: 'BOOT-STAFF-RETRY',
      device_role: 'staff',
      plan_code: 'pro',
      staff_user: { id: 'staff-cached' }
    });
    supabaseMocks.hasStaffSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyStaffSession.mockResolvedValue({
      success: false,
      valid: false,
      verificationStatus: 'transport_unavailable',
      code: 'SESSION_TRANSPORT_UNAVAILABLE'
    });
    const state = createState({ _requireStaffLogin: vi.fn() });

    await expect(state.initializeApp()).resolves.toEqual({ status: 'staff_login_required' });
    expect(supabaseMocks.verifyStaffSession).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(state._requireStaffLogin).not.toHaveBeenCalled();
    expect(actorMocks.restoreActorRuntimeFromCurrentSessionCache).not.toHaveBeenCalled();
    expect(state.staffLoginError).toMatchObject({
      code: 'SESSION_VERIFICATION_INCONCLUSIVE',
      verificationStatus: 'transport_unavailable'
    });
  });

  it('preserves both credential families and fails closed when bootstrap restoration is ambiguous', async () => {
    storageMocks.getLicenseFromStorage.mockResolvedValue({
      license_key: 'BOOT-ADMIN-AMBIGUOUS',
      device_role: 'admin',
      plan_code: 'pro',
      max_devices: 2,
      admin_user: { id: 'admin-old' }
    });
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.verifyAdminSession.mockResolvedValue({
      valid: true,
      admin_user: { id: 'admin-verified' },
      details: { license_key: 'BOOT-ADMIN-AMBIGUOUS', plan_code: 'pro', max_devices: 2 }
    });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockRejectedValueOnce(Object.assign(
      new Error('ambiguous actor session evidence'),
      { code: 'ACTOR_SESSION_AMBIGUOUS' }
    ));
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'admin_login_required' });

    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(supabaseMocks.clearStaffSessionCache).not.toHaveBeenCalled();
    expect(state.currentAdminUser).toBeNull();
    expect(state.adminLoginError).toMatchObject({
      code: 'ACTOR_RUNTIME_RESTORE_FAILED',
      reasonCode: 'ACTOR_SESSION_AMBIGUOUS'
    });
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
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: true, reason: 'authorized' });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockRejectedValueOnce(Object.assign(
      new Error('ACTOR_SESSION_REQUIRED'),
      { code: 'ACTOR_SESSION_REQUIRED' }
    ));
    const state = createState();

    await expect(state.initializeApp()).resolves.toEqual({ status: 'admin_login_required' });

    expect(supabaseMocks.clearAdminSessionCache).not.toHaveBeenCalled();
    expect(state.currentAdminUser).toBeNull();
    expect(state._processOfflineMode).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.restoreAllMocks());


describe('interrupted owner onboarding through real bootstrap and profile preparation', () => {
  const license = {
    license_key: 'ONBOARDING-FIXTURE', device_role: 'admin',
    admin_identity_required: true, plan_code: 'pro', max_devices: 2,
    device_id: 'fixture-device', admin_user: { id: 'fixture-owner' }
  };
  let state;
  beforeEach(() => {
    vi.clearAllMocks();
    actorMocks.assertAuthenticatedActorSessionCurrent.mockResolvedValue(true);
    tenantGuard.assertLocalTenantAccess.mockResolvedValue({ status: 'pass' });
    actorRuntimeController.lock('onboarding_test_reset');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const runtime = { opaqueId: 'fixture-tenant', databaseName: 'fixture-db', generation: 1 };
    const adminSessionBinding = {
      actorId: license.admin_user.id,
      sessionId: 'fixture-admin-session',
      deviceRef: license.device_id,
      tenantOpaqueId: runtime.opaqueId
    };
    vi.spyOn(tenantRouter, 'getTenantRuntimeReadiness').mockReturnValue({ ready: true, runtime });
    actorMocks.beginActorRuntimeAuthentication.mockImplementation((actorType) => (
      actorRuntimeController.beginAuthentication({ actorType })
    ));
    actorMocks.lockActorRuntime.mockImplementation((reason) => actorRuntimeController.lock(reason));
    storageMocks.getLicenseFromStorage.mockResolvedValue(license);
    supabaseMocks.hasStaffSessionToken.mockResolvedValue(false);
    supabaseMocks.hasAdminSessionToken.mockResolvedValue(true);
    supabaseMocks.getAdminOfflineAuthorization.mockResolvedValue({ eligible: false });
    supabaseMocks.verifyAdminSession.mockResolvedValue({ valid: true, admin_user: license.admin_user, details: license });
    actorMocks.restoreActorRuntimeFromCurrentSessionCache.mockImplementation(async ({ actorType, actor }) => {
      if (actorType !== 'admin' || actor?.id !== adminSessionBinding.actorId) {
        throw new Error('ADMIN_SESSION_BINDING_MISMATCH');
      }
      return actorRuntimeController.grant({
        actorType,
        actorId: adminSessionBinding.actorId,
        sessionId: adminSessionBinding.sessionId,
        permissions: ['*'],
        tenantOpaqueId: adminSessionBinding.tenantOpaqueId,
        deviceRef: adminSessionBinding.deviceRef,
        authorizationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    });
    runtimeMocks.prepareLocalDatabase.mockResolvedValue({ ready: true });
    profileStorage.loadData.mockResolvedValue(null);
    supabaseMocks.getBusinessProfile.mockResolvedValue({ success: false, code: 'PROFILE_NOT_FOUND' });
    supabaseMocks.saveBusinessProfile.mockResolvedValue({ success: true, timezone: 'America/Merida' });
    supabaseMocks.revalidateLicense.mockResolvedValue({ valid: true, ...license, features: {} });
    // A fresh store represents reopening the browser: only the allowed stored
    // license/session adapters survive; the enrollment navigation context does not.
    state = createState({ ownerEnrollmentContext: null });
    const set = (patch) => Object.assign(state, patch);
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get), createLicenseAdminActions({ set, get }));
  });

  it('restores the existing owner, confirms absence, saves and reloads the same business', async () => {
    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'setup_required' });
    expect(actorMocks.assertAuthenticatedActorSessionCurrent).toHaveBeenCalled();
    expect(supabaseMocks.getBusinessProfile).toHaveBeenCalledWith(license.license_key);
    expect(supabaseMocks.verifyAdminSession).toHaveBeenCalledWith(
      license.license_key,
      expect.objectContaining({ beforeLocalPersistence: expect.any(Function) })
    );
    expect(actorRuntimeController.getState()).toEqual(expect.objectContaining({
      status: 'granted',
      actorType: 'admin',
      actorId: license.admin_user.id,
      actorKey: `admin:${license.admin_user.id}`,
      sessionId: 'fixture-admin-session',
      permissions: ['*'],
      tenant: expect.objectContaining({ opaqueId: 'fixture-tenant' })
    }));
    expect(supabaseMocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(profileStorage.saveData).not.toHaveBeenCalled();
    expect(supabaseMocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
    expect(supabaseMocks.activateLicense).not.toHaveBeenCalled();
    expect(supabaseMocks.adminLoginOnDevice).not.toHaveBeenCalled();
    await state.handleSetup({ name: 'Fixture business', business_type: ['abarrotes'], timezone: 'America/Merida' });
    expect(state.appStatus).toBe('ready');
    expect(state.companyProfile.license_key).toBe(license.license_key);
    expect(supabaseMocks.saveBusinessProfile).toHaveBeenCalledTimes(1);
    supabaseMocks.getBusinessProfile.mockResolvedValue({ success: true, data: state.companyProfile });
    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });
    expect(supabaseMocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
  });

  it('continues normally when the business already exists', async () => {
    supabaseMocks.getBusinessProfile.mockResolvedValue({ success: true, data: {
      license_key: license.license_key, name: 'Existing business', business_type: ['abarrotes']
    } });
    await expect(state.initializeApp({ force: true })).resolves.toEqual({ status: 'ready' });
  });

  it.each([
    ['transport', { success: false, message: 'Failed to fetch' }],
    ['timeout', { success: false, message: 'Profile query timed out' }],
    ['empty result', null],
    ['unknown license', { success: false, code: 'LICENSE_NOT_FOUND' }]
  ])('does not infer absence from %s', async (_label, result) => {
    supabaseMocks.getBusinessProfile.mockResolvedValue(result);
    await state.initializeApp({ force: true });
    expect(state.appStatus).toBe('admin_login_required');
    expect(supabaseMocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('does not enter Setup after storage failure even with remote absence', async () => {
    profileStorage.loadData.mockRejectedValue(new Error('fixture storage unavailable'));
    await state.initializeApp({ force: true });
    expect(state.appStatus).toBe('admin_login_required');
  });

  it('requires authentication for a revoked session before reading the profile', async () => {
    supabaseMocks.verifyAdminSession.mockResolvedValue({ valid: false, code: 'ADMIN_SESSION_REVOKED' });
    await state.initializeApp({ force: true });
    expect(state.appStatus).not.toBe('setup_required');
    expect(supabaseMocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('keeps an unauthorized device blocked before loading a profile', async () => {
    supabaseMocks.verifyAdminSession.mockResolvedValue({ valid: false, code: 'DEVICE_NOT_AUTHORIZED' });
    await state.initializeApp({ force: true });
    expect(state.appStatus).not.toBe('setup_required');
    expect(supabaseMocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('rejects a tenant mismatch at the preparation boundary', async () => {
    vi.spyOn(tenantGuard, 'assertLocalTenantAccess').mockImplementation(async () => {
      throw Object.assign(new Error('fixture tenant mismatch'), { code: 'ACTOR_TENANT_MISMATCH' });
    });
    await state.initializeApp({ force: true });
    expect(state.appStatus).not.toBe('setup_required');
    expect(supabaseMocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('does not read a profile when the restored actor session loses authorization', async () => {
    actorMocks.assertAuthenticatedActorSessionCurrent.mockRejectedValueOnce(
      Object.assign(new Error('fixture session invalid'), { code: 'ACTOR_SESSION_REQUIRED' })
    );
    await state.initializeApp({ force: true });
    expect(state.appStatus).toBe('admin_login_required');
    expect(supabaseMocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('does not infer a missing business offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await state.initializeApp({ force: true });
    expect(state.appStatus).not.toBe('setup_required');
    expect(supabaseMocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('ignores a late absence response after the license context changes', async () => {
    const response = deferred();
    const started = deferred();
    supabaseMocks.getBusinessProfile.mockImplementation(() => { started.resolve(); return response.promise; });
    const bootstrap = state.initializeApp({ force: true });
    await started.promise;
    state.licenseDetails = { license_key: 'OTHER-FIXTURE' };
    state.appStatus = 'license_access_required';
    response.resolve({ success: false, code: 'PROFILE_NOT_FOUND' });
    await bootstrap;
    expect(state.appStatus).toBe('license_access_required');
    expect(state.licenseDetails.license_key).toBe('OTHER-FIXTURE');
    expect(state.companyProfile).toBeNull();
  });
});
