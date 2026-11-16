export const FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY = 'lanzo:free-local-setup-continuity:v1';

const normalizeLicenseKey = (licenseKey) => (
  typeof licenseKey === 'string' && licenseKey.trim() ? licenseKey.trim() : null
);

const getBrowserStorage = () => {
  try {
    if (typeof window === 'undefined') return null;
    const origin = window.location?.origin;
    const storage = window.localStorage;
    if (!origin || origin === 'null' || !storage) return null;
    return { origin, storage };
  } catch {
    return null;
  }
};

export const markFreeLocalSetupContinuity = (licenseKey) => {
  const normalizedLicenseKey = normalizeLicenseKey(licenseKey);
  const browser = getBrowserStorage();
  if (!normalizedLicenseKey || !browser) return false;

  const marker = {
    version: 1,
    licenseKey: normalizedLicenseKey,
    origin: browser.origin
  };
  const serialized = JSON.stringify(marker);

  try {
    browser.storage.setItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY, serialized);
    return browser.storage.getItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
};

export const hasFreeLocalSetupContinuity = (licenseKey) => {
  const normalizedLicenseKey = normalizeLicenseKey(licenseKey);
  const browser = getBrowserStorage();
  if (!normalizedLicenseKey || !browser) return false;

  try {
    const serialized = browser.storage.getItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY);
    if (!serialized) return false;
    const marker = JSON.parse(serialized);
    return marker?.version === 1
      && marker.licenseKey === normalizedLicenseKey
      && marker.origin === browser.origin;
  } catch {
    return false;
  }
};

export const clearFreeLocalSetupContinuity = (licenseKey) => {
  const normalizedLicenseKey = normalizeLicenseKey(licenseKey);
  const browser = getBrowserStorage();
  if (!normalizedLicenseKey || !browser) return false;

  try {
    const serialized = browser.storage.getItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY);
    if (!serialized) return true;
    const marker = JSON.parse(serialized);
    if (marker?.version !== 1
      || marker.licenseKey !== normalizedLicenseKey
      || marker.origin !== browser.origin) return false;

    browser.storage.removeItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY);
    return browser.storage.getItem(FREE_LOCAL_SETUP_CONTINUITY_STORAGE_KEY) === null;
  } catch {
    return false;
  }
};
