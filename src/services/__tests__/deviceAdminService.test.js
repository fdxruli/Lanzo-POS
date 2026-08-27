import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTenant: vi.fn(),
  runWithLease: vi.fn(async (_source, _options, operation) => operation()),
  checkInternetConnection: vi.fn(async () => true),
  getStableDeviceId: vi.fn(async () => 'device-a'),
  rpc: vi.fn(),
  loadData: vi.fn(),
  saveData: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  getAdminSessionToken: vi.fn(async () => 'admin-session-a'),
  getDeviceSecurityToken: vi.fn(async () => 'device-token-a')
}));

vi.mock('../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: mocks.runWithLease
}));

vi.mock('../supabase', () => ({
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  getAdminSessionToken: mocks.getAdminSessionToken,
  getDeviceSecurityToken: mocks.getDeviceSecurityToken,
  supabaseClient: { rpc: mocks.rpc }
}));

vi.mock('../database', () => ({
  loadData: mocks.loadData,
  saveData: mocks.saveData,
  STORES: { SYNC_CACHE: 'sync_cache' }
}));

vi.mock('../utils', () => ({
  checkInternetConnection: mocks.checkInternetConnection,
  getStableDeviceId: mocks.getStableDeviceId
}));

vi.mock('../Logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      clearServerStatus: vi.fn(),
      reportServerStatus: vi.fn()
    })
  }
}));

import { deactivateDeviceSmart } from '../licenseService';
import { setDeviceModeSmart } from '../deviceModeService';

describe('device administration service boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTenant.mockResolvedValue({ status: 'pass' });
    mocks.runWithLease.mockImplementation(async (_source, _options, operation) => operation());
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.getStableDeviceId.mockResolvedValue('device-a');
    mocks.getAdminSessionToken.mockResolvedValue('admin-session-a');
    mocks.getDeviceSecurityToken.mockResolvedValue('device-token-a');
    mocks.rpc.mockResolvedValue({
      data: { success: true, device_mode: 'shared' },
      error: null
    });
  });

  it('rejects an invalid mode before tenant access or RPC', async () => {
    const result = await setDeviceModeSmart('device-b', 'invalid', 'LIC-1');

    expect(result).toEqual({
      success: false,
      code: 'DEVICE_MODE_INVALID_REQUEST',
      message: 'No se pudo validar el cambio de modo del dispositivo.'
    });
    expect(mocks.assertTenant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a mode mutation before RPC when offline', async () => {
    mocks.checkInternetConnection.mockResolvedValue(false);

    const result = await setDeviceModeSmart('device-b', 'staff_only', 'LIC-1');

    expect(result).toMatchObject({ success: false, code: 'ONLINE_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed before RPC when Admin credentials are incomplete', async () => {
    mocks.getAdminSessionToken.mockResolvedValue(null);

    const result = await setDeviceModeSmart('device-b', 'shared', 'LIC-1');

    expect(result).toMatchObject({ success: false, code: 'ADMIN_SESSION_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['admin_only', 'staff_only', 'shared'])('sends canonical mode %s with the exact Admin context', async (mode) => {
    await setDeviceModeSmart('device-b', mode, 'LIC-1');

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_device_mode', {
      p_license_key: 'LIC-1',
      p_requester_fingerprint: 'device-a',
      p_device_security_token: 'device-token-a',
      p_admin_session_token: 'admin-session-a',
      p_target_device_id: 'device-b',
      p_device_mode: mode
    });
  });

  it('blocks release offline without an RPC', async () => {
    mocks.checkInternetConnection.mockResolvedValue(false);

    const result = await deactivateDeviceSmart('device-b', 'LIC-1');

    expect(result).toMatchObject({ success: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
  });

  it('sends a remote release with the exact authenticated context', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: true, released_current_device: false },
      error: null
    });

    await deactivateDeviceSmart('device-b', 'LIC-1');

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_release_device', {
      p_license_key: 'LIC-1',
      p_requester_fingerprint: 'device-a',
      p_device_security_token: 'device-token-a',
      p_admin_session_token: 'admin-session-a',
      p_target_device_id: 'device-b'
    });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
  });

  it('does not clear current-device credentials when the release fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: false, code: 'ADMIN_SESSION_INVALID' },
      error: null
    });

    const result = await deactivateDeviceSmart('device-a', 'LIC-1');

    expect(result).toEqual({ success: false, code: 'ADMIN_SESSION_INVALID' });
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
  });

  it('clears current-device credentials only after confirmed server release', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: true, released_current_device: true },
      error: null
    });

    const result = await deactivateDeviceSmart('device-a', 'LIC-1');

    expect(result).toEqual({ success: true, released_current_device: true });
    expect(mocks.assertTenant).toHaveBeenCalledWith(
      { license_key: 'LIC-1' },
      { reason: 'license_device_release_commit' }
    );
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', {
      key: 'device_security_token',
      value: null
    });
    expect(mocks.saveData).toHaveBeenCalledWith('sync_cache', {
      key: 'last_valid_license_state',
      value: null
    });
    expect(mocks.clearAdminSessionCache).toHaveBeenCalledTimes(1);
  });
});
