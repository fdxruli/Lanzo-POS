const NETWORK_CODES = new Set([
  'ERR_NETWORK',
  'FETCH_ERROR',
  'FAILED_TO_FETCH',
  'NETWORK_ERROR',
  'NETWORK_REQUEST_FAILED',
  'OFFLINE',
  'OFFLINE_PRECHECK'
]);

const TRANSITION_CODES = new Set([
  'ADMIN_OR_STAFF_LOGIN_REQUIRED',
  'ADMIN_ENROLLMENT_REQUIRED',
  'STAFF_LOGIN_REQUIRED',
  'LICENSE_CHANGE_REQUIRED',
  'LOCAL_TENANT_MISMATCH'
]);

const NETWORK_MESSAGE_PATTERN = /failed to fetch|network error|networkerror|connection (?:error|failed|lost)|no se pudo conectar|sin conexi[oó]n|no tienes conexi[oó]n|offline/i;
const RATE_LIMIT_MESSAGE_PATTERN = /demasiados intentos|too many attempts|rate[ _-]?limit(?:ed)?/i;
const DB_TIMEOUT_MESSAGE_PATTERN = /indexeddb capability probe timed out|database(?:open)?timeout|database open timed out/i;
const DB_STORAGE_MESSAGE_PATTERN = /browser storage unavailable|no se pudo abrir el almacenamiento local del navegador|indexeddb.*(?:unavailable|failure|failed)/i;

const readFirstDefined = (source, keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
    if (source?.details?.[key] !== undefined && source?.details?.[key] !== null) {
      return source.details[key];
    }
  }
  return undefined;
};

const normalizeCode = (source = {}) => {
  const value = readFirstDefined(source, ['code', 'error_code', 'reason']);
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
};

const readMessage = (source = {}) => {
  const message = readFirstDefined(source, ['message', 'error']);
  if (typeof message === 'string') return message;
  if (typeof message?.message === 'string') return message.message;
  return typeof source?.cause?.message === 'string' ? source.cause.message : '';
};

const readStatus = (source = {}) => {
  const value = source?.status ?? source?.statusCode ?? source?.response?.status;
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
};

const readRetryAfterSeconds = (source = {}) => {
  const value = readFirstDefined(source, ['retry_after_seconds', 'retryAfterSeconds']);
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(Math.ceil(seconds), 3600);
};

const buildError = ({
  code = null,
  title,
  message,
  action,
  retryable,
  supportRecommended,
  retryAfterSeconds
}) => ({
  kind: 'error',
  code,
  title,
  message,
  action,
  retryable,
  supportRecommended,
  ...(retryAfterSeconds === undefined ? {} : { retry_after_seconds: retryAfterSeconds })
});

const buildTransition = (code) => ({
  kind: 'transition',
  code: code || null,
  title: null,
  message: null,
  action: 'continue',
  retryable: false,
  supportRecommended: false
});

const isTransition = (source, code) => Boolean(
  source?.accessChoiceRequired === true
  || source?.access_choice_required === true
  || source?.adminEnrollmentRequired === true
  || source?.admin_enrollment_required === true
  || source?.staffLoginRequired === true
  || source?.staff_login_required === true
  || source?.licenseChangeRequired === true
  || source?.localTenantMismatch === true
  || TRANSITION_CODES.has(code)
);

const isTransportFailure = (source, code) => {
  const status = readStatus(source);
  return (status !== null && status >= 500 && status <= 599)
    || code.startsWith('PGRST')
    || code === 'TRANSPORT_ERROR'
    || code === 'RPC_ERROR'
    || code === 'HTTP_5XX';
};

const isNetworkFailure = (source, code, rawMessage, isOnline) => (
  NETWORK_CODES.has(code)
  || source?.offline === true
  || source?.isOffline === true
  || isOnline === false
  || NETWORK_MESSAGE_PATTERN.test(rawMessage)
);

export const mapLicenseActivationResult = (source = {}, { isOnline } = {}) => {
  const code = normalizeCode(source);
  const rawMessage = readMessage(source);
  const retryAfterSeconds = readRetryAfterSeconds(source);
  const online = isOnline ?? (typeof navigator === 'undefined' ? true : navigator.onLine);

  if (isTransition(source, code)) return buildTransition(code);

  if (code === 'LICENSE_NOT_FOUND') {
    return buildError({
      code,
      title: 'Licencia no disponible',
      message: 'Revisa que hayas escrito la clave correctamente e inténtalo de nuevo.',
      action: 'correct_and_retry',
      retryable: true,
      supportRecommended: false
    });
  }

  if (code === 'LICENSE_NOT_ACTIVE') {
    return buildError({
      code,
      title: 'Licencia no disponible',
      message: 'No pudimos usar esta licencia. Verifica que esté vigente o contacta a soporte.',
      action: 'verify_or_contact_support',
      retryable: false,
      supportRecommended: true
    });
  }

  if (code === 'LICENSE_ACTIVATION_RATE_LIMITED' || RATE_LIMIT_MESSAGE_PATTERN.test(rawMessage)) {
    return buildError({
      code: code || 'LICENSE_ACTIVATION_RATE_LIMITED',
      title: 'Demasiados intentos',
      message: 'Espera unos minutos antes de volver a intentarlo.',
      action: 'retry_later',
      retryable: true,
      supportRecommended: false,
      retryAfterSeconds
    });
  }

  if (code === 'ADMIN_ENROLLMENT_NOT_ALLOWED') {
    return buildError({
      code,
      title: 'Activación no disponible',
      message: 'Este dispositivo no puede completar esta activación. Usa un acceso autorizado o contacta al administrador.',
      action: 'contact_admin',
      retryable: false,
      supportRecommended: true
    });
  }

  if (code === 'DB_BROWSER_STORAGE_UNAVAILABLE' || DB_STORAGE_MESSAGE_PATTERN.test(rawMessage)) {
    return buildError({
      code: code || 'DB_BROWSER_STORAGE_UNAVAILABLE',
      title: 'Almacenamiento no disponible',
      message: 'Lanzo no pudo usar el almacenamiento local de este navegador. Cierra otras pestañas de Lanzo e inténtalo nuevamente.',
      action: 'close_other_lanzo_tabs',
      retryable: true,
      supportRecommended: false
    });
  }

  if (code === 'DB_OPEN_TIMEOUT' || DB_TIMEOUT_MESSAGE_PATTERN.test(rawMessage)) {
    return buildError({
      code: code || 'DB_OPEN_TIMEOUT',
      title: 'Almacenamiento ocupado',
      message: 'Cierra otras pestañas de Lanzo e inténtalo nuevamente.',
      action: 'close_other_lanzo_tabs',
      retryable: true,
      supportRecommended: false
    });
  }

  if (isNetworkFailure(source, code, rawMessage, online)) {
    return buildError({
      code: code || 'NETWORK_ERROR',
      title: 'Sin conexión',
      message: 'Conéctate a internet e inténtalo nuevamente.',
      action: 'retry_when_online',
      retryable: true,
      supportRecommended: false
    });
  }

  if (isTransportFailure(source, code)) {
    return buildError({
      code: code || 'TRANSPORT_ERROR',
      title: 'No pudimos validar la licencia',
      message: 'Inténtalo nuevamente. Si el problema continúa, contacta a soporte.',
      action: 'retry_or_contact_support',
      retryable: true,
      supportRecommended: true
    });
  }

  return buildError({
    code: code || null,
    title: 'Ocurrió un problema',
    message: 'No pudimos validar la licencia. Inténtalo nuevamente.',
    action: 'retry_or_contact_support',
    retryable: true,
    supportRecommended: true
  });
};
