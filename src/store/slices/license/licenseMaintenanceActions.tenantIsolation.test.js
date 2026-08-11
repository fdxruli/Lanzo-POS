import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renewLicenseService: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn()
}));

vi.mock('../../../services/licenseService', () => ({
  renewLicenseService: mocks.renewLicenseService
}));

vi.mock('../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess
}));

import { createLicenseMaintenanceActions } from './licenseMaintenanceActions';

describe('license renewal tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertLocalTenantSyncAccess.mockResolvedValue({ status: 'pass' });
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
});
