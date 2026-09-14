import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBusinessProfile: vi.fn(),
  revalidateLicense: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  actorRuntimeCapture: vi.fn(),
  actorHandle: {
    actorType: 'admin',
    sessionId: 'admin-session',
    assertCurrent: vi.fn()
  },
  loadData: vi.fn(),
  saveBusinessProfile: vi.fn(),
  saveData: vi.fn(async () => undefined),
  saveLicenseToStorage: vi.fn(async () => undefined)
}));

vi.mock('../../services/database', () => ({
  loadData: mocks.loadData,
  saveData: mocks.saveData,
  STORES: { COMPANY: 'company' }
}));

vi.mock('../../services/supabase', () => ({
  getBusinessProfile: mocks.getBusinessProfile,
  revalidateLicense: mocks.revalidateLicense,
  saveBusinessProfile: mocks.saveBusinessProfile
}));

vi.mock('../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo' },
  uploadImageFile: vi.fn()
}));

vi.mock('../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_')
}));

vi.mock('../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: mocks.actorRuntimeCapture }
}));

import { createProfileSlice } from './createProfileSlice';
import {
  PROFILE_LAST_LICENSE_KEY,
  PROFILE_LAST_LOAD_KEY
} from './license/licenseConstants';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn((key) => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
};

describe('profile refresh during authenticated staff transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('File', class File {});
    mocks.assertLocalTenantSyncAccess.mockResolvedValue({ status: 'pass' });
    mocks.actorHandle.actorType = 'admin';
    mocks.actorHandle.sessionId = 'admin-session';
    mocks.actorHandle.assertCurrent.mockReset();
    mocks.actorRuntimeCapture.mockReturnValue(mocks.actorHandle);

    localStorage.setItem(PROFILE_LAST_LOAD_KEY, String(Date.now()));
    localStorage.setItem(PROFILE_LAST_LICENSE_KEY, 'LANZO-PRO');

    mocks.loadData.mockResolvedValue({
      id: 'company:LANZO-PRO',
      license_key: 'LANZO-PRO',
      name: 'Negocio',
      business_type: ['abarrotes']
    });
    mocks.getBusinessProfile.mockResolvedValue({
      success: true,
      data: {
        profile_id: 'profile-id',
        license_key: 'LANZO-PRO',
        business_name: 'Negocio',
        business_type: ['hardware']
      }
    });
    mocks.revalidateLicense.mockResolvedValue({
      valid: true,
      license_key: 'LANZO-FREE',
      plan_code: 'pro_monthly',
      features: {
        ecommerce_portal_enabled: true,
        ecommerce_order_inbox: true
      },
      device_role: 'admin'
    });
  });

  it('bypasses a fresh local TTL and reads the authoritative profile', async () => {
    const state = {
      appStatus: 'staff_login_required',
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-id' },
      companyProfile: {
        license_key: 'LANZO-PRO',
        name: 'Negocio',
        business_type: ['abarrotes']
      }
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    const slice = createProfileSlice(set, get);
    Object.assign(state, slice);

    const profile = await state._loadProfile('LANZO-PRO');

    expect(mocks.getBusinessProfile).toHaveBeenCalledWith('LANZO-PRO');
    expect(profile.business_type).toEqual(['hardware']);
    expect(state.companyProfile.business_type).toEqual(['hardware']);
  });

  it('rejects a remote profile for another tenant before caching or rendering it', async () => {
    const tenantError = Object.assign(new Error('tenant mismatch'), {
      code: 'LOCAL_TENANT_SYNC_BLOCKED'
    });
    mocks.assertLocalTenantSyncAccess.mockImplementation(async (identity) => {
      const licenseKey = identity?.license_key || identity?.licenseKey;
      if (licenseKey === 'LANZO-OTHER') throw tenantError;
      return { status: 'pass' };
    });
    mocks.getBusinessProfile.mockResolvedValueOnce({
      success: true,
      data: {
        license_key: 'LANZO-OTHER',
        business_name: 'Negocio ajeno',
        business_type: ['restaurant']
      }
    });

    const originalProfile = {
      license_key: 'LANZO-PRO',
      name: 'Negocio',
      business_type: ['abarrotes']
    };
    const state = {
      appStatus: 'staff_login_required',
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-id' },
      companyProfile: originalProfile
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get));
    state.companyProfile = originalProfile;

    await expect(state._loadProfile('LANZO-PRO', { forceRemote: true })).rejects.toBe(tenantError);
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(state.companyProfile).toBe(originalProfile);
  });

  it.each(['admin', 'staff'])('binds an allowed %s profile update to its captured actor handle', async (actorType) => {
    mocks.actorHandle.actorType = actorType;
    mocks.actorHandle.sessionId = `${actorType}-session`;
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      licenseDetails: { license_key: 'LANZO-PRO' },
      companyProfile: null
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    Object.assign(state, createProfileSlice(set, () => state));

    await state.updateCompanyProfile({
      name: 'Actor profile',
      business_type: ['hardware']
    });

    expect(mocks.actorRuntimeCapture).toHaveBeenCalledWith('settings');
    expect(mocks.saveBusinessProfile).toHaveBeenCalledWith(
      'LANZO-PRO',
      expect.objectContaining({ name: 'Actor profile', business_type: ['hardware'] }),
      { actorHandle: mocks.actorHandle }
    );
    expect(mocks.saveData).toHaveBeenCalledTimes(2);
    expect(state.companyProfile).toMatchObject({ name: 'Actor profile' });
  });

  it('refreshes effective license features before marking first-time setup ready', async () => {
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      licenseDetails: {
        license_key: 'LANZO-FREE',
        features: { full_access: true }
      },
      currentDeviceRole: 'admin',
      companyProfile: null,
      appStatus: 'setup_required'
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    Object.assign(state, createProfileSlice(set, () => state));

    await state.handleSetup({
      name: 'Negocio nuevo',
      business_type: ['hardware']
    });

    expect(mocks.revalidateLicense).toHaveBeenCalledWith('LANZO-FREE');
    expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
      license_key: 'LANZO-FREE',
      valid: true,
      features: {
        ecommerce_portal_enabled: true,
        ecommerce_order_inbox: true
      }
    }));
    expect(state.licenseDetails.features).toEqual({
      ecommerce_portal_enabled: true,
      ecommerce_order_inbox: true
    });
    expect(state.appStatus).toBe('ready');
  });

  it('does not enter ready when onboarding cannot obtain authoritative features', async () => {
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    mocks.revalidateLicense.mockResolvedValue({
      valid: true,
      reason: 'offline_grace',
      features: { ecommerce_portal_enabled: true }
    });
    const state = {
      licenseDetails: { license_key: 'LANZO-FREE', features: { full_access: true } },
      currentDeviceRole: 'admin',
      companyProfile: null,
      appStatus: 'setup_required'
    };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await expect(state.handleSetup({
      name: 'Negocio nuevo',
      business_type: ['hardware']
    })).rejects.toMatchObject({ code: 'offline_grace' });
    expect(state.appStatus).toBe('setup_required');
    expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
  });

  it('denies a Staff profile mutation before any remote or local write when settings is absent', async () => {
    const denied = Object.assign(new Error('ACTOR_PERMISSION_DENIED'), {
      code: 'ACTOR_PERMISSION_DENIED'
    });
    mocks.actorRuntimeCapture.mockImplementationOnce(() => { throw denied; });
    const state = { licenseDetails: { license_key: 'LANZO-PRO' } };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await expect(state.updateCompanyProfile({
      name: 'Denied profile',
      business_type: ['hardware']
    })).rejects.toBe(denied);
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
  });

  it.each([
    ['updateCompanyProfile', { name: 'Stale update', business_type: ['hardware'] }],
    ['handleSetup', { name: 'Stale setup', business_type: ['abarrotes'] }]
  ])('fences %s before local cache publication when the actor changes after the RPC', async (method, payload) => {
    const stale = Object.assign(new Error('ACTOR_CONTEXT_STALE'), {
      code: 'ACTOR_CONTEXT_STALE'
    });
    mocks.actorHandle.assertCurrent
      .mockImplementationOnce(() => ({ actorKey: 'admin:one' }))
      .mockImplementationOnce(() => { throw stale; });
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      licenseDetails: { license_key: 'LANZO-PRO' },
      companyProfile: null,
      appStatus: 'setup_required'
    };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await expect(state[method](payload)).rejects.toBe(stale);
    expect(mocks.saveBusinessProfile).toHaveBeenCalledWith(
      'LANZO-PRO', expect.any(Object), { actorHandle: mocks.actorHandle }
    );
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(state.companyProfile).toBeNull();
    expect(state.appStatus).toBe('setup_required');
  });
});
