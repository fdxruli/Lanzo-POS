import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renewLicenseService: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(),
  getTenantRuntimeReadiness: vi.fn(() => ({ ready: true, runtime: { opaqueId: 'health-test', generation: 1 } }))
}));

vi.mock('../../../services/licenseService', () => ({
  renewLicenseService: mocks.renewLicenseService
}));

vi.mock('../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('../../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: mocks.getTenantRuntimeReadiness
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess
}));

import { createLicenseMaintenanceActions } from './licenseMaintenanceActions';

describe('license renewal tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertLocalTenantSyncAccess.mockResolvedValue({ status: 'pass' });
    mocks.getTenantRuntimeReadiness.mockReturnValue({ ready: true, runtime: { opaqueId: 'health-test', generation: 1 } });
  });

  it('rejects a contradictory response identity before persisting or publishing it', async () => {
    const tenantError = Object.assign(new Error('tenant mismatch'), {
      code: 'LOCAL_TENANT_SYNC_BLOCKED'
    });
    mocks.assertLocalTenantSyncAccess.mockImplementation(async (identity) => {
      if (identity?.license_id === 'tenant-b') throw tenantError;
      return { status: 'pass' };
    });
    mocks.renewLicenseService.mockResolvedValue({
      success: true,
      licenseDetails: {
        license_id: 'tenant-b',
        expires_at: '2030-01-01T00:00:00.000Z'
      }
    });

    const adminUser = { id: 'admin-a' };
    const state = {
      appStatus: 'ready',
      currentAdminUser: adminUser,
      currentStaffUser: null,
      licenseDetails: {
        license_id: 'tenant-a',
        license_key: 'LANZO-A'
      }
    };
    const set = vi.fn((patch) => Object.assign(state, patch));
    const get = () => state;
    Object.assign(state, createLicenseMaintenanceActions({ set, get }));

    await expect(state.renewLicense()).rejects.toBe(tenantError);
    expect(mocks.assertLocalTenantSyncAccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ license_id: 'tenant-b' }),
      { reason: 'license_renewal_response_identity' }
    );
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
  it('defers wake health checks until TenantRuntime is physically ready', async () => {
    const recoverRealtimeSecurity = vi.fn(async () => undefined);
    const runLicenseSyncCheck = vi.fn(async () => undefined);
    const state = {
      appStatus: 'ready',
      _isInitializing: false,
      licenseSyncMode: 'hybrid_realtime',
      licenseDetails: {
        license_key: 'LANZO-PRO',
        plan_code: 'PRO',
        features: {
          cloud_pos_sync: true,
          cloud_cash_sync: true,
          realtime_license_sync: true
        }
      },
      recoverRealtimeSecurity,
      runLicenseSyncCheck
    };
    const set = vi.fn();
    Object.assign(state, createLicenseMaintenanceActions({ set, get: () => state }));
    vi.stubGlobal('navigator', { onLine: true });
    mocks.getTenantRuntimeReadiness.mockReturnValue({ ready: false, runtime: null });

    await state.performSystemHealthCheck('online', { timeAwayMs: 5 * 60 * 1000 });

    expect(recoverRealtimeSecurity).not.toHaveBeenCalled();
    expect(runLicenseSyncCheck).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(state.licenseDetails.features).toEqual({
      cloud_pos_sync: true,
      cloud_cash_sync: true,
      realtime_license_sync: true
    });

    mocks.getTenantRuntimeReadiness.mockReturnValue({
      ready: true,
      runtime: { opaqueId: 'health-restored', generation: 2 }
    });
    await state.performSystemHealthCheck('online', { timeAwayMs: 5 * 60 * 1000 });

    expect(recoverRealtimeSecurity).toHaveBeenCalledTimes(1);
    expect(runLicenseSyncCheck).not.toHaveBeenCalled();
    expect(state.licenseDetails.features.realtime_license_sync).toBe(true);
  });

});
