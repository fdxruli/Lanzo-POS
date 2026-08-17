import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  adminLogoutSession: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn()
}));
const storageMocks = vi.hoisted(() => ({ saveLicenseToStorage: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({ ensureLocalDatabaseReady: vi.fn() }));
const actorMocks = vi.hoisted(() => ({
  beginActorRuntimeAuthentication: vi.fn(),
  grantAuthenticatedActorRuntime: vi.fn(),
  lockActorRuntime: vi.fn()
}));

vi.mock('../../../../services/supabase', () => supabaseMocks);
vi.mock('../../../../services/licenseStorage', () => storageMocks);
vi.mock('../../../../services/db/databaseRuntime', () => runtimeMocks);
vi.mock('../../../../services/auth/actorSessionRuntimeBridge', () => actorMocks);
vi.mock('../../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  lockLocalTenantAccess: vi.fn()
}));

import { createLicenseAdminActions } from '../licenseAdminActions';
import { clearDatabaseRecoveryState } from '../../../../services/db/databaseRecoveryState';

const createRemoteResult = (licenseKey = 'LIC-1') => ({
  success: true,
  details: {
    license_key: licenseKey,
    plan_code: 'pro',
    device_id: `device-${licenseKey}`
  },
  admin_user: { id: `admin-${licenseKey}` },
  session: { id: `session-${licenseKey}` }
});

const createHarness = (overrides = {}) => {
  const state = {
    licenseDetails: { license_key: 'LIC-1' },
    adminLoginLicenseKey: 'LIC-1',
    _loadProfile: vi.fn().mockResolvedValue({ id: 'profile' }),
    stopLicenseSync: vi.fn(),
    _processOfflineMode: vi.fn(),
    ...overrides
  };
  const set = (patch) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  const get = () => state;
  Object.assign(state, createLicenseAdminActions({ set, get }));
  return state;
};

beforeEach(() => {
  vi.clearAllMocks();
  clearDatabaseRecoveryState();
  supabaseMocks.clearStaffSessionCache.mockResolvedValue(undefined);
  storageMocks.saveLicenseToStorage.mockResolvedValue(undefined);
  runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
  actorMocks.grantAuthenticatedActorRuntime.mockResolvedValue({ status: 'granted' });
});

describe('admin session local recovery', () => {
  it('keeps a license-bound remote session and reuses it after UpgradeError', async () => {
    const remoteResult = createRemoteResult('LIC-1');
    supabaseMocks.adminLoginOnDevice.mockResolvedValue(remoteResult);
    const upgradeError = new Error('Not yet support for changing primary key');
    upgradeError.name = 'UpgradeError';
    runtimeMocks.ensureLocalDatabaseReady.mockRejectedValueOnce(upgradeError);
    const state = createHarness();

    const first = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(first).toMatchObject({
      success: false,
      remoteAuthenticated: true,
      localRecoveryRequired: true
    });
    expect(actorMocks.lockActorRuntime).toHaveBeenCalledWith('admin_actor_binding_or_bootstrap_failed');
    expect(state.currentAdminUser).toEqual({ id: 'admin-LIC-1' });
    expect(state.pendingAdminSessionResult).toMatchObject({
      licenseKey: 'LIC-1',
      adminUserId: 'admin-LIC-1',
      deviceId: 'device-LIC-1',
      sessionIdentity: 'session-LIC-1',
      result: remoteResult
    });
    expect(state.pendingAdminSessionResult).not.toHaveProperty('password');
    expect(storageMocks.saveLicenseToStorage).toHaveBeenCalled();
    expect(supabaseMocks.adminLogoutSession).not.toHaveBeenCalled();

    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValueOnce(undefined);
    const second = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(second).toMatchObject({ success: true, remoteAuthenticated: true });
    expect(supabaseMocks.adminLoginOnDevice).toHaveBeenCalledTimes(1);
    expect(state._loadProfile).toHaveBeenCalledTimes(1);
    expect(actorMocks.grantAuthenticatedActorRuntime).toHaveBeenCalledWith({
      actorType: 'admin',
      actor: { id: 'admin-LIC-1' }
    });
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it('does not reuse LIC-A when login continues with LIC-B', async () => {
    const resultA = createRemoteResult('LIC-A');
    const resultB = createRemoteResult('LIC-B');
    const state = createHarness({
      licenseDetails: { license_key: 'LIC-B' },
      adminLoginLicenseKey: 'LIC-B',
      currentAdminUser: { id: 'admin-LIC-A' },
      pendingAdminSessionResult: {
        licenseKey: 'LIC-A',
        adminUserId: 'admin-LIC-A',
        deviceId: 'device-LIC-A',
        sessionIdentity: 'session-LIC-A',
        authenticatedAt: '2026-07-24T00:00:00.000Z',
        result: resultA
      }
    });
    supabaseMocks.adminLoginOnDevice.mockResolvedValue(resultB);

    const result = await state.handleAdminLogin({ username: 'owner-b', password: 'secret-b' });

    expect(result).toMatchObject({ success: true, remoteAuthenticated: true });
    expect(supabaseMocks.adminLoginOnDevice).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.adminLoginOnDevice).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'LIC-B',
      username: 'owner-b',
      password: 'secret-b'
    }));
    expect(state.currentAdminUser).toEqual({ id: 'admin-LIC-B' });
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it.each([
    ['licenseKey', 'LIC-TAMPERED'],
    ['adminUserId', 'admin-tampered'],
    ['deviceId', 'device-tampered'],
    ['sessionIdentity', 'session-tampered']
  ])('rejects a pending session with altered %s', async (field, value) => {
    const remoteResult = createRemoteResult('LIC-1');
    const pending = {
      licenseKey: 'LIC-1',
      adminUserId: 'admin-LIC-1',
      deviceId: 'device-LIC-1',
      sessionIdentity: 'session-LIC-1',
      authenticatedAt: '2026-07-24T00:00:00.000Z',
      result: remoteResult,
      [field]: value
    };
    const freshResult = createRemoteResult('LIC-1');
    const state = createHarness({
      currentAdminUser: { id: 'admin-LIC-1' },
      pendingAdminSessionResult: pending
    });
    supabaseMocks.adminLoginOnDevice.mockResolvedValue(freshResult);

    const result = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(result).toMatchObject({ success: true });
    expect(supabaseMocks.adminLoginOnDevice).toHaveBeenCalledTimes(1);
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it('leaves no pending session when credentials are rejected', async () => {
    const state = createHarness();
    supabaseMocks.adminLoginOnDevice.mockResolvedValue({
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Credenciales inválidas.'
    });

    const result = await state.handleAdminLogin({ username: 'owner', password: 'bad' });

    expect(result).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' });
    expect(actorMocks.grantAuthenticatedActorRuntime).not.toHaveBeenCalled();
    expect(state.pendingAdminSessionResult).toBeNull();
  });

  it('does not revoke the remote session when profile loading fails later', async () => {
    supabaseMocks.adminLoginOnDevice.mockResolvedValue(createRemoteResult('LIC-1'));
    const state = createHarness();
    state._loadProfile.mockRejectedValueOnce(new Error('profile local write failed'));

    const result = await state.handleAdminLogin({ username: 'owner', password: 'secret' });

    expect(result).toMatchObject({
      success: false,
      remoteAuthenticated: true,
      code: 'ADMIN_LOCAL_BOOTSTRAP_FAILED'
    });
    expect(actorMocks.lockActorRuntime).toHaveBeenCalledWith('admin_actor_binding_or_bootstrap_failed');
    expect(supabaseMocks.adminLogoutSession).not.toHaveBeenCalled();
    expect(state.currentAdminUser).toEqual({ id: 'admin-LIC-1' });
    expect(state.pendingAdminSessionResult).toMatchObject({
      licenseKey: 'LIC-1',
      result: expect.any(Object)
    });
  });
});
