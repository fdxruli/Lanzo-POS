const PLAN_NAMES_BY_CODE = Object.freeze({
  free_trial: 'Lanzo Local',
  basic_monthly: 'Lanzo Basico Legacy',
  pro_monthly: 'Lanzo Nube'
});

const DEFAULT_SUPPORT_EMAIL = 'contacto.entrealas@gmail.com';

const normalizeText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text && text !== 'undefined' ? text : fallback;
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

const redactSensitiveText = (value) => String(value || '')
  .replace(/\b(license(?:\s|_|-)?key|licencia|token|jwt|password|contrase(?:ñ|n)a|pin)\s*[:=]\s*[^\s,;]+/gi, '$1: [redactado]')
  .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redactado]');

const getRecoveryEnvironment = (environment = {}) => {
  const browser = environment.navigator || globalThis.navigator;
  const pageLocation = environment.location || globalThis.location;
  const now = environment.now instanceof Date ? environment.now : new Date();

  return {
    appVersion: normalizeText(environment.appVersion ?? import.meta.env?.VITE_APP_VERSION, 'No disponible'),
    userAgent: normalizeText(environment.userAgent ?? browser?.userAgent, 'No disponible'),
    platform: normalizeText(environment.platform ?? browser?.platform, 'No disponible'),
    language: normalizeText(environment.language ?? browser?.language, 'No disponible'),
    online: typeof environment.online === 'boolean'
      ? environment.online
      : browser?.onLine !== false,
    path: normalizeText(environment.path ?? pageLocation?.pathname, 'No disponible'),
    timestamp: now.toISOString()
  };
};

/**
 * Builds the bounded, privacy-safe report for controlled IndexedDB recovery.
 * It intentionally accepts recovery metadata only: never database contents,
 * license credentials, tenant identifiers, or sync payloads.
 */
export function buildDatabaseRecoverySupportReport(recovery = {}, environment = {}) {
  const details = getRecoveryEnvironment(environment);
  const affectedStores = Array.isArray(recovery.affectedStores)
    ? recovery.affectedStores.filter((store) => typeof store === 'string' && store.length > 0)
    : [];
  const optionalVersions = [
    Number.isFinite(recovery.detectedNativeVersion)
      ? `Versión local detectada: ${recovery.detectedNativeVersion}`
      : null,
    Number.isFinite(recovery.expectedNativeVersion)
      ? `Versión compatible con esta instalación: ${recovery.expectedNativeVersion}`
      : null
  ].filter(Boolean);

  return [
    'REPORTE TÉCNICO DE RECUPERACIÓN LOCAL - LANZO POS',
    '',
    `Código de diagnóstico: ${normalizeText(recovery.errorCode, 'No disponible')}`,
    `Estado de recuperación: ${normalizeText(recovery.status, 'No disponible')}`,
    `Clasificación/mensaje: ${redactSensitiveText(normalizeText(recovery.message, 'No disponible'))}`,
    `Base local: ${getSafeDatabaseFamily(recovery.databaseName)}`,
    ...optionalVersions,
    `Requiere migración: ${recovery.requiresMigration === true ? 'Sí' : 'No'}`,
    `Reintentable: ${recovery.isRetryable === false ? 'No' : 'Sí'}`,
    ...(affectedStores.length > 0 ? [`Stores afectados: ${affectedStores.join(', ')}`] : []),
    '',
    `Versión de Lanzo: ${details.appVersion}`,
    `Navegador/entorno: ${details.userAgent}`,
    `Plataforma: ${details.platform}`,
    `Idioma: ${details.language}`,
    `Estado de red: ${details.online ? 'Online' : 'Offline'}`,
    `Ruta: ${details.path}`,
    `Fecha y hora: ${details.timestamp}`,
    '',
    'Reporte generado automáticamente. No incluye datos sensibles ni contenido de negocio.'
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

const getCompanyName = (companyProfile = {}) => normalizeText(
  companyProfile?.name ||
  companyProfile?.business_name ||
  companyProfile?.commercial_name,
  'Negocio no configurado'
);

const getDeviceInfo = () => {
  if (typeof navigator === 'undefined') return 'No disponible';
  return normalizeText(navigator.userAgent, 'No disponible');
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
    `Licencia: ${getLicenseKey(licenseDetails)}`,
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
    licenseKey: getLicenseKey(licenseDetails),
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
