import { isLocalStorageEnabled, safeLocalStorageSet } from './utils';
import Logger from './Logger';

const _ui_render_config_v2 = import.meta.env.VITE_LICENSE_SALT;

export const stableStringify = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return JSON.stringify(
      obj.map((item) =>
        typeof item === 'object' && item !== null
          ? JSON.parse(stableStringify(item))
          : item
      )
    );
  }

  const sortedKeys = Object.keys(obj).sort();
  const sortedObj = sortedKeys.reduce((result, key) => {
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      result[key] = JSON.parse(stableStringify(value));
    } else {
      result[key] = value;
    }
    return result;
  }, {});

  return JSON.stringify(sortedObj);
};

export const generateSignature = (data) => {
  const stringData = stableStringify(data);
  let hash = 0;
  if (stringData.length === 0) return hash;
  const mixedString = stringData + _ui_render_config_v2;
  for (let i = 0; i < mixedString.length; i++) {
    const char = mixedString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return hash.toString(16);
};

export const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };

  if (!dataToStore.localExpiry) {
    dataToStore.localExpiry = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  const signature = generateSignature(dataToStore);
  const packageToStore = { data: dataToStore, signature };
  const saved = safeLocalStorageSet('lanzo_license', JSON.stringify(packageToStore));

  if (!saved) {
    Logger.warn('No se pudo persistir la licencia por falta de espacio.');
  }
};

export const getLicenseFromStorage = async () => {
  if (!isLocalStorageEnabled()) return null;
  const storedString = localStorage.getItem('lanzo_license');
  if (!storedString) return null;

  try {
    const parsedPackage = JSON.parse(storedString);
    if (!parsedPackage.data || !parsedPackage.signature) {
      return null;
    }

    const expectedSignature = generateSignature(parsedPackage.data);
    if (parsedPackage.signature !== expectedSignature) {
      Logger.error('ALERTA DE SEGURIDAD: Firma de licencia manipulada o corrupta.');
      clearLicenseFromStorage();
      return null;
    }

    return parsedPackage.data;
  } catch (e) {
    Logger.error('Error leyendo licencia local:', e);
    return null;
  }
};

export const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
};
