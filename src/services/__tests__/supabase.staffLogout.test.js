// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  values: new Map(),
  readDeviceRegistryValue: vi.fn(),
  writeDeviceRegistryValue: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@fingerprintjs/fingerprintjs', () => ({ default: { load: vi.fn() } }));
vi.mock('../database', () => ({
  STORES: { SYNC_CACHE: 'sync_cache' },
  loadData: vi.fn(async (_store, key) => mocks.values.has(key) ? { value: mocks.values.get(key) } : null),
  saveData: vi.fn(async (_store, record) => mocks.values.set(record.key, record.value))
}));
vi.mock('../device/deviceRegistry', () => ({
  DEVICE_REGISTRY_KEYS: { STABLE_DEVICE_ID: 'lanzo_device_id', LICENSE_ATTEMPTS: 'license_attempts' },
  readDeviceRegistryValue: mocks.readDeviceRegistryValue,
  writeDeviceRegistryValue: mocks.writeDeviceRegistryValue
}));
vi.mock('../utils', () => ({
  safeLocalStorageSet: (key, value) => localStorage.setItem(key, value),
  checkInternetConnection: vi.fn(async () => true)
}));
vi.mock('../Logger', () => ({ default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(),
  isLocalTenantAccessError: vi.fn(() => false),
  getLocalTenantBinding: vi.fn(),
  runWithLocalTenantSyncLease: vi.fn((_tenant, _options, operation) => operation())
}));

const loadSupabase = async () => {
  vi.resetModules();
  return import('../supabase');
};

describe('Staff logout remote revocation reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values = new Map([
      ['staff_session_token', 'staff-session-secret'],
      ['staff_session_id', 'staff-session-id'],
      ['device_security_token', 'current-device-proof']
    ]);
    mocks.readDeviceRegistryValue.mockResolvedValue('logout-fixture-device');
    localStorage.setItem('lanzo_device_id', 'logout-fixture-device');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://logout-fixture.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fixture-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('reports local invalidation separately when the server confirms revocation', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { success: true }, error: null });
    const { staffLogoutSession } = await loadSupabase();

    await expect(staffLogoutSession('LIC-LOGOUT')).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'confirmed'
    });
    expect(mocks.values.get('staff_session_token')).toBeNull();
  });

  it('does not claim remote revocation when the response is lost after the request', async () => {
    mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { staffLogoutSession } = await loadSupabase();

    await expect(staffLogoutSession('LIC-LOGOUT')).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_confirmed'
    });
    expect(mocks.values.get('staff_session_token')).toBeNull();
  });

  it('returns after the remote timeout while keeping the server status unconfirmed', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockReturnValueOnce(new Promise(() => {}));
    const { staffLogoutSession } = await loadSupabase();
    const logout = staffLogoutSession('LIC-LOGOUT');
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(logout).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_confirmed'
    });
    expect(mocks.values.get('staff_session_token')).toBeNull();
  });

  it('marks an offline logout as local only without attempting the RPC', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const { staffLogoutSession } = await loadSupabase();

    await expect(staffLogoutSession('LIC-LOGOUT')).resolves.toMatchObject({
      success: true,
      localCredentialsCleared: true,
      remoteRevocationStatus: 'not_attempted'
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends owner credentials with the persisted device proof to the dedicated recovery RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { success: false, code: 'INVALID_ADMIN_CREDENTIALS' }, error: null });
    const { adminRecoverStaffOnlyDevice } = await loadSupabase();

    await expect(adminRecoverStaffOnlyDevice({
      licenseKey: 'LIC-RECOVERY',
      username: 'owner-qa',
      password: 'fresh-owner-password'
    })).resolves.toMatchObject({ success: false, code: 'INVALID_ADMIN_CREDENTIALS' });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_recover_staff_only_device', {
      p_license_key: 'LIC-RECOVERY',
      p_username: 'owner-qa',
      p_password: 'fresh-owner-password',
      p_device_fingerprint: 'logout-fixture-device',
      p_device_security_token: 'current-device-proof'
    });
  });
});
