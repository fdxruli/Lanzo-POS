import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  clearLicenseFromStorage: vi.fn(),
  invalidateProfileRefreshMetadata: vi.fn(),
  lockLocalTenantAccess: vi.fn(),
  getLocalTenantGuardState: vi.fn(),
  closeTenantRuntime: vi.fn(),
  notifyPosCatalogSessionReset: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
  activateLicense: mocks.activateLicense,
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  clearStaffSessionCache: mocks.clearStaffSessionCache
}));
vi.mock('../../../services/licenseStorage', () => ({ clearLicenseFromStorage: mocks.clearLicenseFromStorage }));
vi.mock('./profileRefreshCache', () => ({ invalidateProfileRefreshMetadata: mocks.invalidateProfileRefreshMetadata }));
vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
  initializeLocalTenantGuard: vi.fn(),
  isLocalTenantAccessError: () => false,
  getLocalTenantGuardState: mocks.getLocalTenantGuardState,
  lockLocalTenantAccess: mocks.lockLocalTenantAccess
}));
vi.mock('../../../services/db/tenantRuntimeRouter', () => ({ closeTenantRuntime: mocks.closeTenantRuntime }));
vi.mock('../../../services/products/posCatalogSessionEvents', () => ({ notifyPosCatalogSessionReset: mocks.notifyPosCatalogSessionReset }));
vi.mock('./licenseGuards', () => ({
  buildLicensePlanBlockInfo: () => ({ reason: 'device_not_allowed' }),
  isLicensePlanBlockFailure: () => false,
  isStaffDeviceAuthorizationFailure: () => false,
  getStaffLoginMessage: () => 'Staff login required'
}));
vi.mock('../../../services/Logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), error: mocks.loggerError } }));

import { createLicenseActivationActions } from './licenseActivationActions';
import { createLicenseSessionActions } from './licenseSessionActions';

const createState = () => {
  const state = {
    appStatus: 'admin_enrollment_required',
    ownerEnrollmentContext: 'new_license_setup',
    licenseDetails: { license_key: 'LICENSE-A' },
    currentDeviceRole: 'admin',
    currentAdminUser: null,
    currentStaffUser: null,
    stopLicenseSync: vi.fn(async () => undefined),
    resetNotificationRuntime: vi.fn(),
    resetEcommerceOrdersState: vi.fn(),
    _invalidateProfileLoads: vi.fn(),
    lockDriveSession: vi.fn(),
    _loadProfile: vi.fn()
  };
  const set = (partial) => Object.assign(state, partial);
  const get = () => state;
  Object.assign(state, createLicenseSessionActions({ set, get }));
  Object.assign(state, createLicenseActivationActions({ set, get, hasStaffValidationContext: () => false }));
  return state;
};

describe('owner enrollment context session boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalTenantGuardState.mockReturnValue({ status: 'granted' });
    mocks.clearAdminSessionCache.mockResolvedValue(undefined);
    mocks.clearStaffSessionCache.mockResolvedValue(undefined);
  });

  it('clears new-license context on logout, so license B enters standalone existing-license enrollment', async () => {
    const state = createState();
    await state.logout();
    expect(state).toMatchObject({ appStatus: 'unauthenticated', licenseDetails: null, ownerEnrollmentContext: null });

    mocks.activateLicense.mockResolvedValue({
      valid: false,
      admin_enrollment_required: true,
      details: { license_key: 'LICENSE-B', plan_code: 'pro' }
    });
    await state.handleLogin('LICENSE-B');
    expect(mocks.loggerError).not.toHaveBeenCalled();

    expect(state).toMatchObject({
      appStatus: 'admin_enrollment_required',
      ownerEnrollmentContext: 'existing_license',
      licenseDetails: expect.objectContaining({ license_key: 'LICENSE-B' })
    });
  });

  it('clears context both when a license change is required and when it is confirmed', async () => {
    const state = createState();
    await state._requireLicenseChange();
    expect(state).toMatchObject({ appStatus: 'license_change_required', ownerEnrollmentContext: null });

    state.ownerEnrollmentContext = 'new_license_setup';
    await state.confirmLicenseChangeRequired();
    expect(state).toMatchObject({ appStatus: 'unauthenticated', ownerEnrollmentContext: null });
  });

  it('clears context and tenant-owned UI when leaving a local tenant mismatch', async () => {
    const state = createState();
    state.companyProfile = { name: 'Tenant A' };
    state.profileImportCandidate = { name: 'Tenant A import' };
    await state.leaveLocalTenantMismatch();

    expect(state).toMatchObject({
      appStatus: 'unauthenticated',
      ownerEnrollmentContext: null,
      licenseDetails: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null
    });
  });
});
