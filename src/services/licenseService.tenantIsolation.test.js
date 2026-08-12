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
  getAdminSessionToken: vi.fn(async () => 'admin-token-a'),
  getDeviceSecurityToken: vi.fn(async () => 'device-token-a')
}));

vi.mock('./tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_'),
  runWithLocalTenantSyncLease: mocks.runWithLease
}));

vi.mock('./supabase', () => ({
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  getAdminSessionToken: mocks.getAdminSessionToken,
  getDeviceSecurityToken: mocks.getDeviceSecurityToken,
  supabaseClient: { rpc: mocks.rpc }
}));

vi.mock('./database', () => ({
  loadData: mocks.loadData,
  saveData: mocks.saveData,
  STORES: { SYNC_CACHE: 'sync_cache' }
}));

vi.mock('./utils', () => ({
  checkInternetConnection: mocks.checkInternetConnection,
  getStableDeviceId: mocks.getStableDeviceId
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      clearServerStatus: vi.fn(),
      reportServerStatus: vi.fn()
    })
  }
}));

import { deactivateDeviceSmart, getLicenseDevicesSmart } from './licenseService';

const tenantError = () => Object.assign(new Error('tenant blocked'), {
  code: 'LOCAL_TENANT_SYNC_BLOCKED'
});

describe('licenseService tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTenant.mockResolvedValue({ status: 'pass' });
    mocks.checkInternetConnection.mockResolvedValue(true);
    mocks.getStableDeviceId.mockResolvedValue('device-a');
    mocks.getAdminSessionToken.mockResolvedValue('admin-token-a');
    mocks.getDeviceSecurityToken.mockResolvedValue('device-token-a');
  });

  it('fails before credentials, RPC or cache access for a non-active license', async () => {
    const error = tenantError();
    mocks.assertTenant.mockRejectedValueOnce(error);

    await expect(getLicenseDevicesSmart('TENANT-B')).rejects.toBe(error);
    expect(mocks.runWithLease).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it('does not cache a devices response when tenant access changes before commit', async () => {
    const error = tenantError();
    mocks.rpc.mockResolvedValue({
      data: { success: true, data: [{ id: 'device-a' }] },
      error: null
    });
    mocks.assertTenant.mockImplementation(async (_source, options) => {
      if (options?.reason === 'license_devices_cache_commit') throw error;
      return { status: 'pass' };
    });

    await expect(getLicenseDevicesSmart('TENANT-A')).rejects.toBe(error);
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.loadData).not.toHaveBeenCalled();
  });

  it('does not clear credentials when a release response loses tenant access', async () => {
    const error = tenantError();
    mocks.rpc.mockResolvedValue({
      data: { success: true, released_current_device: true },
      error: null
    });
    mocks.assertTenant.mockImplementation(async (_source, options) => {
      if (options?.reason === 'license_device_release_commit') throw error;
      return { status: 'pass' };
    });

    await expect(deactivateDeviceSmart('device-a', 'TENANT-A')).rejects.toBe(error);
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.clearAdminSessionCache).not.toHaveBeenCalled();
  });
});
