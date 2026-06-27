import {
  getLicenseSyncIntervalMs,
  getLicenseSyncMode,
  isCriticalLicenseValidationReason
} from './licenseGuards';

const SHORT_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

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
    // Best effort.
  }
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

export const shouldSkipRemoteValidationForPlan = ({
  licenseDetails,
  mode = getLicenseSyncMode(licenseDetails),
  reason = 'manual',
  now = Date.now()
} = {}) => {
  if (!licenseDetails?.license_key) return false;
  if (isCriticalLicenseValidationReason(reason)) return false;

  const lastSuccessMs = readLastLicenseValidationSuccessMs();
  if (!lastSuccessMs) return false;

  const intervalMs = getLicenseSyncIntervalMs(licenseDetails, mode);
  return now - lastSuccessMs < intervalMs;
};

export const shouldSkipRemoteValidationAfterFailure = ({
  licenseDetails,
  reason = 'manual',
  now = Date.now()
} = {}) => {
  if (!licenseDetails?.license_key) return false;
  if (isCriticalLicenseValidationReason(reason)) return false;

  const lastAttemptMs = readLastLicenseValidationAttemptMs();
  if (!lastAttemptMs) return false;

  return now - lastAttemptMs < SHORT_RETRY_COOLDOWN_MS;
};

export const readLastLicenseValidationMs = readLastLicenseValidationSuccessMs;
export const markLastLicenseValidation = markLastLicenseValidationSuccess;
