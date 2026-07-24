import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  adminLogoutSession: vi.fn(),
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn(),
  saveLicenseToStorage: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
  activateLicense: mocks.activateLicense,
  adminLoginOnDevice: mocks.adminLoginOnDevice,
  adminLogoutSession: mocks.adminLogoutSession,
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  clearStaffSessionCache: mocks.clearStaffSessionCache,
  enrollAdminOwnerOnDevice: mocks.enrollAdminOwnerOnDevice
}));
vi.mock('../../../services/licenseStorage', () => ({ saveLicenseToStorage: mocks.saveLicenseToStorage }));

import { createLicenseAdminActions } from './licenseAdminActions';

const setup = () => {
  const state = {
    appStatus: 'admin_login_required',
    adminLoginLicenseKey: 'LANZO-ADMIN-TEST',
    licenseDetails: { license_key: 'LANZO-ADMIN-TEST', product_name: 'Pro' },
    stopLicenseSync: vi.fn(),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; })
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;
  Object.assign(state, createLicenseAdminActions({ set, get }));
  return state;
};

describe('license admin actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes admin login immediately without reloading', async () => {
    const state = setup();
    mocks.adminLoginOnDevice.mockResolvedValue({
      success: true,
      admin_user: { id: 'admin-1', username: 'owner', display_name: 'Owner' },
      details: { license_key: 'LANZO-ADMIN-TEST', device_role: 'admin' }
    });
    await expect(state.handleAdminLogin({ username: 'owner', password: 'fixture-password' })).resolves.toEqual({ success: true });
    expect(state.currentAdminUser).toMatchObject({ id: 'admin-1' });
    expect(state.currentStaffUser).toBeNull();
    expect(state.appStatus).toBe('ready');
    expect(state._loadProfile).toHaveBeenCalledWith('LANZO-ADMIN-TEST', { forceRemote: true, reason: 'admin_login' });
  });

  it('keeps incorrect credentials in the admin login flow', async () => {
    const state = setup();
    mocks.adminLoginOnDevice.mockResolvedValue({ success: false, code: 'INVALID_ADMIN_CREDENTIALS', message: 'Usuario o contrasena incorrectos.' });
    const result = await state.handleAdminLogin({ username: 'owner', password: 'wrong-fixture' });
    expect(result.success).toBe(false);
    expect(state.appStatus).toBe('admin_login_required');
    expect(state.adminLoginError.code).toBe('INVALID_ADMIN_CREDENTIALS');
  });

  it('does not remain loading when the legacy backend validates an admin device', async () => {
    const state = setup();
    mocks.activateLicense.mockResolvedValue({
      valid: true,
      details: { license_key: 'LANZO-ADMIN-TEST', plan_code: 'pro' }
    });

    await expect(state.discoverAdminAccess('LANZO-ADMIN-TEST')).resolves.toEqual({
      success: true,
      legacyBackendFallback: true
    });
    expect(state._processOfflineMode).toHaveBeenCalledWith(
      expect.objectContaining({ license_key: 'LANZO-ADMIN-TEST', device_role: 'admin' }),
      { reason: 'legacy_admin_auth_compatibility' }
    );
    expect(state.appStatus).toBe('ready');
  });

  it('completes owner enrollment and records currentAdminUser', async () => {
    const state = setup();
    state.appStatus = 'admin_enrollment_required';
    mocks.enrollAdminOwnerOnDevice.mockResolvedValue({
      success: true,
      admin_user: { id: 'owner-1', username: 'owner_test', display_name: 'Test Owner' },
      details: { license_key: 'LANZO-ADMIN-TEST' }
    });
    await state.handleAdminEnrollment({ username: 'owner_test', password: 'fixture-password', displayName: 'Test Owner' });
    expect(state.currentAdminUser.id).toBe('owner-1');
    expect(state.adminEnrollmentRequired).toBe(false);
    expect(state.appStatus).toBe('ready');
  });

  it('distinguishes admin logout from releasing the device', async () => {
    const state = setup();
    state.currentAdminUser = { id: 'admin-1' };
    await state.logoutAdmin();
    expect(mocks.adminLogoutSession).toHaveBeenCalledWith('LANZO-ADMIN-TEST');
    expect(state.appStatus).toBe('admin_login_required');
    expect(state.licenseDetails.license_key).toBe('LANZO-ADMIN-TEST');
  });
});
