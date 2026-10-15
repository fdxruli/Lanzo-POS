import {
  classifyIncident,
  getSafeBrowserLabel,
  getSafeIncidentAppVersion,
  getSafeIncidentBuildCommit,
  getSafeIncidentRoute,
  INCIDENT_CATEGORY,
  INCIDENT_SEVERITY
} from './incidentDiagnostics';

export const INCIDENT_REPORT_SCHEMA_VERSION = 1;
export const DEDUPLICATION_WINDOW_MS = 30_000;
export const MAX_RECENT_INCIDENTS = 100;
export const VALID_CATEGORIES = new Set(Object.values(INCIDENT_CATEGORY));
export const VALID_SEVERITIES = new Set(Object.values(INCIDENT_SEVERITY));
export const VALID_SOURCES = new Set([
  'react_boundary', 'global_error', 'unhandled_rejection', 'navigation_resource',
  'indexeddb', 'pwa', 'synchronization', 'backend_service', 'module_exception'
]);
export const VALID_RECOVERY_STATUSES = new Set([
  'detected', 'preserved', 'action_required', 'recovering', 'verified', 'failed', 'blocked'
]);

const read = (value, key) => {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
};

export const safeNow = (value) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

export const createOpaqueId = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // The ID is a correlation value, never an authorization credential.
  }

  const bytes = new Uint8Array(16);
  try {
    globalThis.crypto?.getRandomValues?.(bytes);
  } catch {
    // Use a non-security fallback only for diagnostic correlation.
  }
  if (!bytes.some(Boolean)) bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// This non-cryptographic digest is used only to group already-safe enum values.
// It never hashes the original error message, stack, route parameters, or data.
export const stableSafeFingerprint = (value) => {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const multipliers = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x85ebca6b];
  const hashes = seeds.map((seed, seedIndex) => {
    let hash = seed;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), multipliers[seedIndex]);
      hash ^= hash >>> (13 + seedIndex);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  });
  return `v1-${hashes.join('')}`;
};

export const getDefaultEnvironment = () => {
  let pathname = '/';
  let userAgent = '';
  let online = true;
  try {
    pathname = globalThis.location?.pathname || '/';
    userAgent = globalThis.navigator?.userAgent || '';
    online = globalThis.navigator?.onLine !== false;
  } catch {
    // Diagnostic capture must work during partial browser initialization.
  }
  return {
    pathname,
    userAgent,
    online,
    appVersion: import.meta.env?.VITE_APP_VERSION,
    buildCommit: import.meta.env?.VITE_BUILD_COMMIT,
    now: new Date()
  };
};

const normalizeSource = (source) => {
  const mapping = {
    react: 'react_boundary',
    react_render: 'react_boundary',
    window_error: 'global_error',
    'window.error': 'global_error',
    unhandledrejection: 'unhandled_rejection',
    chunk: 'navigation_resource',
    navigation: 'navigation_resource',
    database: 'indexeddb',
    supabase_rpc: 'backend_service',
    backend: 'backend_service',
    sync: 'synchronization'
  };
  const normalized = mapping[source] || source;
  return VALID_SOURCES.has(normalized) ? normalized : 'module_exception';
};

const normalizePlatform = (userAgent = '') => {
  if (/Android/i.test(userAgent)) return 'Android';
  if (/(?:iPhone|iPad|iPod|iOS)/i.test(userAgent)) return 'iOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'No disponible';
};

export const normalizeExpectedBusinessCode = (code) => (
  typeof code === 'string'
  && /^(?:42501|VALIDATION_|BUSINESS_RULE_|RULE_VIOLATION|EXPECTED_|INSUFFICIENT_PERMISSION|PERMISSION_DENIED|NOT_FOUND|ALREADY_EXISTS|DUPLICATE_)/i.test(code)
);

/**
 * Maps common service failures to a safe technical category. Expected business
 * rejections are explicitly marked and do not become global incidents by
 * default. Callers may set `expectedBusiness` when the domain contract knows a
 * permission or validation rejection is normal.
 */
export const normalizeBackendError = (error, context = {}) => {
  const code = typeof read(error, 'code') === 'string' ? read(error, 'code').slice(0, 120) : '';
  const status = Number(read(error, 'status') ?? read(error, 'statusCode'));
  const expectedBusiness = context.expectedBusiness === true
    || read(error, 'expectedBusiness') === true
    || normalizeExpectedBusinessCode(code);

  let category = context.category;
  if (!VALID_CATEGORIES.has(category)) {
    if (status === 401 || status === 403 || /^(?:AUTH_|ACTOR_|SESSION_|DEVICE_TOKEN_)/i.test(code)) {
      category = INCIDENT_CATEGORY.AUTHORIZATION_SESSION;
    } else if (/^(?:PGRST\d+|SUPABASE_)/i.test(code)) {
      category = INCIDENT_CATEGORY.SUPABASE_RPC;
    } else if (status === 0 || status === 408 || /^(?:NETWORK_|FETCH_|TIMEOUT)/i.test(code)) {
      category = INCIDENT_CATEGORY.CONNECTIVITY;
    } else if (/^SYNC_/i.test(code)) {
      category = INCIDENT_CATEGORY.SYNCHRONIZATION;
    } else if (/^(?:PAYMENT_|SALE_|FINANCIAL_)/i.test(code)) {
      category = INCIDENT_CATEGORY.FINANCIAL_OPERATION;
    } else {
      category = INCIDENT_CATEGORY.SUPABASE_RPC;
    }
  }

  const classification = classifyIncident(error, {
    ...context,
    category,
    ...(context.financialOutcome === 'unknown' ? { financialOutcome: 'unknown' } : {})
  });
  const isAuthorization = status === 401 || status === 403
    || /^(?:AUTH_|ACTOR_|SESSION_|DEVICE_TOKEN_)/i.test(code);
  const isIntegrity = context.integrity === true
    || /^23[0-9A-Z]{3}$/i.test(code)
    || /^(?:INTEGRITY_|CONSTRAINT_)/i.test(code);
  const failureKind = expectedBusiness
    ? 'expected_business'
    : classification.category === INCIDENT_CATEGORY.FINANCIAL_OPERATION
      && classification.severity === INCIDENT_SEVERITY.CRITICAL_BLOCKER
      ? 'financial_outcome_ambiguous'
      : isAuthorization
        ? 'authorization'
        : classification.category === INCIDENT_CATEGORY.CONNECTIVITY
          ? 'transient_connectivity'
          : isIntegrity
            ? 'integrity'
            : status >= 500 || /^(?:PGRST\d+|SUPABASE_)/i.test(code)
              ? 'service_failure'
              : 'unexpected';

  return Object.freeze({
    expectedBusiness,
    reportable: !expectedBusiness,
    failureKind,
    category: classification.category,
    severity: classification.severity,
    safeCode: classification.code,
    errorType: classification.errorType
  });
};

/**
 * Explicit adapter for service boundaries. Callers should invoke this only
 * after deciding a backend failure is operationally relevant; expected domain
 * validation and permission rejections stay out of the global incident flow.
 */
export const captureBackendIncident = (error, context = {}) => {
  const normalized = normalizeBackendError(error, context);
  if (!normalized.reportable) return null;
  return captureIncident(error, {
    ...context,
    backend: true,
    source: context.source || 'backend_service',
    category: normalized.category,
    severity: normalized.severity
  });
};

const isExpectedBusinessError = (error, context) => (
  context.expectedBusiness === true
  || context.reportable === false
  || normalizeExpectedBusinessCode(read(error, 'code'))
  || read(error, 'expectedBusiness') === true
  || read(error, 'isBusinessError') === true
);

export const readEnvironment = (environment) => {
  try {
    return typeof environment === 'function' ? environment() : { ...getDefaultEnvironment(), ...(environment || {}) };
  } catch {
    return getDefaultEnvironment();
  }
};

const safeIncidentRecord = (error, context = {}, environment = getDefaultEnvironment()) => {
  const isBackend = context.backend === true
    || ['backend', 'backend_service', 'supabase_rpc'].includes(context.source);
  const backend = isBackend ? normalizeBackendError(error, context) : null;
  if (isExpectedBusinessError(error, context) || backend?.expectedBusiness) return null;
  if (context.level === 'warn' || context.source === 'console') return null;

  const classified = classifyIncident(error, {
    ...context,
    ...(backend ? { category: backend.category, severity: backend.severity } : {})
  });
  const source = normalizeSource(context.source || (backend ? 'backend_service' : 'module_exception'));
  const safeRoute = getSafeIncidentRoute(context.pathname ?? environment.pathname);
  const module = safeRoute === 'inicio'
    ? 'inicio'
    : safeRoute.startsWith('/') ? (safeRoute.slice(1) || 'inicio') : 'otra-seccion';
  const fingerprint = stableSafeFingerprint([
    INCIDENT_REPORT_SCHEMA_VERSION,
    classified.category,
    classified.severity,
    classified.code,
    module
  ].join('|'));
  const occurredAt = safeNow(environment.now);
  const online = typeof context.online === 'boolean' ? context.online : environment.online;
  const networkStatus = typeof online === 'boolean'
    ? (online ? 'online' : 'offline')
    : 'unknown';

  return Object.freeze({
    schema_version: INCIDENT_REPORT_SCHEMA_VERSION,
    incident_id: createOpaqueId(),
    correlation_id: createOpaqueId(),
    fingerprint,
    source,
    category: classified.category,
    severity: classified.severity,
    safe_code: classified.code,
    module,
    safe_route: safeRoute,
    app_version: getSafeIncidentAppVersion(environment.appVersion),
    build_commit: getSafeIncidentBuildCommit(environment.buildCommit),
    browser_family: getSafeBrowserLabel(environment.userAgent),
    platform: normalizePlatform(environment.userAgent),
    network_status: networkStatus,
    recovery_status: VALID_RECOVERY_STATUSES.has(context.recoveryStatus) ? context.recoveryStatus : 'detected',
    occurred_at: occurredAt
  });
};

export const createIncidentCapture = ({
  environment = getDefaultEnvironment,
  now = () => Date.now(),
  idFactory = createOpaqueId,
  deduplicationWindowMs = DEDUPLICATION_WINDOW_MS
} = {}) => {
  const recent = new Map();

  return Object.freeze({
    capture(error, context = {}) {
      try {
        const env = readEnvironment(environment);
        const timestamp = Number(now());
        const candidate = safeIncidentRecord(error, context, { ...env, now: context.now ?? new Date(timestamp) });
        if (!candidate) return null;
        const dedupeKey = [candidate.category, candidate.severity, candidate.safe_code, candidate.module].join('|');
        const existing = recent.get(dedupeKey);
        if (existing && timestamp >= existing.timestamp && timestamp - existing.timestamp < deduplicationWindowMs) {
          return Object.freeze({ ...existing.incident, deduplicated: true });
        }
        const incident = Object.freeze({ ...candidate, incident_id: idFactory(), correlation_id: idFactory() });
        recent.set(dedupeKey, { timestamp, incident });
        for (const [key, value] of recent) {
          if (timestamp >= value.timestamp && timestamp - value.timestamp >= deduplicationWindowMs) recent.delete(key);
        }
        while (recent.size > MAX_RECENT_INCIDENTS) recent.delete(recent.keys().next().value);
        return incident;
      } catch {
        // Error reporting must never become a second source of runtime errors.
        return null;
      }
    },
    clear() {
      recent.clear();
    }
  });
};

export const incidentCapture = createIncidentCapture();
export const captureIncident = (error, context = {}) => incidentCapture.capture(error, context);
export const resetIncidentCaptureForTests = () => incidentCapture.clear();
