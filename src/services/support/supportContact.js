const PLAN_NAMES_BY_CODE = Object.freeze({
  free_trial: 'Lanzo Local',
  basic_monthly: 'Lanzo Basico Legacy',
  pro_monthly: 'Lanzo Nube'
});

const normalizeText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const getSupportEmail = () => normalizeText(import.meta.env?.VITE_SUPPORT_EMAIL);

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
