import { describe, expect, it } from 'vitest';

import {
  hasModernAdminIdentityEvidence,
  requiresAdminIdentity
} from '../licenseGuards';

describe('modern FREE Admin cutover invariant', () => {
  it('keeps a cut-over FREE license actor-bound when a stale response omits the Admin user', () => {
    const currentLicense = {
      license_key: 'FREE-MODERN-CUTOVER',
      plan_code: 'free_trial',
      max_devices: 1,
      device_role: 'admin',
      features: { staff_roles: false },
      admin_identity_required: true,
      admin_user: { id: 'admin-stable-1', username: 'owner' }
    };
    const staleLegacyResponse = {
      license_key: 'FREE-MODERN-CUTOVER',
      plan_code: 'free_trial',
      max_devices: 1,
      device_role: 'admin',
      features: { staff_roles: false },
      admin_user: null
    };

    expect(hasModernAdminIdentityEvidence(currentLicense)).toBe(true);

    const mergedLicense = {
      ...currentLicense,
      ...staleLegacyResponse,
      admin_identity_required: true
    };

    expect(hasModernAdminIdentityEvidence(mergedLicense)).toBe(true);
    expect(requiresAdminIdentity(mergedLicense)).toBe(true);
  });

  it('keeps a true pre-cutover FREE license eligible for legacy compatibility', () => {
    const legacyLicense = {
      license_key: 'FREE-LEGACY-OWNER',
      plan_code: 'free_trial',
      max_devices: 1,
      device_role: 'admin',
      features: { staff_roles: false }
    };

    expect(hasModernAdminIdentityEvidence(legacyLicense)).toBe(false);
    expect(requiresAdminIdentity(legacyLicense)).toBe(false);
  });
});