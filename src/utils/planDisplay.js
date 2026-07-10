const PLAN_DISPLAY_BY_CODE = Object.freeze({
  free_trial: {
    name: 'Lanzo Local',
    shortName: 'Local',
    priceLabel: '$0 MXN'
  },
  basic_monthly: {
    name: 'Lanzo Básico Legacy',
    shortName: 'Básico Legacy',
    priceLabel: '$0 MXN'
  },
  pro_monthly: {
    name: 'Lanzo Nube',
    shortName: 'Nube',
    priceLabel: '$129 MXN/mes'
  }
});

const normalizeText = (value) => String(value || '').trim();

const getPlanCode = (licenseDetails = {}) => normalizeText(
  licenseDetails?.plan_code ||
  licenseDetails?.details?.plan_code ||
  licenseDetails?.plan ||
  licenseDetails?.subscription_plan ||
  licenseDetails?.product_code
).toLowerCase();

const getFeatures = (licenseDetails = {}) => (
  licenseDetails?.features ||
  licenseDetails?.details?.features ||
  {}
);

const getPlanDisplayByDetails = (licenseDetails = {}) => {
  const planCode = getPlanCode(licenseDetails);
  if (PLAN_DISPLAY_BY_CODE[planCode]) return PLAN_DISPLAY_BY_CODE[planCode];

  if (getFeatures(licenseDetails)?.realtime_license_sync === true) {
    return PLAN_DISPLAY_BY_CODE.pro_monthly;
  }

  return PLAN_DISPLAY_BY_CODE.free_trial;
};

const getShortNameFromName = (planName) => {
  const normalized = normalizeText(planName).toLowerCase();
  if (normalized.includes('nube')) return 'Nube';
  if (normalized.includes('local')) return 'Local';
  if (normalized.includes('básico') || normalized.includes('basico')) return 'Básico Legacy';
  return planName;
};

export const getCommercialPlanName = (licenseDetails = {}) => {
  const explicitPlanName = normalizeText(licenseDetails?.plan_name || licenseDetails?.details?.plan_name);
  if (explicitPlanName) return explicitPlanName;

  return getPlanDisplayByDetails(licenseDetails).name;
};

export const getCommercialPlanShortName = (licenseDetails = {}) => {
  const explicitPlanName = normalizeText(licenseDetails?.plan_name || licenseDetails?.details?.plan_name);
  if (explicitPlanName) return getShortNameFromName(explicitPlanName);

  return getPlanDisplayByDetails(licenseDetails).shortName;
};

export const getCommercialPlanPriceLabel = (licenseDetails = {}) => (
  getPlanDisplayByDetails(licenseDetails).priceLabel
);
