import { describe, expect, it } from 'vitest';
import {
  hasModernAdminIdentityEvidence,
  requiresAdminIdentity
} from '../licenseGuards';

const freeLicense = (overrides = {}) => ({
  license_key: 'FREE-AUTHORITY-TEST',
  plan_code: 'free_trial',
  max_devices: 1,
  device_role: 'admin',
  features: { staff_roles: false },
  ...overrides
});

const proLicense = (overrides = {}) => ({
  license_key: 'PRO-AUTHORITY-TEST',
  plan_code: 'pro_monthly',
  max_devices: 5,
  device_role: 'admin',
  features: { staff_roles: true },
  ...overrides
});

describe('license Admin authority classification', () => {
  it('keeps legitimate FREE legacy outside the actor-bound Admin requirement', () => {
    const license = freeLicense();
    expect(hasModernAdminIdentityEvidence(license)).toBe(false);
    expect(requiresAdminIdentity(license)).toBe(false);
  });

  it('classifies FREE with a real cached Admin identity as modern actor-bound', () => {
    const license = freeLicense({ admin_user: { id: 'admin-free-1' } });
    expect(hasModernAdminIdentityEvidence(license)).toBe(true);
    expect(requiresAdminIdentity(license)).toBe(true);
  });

  it('keeps FREE modern after the Admin session/user cache is cleared by relying on the cutover marker', () => {
    const license = freeLicense({
      admin_identity_required: true,
      admin_user: null
    });
    expect(hasModernAdminIdentityEvidence(license)).toBe(true);
    expect(requiresAdminIdentity(license)).toBe(true);
  });

  it('preserves the existing PRO actor-bound requirement', () => {
    const license = proLicense();
    expect(requiresAdminIdentity(license)).toBe(true);
  });
});
