// src/store/slices/license/licenseConstants.js

export const FATAL_REASONS = [
  'banned',
  'cloned',
  'deleted',
  'revoked',
  'not_found',
  'suspended',
  'device_banned',
  'device_not_allowed',
  'device_limit_reached',
  'license_not_found',
  'license_suspended',
  'license_revoked',
  'invalid_license',
  'invalid',
  'LICENSE_NOT_FOUND',
  'LICENSE_SUSPENDED',
  'DEVICE_NOT_ALLOWED',
  'DEVICE_BANNED',
  'DEVICE_RELEASED',
  'device_released',
  'CLONING_DETECTED'
];

export const RENEWAL_REASONS = [
  'expired_subscription',
  'LICENSE_EXPIRED',
  'license_expired'
];

export const RECOVERABLE_VALIDATION_REASONS = [
  'DEVICE_TOKEN_REQUIRED',
  'token_required',
  'no_secure_context',
  'server_rejected',
  'VALIDATION_TIMEOUT',
  'NETWORK_ERROR',
  'OFFLINE_PRECHECK',
  'offline_grace_expired'
];

export const STAFF_LOGIN_REASONS = [
  'STAFF_LOGIN_REQUIRED',
  'staff_login_required',
  'STAFF_SESSION_REQUIRED',
  'STAFF_SESSION_INVALID'
];

export const STAFF_DEVICE_AUTH_REASONS = [
  'DEVICE_NOT_ALLOWED',
  'DEVICE_BANNED',
  'DEVICE_RELEASED',
  'device_not_allowed',
  'device_banned',
  'device_released'
];

export const STAFF_DEVICE_AUTH_MESSAGE =
  'Este dispositivo fue liberado o ya no está autorizado. Inicia sesión staff nuevamente o pide al administrador revisar los dispositivos.';

export const LICENSE_PLAN_BLOCK_REASONS = [
  'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
  'PLAN_DOWNGRADE_DEVICE_LIMIT'
];

export const GRACE_PERIOD_DAYS = 7;

// FASE 6H: intervalos por plan/modo para evitar revalidaciones agresivas.
export const FREE_LICENSE_SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias
export const BASIC_LICENSE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
export const PRO_POLLING_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30min fallback sin realtime

// Compatibilidad con imports antiguos.
export const LICENSE_SYNC_INTERVAL_MS = PRO_POLLING_SYNC_INTERVAL_MS;
export const REALTIME_SAFETY_SYNC_INTERVAL_MS = PRO_REALTIME_SAFETY_SYNC_INTERVAL_MS;

// Evita duplicar llamadas por focus/online/visibility/pageshow muy juntos.
export const LICENSE_REMOTE_VALIDATION_COOLDOWN_MS = 90 * 1000;

// Evita stop/start de realtime en cada regreso a primer plano si el canal sigue vivo.
export const REALTIME_RECOVERY_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Perfil: TTL largo. No se refresca en ventas ni safety checks frecuentes.
export const PROFILE_REFRESH_TTL_MS = 12 * 60 * 60 * 1000;
export const PROFILE_LAST_LOAD_KEY = 'Lanzo_last_profile_load';
export const PROFILE_LAST_LICENSE_KEY = 'Lanzo_last_profile_license_key';

export const LOCAL_FATAL_APP_STATUSES = [
  'expired',
  'revoked',
  'cancelled',
  'blocked',
  'device_revoked',
  'staff_login_required',
  'locked_renewal'
];

export const ENABLE_LICENSE_REALTIME =
  import.meta.env.VITE_ENABLE_LICENSE_REALTIME === 'true';
