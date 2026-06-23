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

// Polling normal para planes sin realtime. Mantiene bajo el consumo de Supabase.
export const LICENSE_SYNC_INTERVAL_MS = 30 * 60 * 1000;

// Red de seguridad para PWA móvil con realtime. Si Android/iOS pausa el WebSocket
// sin disparar CLOSED/TIMED_OUT, este check evita esperar 30 minutos.
export const REALTIME_SAFETY_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export const ENABLE_LICENSE_REALTIME =
  import.meta.env.VITE_ENABLE_LICENSE_REALTIME === 'true';