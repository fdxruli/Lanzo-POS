import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBusinessProfile: vi.fn(),
  loadData: vi.fn(),
  saveBusinessProfile: vi.fn(),
  saveData: vi.fn(async () => undefined)
}));

vi.mock('../../services/database', () => ({
  loadData: mocks.loadData,
  saveData: mocks.saveData,
  STORES: { COMPANY: 'company' }
}));

vi.mock('../../services/supabase', () => ({
  getBusinessProfile: mocks.getBusinessProfile,
  saveBusinessProfile: mocks.saveBusinessProfile
}));

vi.mock('../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo' },
  uploadImageFile: vi.fn()
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
});
