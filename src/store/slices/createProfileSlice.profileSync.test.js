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
  actorRuntimePermissions: ['settings_data'],
  loadData: vi.fn(),
  saveBusinessProfile: vi.fn(),
  uploadImageFile: vi.fn(),
  saveData: vi.fn(async () => undefined),
  saveLicenseToStorage: vi.fn(async () => undefined),
  getTenantRuntimeReadiness: vi.fn(() => ({ ready: true, runtime: { opaqueId: 'profile-test', generation: 1 } }))
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
  uploadImageFile: mocks.uploadImageFile
}));

vi.mock('../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_')
}));

vi.mock('../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: mocks.getTenantRuntimeReadiness,
  isTenantRuntimeError: (error) => String(error?.code || '').startsWith('TENANT_RUNTIME_')
}));

vi.mock('../../services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: { PERMISSION_DENIED: 'ACTOR_PERMISSION_DENIED' },
  ActorRuntimeError: class ActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  },
  actorRuntimeController: {
    capture: mocks.actorRuntimeCapture,
    getState: () => {
      const actorType = mocks.actorHandle.actorType;
      const actorId = `${actorType}-id`;
      return {
        status: 'granted',
        actorType,
        actorId,
        actorKey: `${actorType}:${actorId}`,
        sessionId: mocks.actorHandle.sessionId,
        generation: 1,
        permissions: actorType === 'admin' ? ['*'] : mocks.actorRuntimePermissions
      };
    },
    assertCurrent: vi.fn()
  }
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
    mocks.getTenantRuntimeReadiness.mockReturnValue({ ready: true, runtime: { opaqueId: 'profile-test', generation: 1 } });
    mocks.actorHandle.actorType = 'admin';
    mocks.actorHandle.sessionId = 'admin-session';
    mocks.actorHandle.assertCurrent.mockReset();
    mocks.actorRuntimeCapture.mockReturnValue(mocks.actorHandle);
    mocks.actorRuntimePermissions = ['settings_data'];

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
    mocks.actorRuntimePermissions = ['settings_data'];
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      currentDeviceRole: actorType,
      currentAdminUser: actorType === 'admin' ? { id: 'admin-id' } : null,
      currentStaffUser: actorType === 'staff' ? {
        id: 'staff-id', permissions: { settings_data: true }
      } : null,
      licenseDetails: { license_key: 'LANZO-PRO' },
      companyProfile: null
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    Object.assign(state, createProfileSlice(set, () => state));

    await state.updateCompanyProfile({
      name: 'Actor profile',
      business_type: ['hardware']
    });

    expect(mocks.actorRuntimeCapture).toHaveBeenCalledWith('settings_data');
    expect(mocks.saveBusinessProfile).toHaveBeenCalledWith(
      'LANZO-PRO',
      expect.objectContaining({ name: 'Actor profile', business_type: ['hardware'] }),
      { actorHandle: expect.objectContaining({ actorType, sessionId: `${actorType}-session` }) }
    );
    expect(mocks.saveData).toHaveBeenCalledTimes(2);
    expect(state.companyProfile).toMatchObject({ name: 'Actor profile' });
  });

  it('keeps an unmodified legacy Settings grant able to update the business profile', async () => {
    mocks.actorHandle.actorType = 'staff';
    mocks.actorHandle.sessionId = 'staff-session';
    mocks.actorRuntimePermissions = ['settings'];
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-id', permissions: { settings: true } },
      licenseDetails: { license_key: 'LANZO-PRO' },
      companyProfile: null
    };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await state.updateCompanyProfile({
      name: 'Legacy profile',
      business_type: ['hardware']
    });

    expect(mocks.actorRuntimeCapture).toHaveBeenCalledWith('settings');
    expect(mocks.saveBusinessProfile).toHaveBeenCalledTimes(1);
  });

  it('refreshes effective license features before marking first-time setup ready', async () => {
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      licenseDetails: {
        license_key: 'LANZO-FREE',
        features: { full_access: true }
      },
      currentAdminUser: { id: 'admin-id' },
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
      currentAdminUser: { id: 'admin-id' },
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
    mocks.actorHandle.actorType = 'staff';
    mocks.actorHandle.sessionId = 'staff-session';
    mocks.actorRuntimePermissions = ['pos'];
    const state = {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-id', permissions: { pos: true } },
      licenseDetails: { license_key: 'LANZO-PRO' }
    };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await expect(state.updateCompanyProfile({
      name: 'Denied profile',
      business_type: ['hardware']
    })).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(mocks.actorRuntimeCapture).not.toHaveBeenCalled();
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
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-id' },
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
      'LANZO-PRO', expect.any(Object), {
        actorHandle: expect.objectContaining({ actorType: 'admin', sessionId: 'admin-session' })
      }
    );
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(state.companyProfile).toBeNull();
    expect(state.appStatus).toBe('setup_required');
  });
  it('keeps the current profile while a background retry waits for TenantRuntime', async () => {
    const originalProfile = { license_key: 'LANZO-PRO', name: 'Negocio vigente', business_type: ['abarrotes'] };
    const state = { appStatus: 'ready', currentDeviceRole: 'admin', companyProfile: originalProfile };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get));
    state.companyProfile = originalProfile;
    mocks.getTenantRuntimeReadiness.mockReturnValue({ ready: false, runtime: null });

    await expect(state._loadProfile('LANZO-PRO', {
      forceRemote: true,
      profileLoadMode: 'background',
      reason: 'runtime_recovery'
    })).resolves.toBe(originalProfile);

    expect(mocks.assertLocalTenantSyncAccess).not.toHaveBeenCalled();
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.getBusinessProfile).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(state.appStatus).toBe('ready');
    expect(state.companyProfile).toBe(originalProfile);
  });

  it('does not downgrade to Setup after an online profile request fails', async () => {
    const state = { appStatus: 'ready', currentDeviceRole: 'admin', companyProfile: null };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get));
    mocks.loadData.mockResolvedValue(null);
    mocks.getBusinessProfile.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(state._loadProfile('LANZO-PRO', {
      allowSetupTransition: true,
      reason: 'new_license_setup'
    })).resolves.toBeNull();

    expect(state.appStatus).toBe('ready');
    expect(set).not.toHaveBeenCalled();
  });

  it('allows the new owner onboarding path into Setup only after remote absence is confirmed', async () => {
    const state = {
      appStatus: 'loading',
      currentDeviceRole: 'admin',
      ownerEnrollmentContext: 'new_license_setup',
      companyProfile: null
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get));
    mocks.loadData.mockResolvedValue(null);
    mocks.getBusinessProfile.mockResolvedValueOnce({ success: false, code: 'PROFILE_NOT_FOUND' });

    await expect(state._loadProfile('LANZO-PRO', {
      allowSetupTransition: true,
      reason: 'new_license_setup'
    })).resolves.toBeNull();

    expect(state.appStatus).toBe('setup_required');
  });

  it('propagates a TenantRuntime failure without publishing an empty profile', async () => {
    const runtimeError = Object.assign(new Error('tenant database is opening'), {
      code: 'TENANT_RUNTIME_NOT_READY'
    });
    const state = { appStatus: 'ready', currentDeviceRole: 'admin', companyProfile: null };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;
    Object.assign(state, createProfileSlice(set, get));
    mocks.loadData.mockRejectedValueOnce(runtimeError);

    await expect(state._loadProfile('LANZO-PRO', {
      allowSetupTransition: true,
      reason: 'new_license_setup'
    })).rejects.toBe(runtimeError);

    expect(state.appStatus).toBe('ready');
    expect(set).not.toHaveBeenCalled();
  });


  it.each(['updateCompanyProfile', 'handleSetup'])(
    'uploads the original logo for %s while keeping the auxiliary file out of the profile',
    async (method) => {
      const preview = Object.assign(new File(), { size: 100 });
      const original = Object.assign(new File(), { size: 900000 });
      mocks.uploadImageFile.mockResolvedValue({ publicUrl: 'https://storage.test/logo-new.webp' });
      mocks.saveBusinessProfile.mockResolvedValue({ success: true });
      const state = {
        currentDeviceRole: 'admin',
        currentAdminUser: { id: 'admin-id' },
        licenseDetails: { license_key: 'LANZO-PRO' },
        companyProfile: null,
        appStatus: 'setup_required'
      };
      Object.assign(state, createProfileSlice(
        vi.fn((partial) => Object.assign(state, partial)),
        () => state
      ));

      await state[method]({
        name: 'Mi negocio',
        logo: preview,
        logoUploadSource: original,
        business_type: ['hardware']
      });

      expect(mocks.uploadImageFile).toHaveBeenCalledWith({
        file: original,
        licenseKey: 'LANZO-PRO',
        purpose: 'business-logo'
      });
      const profilePayload = mocks.saveBusinessProfile.mock.calls[0][1];
      expect(profilePayload.logo).toBe('https://storage.test/logo-new.webp');
      expect(profilePayload).not.toHaveProperty('logoUploadSource');
    }
  );

  it('keeps the thumbnail fallback when a logo source is above the upload limit', async () => {
    const preview = Object.assign(new File(), { size: 120 });
    const oversizedSource = Object.assign(new File(), { size: 21 * 1024 * 1024 });
    mocks.uploadImageFile.mockResolvedValue({ publicUrl: 'https://storage.test/logo.webp' });
    mocks.saveBusinessProfile.mockResolvedValue({ success: true });
    const state = {
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-id' },
      licenseDetails: { license_key: 'LANZO-PRO' },
      companyProfile: null
    };
    Object.assign(state, createProfileSlice(
      vi.fn((partial) => Object.assign(state, partial)),
      () => state
    ));

    await state.updateCompanyProfile({
      logo: preview,
      logoUploadSource: oversizedSource,
      business_type: ['hardware']
    });

    expect(mocks.uploadImageFile).toHaveBeenCalledWith(
      expect.objectContaining({ file: preview, purpose: 'business-logo' })
    );
  });
});
