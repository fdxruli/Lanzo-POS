import { describe, expect, it } from 'vitest';
import {
  ABOUT_LICENSE_STATE,
  resolveAboutContactActions,
  resolveAboutLicenseState
} from '../aboutTelegramActions';
import { TELEGRAM_CONTACT_INTENT } from '../../services/support/telegramContact';
import { createEffectiveLicenseValidationEvidence, getLicenseStatusPresentation } from '../../utils/licenseStatusPresentation';

const activeLicense = (overrides = {}) => ({
  valid: true,
  status: 'active',
  ...overrides
});

const TEST_NOW = new Date('2026-10-09T15:30:00.000Z');

const confirmedEvidence = (status, overrides = {}) => createEffectiveLicenseValidationEvidence({
  status,
  valid: status !== 'expired',
  license_status: 'active',
  is_entitled: status !== 'expired',
  is_in_grace: status === 'grace_period',
  expires_at: status === 'active' ? '2026-10-30T15:14:09.000Z' : null,
  grace_period_ends: status === 'grace_period' ? '2026-10-16T15:14:09.000Z' : null,
  ...overrides
}, {
  effectiveStatus: status,
  now: new Date(TEST_NOW.getTime() - 1000)
});

const cloudLicense = (status = 'active', overrides = {}) => ({
  valid: status !== 'expired',
  status,
  lifecycle_state: status,
  license_status: 'active',
  is_entitled: status !== 'expired',
  is_in_grace: status === 'grace_period',
  plan_code: 'pro_monthly',
  features: { cloud_pos_sync: true },
  expires_at: status === 'active' ? '2026-10-30T15:14:09.000Z' : null,
  grace_period_ends: status === 'grace_period' ? '2026-10-16T15:14:09.000Z' : null,
  effective_lifecycle_validation: confirmedEvidence(status),
  ...overrides
});
ions({
      licenseState: ABOUT_LICENSE_STATE.LOCAL_ACTIVE,
      selectedWorkflow: 'team',
      isAuthorizedCommercialAdmin: true
    });

    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION);
    expect(actions.secondary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY);
  });

  it('updates its intent from the current workflow without retaining the previous selection', () => {
    const team = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.LOCAL_ACTIVE,
      selectedWorkflow: 'team',
      isAuthorizedCommercialAdmin: true
    });
    const solo = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.LOCAL_ACTIVE,
      selectedWorkflow: 'solo',
      isAuthorizedCommercialAdmin: true
    });

    expect(team.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION);
    expect(solo.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_INQUIRY);
  });

  it('offers support and renewal rather than another PRO sales pitch to an active Cloud admin', () => {
    const actions = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.CLOUD_ACTIVE,
      isAuthorizedCommercialAdmin: true
    });

    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_SUPPORT);
    expect(actions.secondary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_RENEWAL);
  });

  it('keeps employees and unauthorized actors out of commercial CTAs', () => {
    const actions = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.CLOUD_ACTIVE,
      isAuthorizedCommercialAdmin: false
    });

    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT);
    expect(actions.secondary).toBeNull();
  });

  it('offers reactivation only for an explicitly expired Cloud licence', () => {
    const state = resolveAboutLicenseState({
      licenseDetails: { valid: false, status: 'expired' },
      licenseStatus: 'expired',
      isCloudPlan: true
    });
    const actions = resolveAboutContactActions({ licenseState: state, isAuthorizedCommercialAdmin: true });

    expect(state).toBe(ABOUT_LICENSE_STATE.CLOUD_EXPIRED);
    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_REACTIVATION);
  });

  it('keeps grace separate from active and directs the admin to confirm plan continuity', () => {
    const state = resolveAboutLicenseState({
      licenseDetails: cloudLicense('grace_period'),
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    });
    const actions = resolveAboutContactActions({ licenseState: state, isAuthorizedCommercialAdmin: true });

    expect(state).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
    expect(actions.primary.label).toBe('Consultar situación del plan');
    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_RENEWAL);
  });

  it('uses general support when the licence status is invalid, pending, contradictory or unknown', () => {
    const cases = [
      { licenseDetails: null, licenseStatus: 'active', isCloudPlan: true },
      { licenseDetails: { valid: true, status: 'pending' }, licenseStatus: 'pending', isCloudPlan: true },
      { licenseDetails: { valid: true, status: 'active' }, licenseStatus: 'expired', isCloudPlan: true },
      { licenseDetails: { status: 'active' }, licenseStatus: 'active', isCloudPlan: true }
    ];

    cases.forEach((input) => {
      const state = resolveAboutLicenseState(input);
      const actions = resolveAboutContactActions({ licenseState: state, isAuthorizedCommercialAdmin: true });
      expect(state).toBe(ABOUT_LICENSE_STATE.UNKNOWN);
      expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT);
      expect(actions.secondary).toBeNull();
    });
  });
  it('LIC-ABOUT-01: recognizes an active Cloud entitlement confirmed by the server', () => {
    expect(resolveAboutLicenseState({
      licenseDetails: cloudLicense('active'),
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_ACTIVE);
  });

  it('LIC-ABOUT-02: recognizes a grace entitlement using the effective validation contract', () => {
    const details = cloudLicense('grace_period', {
      status: 'grace_period',
      license_status: 'active'
    });

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'grace_period',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
  });

  it('LIC-ABOUT-03: keeps effective grace when administrative license_status is expired', () => {
    const details = cloudLicense('grace_period', {
      license_status: 'expired'
    });

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
  });

  it('LIC-ABOUT-04: lets a recent server-confirmed grace state override stale local status', () => {
    const details = cloudLicense('grace_period', {
      status: 'active',
      lifecycle_state: 'active'
    });

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
  });

  it('LIC-ABOUT-05: keeps real contradictions without server evidence conservative', () => {
    const details = {
      valid: true,
      status: 'active',
      lifecycle_state: 'grace_period',
      is_entitled: true,
      is_in_grace: false,
      features: { cloud_pos_sync: true }
    };

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.UNKNOWN);
  });

  it('LIC-ABOUT-06: does not present grace after the confirmed grace deadline', () => {
    const details = cloudLicense('grace_period', {
      effective_lifecycle_validation: confirmedEvidence('grace_period', {
        grace_period_ends: '2026-10-09T15:29:59.999Z'
      })
    });

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'grace_period',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_EXPIRED);
  });

  it('LIC-ABOUT-07: uses the confirmed Local plan after downgrade', () => {
    const details = {
      valid: true,
      status: 'active',
      license_status: 'active',
      plan_code: 'free_trial',
      license_type: 'free',
      is_lifetime: true,
      expires_at: null,
      features: { cloud_pos_sync: false },
      effective_lifecycle_validation: confirmedEvidence('active')
    };

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: false,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.LOCAL_ACTIVE);
  });

  it('LIC-ABOUT-08: keeps a permanent Free license Local despite stale paid grace metadata', () => {
    const details = {
      valid: true,
      status: 'grace_period',
      lifecycle_state: 'grace_period',
      plan_code: 'free_trial',
      license_type: 'free',
      is_lifetime: true,
      expires_at: null,
      features: { cloud_pos_sync: false }
    };

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'grace_period',
      isCloudPlan: false,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.LOCAL_ACTIVE);
  });

  it('LIC-ABOUT-09: keeps grace continuity actions restricted to an authorized admin', () => {
    const actions = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.CLOUD_GRACE,
      isAuthorizedCommercialAdmin: false
    });

    expect(actions.primary.label).toBe('Contactar soporte');
    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT);
    expect(actions.secondary).toBeNull();
  });

  it('LIC-ABOUT-10: preserves the cached validation object without triggering a new validation', () => {
    const details = cloudLicense('active');
    const original = structuredClone(details);

    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_ACTIVE);
    expect(details).toEqual(original);
  });

  it.each(['revoked', 'suspended', 'administratively_blocked', 'validation_inconclusive'])(
    'LIC-ABOUT-11: does not elevate %s to Cloud active or grace',
    (blockedStatus) => {
      const details = cloudLicense('active', { status: blockedStatus });

      expect(resolveAboutLicenseState({
        licenseDetails: details,
        licenseStatus: blockedStatus,
        isCloudPlan: true,
        now: TEST_NOW
      })).toBe(ABOUT_LICENSE_STATE.UNKNOWN);
    }
  );

  it('LIC-ABOUT-12: respects exact UTC grace boundaries before, during, and after grace', () => {
    const graceEnd = '2026-10-16T15:14:09.000Z';
    const before = cloudLicense('grace_period', {
      grace_period_ends: graceEnd,
      effective_lifecycle_validation: confirmedEvidence('grace_period', { grace_period_ends: graceEnd })
    });

    expect(resolveAboutLicenseState({
      licenseDetails: before,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: new Date('2026-10-16T15:14:08.999Z')
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
    expect(resolveAboutLicenseState({
      licenseDetails: before,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: new Date('2026-10-16T15:14:09.000Z')
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_EXPIRED);
  });

  it('LIC-ABOUT-14: uses the same effective lifecycle classification as License y Rubros', () => {
    const details = cloudLicense('grace_period');

    expect(getLicenseStatusPresentation(details, TEST_NOW, { licenseStatus: 'active' }).status)
      .toBe('grace_period');
    expect(resolveAboutLicenseState({
      licenseDetails: details,
      licenseStatus: 'active',
      isCloudPlan: true,
      now: TEST_NOW
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_GRACE);
  });

});
