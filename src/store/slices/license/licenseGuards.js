// src/store/slices/license/licenseGuards.js

import {
  ENABLE_LICENSE_REALTIME,
  FATAL_REASONS,
  RECOVERABLE_VALIDATION_REASONS,
  STAFF_LOGIN_REASONS,
  STAFF_DEVICE_AUTH_REASONS,
  STAFF_DEVICE_AUTH_MESSAGE,
  LICENSE_PLAN_BLOCK_REASONS,
  GRACE_PERIOD_DAYS
} from './licenseConstants';

export const isRealtimeEnabledForLicense = (licenseDetails) => (
  ENABLE_LICENSE_REALTIME &&
  licenseDetails?.features?.realtime_license_sync === true &&
  Boolean(licenseDetails?.realtime_topic)
);

export const getLicenseSyncMode = (licenseDetails) => (
  isRealtimeEnabledForLicense(licenseDetails) ? 'hybrid_realtime' : 'hybrid_polling'
);

export const normalizeValidationCode = (validation = {}) => (
  validation.reason ||
  validation.status ||
  validation.error ||
  validation.code ||
  ''
).toString();

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