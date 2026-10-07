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
      if (identity¶»§q«^