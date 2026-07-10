import {
  ENABLE_LICENSE_REALTIME,
  FREE_LICENSE_SYNC_INTERVAL_MS,
  BASIC_LICENSE_SYNC_INTERVAL_MS,
  PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS,
  PRO_POLLING_SYNC_INTERVAL_MS,
  LICENSE_VALIDATION_ERROR_COOLDOWN_MS
} from './licenseConstants';

const CRITICAL_REASON_PATTERN = /realtime_event|realtime_reconnected|realtime_recover|license_changed|plan_changed|device_changed|device_revoked|staff_changed|staff_invalidated|permission_changed|force|activation|staff_login|renewal/;

export const LAST_LICENSE_VALIDATION_SUCCESS_KEY = 'Lanzo_last_license_validation_success';
export const LAST_LICENSE_VALIDATION_SUCCESS_LICENSE_KEY = 'Lanzo_last_license_validation_success_key';
export const LAST_LICENSE_VALIDATION_ATTEMPT_KEY = 'Lanzo_last_license_validation_attempt';
export const LAST_LICENSE_VALIDATION_ATTEMPT_LICENSE_KEY = 'Lanzo_last_license_validation_attempt_key';
export const LAST_LICENSE_VALIDATION_SESSION_KEY = 'Lanzo_last_validation';
export const LAST_LICENSE_VALIDATION_PERSISTENT_KEY = 'Lanzo_last_validation_persistent';
export const LAST_REMOTE_LICENSE_VALIDATION_KEY = 'Lanzo_last_remote_license_validation';
export const LAST_REMOTE_LICENSE_KEY = 'Lanzo_last_remote_license_key';

const readNum = (storage, key) => {
  try {
    const value = Number(storage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

const write = (storage, key, value) => {
  try {
    storage.setItem(key, value);
  } catch {
    // Best effort cache write.
  }
};

const planCodeOf = (licenseDetails = {}) => (
  licenseDetails.plan_code ||
  licenseDetails.plan ||
  licenseDetails.subscription_plan ||
  licenseDetails.product_code ||
  ''
).toString().trim().toLowerCase();

const isCriticalReason = (reason = '') => CRITICAL_REASON_PATTERN.test(String(reason || '').toLowerCase());

const getMode = (licenseDetails = {}) => (
  ENABLE_LICENSE_REALTIME && licenseDetails?.features?.realtime_license_sync === true && Boolean(licenseDetails?.realtime_topic)
    ? 'hybrid_realtime'
    : 'hybrid_polling'
);

const getIntervalMs = (licenseDetails = {}, mode = getMode(licenseDetails)) => {
  const code = planCodeOf(licenseDetails);
  const isPro = code.includes('pro') || licenseDetails.features?.cloud_sales_base === true;
  if (isPro) return mode === 'hybrid_realtime' ? PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS : PRO_POLLING_SYNC_INTERVAL_MS;
  if (code.includes('basic')) return BASIC_LICENSE_SYNC_INTERVAL_MS;
  return FREE_LICENSE_SYNC_INTERVAL_MS;
};

export const readLastLicenseValidationSuccessMs = () => {
  const primary = Math.max(
    readNum(localStorage, LAST_LICENSE_VALIDATION_SUCCESS_KEY),
    readNum(sessionStorage, LAST_LICENSE_VALIDATION_SUCCESS_KEY)
  );
  if (primary > 0) return primary;
  return Math.max(
    readNum(sessionStorage, LAST_LICENSE_VALIDATION_SESSION_KEY),
    readNum(localStorage, LAST_LICENSE_VALIDATION_PERSISTENT_KEY),
    readNum(sessionStorage, LAST_REMOTE_LICENSE_VALIDATION_KEY)
  );
};

export const readLastLicenseValidationAttemptMs = () => Math.max(
  readNum(localStorage, LAST_LICENSE_VALIDATION_ATTEMPT_KEY),
  readNum(sessionStorage, LAST_LICENSE_VALIDATION_ATTEMPT_KEY)
);

export const markLastLicenseValidationSuccess = (licenseKey = null) => {
  const now = Date.now().toString();
  write(localStorage, LAST_LICENSE_VALIDATION_SUCCESS_KEY, now);
  write(sessionStorage, LAST_LICENSE_VALIDATION_SUCCESS_KEY, now);
  write(localStorage, LAST_LICENSE_VALIDATION_PERSISTENT_KEY, now);
  write(sessionStorage, LAST_LICENSE_VALIDATION_SESSION_KEY, now);
  write(sessionStorage, LAST_REMOTE_LICENSE_VALIDATION_KEY, now);
  if (licenseKey) {
    write(localStorage, LAST_LICENSE_VALIDATION_SUCCESS_LICENSE_KEY, licenseKey);
    write(sessionStorage, LAST_LICENSE_VALIDATION_SUCCESS_LICENSE_KEY, licenseKey);
    write(sessionStorage, LAST_REMOTE_LICENSE_KEY, licenseKey);
  }
};

export const markLastLicenseValidationAttempt = (licenseKey = null) => {
  const now = Date.now().toString();
  write(localStorage, LAST_LICENSE_VALIDATION_ATTEMPT_KEY, now);
  write(sessionStorage, LAST_LICENSE_VALIDATION_ATTEMPT_KEY, now);
  if (licenseKey) {
    write(localStorage, LAST_LICENSE_VALIDATION_ATTEMPT_LICENSE_KEY, licenseKey);
    write(sessionStorage, LAST_LICENSE_VALIDATION_ATTEMPT_LICENSE_KEY, licenseKey);
  }
};

export const shouldSkipRemoteValidationForPlan = ({ licenseDetails, mode = getMode(licenseDetails), reason = 'manual', now = Date.now() } = {}) => {
  if (!licenseDetails?.license_key) return false;
  if (isCriticalReason(reason)) return false;
  const lastSuccessMs = readLastLicenseValidationSuccessMs();
  return lastSuccessMs > 0 && now - lastSuccessMs < getIntervalMs(licenseDetails, mode);
};

export const shouldSkipRemoteValidationAfterFailure = ({ licenseDetails, reason = 'manual', now = Date.now() } = {}) => {
  if (!licenseDetails?.license_key) return false;
  if (isCriticalReason(reason)) return false;
  const lastAttemptMs = readLastLicenseValidationAttemptMs();
  return lastAttemptMs > 0 && now - lastAttemptMs < LICENSE_VALIDATION_ERROR_COOLDOWN_MS;
};

export const readLastLicenseValidationMs = readLastLicenseValidationSuccessMs;
export const markLastLicenseValidation = markLastLicenseValidationSuccess;
