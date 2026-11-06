// 1. Aviso global informativo. La fecha publicada se ancla al commit que
// introdujo update_soporte_07 (2026-03-10 22:38:42 -06:00); no depende de que
// exista una clave de licencia en localStorage. Los avisos nuevos deben
// incluir publishedAt; expiresAt:null queda reservado para retiro manual,
// mientras que los avisos temporales (por ejemplo, mantenimiento) deben
// declarar una fecha de expiración.
export const GLOBAL_ALERT = {
  active: false,
  id: 'update_soporte_07',
  title: 'Actualización completada',
  message: 'Las mejoras recientes del módulo de ventas ya están disponibles. No necesitas realizar ninguna acción. Si notas algún comportamiento inesperado, puedes comunicarte con soporte desde Lanzo.',
  actionLabel: 'Ver soporte',
  actionLink: '/acerca-de',
  severity: 'info',
  isDismissible: true,
  publishedAt: '2026-03-11T04:38:42.000Z',
  // No hay una fecha de expiración autoritativa en el repositorio. El aviso
  // puede retirarse de forma explícita con active:false sin inventar una fecha.
  expiresAt: null,
};

const getValidTimestamp = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const getLicenseCreatedAt = (licenseDetails = {}) => {
  const candidates = [
    licenseDetails.created_at,
    licenseDetails.createdAt,
    licenseDetails.details?.created_at,
    licenseDetails.details?.createdAt,
  ];

  return candidates.map(getValidTimestamp).find((timestamp) => timestamp !== null) || null;
};

export const getGlobalAlertStorageKey = (alert = GLOBAL_ALERT) => (
  alert?.id ? `lanzo_alert_${alert.id}` : null
);

export const hasAcknowledgedGlobalAlert = (
  alert = GLOBAL_ALERT,
  storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null
) => {
  const key = getGlobalAlertStorageKey(alert);
  if (!key || !storage?.getItem) return false;

  try {
    return storage.getItem(key) === 'true';
  } catch {
    return false;
  }
};

export const acknowledgeGlobalAlert = (
  alert = GLOBAL_ALERT,
  storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null
) => {
  const key = getGlobalAlertStorageKey(alert);
  if (!key || !storage?.setItem) return false;

  try {
    storage.setItem(key, 'true');
    return true;
  } catch {
    return false;
  }
};

export const isGlobalAlertEligible = (
  alert = GLOBAL_ALERT,
  {
    licenseDetails = null,
    acknowledged = false,
    now = Date.now(),
  } = {}
) => {
  if (!alert?.active || !alert.id || acknowledged) return false;

  const publishedAt = getValidTimestamp(alert.publishedAt);
  const licenseCreatedAt = getLicenseCreatedAt(licenseDetails);
  const hasExpiry = typeof alert.expiresAt !== 'undefined' && alert.expiresAt !== null;
  const expiresAt = hasExpiry ? getValidTimestamp(alert.expiresAt) : null;

  // Si falta una fecha confiable, no abrir un aviso histórico automáticamente.
  if (publishedAt === null || licenseCreatedAt === null) return false;
  if (hasExpiry && expiresAt === null) return false;
  if (Number.isFinite(expiresAt) && now >= expiresAt) return false;

  return licenseCreatedAt <= publishedAt;
};
