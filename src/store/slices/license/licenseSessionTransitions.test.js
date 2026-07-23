import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAdminSessionCache: vi.fn(),
  clearStaffSessionCache: vi.fn(),
  hasAdminSessionToken: vi.fn(),
  hasStaffSessionToken: vi.fn(),
  hasValidOfflineAdminSession: vi.fn(),
  verifyAdminSession: vi.fn(),
  verifyStaffSession: vi.fn(),
  revalidateLicense: vi.fn(),
  activateLicense: vi.fn(),
  adminLoginOnDevice: vi.fn(),
  staffLoginOnDevice: vi.fn(),
  staffLogoutSession: vi.fn(),
  adminLogoutSession: vi.fn(),
  saveLicenseToStorage: vi.fn(),
  getLicenseFromStorage: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
  clearAdminSessionCache: mocks.clearAdminSessionCache,
  clearStaffSessionCache: mocks.clearStaffSessionCache,
  hasAdminSessionToken: mocks.hasAdminSessionToken,
  hasStaffSessionToken: mocks.hasStaffSessionToken,
  hasValidOfflineAdminSession: mocks.hasValidOfflineAdminSession,
  verifyAdminSession: mocks.verifyAdminSession,
  verifyStaffSession: mocks.verifyStaffSession,
  revalidateLicense: mocks.revalidateLicense,
  activateLicense: mocks.activateLicense,
  adminLoginOnDevice: mocks.adminLoginOnDevice,
  staffLoginOnDevice: mocks.staffLoginOnDevice,
  staffLogoutSession: mocks.staffLogoutSession,
  adminLogoutSession: mocks.adminLogoutSession
}));
vi.mock('../../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage,
  getLicenseFromStorage: mocks.getLicenseFromStorage
}));
vi.mock('../../../services/Logger', () => ({ default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createLicenseAdminActions } from './licenseAdminActions';
import { createLicenseBootstrapActions } from './licenseBootstrapActions';
import { createLicenseProcessingActions } from './licenseProcessingActions';
import { createLicenseStaffActions } from './licenseStaffActions';

const proLicense = (device_role = 'admin') => ({
  license_key: 'TEST-LICENSE-ACTOR-TRANSITION',
  device_role,
  plan_code: 'pro',
  max_devices: 2,
  status: 'active',
  localExpiry: new Date(Date.now() + 60_000).toISOString()
});

const createStore = (initial = {}) => {
  const state = {
    appStatus: 'loading',
    licenseDetails: proLicense(),
    stopLicenseSync: vi.fn(),
    refreshLicenseSyncMode: vi.fn(),
    _validateInBackground: vi.fn(),
    _loadProfile: vi.fn(async () => { state.appStatus = 'ready'; }),
    _processOfflineMode: vi.fn(async () => { state.appStatus = 'ready'; }),
    _requireLicenseChange: vi.fn(),
    clearLocalLicenseSession: vi.fn(),
    ...initial
  };
  const set = vi.fn((partial) => Object.assign(state, partial));
  const get = () => state;
  Object.assign(state,
    createLicenseAdminActions({ set, get }),
    createLicenseStaffActions({ set, get }),
    createLicenseBootstrapActions({ set, get }),
    createLicenseProcessingActions({
      set,
      get,
      clearLocalLicenseSession: state.clearLocalLicenseSession,
      hasStaffValidationContext: async () => false
    })
  );
  return state;
};

describe('canonical actor session transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.hasAdminSessionToken.mockResolvedValue(true);
    mocks.hasStaffSessionToken.mockResolvedValue(true);
  });

  it('restores admin after staff → admin → reload, clearing the residual staff cache', async () => {
    const state = createStore({ appStatus: 'admin_login_required' });
    mocks.adminLoginOnDevice.mockResolvedValue({
      success: true,
      admin_user: { id: 'admin-1', username: 'owner' },
      details: proLicense('admin')
    });
    await state.handleAdminLogin({ username: 'owner', password: 'synthetic' });
    expect(mocks.clearStaffSessionCache).toHaveBeenCalled();
    expect(state.licenseDetails.device_role).toBe('admin');

    mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
    mocks.verifyAdminSession.mockResolvedValue({ valid: true, admin_user: { id: 'admin-1' }, details: proLicense('admin') });
    await state.initializeApp();
    expect(mocks.verifyAdminSession).toHaveBeenCalledWith(state.licenseDetails.license_key);
    expect(mocks.verifyStaffSession).not.toHaveBeenCalled();
    expect(state.appStatus).toBe('ready');
  });

  it('restores staff after admin → staff → reload, clearing the residual admin cache', async () => {
    const state = createStore({
      appStatus: 'staff_login_required',
      licenseDetails: proLicense('admin'),
      staffLoginLicenseKey: proLicense().license_key
    });
    mocks.staffLoginOnDevice.mockResolvedValue({
      success: true,
      staff_user: { id: 'staff-1', username: 'cashier' },
      details: proLicense('staff')
    });
    await state.handleStaffLogin({ username: 'cashier', password: 'synthetic' });
    expect(mocks.clearAdminSessionCache).toHaveBeenCalled();
    expect(state.licenseDetails.device_role).toBe('staff');

    mocks.getLicenseFromStorage.mockResolvedValue(state.licenseDetails);
    mocks.verifyStaffSession.mockResolvedValue({ valid: true, staff_user: { id: 'staff-1' } });
    await state.initializeApp();
    expect(mocks.verifyStaffSession).toHaveBeenCalledWith(state.licenseDetails.license_key);
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(state.appStatus).toBe('ready');
  });

  it('uses server discovery instead of selecting a role from either residual token', async () => {
    const state = createStore();
    const ambiguous = { ...proLicense(), device_role: null };
    mocks.getLicenseFromStorage.mockResolvedValue(ambiguous);
    state.discoverAdminAccess = vi.fn(async () => {
      state.appStatus = 'admin_login_required';
    });
    await state.initializeApp();
    expect(state.discoverAdminAccess).toHaveBeenCalledWith(ambiguous.license_key);
    expect(mocks.verifyAdminSession).not.toHaveBeenCalled();
    expect(mocks.verifyStaffSession).not.toHaveBeenCalled();
  });

  it('moves a trusted admin from FREE to enrollment immediately without a reload', async () => {
    const state = createStore({ appStatus: 'ready', licenseDetails: { ...proLicense('admin'), plan_code: 'free_trial', max_devices: 1 } });
    mocks.hasAdminSessionToken.mockResolvedValue(false);
    state.discoverAdminAccess = vi.fn(async () => {
      state.appStatus = 'admin_enrollment_required';
    });
    const remotePro = { ...proLicense('admin'), valid: true, plan_code: 'pro', max_devices: 2 };
    await state._processServerValidation(remotePro, state.licenseDetails, { reason: 'test_hot_upgrade' });
    expect(state.stopLicenseSync).toHaveBeenCalled();
    expect(mocks.clearStaffSessionCache).toHaveBeenCalled();
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({ plan_code: 'pro' }));
    expect(state.discoverAdminAccess).toHaveBeenCalledWith(remotePro.license_key);
    expect(state.appStatus).toBe('admin_enrollment_required');
    expect(state._loadProfile).not.toHaveBeenCalled();
  });
});
