import { describe, expect, it } from 'vitest';
import {
  ABOUT_LICENSE_STATE,
  resolveAboutContactActions,
  resolveAboutLicenseState
} from '../aboutTelegramActions';
import { TELEGRAM_CONTACT_INTENT } from '../../services/support/telegramContact';

const activeLicense = (overrides = {}) => ({
  valid: true,
  status: 'active',
  ...overrides
});

describe('aboutTelegramActions', () => {
  it('recognizes only explicitly active Local and Cloud licences', () => {
    expect(resolveAboutLicenseState({
      licenseDetails: activeLicense(), licenseStatus: 'active', isCloudPlan: false
    })).toBe(ABOUT_LICENSE_STATE.LOCAL_ACTIVE);
    expect(resolveAboutLicenseState({
      licenseDetails: activeLicense(), licenseStatus: 'active', isCloudPlan: true
    })).toBe(ABOUT_LICENSE_STATE.CLOUD_ACTIVE);
  });

  it('routes Local solo users to information and lets them keep Local', () => {
    const actions = resolveAboutContactActions({
      licenseState: ABOUT_LICENSE_STATE.LOCAL_ACTIVE,
      selectedWorkflow: 'solo',
      isAuthorizedCommercialAdmin: true
    });

    expect(actions.primary.intent).toBe(TELEGRAM_CONTACT_INTENT.PRO_INQUIRY);
    expect(actions.primary.label).toBe('Consultar Lanzo Nube');
    expect(actions.secondary).toMatchObject({ kind: 'anchor', label: 'Mantener plan Local' });
  });

  it('routes Local team users to assisted activation and requirements', () => {
    const actions = resolveAboutContactActions({
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
      licenseDetails: { valid: true, status: 'grace_period' },
      licenseStatus: 'grace_period',
      isCloudPlan: true
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
});
