import { isLocalStorageEnabled, safeLocalStorageSet } from './utils';
import Logger from './Logger';
import {
  getConfiguredOfflineEntitlementPublicKey,
  verifyOfflineEntitlement,
  OFFLINE_ENTITLEMENT_TRUST
} from './offlineEntitlement';

const STORAGE_SCHEMA_VERSION = 2;

const resolveOfflineEntitlement = (packageData) => (
  packageData?.offline_entitlement || packageData?.data?.offline_entitlement || null
);

export const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };

  // A browser cache is not an authority. Only a server-issued Ed25519
  // entitlement can make the cached cloud state verifiable offline. When the
  // issuer is not deployed yet, persist an explicit transitional marker.
  const packageToStore = {
    storage_schema_version: STORAGE_SCHEMA_VERSION,
    data: dataToStore,
    offline_entitlement: dataToStore.offline_entitlement || null,
    offline_trust: OFFLINE_ENTITLEMENT_TRUST.UNTRUSTED_CACHE
  };
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
    if (!parsedPackage.data) {
      return null;
    }

    if (parsedPackage.storage_schema_version !== STORAGE_SCHEMA_VERSION) {
      // Legacy hashes were never cryptographic signatures. Preserve the
      // Local/Free bootstrap path, but make the lack of authenticity explicit
      // so no future cloud authorization can treat it as proof.
      return {
        ...parsedPackage.data,
        offline_trust: OFFLINE_ENTITLEMENT_TRUST.LEGACY_UNTRUSTED
      };
    }

    const entitlement = resolveOfflineEntitlement(parsedPackage);
    if (entitlement) {
      const verified = await verifyOfflineEntitlement(
        entitlement,
        getConfiguredOfflineEntitlementPublicKey()
      );
      if (!verified) {
        Logger.error('La acreditación offline firmada no es válida.');
        clearLicenseFromStorage();
        return null;
      }
      return {
        ...parsedPackage.data,
        offline_trust: OFFLINE_ENTITLEMENT_TRUST.SIGNED
      };
    }

    return {
      ...parsedPackage.data,
      offline_trust: OFFLINE_ENTITLEMENT_TRUST.UNTRUSTED_CACHE
    };
  } catch (e) {
    Logger.error('Error leyendo licencia local:', e);
    return null;
  }
};

export const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
};
