import {
  INCIDENT_REPORT_SCHEMA_VERSION,
  VALID_CATEGORIES,
  VALID_SEVERITIES,
  VALID_SOURCES,
  VALID_RECOVERY_STATUSES,
  DEDUPLICATION_WINDOW_MS,
  stableSafeFingerprint,
  safeNow,
  getDefaultEnvironment,
  readEnvironment,
  createOpaqueId,
  createIncidentCapture,
  incidentCapture,
  captureIncident,
  resetIncidentCaptureForTests,
  normalizeBackendError,
  captureBackendIncident
} from './incidentCapture';
import {
  getSafeIncidentAppVersion,
  getSafeIncidentBuildCommit,
  getSafeIncidentRoute,
  getSafeIncidentCode,
  getSafeIncidentLocation,
  INCIDENT_CATEGORY,
  INCIDENT_SEVERITY
} from './incidentDiagnostics';

export { normalizeBackendError, captureBackendIncident, captureIncident };

export const INCIDENT_REPORT_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  READY: 'ready',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  OFFLINE: 'offline',
  UNAVAILABLE: 'unavailable'
});

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_REPORT_BYTES = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^v1-[a-f0-9]{32}$/;
const REPORT_REFERENCE_PATTERN = /^IR-[A-F0-9]{16}$/;

const read = (value, key) => {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
};

export const createIncidentReportPayload = (incident, userDescription = '') => {
  if (!incident || typeof incident !== 'object') {
    throw Object.assign(new Error('INCIDENT_REPORT_INVALID'), { code: 'INCIDENT_REPORT_INVALID' });
  }
  if (typeof userDescription !== 'string' || userDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw Object.assign(new Error('INCIDENT_DESCRIPTION_TOO_LONG'), { code: 'INCIDENT_DESCRIPTION_TOO_LONG' });
  }

  const category = VALID_CATEGORIES.has(incident.category) ? incident.category : INCIDENT_CATEGORY.UNKNOWN;
  const severity = VALID_SEVERITIES.has(incident.severity) ? incident.severity : INCIDENT_SEVERITY.SECTION_FAILURE;
  const safeRoute = getSafeIncidentRoute(incident.safe_route);
  const moduleCandidate = typeof incident.module === 'string' ? incident.module : '';
  const module = /^[a-z0-9-]{1,40}$/.test(moduleCandidate)
    ? moduleCandidate
    : (safeRoute === 'inicio' ? 'inicio' : safeRoute.startsWith('/') ? (safeRoute.slice(1) || 'inicio') : 'otra-seccion');
  const fingerprintCandidate = typeof incident.fingerprint === 'string' && FINGERPRINT_PATTERN.test(incident.fingerprint)
    ? incident.fingerprint
    : stableSafeFingerprint([INCIDENT_REPORT_SCHEMA_VERSION, category, severity, incident.safe_code, module].join('|'));
  const description = userDescription.trim();
  const payload = {
    schema_version: INCIDENT_REPORT_SCHEMA_VERSION,
    incident_id: UUID_PATTERN.test(incident.incident_id) ? incident.incident_id : '',
    correlation_id: UUID_PATTERN.test(incident.correlation_id) ? incident.correlation_id : '',
    fingerprint: fingerprintCandidate,
    source: VALID_SOURCES.has(incident.source) ? incident.source : 'module_exception',
    category,
    severity,
    safe_code: getSafeIncidentCode({ code: incident.safe_code }, category),
    module,
    safe_route: safeRoute,
    app_version: getSafeIncidentAppVersion(incident.app_version),
    build_commit: getSafeIncidentBuildCommit(incident.build_commit),
    browser_family: typeof incident.browser_family === 'string'
      && /^(?:Edge|Opera|Firefox|Chrome|Safari) \d{1,3}$|^Navegador no identificado$/.test(incident.browser_family)
      ? incident.browser_family
      : 'Navegador no identificado',
    platform: ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'No disponible'].includes(incident.platform)
      ? incident.platform
      : 'No disponible',
    network_status: ['online', 'offline', 'unknown'].includes(incident.network_status)
      ? incident.network_status
      : 'unknown',
    recovery_status: VALID_RECOVERY_STATUSES.has(incident.recovery_status)
      ? incident.recovery_status
      : 'detected',
    occurred_at: safeNow(incident.occurred_at),
    user_description: description || null
  };

  if (!payload.incident_id || !payload.correlation_id) {
    throw Object.assign(new Error('INCIDENT_REPORT_INVALID'), { code: 'INCIDENT_REPORT_INVALID' });
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_REPORT_BYTES) {
    throw Object.assign(new Error('INCIDENT_REPORT_TOO_LARGE'), { code: 'INCIDENT_REPORT_TOO_LARGE' });
  }
  return Object.freeze(payload);
};

export const formatIncidentDiagnostic = (incident, userDescription = '') => {
  const payload = createIncidentReportPayload(incident, userDescription);
  const legacyPath = ['inicio', '/inicio'].includes(incident?.safe_route) ? '/' : incident?.safe_route;
  const location = getSafeIncidentLocation(
    incident?.recovery_surface,
    incident?.navigation_path ?? legacyPath
  );
  return [
    'DIAGNÓSTICO TÉCNICO DE LANZO POS',
    `Área funcional: ${location.functionalArea}`,
    `Pantalla afectada: ${location.affectedScreen}`,
    `Ruta de navegación: ${location.navigationPath}`,
    `Componente supervisado: ${location.supervisedComponent}`,
    JSON.stringify(payload, null, 2),
    '',
    'La descripción es texto libre y no se limpia automáticamente.'
  ].join('\n');
};

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key
  || licenseDetails.licenseKey
  || licenseDetails.details?.license_key
  || licenseDetails.details?.licenseKey
  || null
);

const safeContextIsCurrent = (isContextCurrent) => {
  try {
    return typeof isContextCurrent !== 'function' || isContextCurrent() === true;
  } catch {
    return false;
  }
};

const submitIncidentReportRpc = async ({ payload, licenseDetails, isContextCurrent }) => {
  let supabaseModule;
  let syncModule;
  try {
    [supabaseModule, syncModule] = await Promise.all([
      import('../supabase'),
      import('../sync/posSyncClient')
    ]);
  } catch {
    return { status: INCIDENT_REPORT_STATUS.UNAVAILABLE, code: 'INCIDENT_REPORTING_UNAVAILABLE' };
  }
  const { supabaseClient } = supabaseModule;
  const { buildPosSyncAuthContext } = syncModule;
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    return { status: INCIDENT_REPORT_STATUS.UNAVAILABLE, code: 'INCIDENT_REPORTING_UNAVAILABLE' };
  }
  if (!safeContextIsCurrent(isContextCurrent)) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_CONTEXT_CHANGED' };
  }

  const licenseKey = getLicenseKey(licenseDetails);
  if (!licenseKey) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_AUTHORIZATION_REQUIRED' };
  }
  const authContext = await buildPosSyncAuthContext({ licenseKey });
  if (!authContext.deviceFingerprint || !authContext.securityToken || !authContext.staffSessionToken) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_AUTHORIZATION_REQUIRED' };
  }
  if (!safeContextIsCurrent(isContextCurrent)) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_CONTEXT_CHANGED' };
  }

  const { data, error } = await supabaseClient.rpc('submit_technical_incident_report', {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken,
    p_incident: payload,
    p_consent: true
  });
  if (error) throw error;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { success: false, code: 'INCIDENT_REPORT_INVALID_RESPONSE' };
    }
  }
  return data;
};

const normalizeDeliveryFailure = (error, online) => {
  if (!online) return { status: INCIDENT_REPORT_STATUS.OFFLINE, code: 'INCIDENT_REPORT_OFFLINE' };
  const code = typeof read(error, 'code') === 'string' ? read(error, 'code').toUpperCase() : '';
  const message = typeof read(error, 'message') === 'string' ? read(error, 'message') : '';
  if (/PGRST202|PGRST203/.test(code) || /could not find the function|function .* does not exist/i.test(message)) {
    return { status: INCIDENT_REPORT_STATUS.UNAVAILABLE, code: 'INCIDENT_REPORTING_UNAVAILABLE' };
  }
  if (/RATE_LIMIT/.test(code)) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_RATE_LIMITED' };
  }
  if (/AUTH|ACTOR|SESSION|LICENSE|DEVICE/.test(code) || [401, 403].includes(Number(read(error, 'status')))) {
    return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_AUTHORIZATION_FAILED' };
  }
  return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_DELIVERY_FAILED' };
};

export const createIncidentReporter = ({
  environment = getDefaultEnvironment,
  transport = submitIncidentReportRpc,
  now = () => Date.now(),
  idFactory = createOpaqueId,
  deduplicationWindowMs = DEDUPLICATION_WINDOW_MS,
  capture = null
} = {}) => {
  const captureService = capture || createIncidentCapture({ environment, now, idFactory, deduplicationWindowMs });

  return Object.freeze({
    capture: (error, context = {}) => captureService.capture(error, context),

    prepare(incident, userDescription = '') {
      return createIncidentReportPayload(incident, userDescription);
    },

    format(incident, userDescription = '') {
      return formatIncidentDiagnostic(incident, userDescription);
    },

    async submit(incident, {
      consent = false,
      userDescription = '',
      licenseDetails = {},
      isContextCurrent = () => true
    } = {}) {
      if (consent !== true) return { status: INCIDENT_REPORT_STATUS.READY, code: 'INCIDENT_REPORT_CONSENT_REQUIRED' };
      const env = readEnvironment(environment);
      const online = env.online !== false;
      if (!online) return { status: INCIDENT_REPORT_STATUS.OFFLINE, code: 'INCIDENT_REPORT_OFFLINE' };
      if (!safeContextIsCurrent(isContextCurrent)) {
        return { status: INCIDENT_REPORT_STATUS.FAILED, code: 'INCIDENT_REPORT_CONTEXT_CHANGED' };
      }
      if (typeof transport !== 'function') {
        return { status: INCIDENT_REPORT_STATUS.UNAVAILABLE, code: 'INCIDENT_REPORTING_UNAVAILABLE' };
      }

      let payload;
      try {
        payload = createIncidentReportPayload(incident, userDescription);
      } catch (error) {
        return { status: INCIDENT_REPORT_STATUS.FAILED, code: read(error, 'code') || 'INCIDENT_REPORT_INVALID' };
      }

      try {
        const response = await transport({ payload, licenseDetails, isContextCurrent });
        if (response?.status && [
          INCIDENT_REPORT_STATUS.OFFLINE,
          INCIDENT_REPORT_STATUS.FAILED,
          INCIDENT_REPORT_STATUS.UNAVAILABLE
        ].includes(response.status)) {
          return { status: response.status, code: response.code || undefined };
        }
        const reference = response?.report_reference ?? response?.reportReference;
        if (response?.success === true && typeof reference === 'string' && REPORT_REFERENCE_PATTERN.test(reference)) {
          return { status: INCIDENT_REPORT_STATUS.SENT, reportReference: reference };
        }
        const code = typeof response?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(response.code)
          ? response.code
          : 'INCIDENT_REPORT_DELIVERY_FAILED';
        if (/UNAVAILABLE/.test(code)) return { status: INCIDENT_REPORT_STATUS.UNAVAILABLE, code };
        return { status: INCIDENT_REPORT_STATUS.FAILED, code };
      } catch (error) {
        let currentlyOnline = online;
        try {
          currentlyOnline = readEnvironment(environment).online !== false;
        } catch {
          currentlyOnline = false;
        }
        return normalizeDeliveryFailure(error, currentlyOnline);
      }
    },

    clearForTests() {
      captureService.clear();
    }
  });
};

export const incidentReporter = createIncidentReporter({ capture: incidentCapture });
export const submitIncidentReport = (incident, options = {}) => incidentReporter.submit(incident, options);
export const resetIncidentReporterForTests = resetIncidentCaptureForTests;

export const formatIncidentChannelSummary = ({ incident, reportReference, receiptConfirmed = false } = {}) => {
  const confirmedReference = receiptConfirmed === true
    && typeof reportReference === 'string'
    && REPORT_REFERENCE_PATTERN.test(reportReference)
    ? reportReference
    : '';
  const code = getSafeIncidentCode({ code: incident?.safe_code }, incident?.category);
  const category = VALID_CATEGORIES.has(incident?.category) ? incident.category : INCIDENT_CATEGORY.UNKNOWN;
  const route = getSafeIncidentRoute(incident?.safe_route);
  const receipt = confirmedReference || 'diagnóstico local no registrado';
  return `Lanzo POS · ${receipt} · ${code} · ${category} · ${route}`.slice(0, 240);
};
