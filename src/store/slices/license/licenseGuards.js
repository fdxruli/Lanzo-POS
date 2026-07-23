import {
  ENABLE_LICENSE_REALTIME,
  FATAL_REASONS,
  RECOVERABLE_VALIDATION_REASONS,
  STAFF_LOGIN_REASONS,
  STAFF_DEVICE_AUTH_REASONS,
  STAFF_DEVICE_AUTH_MESSAGE,
  LICENSE_PLAN_BLOCK_REASONS,
  GRACE_PERIOD_DAYS,
  FREE_LICENSE_SYNC_INTERVAL_MS,
  BASIC_LICENSE_SYNC_INTERVAL_MS,
  PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS,
  PRO_POLLING_SYNC_INTERVAL_MS,
  LOCAL_FATAL_APP_STATUSES
} from './licenseConstants';

import {
  markLastLicenseValidationAttempt,
  markLastLicenseValidationSuccess,
  readLastLicenseValidationAttemptMs,
  readLastLicenseValidationSuccessMs,
  shouldSkipRemoteValidationAfterFailure,
  shouldSkipRemoteValidationForPlan as shouldSkipRemoteValidationForPlanFromTimestamps
} from './licenseValidationTimestamps';

const CRITICAL_LICENSE_VALIDATION_REASONS = new Set([
  'realtime_event',
  'realtime_reconnected_long',
  'realtime_recover',
  'license_changed',
  'plan_changed',
  'device_changed',
  'device_revoked',
  'staff_changed',
  'staff_invalidated',
  'permission_changed',
  'force',
  'activation',
  'staff_login',
  'renewal'
]);

const CRITICAL_LICENSE_VALIDATION_REASON_PREFIXES = [
  'realtime_recover_'
];

const normalizePlanCode = (licenseDetails = {}) => (
  licenseDetails.plan_code ||
  licenseDetails.plan ||
  licenseDetails.subscription_plan ||
  licenseDetails.product_code ||
  ''
).toString().trim().toLowerCase();

const normalizeStatusCode = (value) => String(value || '').trim().toLowerCase();

export const isRealtimeEnabledForLicense = (licenseDetails) => (
  ENABLE_LICENSE_REALTIME &&
  licenseDetails?.features?.realtime_license_sync === true &&
  Boolean(licenseDetails?.realtime_topic)
);

export const isProLicense = (licenseDetails = {}) => {
  const planCode = normalizePlanCode(licenseDetails);
  return planCode.includes('pro') || licenseDetails.features?.cloud_sales_base === true;
};

export const isBasicLicense = (licenseDetails = {}) => normalizePlanCode(licenseDetails).includes('basic');

export const isFreeLicense = (licenseDetails = {}) => {
  const planCode = normalizePlanCode(licenseDetails);
  return !isProLicense(licenseDetails) && (
    planCode.includes('free') ||
    planCode.includes('trial') ||
    planCode.length === 0
  );
};

export const getLicenseSyncMode = (licenseDetails) => (
  isRealtimeEnabledForLicense(licenseDetails) ? 'hybrid_realtime' : 'hybrid_polling'
);

export const getLicenseSyncIntervalMs = (licenseDetails = {}, mode = getLicenseSyncMode(licenseDetails)) => {
  if (isProLicense(licenseDetails)) {
    return mode === 'hybrid_realtime'
      ? PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS
      : PRO_POLLING_SYNC_INTERVAL_MS;
  }
  if (isBasicLicense(licenseDetails)) return BASIC_LICENSE_SYNC_INTERVAL_MS;
  return FREE_LICENSE_SYNC_INTERVAL_MS;
};

export const isCriticalLicenseValidationReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();

  return CRITICAL_LICENSE_VALIDATION_REASONS.has(normalized) ||
    CRITICAL_LICENSE_VALIDATION_REASON_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

export const readLastLicenseValidationMs = readLastLicenseValidationSuccessMs;
export const markLastLicenseValidation = markLastLicenseValidationSuccess;
export const shouldSkipRemoteValidationForPlan = shouldSkipRemoteValidationForPlanFromTimestamps;

export {
  markLastLicenseValidationAttempt,
  markLastLicenseValidationSuccess,
  readLastLicenseValidationAttemptMs,
  readLastLicenseValidationSuccessMs,
  shouldSkipRemoteValidationAfterFailure
};

export const normalizeValidationCode = (validation = {}) => (
  validation.reason || validation.status || validation.error || validation.code || ''
).toString();

export const isFatalValidationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation).toLowerCase();
  return FATAL_REASONS.some((reason) => reason.toLowerCase() === code);
};

export const isRecoverableValidationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation).toLowerCase();
  return RECOVERABLE_VALIDATION_REASONS.some((reason) => reason.toLowerCase() === code);
};

export const isStaffLoginRequiredFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation).toLowerCase();
  return STAFF_LOGIN_REASONS.some((reason) => reason.toLowerCase() === code) || validation.staff_login_required === true;
};

export const isStaffDeviceAuthorizationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation).toLowerCase();
  return STAFF_DEVICE_AUTH_REASONS.some((reason) => reason.toLowerCase() === code);
};

export const getStaffLoginMessage = (validation = {}) => (
  isStaffDeviceAuthorizationFailure(validation)
    ? STAFF_DEVICE_AUTH_MESSAGE
    : validation.details || validation.message || 'Inicia sesión staff para continuar.'
);

export const getLicensePlanBlockReason = (validation = {}) => (
  validation.block_reason || validation.details?.block_reason || validation.reason || validation.code || validation.status || ''
).toString();

export const hasLicensePlanBlockReason = (validation = {}) => {
  const reason = getLicensePlanBlockReason(validation).toLowerCase();
  return LICENSE_PLAN_BLOCK_REASONS.some((item) => item.toLowerCase() === reason);
};

export const isLicensePlanBlockFailure = (validation = {}) => (
  hasLicensePlanBlockReason(validation) && validation.valid !== true
);

export const requiresAdminIdentity = (license = {}) => {
  const planCode = String(license.plan_code || license.plan?.code || '').toLowerCase();
  const features = license.features || license.effective_features || {};
  return Boolean(
    license.admin_identity_required === true ||
    (planCode && planCode !== 'free_trial') ||
    features.staff_roles === true ||
    Number(license.max_devices || 1) > 1
  );
};

export const buildLicensePlanBlockInfo = (validation = {}, fallbackLicense = {}) => {
  const reason = getLicensePlanBlockReason(validation) || 'LICENSE_PLAN_CHANGED';
  const planName = validation.plan_name || validation.details?.plan_name || fallbackLicense.plan_name || 'Plan actual';
  const planCode = validation.plan_code || validation.details?.plan_code || fallbackLicense.plan_code || null;
  const productName = validation.product_name || validation.details?.product_name || fallbackLicense.product_name || 'Lanzo POS';
  const maxDevices = validation.max_devices ?? validation.details?.max_devices ?? fallbackLicense.max_devices ?? null;
  const deviceRole = validation.device_role || validation.details?.device_role || fallbackLicense.device_role || null;
  const licenseKey = validation.license_key || validation.details?.license_key || fallbackLicense.license_key || null;

  return {
    reason,
    block_reason: reason,
    message: validation.message || validation.details || 'La licencia cambió de plan y requiere revisión.',
    license_key: licenseKey,
    plan_code: planCode,
    plan_name: planName,
    product_name: productName,
    max_devices: maxDevices,
    device_role: deviceRole,
    received_at: new Date().toISOString()
  };
};

export const deriveGracePeriodEnd = (validationData = {}, fallbackLicense = {}) => {
  if (validationData.grace_period_ends) return validationData.grace_period_ends;
  if (validationData.status !== 'grace_period') return null;
  const expiryValue = validationData.expires_at || fallbackLicense.expires_at;
  if (!expiryValue) return null;
  const expiryDate = new Date(expiryValue);
  if (Number.isNaN(expiryDate.getTime())) return null;
  return new Date(expiryDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
};

const parseTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const isFatalLocalStatus = (status) => LOCAL_FATAL_APP_STATUSES.some((item) => item.toLowerCase() === normalizeStatusCode(status));

export const assertLocalTransactionAllowed = (licenseDetails, state = {}) => {
  if (!licenseDetails) return { ok: false, code: 'LICENSE_MISSING', message: 'No hay una licencia activa para cobrar.' };
  if (!licenseDetails.license_key) return { ok: false, code: 'LICENSE_KEY_MISSING', message: 'No se encontró la clave de licencia local.' };
  if (licenseDetails.valid === false) return { ok: false, code: 'LICENSE_INVALID', message: 'La licencia local no es válida.' };

  const appStatus = state.appStatus || '';
  const licenseStatus = state.licenseStatus || licenseDetails.status || '';
  const detailStatus = licenseDetails.status || licenseDetails.reason || licenseDetails.code || '';

  if (isFatalLocalStatus(appStatus) || isFatalLocalStatus(licenseStatus) || isFatalLocalStatus(detailStatus)) {
    return { ok: false, code: normalizeStatusCode(appStatus || licenseStatus || detailStatus).toUpperCase() || 'LICENSE_BLOCKED', message: 'La licencia requiere revisión antes de cobrar.' };
  }

  const now = Date.now();
  const expiresAt = parseTime(licenseDetails.expires_at);
  const graceEnds = parseTime(licenseDetails.grace_period_ends || licenseDetails.gracePeriodEnds || state.gracePeriodEnds);

  if (expiresAt && expiresAt <= now && (!graceEnds || graceEnds <= now)) {
    return { ok: false, code: 'LICENSE_EXPIRED', message: 'La licencia está expirada.' };
  }

  const isStaff = state.currentDeviceRole === 'staff' || licenseDetails.device_role === 'staff' || Boolean(licenseDetails.staff_user);
  if (isStaff && !(state.currentStaffUser || licenseDetails.staff_user)) {
    return { ok: false, code: 'STAFF_LOGIN_REQUIRED', message: 'Inicia sesión staff para cobrar.' };
  }

  return { ok: true };
};
