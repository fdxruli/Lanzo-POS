import { TELEGRAM_CONTACT_INTENT } from '../services/support/telegramContact.js';

export const ABOUT_LICENSE_STATE = Object.freeze({
  UNKNOWN: 'unknown',
  LOCAL_ACTIVE: 'local_active',
  CLOUD_ACTIVE: 'cloud_active',
  CLOUD_GRACE: 'cloud_grace',
  CLOUD_EXPIRED: 'cloud_expired'
});

const RECOGNIZED_LIFECYCLE_STATES = new Set(['active', 'grace_period', 'expired']);

const normalizeLifecycleState = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const resolveAboutLicenseState = ({
  licenseDetails,
  licenseStatus,
  isCloudPlan
} = {}) => {
  if (!licenseDetails || typeof licenseDetails !== 'object' || typeof licenseDetails.valid !== 'boolean') {
    return ABOUT_LICENSE_STATE.UNKNOWN;
  }

  const lifecycleStates = [
    normalizeLifecycleState(licenseStatus),
    normalizeLifecycleState(licenseDetails.lifecycle_state),
    normalizeLifecycleState(licenseDetails.status)
  ].filter(Boolean);

  if (
    lifecycleStates.length === 0
    || lifecycleStates.some((state) => !RECOGNIZED_LIFECYCLE_STATES.has(state))
    || new Set(lifecycleStates).size !== 1
  ) {
    return ABOUT_LICENSE_STATE.UNKNOWN;
  }

  const [lifecycleState] = lifecycleStates;

  if (lifecycleState === 'grace_period') {
    return isCloudPlan === true && licenseDetails.valid === true
      ? ABOUT_LICENSE_STATE.CLOUD_GRACE
      : ABOUT_LICENSE_STATE.UNKNOWN;
  }

  if (lifecycleState === 'expired') {
    return isCloudPlan === true && licenseDetails.valid === false
      ? ABOUT_LICENSE_STATE.CLOUD_EXPIRED
      : ABOUT_LICENSE_STATE.UNKNOWN;
  }

  if (licenseDetails.valid !== true) return ABOUT_LICENSE_STATE.UNKNOWN;

  return isCloudPlan === true
    ? ABOUT_LICENSE_STATE.CLOUD_ACTIVE
    : ABOUT_LICENSE_STATE.LOCAL_ACTIVE;
};

const telegramAction = (label, intent) => Object.freeze({
  kind: 'telegram',
  label,
  intent
});

const localPlanAction = Object.freeze({
  kind: 'anchor',
  label: 'Mantener plan Local',
  href: '#about-local-plan'
});

const generalSupportAction = telegramAction(
  'Contactar soporte',
  TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT
);

export const resolveAboutContactActions = ({
  licenseState = ABOUT_LICENSE_STATE.UNKNOWN,
  selectedWorkflow = '',
  isAuthorizedCommercialAdmin = false
} = {}) => {
  if (isAuthorizedCommercialAdmin !== true) {
    return Object.freeze({ primary: generalSupportAction, secondary: null });
  }

  if (licenseState === ABOUT_LICENSE_STATE.LOCAL_ACTIVE) {
    if (selectedWorkflow === 'team') {
      return Object.freeze({
        primary: telegramAction('Solicitar Lanzo Nube', TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION),
        secondary: telegramAction('Consultar requisitos', TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY)
      });
    }

    if (selectedWorkflow === 'solo') {
      return Object.freeze({
        primary: telegramAction('Consultar Lanzo Nube', TELEGRAM_CONTACT_INTENT.PRO_INQUIRY),
        secondary: localPlanAction
      });
    }

    return Object.freeze({
      primary: telegramAction('Consultar planes', TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY),
      secondary: null
    });
  }

  if (licenseState === ABOUT_LICENSE_STATE.CLOUD_ACTIVE) {
    return Object.freeze({
      primary: telegramAction('Contactar soporte PRO', TELEGRAM_CONTACT_INTENT.PRO_SUPPORT),
      secondary: telegramAction('Consultar renovación', TELEGRAM_CONTACT_INTENT.PRO_RENEWAL)
    });
  }

  if (licenseState === ABOUT_LICENSE_STATE.CLOUD_GRACE) {
    return Object.freeze({
      primary: telegramAction('Consultar situación del plan', TELEGRAM_CONTACT_INTENT.PRO_RENEWAL),
      secondary: generalSupportAction
    });
  }

  if (licenseState === ABOUT_LICENSE_STATE.CLOUD_EXPIRED) {
    return Object.freeze({
      primary: telegramAction('Consultar reactivación', TELEGRAM_CONTACT_INTENT.PRO_REACTIVATION),
      secondary: generalSupportAction
    });
  }

  return Object.freeze({ primary: generalSupportAction, secondary: null });
};

export default Object.freeze({
  ABOUT_LICENSE_STATE,
  resolveAboutLicenseState,
  resolveAboutContactActions
});
