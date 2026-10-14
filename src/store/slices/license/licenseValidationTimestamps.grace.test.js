import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markLastLicenseValidationSuccess,
  shouldSkipRemoteValidationForPlan
} from './licenseValidationTimestamps';

const FIXED_NOW = new Date('2026-10-12T19:00:00.000Z');
const LICENSE_A = 'TEST-GRACE-TENANT-A';
const LICENSE_B = 'TEST-GRACE-TENANT-B';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
};

const paidLicense = (overrides = {}) => ({
  license_key: LICENSE_A,
  plan_code: 'pro_monthly',
  status: 'active',
  valid: true,
  is_entitled: true,
  is_in_grace: false,
  features: { cloud_pos_sync: true },
  expires_at: '2026-10-09T15:14:09.885Z',
  ...overrides
});

describe('license grace boundary and remote validation TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('revalidates an Admin-restored PRO license when its cached active status is past commercial expiry', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense(),
      reason: 'background',
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });

  it('keeps normal TTL for an already confirmed PRO grace state without promoting permissions', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({
        status: 'grace_period',
        is_in_grace: true,
        grace_period_ends: '2026-10-16T15:14:09.885Z'
      }),
      reason: 'background',
      now: FIXED_NOW.getTime()
    })).toBe(true);
  });

  it('revalidates when a cached grace boundary has expired and Free cutover may be pending', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({
        status: 'grace_period',
        is_in_grace: true,
        grace_period_ends: '2026-10-11T00:00:00.000Z'
      }),
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });

  it('does not reuse validation TTL from another tenant after switching businesses', () => {
    markLastLicenseValidationSuccess(LICENSE_B);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({
        expires_at: '2026-10-30T15:14:09.885Z'
      }),
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });

  it('retains the usual TTL for a confirmed permanent Free license', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: {
        license_key: LICENSE_A,
        plan_code: 'free_trial',
        is_lifetime: true,
        expires_at: null,
        status: 'active',
        valid: true,
        features: { cloud_pos_sync: false }
      },
      now: FIXED_NOW.getTime()
    })).toBe(true);
  });

  it('revalidates when the Zustand lifecycle is inconclusive despite otherwise active details', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({ expires_at: '2026-10-30T15:14:09.885Z' }),
      licenseStatus: 'validation_inconclusive',
      reason: 'background',
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });

  it('keeps confirmed grace when the store still contains the old active status', () => {
    markLastLicenseValidationSuccess(LICENSE_A);

    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({
        status: 'grace_period',
        is_in_grace: true,
        grace_period_ends: '2026-10-16T15:14:09.885Z'
      }),
      licenseStatus: 'active',
      reason: 'background',
      now: FIXED_NOW.getTime()
    })).toBe(true);
  });

  it('never suppresses explicitly critical remote validations', () => {
    markLastLicenseValidationSuccess(LICENSE_A);
    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({ expires_at: '2026-10-30T15:14:09.885Z' }),
      reason: 'license_changed',
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });

  it('forces an Admin session-restore validation even within the normal PRO TTL', () => {
    markLastLicenseValidationSuccess(LICENSE_A);
    expect(shouldSkipRemoteValidationForPlan({
      licenseDetails: paidLicense({ expires_at: '2026-10-30T15:14:09.885Z' }),
      reason: 'admin_session_restore',
      now: FIXED_NOW.getTime()
    })).toBe(false);
  });
});
