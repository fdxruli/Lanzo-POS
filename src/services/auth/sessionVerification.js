export const SESSION_VERIFICATION_STATUS = Object.freeze({
  VERIFIED: 'verified',
  AUTHORITATIVE_DENIAL: 'authoritative_denial',
  TRANSPORT_UNAVAILABLE: 'transport_unavailable',
  SERVER_ERROR: 'server_error',
  INVALID_RESPONSE: 'invalid_response',
  LOCAL_STORAGE_ERROR: 'local_storage_error',
  LOCAL_CREDENTIALS_MISSING: 'local_credentials_missing'
});

const ADMIN_DENIAL_CODES = new Set([
  'ADMIN_SESSION_INVALID',
  'ADMIN_SESSION_EXPIRED',
  'ADMIN_SESSION_REQUIRED',
  'ADMIN_DEVICE_REQUIRED',
  'LICENSE_EXPIRED',
  'LICENSE_NOT_ACTIVE'
]);

const STAFF_DENIAL_CODES = new Set([
  'SESSION_NOT_FOUND',
  'SESSION_EXPIRED',
  'STAFF_SESSION_INVALID',
  'STAFF_SESSION_EXPIRED',
  'DEVICE_NOT_ALLOWED',
  'STAFF_USER_INACTIVE',
  'LICENSE_NOT_ACTIVE'
]);

const ADMIN_ACCESS_DISCOVERY_DENIAL_CODES = new Set([
  'ADMIN_DEVICE_REQUIRED',
  'DEVICE_BANNED',
  'DEVICE_LIMIT_REACHED',
  'DEVICE_NOT_ALLOWED',
  'LICENSE_NOT_ACTIVE',
  'LICENSE_EXPIRED'
]);

const RETRYABLE_RESPONSE_CODES = new Set([
  'RATE_LIMITED',
  'AUTH_RATE_LIMITED',
  'ADMIN_AUTH_RATE_LIMITED',
  'ADMIN_ENROLLMENT_RATE_LIMITED',
  'ADMIN_LOGIN_RATE_LIMITED',
  'SESSION_RATE_LIMITED'
]);

const TRANSPORT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT'
]);

const KNOWN_FETCH_MESSAGES = new Set([
  'failed to fetch',
  'fetch failed',
  'load failed',
  'networkerror when attempting to fetch resource.'
]);

const resultFor = (verificationStatus, code, message, extra = {}) => ({
  success: verificationStatus === SESSION_VERIFICATION_STATUS.VERIFIED,
  valid: verificationStatus === SESSION_VERIFICATION_STATUS.VERIFIED,
  verificationStatus,
  code,
  message,
  ...extra
});

export const createLocalCredentialsMissingResult = (actorType, missingCredentials = []) => {
  const actor = actorType === 'staff' ? 'Staff' : 'Admin';
  return resultFor(
    SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING,
    `${actor.toUpperCase()}_SESSION_CREDENTIALS_MISSING`,
    `Faltan credenciales locales necesarias para verificar la sesión ${actor}.`,
    { missingCredentials: [...missingCredentials] }
  );
};

export const createLocalStorageErrorResult = (actorType) => {
  const actor = actorType === 'staff' ? 'Staff' : 'Admin';
  return resultFor(
    SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR,
    'SESSION_LOCAL_STORAGE_UNAVAILABLE',
    `No se pudieron leer las credenciales locales de la sesión ${actor}.`
  );
};

const responseStatus = (error) => {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.context?.status,
    error?.response?.status,
    error?.cause?.status
  ];
  return candidates.map(Number).find((value) => Number.isInteger(value) && value >= 0) ?? null;
};

const isKnownTransportFailure = (error) => {
  const code = String(error?.code || '').toUpperCase();
  if (TRANSPORT_ERROR_CODES.has(code)) return true;
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return true;

  const exactMessage = String(error?.message || '').trim().toLowerCase();
  return error?.name === 'TypeError' && KNOWN_FETCH_MESSAGES.has(exactMessage);
};

const classifyRpcError = (error) => {
  const status = responseStatus(error);
  const errorCode = String(error?.code || '').toUpperCase();
  if (status === 0 || isKnownTransportFailure(error)) {
    return resultFor(
      SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE,
      errorCode || 'SESSION_TRANSPORT_UNAVAILABLE',
      'No se pudo comunicar con el servidor para verificar la sesión.'
    );
  }

  const code = status === 429
    ? 'SESSION_RATE_LIMITED'
    : status >= 500
      ? `SESSION_SERVER_HTTP_${status}`
      : status === 401 || status === 403
        ? `SESSION_GATEWAY_HTTP_${status}`
        : errorCode || 'SESSION_SERVER_ERROR';

  return resultFor(
    SESSION_VERIFICATION_STATUS.SERVER_ERROR,
    code,
    status === 429
      ? 'El servidor limitó temporalmente las verificaciones. Inténtalo más tarde.'
      : 'El servidor no pudo completar la verificación de la sesión.'
  );
};

export const classifySessionVerificationResponse = (actorType, { data, error } = {}) => {
  if (error) return classifyRpcError(error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return resultFor(
      SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
      'SESSION_VERIFICATION_INVALID_RESPONSE',
      'El servidor devolvió una respuesta que no permite verificar la sesión.'
    );
  }

  const code = String(data.code || data.reason || '').trim().toUpperCase();
  const denialCodes = actorType === 'staff' ? STAFF_DENIAL_CODES : ADMIN_DENIAL_CODES;

  if (RETRYABLE_RESPONSE_CODES.has(code)) {
    return resultFor(
      SESSION_VERIFICATION_STATUS.SERVER_ERROR,
      code,
      'El servidor limitó temporalmente las verificaciones. Inténtalo más tarde.',
      Number.isFinite(Number(data.retry_after_seconds))
        ? { retryAfterSeconds: Number(data.retry_after_seconds) }
        : {}
    );
  }

  if ((data.success === false || data.valid === false) && denialCodes.has(code)) {
    return resultFor(
      SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL,
      code,
      data.message || 'El servidor confirmó que la sesión ya no tiene autorización.',
      { credentialDisposition: 'clear' }
    );
  }

  if (data.success === true && data.valid === true) {
    if (denialCodes.has(code)) {
      return resultFor(
        SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
        code,
        'El servidor devolvió indicadores contradictorios para verificar la sesión.'
      );
    }

    return resultFor(
      SESSION_VERIFICATION_STATUS.VERIFIED,
      code || 'SESSION_VERIFIED',
      data.message || 'La sesión fue verificada.'
    );
  }

  return resultFor(
    SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
    code || 'SESSION_VERIFICATION_INVALID_RESPONSE',
    'El servidor devolvió una respuesta incompleta o desconocida para verificar la sesión.'
  );
};

export const classifyAdminAccessDiscoveryFailure = (result = {}) => {
  if (result.verificationStatus) return result;
  const code = String(result.code || result.reason || '').trim().toUpperCase();
  if (result.valid === false && ADMIN_ACCESS_DISCOVERY_DENIAL_CODES.has(code)) {
    return resultFor(
      SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL,
      code,
      result.message || 'El servidor denegó el acceso para este dispositivo o licencia.',
      { credentialDisposition: 'clear' }
    );
  }
  return resultFor(
    SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
    code || 'ADMIN_ACCESS_DISCOVERY_INCONCLUSIVE',
    'El servidor no devolvió una confirmación reconocible del acceso administrativo.'
  );
};

export const isSessionVerificationInconclusive = (result) => (
  [
    SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE,
    SESSION_VERIFICATION_STATUS.SERVER_ERROR,
    SESSION_VERIFICATION_STATUS.INVALID_RESPONSE,
    SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR,
    SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING
  ].includes(result?.verificationStatus)
);

export const isSessionVerificationTransportFailure = (result) => (
  result?.verificationStatus === SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE
);

export const isAuthoritativeSessionDenial = (result) => (
  result?.verificationStatus === SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL
);

export const isSessionVerificationContextError = (error) => (
  String(error?.code || '').startsWith('ACTOR_')
  || String(error?.code || '').startsWith('LOCAL_TENANT_')
  || error?.code === 'LICENSE_VALIDATION_CONTEXT_STALE'
  || error?.code === 'SESSION_VERIFICATION_CONTEXT_STALE'
);
