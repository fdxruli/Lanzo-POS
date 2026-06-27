// src/store/slices/license/licenseGuards.js

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

export const LAST_LICENSE_VALIDATION_SESSION_KEY = 'Lanzo_last_validation';
export const LAST_LICENSE_VALIDATION_PERSISTENT_KEY = 'Lanzo_last_validation_persistent';
export const LAST_REMOTE_LICENSE_VALIDATION_KEY = 'Lanzo_last_remote_license_validation';
export const LAST_REMOTE_LICENSE_KEY = 'Lanzo_last_remote_license_key';

const CRITICAL_LICENSE_VALIDATION_REASONS = [
  'realtime_event',
  'realtime_reconnected',
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
];

export const isRealtimeEnabledForLicense = (licenseDetails) => (
  ENABLE_LICENSE_REALTIME &&
  licenseDetails?.features?.realtime_license_sync === true &&
  Boolean(licenseDetails?.realtime_topic)
);

const normalizePlanCode = (licenseDetails = {}) => (
  licenseDetails.plan_code ||
  licenseDetails.plan ||
  licenseDetails.subscription_plan ||
  licenseDetails.product_code ||
  ''
).toString().trim().toLowerCase();

export const isProLicense = (licenseDetails = {}) => {
  const planCode = normalizePlanCode(licenseDetails);
  return planCode.includes('pro') || licenseDetails.features?.cloud_sales_base === true;
};

export const isBasicLicense = (licenseDetails = {}) => {
  const planCode = normalizePlanCode(licenseDetails);
  return planCode.includes('basic');
};

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

  if (isBasicLicense(licenseDetails)) {
    return BASIC_LICENSE_SYNC_INTERVAL_MS;
  }

  return FREE_LICENSE_SYNC_INTERVAL_MS;
};

export const isCriticalLicenseValidationReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();
  return CRITICAL_LICENSE_VALIDATION_REASONS.some((item) => normalized.includes(item));
};

export const readLastLicenseValidationMs = () => {
  try {
    const sessionValue = Number(sessionStorage.getItem(LAST_LICENSE_VALIDATION_SESSION_KEY) || 0);
    const persistentValue = Number(localStorage.getItem(LAST_LICENSE_VALIDATION_PERSISTENT_KEY) || 0);
    const legacyRemoteValue = Number(sessionStorage.getItem(LAST_REMOTE_LICENSE_VALIDATION_KEY) || 0);
    const candidate = Math.max(sessionValue || 0, persistentValue || 0, legacyRemoteValue || 0);
    return Number.isFinite(candidate) ? candidate : 0;
  } catch {
    return 0;
  }
};

export const markLastLicenseValidation = (licenseKey = null) => {
  const now = Date.now().toString();

  try {
    sessionStorage.setItem(LAST_LICENSE_VALIDATION_SESSION_KEY, now);
    sessionStorage.setItem(LAST_REMOTE_LICENSE_VALIDATION_KEY, now);
    if (licenseKey) sessionStorage.setItem(LAST_REMOTE_LICENSE_KEY, licenseKey);
  } catch {
    // Best effort.
  }

  try {
    localStorage.setItem(LAST_LICENSE_VALIDATION_PERSISTENT_KEY, now);
  } catch {
    // Best effort.
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

  const lastValidationMs = readLastLicenseValidationMs();
  if (!lastValidationMs) return false;

  const intervalMs = getLicenseSyncIntervalMs(licenseDetails, mode);
  return now - lastValidationMs < intervalMs;
};

export const normalizeValidationCode = (validation = {}) => (
  validation.reason ||
  validation.status ||
  validation.error ||
  validation.code ||
  ''
).toString();

const normalizeStatusCode = (value) => String(value || '').trim().toLowerCase();

export const isFatalValidationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation);
  const normalized = code.toLowerCase();

  return FATAL_REASONS.some((reason) => reason.toLowerCase() === normalized);
};

export const isRecoverableValidationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation).toLowerCase();

  return RECOVERABLE_VALIDATION_REASONS.some(
    (reason) => reason.toLowerCase() === code
  );
};

export const isStaffLoginRequiredFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation);

  return STAFF_LOGIN_REASONS.some(
    (reason) => reason.toLowerCase() === code.toLowerCase()
  ) || validation.staff_login_required === true;
};

export const isStaffDeviceAuthorizationFailure = (validation = {}) => {
  const code = normalizeValidationCode(validation);

  return STAFF_DEVICE_AUTH_REASONS.some(
    (reason) => reason.toLowerCase() === code.toLowerCase()
  );
};

export const getStaffLoginMessage = (validation = {}) => (
  isStaffDeviceAuthorizationFailure(validation)
    ? STAFF_DEVICE_AUTH_MESSAGE
    : validation.details || validation.message || 'Inicia sesion staff para continuar.'
);

export const getLicensePlanBlockReason = (validation = {}) => (
  validation.block_reason ||
  validation.details?.block_reason ||
  validation.reason ||
  validation.code ||
  validation.status ||
  ''
).toString();

export const hasLicensePlanBlockReason = (validation = {}) => {
  const reason = getLicensePlanBlockReason(validation);

  return LICENSE_PLAN_BLOCK_REASONS.some(
    (item) => item.toLowerCase() === reason.toLowerCase()
  );
};

export const isLicensePlanBlockFailure = (validation = {}) => (
  hasLicensePlanBlockReason(validation) && validation.valid !== true
);

export const buildLicensePlanBlockInfo = (validation = {}, fallbackLicense = {}) => {
  const reason = getLicensePlanBlockReason(validation) || 'LICENSE_PLAN_CHANGED';

  const planName =
    validation.plan_name ||
    validation.details?.plan_name ||
    fallbackLicense.plan_name ||
    'Plan actual';

  const planCode =
    validation.plan_code ||
    validation.details?.plan_code ||
    fallbackLicense.plan_code ||
    null;

  const productName =
    validation.product_name ||
    validation.details?.product_name ||
    fallbackLicense.product_name ||
    'Lanzo POS';

  const maxDevices =
    validation.max_devices ??
    validation.details?.max_devices ??
    fallbackLicense.max_devices ??
    null;

  const deviceRole =
    validation.device_role ||
    validation.details?.device_role ||
    fallbackLicense.device_role ||
    null;

  const licenseKey =
    validation.license_key ||
    validation.details?.license_key ||
    fallbackLicense.license_key ||
    null;

  const defaultMessage = reason === 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED'
    ? 'Esta licencia cambió a un plan que no incluye usuarios staff. Este dispositivo fue bloqueado por seguridad.'
    : reason === 'PLAN_DOWNGRADE_DEVICE_LIMIT'
      ? 'Esta licencia cambió a un plan con menos dispositivos permitidos. Este equipo quedó fuera del límite permitido.'
      : 'La licencia cambió de plan y este dispositivo necesita ingresar una licencia compatible.';

  return {
    reason,
    block_reason: reason,
    message: validation.message || validation.details || defaultMessage,
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

  return new Date(
    expiryDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
};

const parseTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
};

const isFatalLocalStatus = (status) => {
  const normalized = normalizeStatusCode(status);
  return LOCAL_FATAL_APP_STATUSES.some((item) => item.toLowerCase() === normalized);
};

export const assertLocalTransactionAllowed = (licenseDetails, state = {}) => {
  if (!licenseDetails) {
    return {
      ok: false,
      code: 'LICENSE_MISSING',
      message: 'No hay una licencia activa para cobrar.'
    };
  }

  if (!licenseDetails.license_key) {
    return {
      ok: false,
      code: 'LICENSE_KEY_MISSING',
      message: 'No se encontró la clave de licencia local.'
    };
  }

  if (licenseDetails.valid === false) {
    return {
      ok: false,
      code: 'LICENSE_INVALID',
      message: 'La licencia local no es válida.'
    };
  }

  const appStatus = state.appStatus || '';
  const licenseStatus = state.licenseStatus || licenseDetails.status || '';
  const detailStatus = licenseDetails.status || licenseDetails.reason || licenseDetails.code || '';

  if (isFatalLocalStatus(appStatus) || isFatalLocalStatus(licenseStatus) || isFatalLocalStatus(detailStatus)) {
    return {
      ok: false,
      code: normalizeStatusCode(appStatus || licenseStatus || detailStatus).toUpperCase() || 'LICENSE_BLOCKED',
      message: 'La licencia está bloqueada o requiere una acción antes de cobrar.'
    };
  }

  const now = Date.now();
  const expiresAt = parseTime(licenseDetails.expires_at);
  const graceEnds = parseTime(
    licenseDetails.grace_period_ends ||
    licenseDetails.gracePeriodEnds ||
    state.gracePeriodEnds
  );

  if (expiresAt && expiresAt <= now && (!graceEnds || graceEnds <= now)) {
    return {
      ok: false,
      code: 'LICENSE_EXPIRED',
      message: 'La licencia está expirada.'
    };
  }

  const isStaff =
    state.currentDeviceRole === 'staff' ||
    licenseDetails.device_role === 'staff' ||
    Boolean(licenseDetails.staff_user);

  if (isStaff && !(state.currentStaffUser || licenseDetails.staff_user)) {
    return {
      ok: false,
      code: 'STAFF_LOGIN_REQUIRED',
      message: 'Inicia sesión staff para cobrar.'
    };
  }

  return { ok: true };
};
