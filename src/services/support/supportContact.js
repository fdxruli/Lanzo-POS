import {
  buildSafeIncidentReport,
  classifyIncident,
  getSafeIncidentCode,
  getSafeBrowserLabel,
  INCIDENT_CATEGORY
} from '../diagnostics/incidentDiagnostics';

const PLAN_NAMES_BY_CODE = Object.freeze({
  free_trial: 'Lanzo Local',
  basic_monthly: 'Lanzo Basico Legacy',
  pro_monthly: 'Lanzo Nube'
});

const DEFAULT_SUPPORT_EMAIL = 'lanzocontacto@gmail.com';

const normalizeText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text && text !== 'undefined' ? text : fallback;
};

const getSafeBuildDate = (value) => {
  const candidate = normalizeText(value).slice(0, 80);
  if (!candidate) return 'No disponible';
  const timestamp = new Date(candidate);
  return Number.isNaN(timestamp.getTime()) ? 'No disponible' : timestamp.toISOString();
};

const getSafeLanguage = (value) => {
  const language = normalizeText(value).slice(0, 24);
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(language)
    ? language
    : 'No disponible';
};

export const getSupportEmail = () => normalizeText(
  import.meta.env?.VITE_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_EMAIL
);

const getSafeDatabaseFamily = (databaseName) => {
  const name = normalizeText(databaseName);
  if (name === 'LanzoDB1') return 'Vault legacy (LanzoDB1)';
  if (name.startsWith('LanzoDB_t_')) return 'Base aislada por tenant (identificador redactado)';
  if (name.startsWith('LanzoDB')) return 'Base local Lanzo (nombre redactado)';
  return name ? 'Base local (nombre redactado)' : 'No disponible';
};

const getRecoveryEnvironment = (environment = {}) => {
  const browser = environment.navigator || globalThis.navigator;
  const now = environment.now instanceof Date ? environment.now : new Date();

  return {
    appVersion: normalizeText(environment.appVersion ?? import.meta.env?.VITE_APP_VERSION, 'No disponible'),
    buildCommit: normalizeText(environment.buildCommit ?? import.meta.env?.VITE_BUILD_COMMIT, 'No disponible'),
    buildDate: getSafeBuildDate(environment.buildDate ?? import.meta.env?.VITE_BUILD_DATE),
    userAgent: getSafeBrowserLabel(environment.userAgent ?? browser?.userAgent),
    language: getSafeLanguage(environment.language ?? browser?.language),
    online: typeof environment.online === 'boolean'
      ? environment.online
      : browser?.onLine !== false,
    timestamp: now.toISOString()
  };
};

/**
 * Builds a bounded technical report for a failure while loading the
 * administrative shell. It receives only boot metadata; tenant identity,
 * IndexedDB rows and authentication material are intentionally excluded.
 */
export function buildAdminBootSupportReport(boot = {}, environment = {}) {
  const details = getRecoveryEnvironment(environment);
  const category = boot.classification === 'asset_load_failure'
    ? INCIDENT_CATEGORY.NAVIGATION_RESOURCE
    : undefined;
  const incident = classifyIncident({ code: boot.errorCode || boot.code }, { category });
  const baseReport = buildSafeIncidentReport(
    { code: boot.errorCode || boot.code },
    { category },
    {
      appVersion: details.appVersion,
      buildCommit: details.buildCommit,
      userAgent: environment.userAgent ?? globalThis.navigator?.userAgent,
      pathname: environment.path ?? globalThis.location?.pathname,
      online: details.online,
      now: new Date(details.timestamp)
    }
  );
  const allowedStages = new Set(['initial_startup', 'ready_runtime_loading', 'route_loading']);
  const stage = allowedStages.has(boot.stage) ? boot.stage : 'unknown';
  const safeStatus = ['idle', 'checking', 'ready', 'migrating', 'recovery_required', 'failed']
    .includes(boot.databaseRecoveryStatus)
    ? boot.databaseRecoveryStatus
    : 'unknown';

  return [
    baseReport,
    `Etapa de inicio: ${stage}`,
    `Estado de recuperación local: ${safeStatus}`,
    `Tenant runtime listo: ${boot.tenantRuntimeReady === true ? 'Sí' : 'No'}`,
    `Recuperación de assets intentada: ${boot.assetRecoveryAttempted === true ? 'Sí' : 'No'}`,
    `Incidencia: ${getSafeIncidentCode({ code: incident.code }, incident.category)}`,
    `Navegador/entorno: ${details.userAgent}`,
    `Idioma: ${details.language}`,
    `Fecha de build: ${details.buildDate}`
  ].join('\n');
}

/**
 * Builds the bounded, privacy-safe report for controlled IndexedDB recovery.
 * It intentionally accepts recovery metadata only: never database contents,
 * license credentials, tenant identifiers, or sync payloads.
 */
export function buildDatabaseRecoverySupportReport(recovery = {}, environment = {}) {
  const details = getRecoveryEnvironment(environment);
  const affectedStoreCount = Array.isArray(recovery.affectedStores)
    ? Math.min(recovery.affectedStores.filter((store) => typeof store === 'string').length, 100)
    : 0;
  const optionalVersions = [
    Number.isFinite(recovery.detectedNativeVersion)
      ? `Versión local detectada: ${recovery.detectedNativeVersion}`
      : null,
    Number.isFinite(recovery.expectedNativeVersion)
      ? `Versión compatible con esta instalación: ${recovery.expectedNativeVersion}`
      : null
  ].filter(Boolean);

  const allowedStates = new Set(['idle', 'checking', 'ready', 'migrating', 'recovery_required', 'failed']);
  const status = allowedStates.has(recovery.status) ? recovery.status : 'unknown';
  const incident = classifyIncident({ code: recovery.errorCode }, { category: INCIDENT_CATEGORY.INDEXEDDB });
  const baseReport = buildSafeIncidentReport(
    { code: getSafeIncidentCode({ code: recovery.errorCode }, incident.category) },
    { category: INCIDENT_CATEGORY.INDEXEDDB },
    {
      appVersion: details.appVersion,
      buildCommit: environment.buildCommit,
      userAgent: environment.userAgent ?? globalThis.navigator?.userAgent,
      pathname: environment.path ?? globalThis.location?.pathname,
      online: details.online,
      now: new Date(details.timestamp)
    }
  );

  return [
    baseReport,
    `Estado de recuperación: ${status}`,
    `Base local: ${getSafeDatabaseFamily(recovery.databaseName)}`,
    ...optionalVersions,
    `Requiere migración: ${recovery.requiresMigration === true ? 'Sí' : 'No'}`,
    `Reintentable: ${recovery.isRetryable === false ? 'No' : 'Sí'}`,
    ...(affectedStoreCount > 0 ? [`Cantidad de stores afectados: ${affectedStoreCount}`] : [])
  ].join('\n');
}

export async function copyTextToClipboard(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue with the same bounded fallback used by the application shell.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.('copy') === true;
  document.body.removeChild(textarea);
  return copied;
}

const getPlanCode = (licenseDetails = {}) => normalizeText(
  licenseDetails?.plan_code ||
  licenseDetails?.details?.plan_code ||
  licenseDetails?.plan ||
  licenseDetails?.subscription_plan ||
  licenseDetails?.product_code,
  'sin_plan'
).toLowerCase();

const getCommercialPlanName = (licenseDetails = {}) => {
  const explicitName = normalizeText(
    licenseDetails?.plan_name ||
    licenseDetails?.details?.plan_name ||
    licenseDetails?.product_name
  );
  if (explicitName) return explicitName;

  const planCode = getPlanCode(licenseDetails);
  if (PLAN_NAMES_BY_CODE[planCode]) return PLAN_NAMES_BY_CODE[planCode];
  if (licenseDetails?.features?.realtime_license_sync === true) return PLAN_NAMES_BY_CODE.pro_monthly;
  return PLAN_NAMES_BY_CODE.free_trial;
};

const getLicenseKey = (licenseDetails = {}) => normalizeText(
  licenseDetails?.license_key ||
  licenseDetails?.licenseKey ||
  licenseDetails?.key ||
  licenseDetails?.details?.license_key,
  'No disponible'
);

const maskLicenseKey = (licenseKey) => {
  const normalized = normalizeText(licenseKey);
  if (!normalized) return 'No disponible';
  const suffix = normalized.slice(-4);
  return suffix ? `••••${suffix}` : '••••';
};

const getCompanyName = (companyProfile = {}) => normalizeText(
  companyProfile?.name ||
  companyProfile?.business_name ||
  companyProfile?.commercial_name,
  'Negocio no configurado'
);

const getDeviceInfo = () => {
  if (typeof navigator === 'undefined') return 'No disponible';
  return getSafeBrowserLabel(navigator.userAgent);
};

export function buildSupportEmailPayload({
  licenseDetails,
  companyProfile,
  appVersion,
  issueType,
  description
} = {}) {
  const planCode = getPlanCode(licenseDetails);
  const commercialPlan = getCommercialPlanName(licenseDetails);
  const localDate = new Date().toLocaleString();
  const normalizedIssueType = normalizeText(issueType, 'No especificado');
  const normalizedDescription = normalizeText(description, 'Sin descripción');

  const subject = `[Soporte Lanzo POS] ${normalizedIssueType} - ${getCompanyName(companyProfile)}`;
  const body = [
    'Hola equipo Lanzo,',
    '',
    'Solicito soporte con la siguiente información:',
    '',
    `Plan comercial: ${commercialPlan}`,
    `Codigo interno del plan: ${planCode}`,
    `Licencia (terminación): ${maskLicenseKey(getLicenseKey(licenseDetails))}`,
    `Nombre del negocio: ${getCompanyName(companyProfile)}`,
    `Version de app: ${normalizeText(appVersion, 'No disponible')}`,
    `Dispositivo/navegador: ${getDeviceInfo()}`,
    `Fecha local: ${localDate}`,
    `Tipo de problema: ${normalizedIssueType}`,
    '',
    'Descripción:',
    normalizedDescription
  ].join('\n');

  return {
    to: getSupportEmail(),
    subject,
    body,
    planCode,
    commercialPlan,
    licenseKey: maskLicenseKey(getLicenseKey(licenseDetails)),
    companyName: getCompanyName(companyProfile),
    appVersion: normalizeText(appVersion, 'No disponible'),
    issueType: normalizedIssueType,
    description: normalizedDescription,
    deviceInfo: getDeviceInfo(),
    localDate
  };
}

export function buildSupportMailtoUrl(payload = {}) {
  const to = normalizeText(payload.to || payload.supportEmail || getSupportEmail());
  const subject = normalizeText(payload.subject);
  const body = normalizeText(payload.body);

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
