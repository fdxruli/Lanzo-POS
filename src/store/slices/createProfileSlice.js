import { loadData, saveData, STORES } from '../../services/database';
import Logger from '../../services/Logger';
import {
  getBusinessProfile,
  saveBusinessProfile
} from '../../services/supabase';
import {
  IMAGE_UPLOAD_PURPOSES,
  uploadImageFile
} from '../../services/storage/imageUploadService';
import { normalizeBusinessTypes as normalizeCanonicalBusinessTypes } from '../../utils/businessType';
import {
  PROFILE_LAST_LICENSE_KEY,
  PROFILE_LAST_LOAD_KEY,
  PROFILE_REFRESH_TTL_MS
} from './license/licenseConstants';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError
} from '../../services/tenant/localTenantGuard';

let _profileLoadGeneration = 0;
let _profileSessionGeneration = 0;

const isProfileLoadCurrent = (generation, sessionGeneration) => (
  generation === _profileLoadGeneration && sessionGeneration === _profileSessionGeneration
);

const LEGACY_COMPANY_KEY = 'company';

const getProfileCacheKey = (licenseKey) => `company:${licenseKey}`;

const normalizeBusinessTypes = (businessType) => {
  let rawTypes = [];

  if (Array.isArray(businessType)) {
    rawTypes = businessType.filter(Boolean);
  } else if (typeof businessType === 'string') {
    rawTypes = businessType
      .replace(/[{}"]+/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return rawTypes.length > 0 ? normalizeCanonicalBusinessTypes(rawTypes) : [];
};

const hasUsableProfile = (profile) => {
  const name = profile?.name || profile?.business_name || '';
  return name.trim().length > 0 && normalizeBusinessTypes(profile?.business_type).length > 0;
};

const buildCompanyData = (rawProfile, licenseKey, id = getProfileCacheKey(licenseKey)) => ({
  id,
  profile_id: rawProfile?.profile_id || rawProfile?.id || null,
  license_key: rawProfile?.license_key || licenseKey,
  name: rawProfile?.business_name || rawProfile?.name || '',
  phone: rawProfile?.phone_number || rawProfile?.phone || '',
  address: rawProfile?.address || '',
  logo: rawProfile?.logo_url || rawProfile?.logo || '',
  business_type: normalizeBusinessTypes(rawProfile?.business_type)
});

const getLastProfileLoadMeta = (licenseKey) => {
  try {
    const lastLoad = Number(localStorage.getItem(PROFILE_LAST_LOAD_KEY) || 0);
    const lastLicenseKey = localStorage.getItem(PROFILE_LAST_LICENSE_KEY) || null;

    return {
      lastLoad: Number.isFinite(lastLoad) ? lastLoad : 0,
      lastLicenseKey,
      isFresh:
        lastLicenseKey === licenseKey &&
        lastLoad > 0 &&
        Date.now() - lastLoad < PROFILE_REFRESH_TTL_MS
    };
  } catch {
    return { lastLoad: 0, lastLicenseKey: null, isFresh: false };
  }
};

const markProfileLoaded = (licenseKey) => {
  try {
    localStorage.setItem(PROFILE_LAST_LOAD_KEY, Date.now().toString());
    localStorage.setItem(PROFILE_LAST_LICENSE_KEY, licenseKey || '');
  } catch {
    // Best effort: el TTL solo optimiza llamadas, no debe romper el flujo.
  }
};

const saveProfileCache = async (licenseKey, companyData) => {
  const scopedProfile = {
    ...companyData,
    id: getProfileCacheKey(licenseKey),
    license_key: licenseKey
  };

  await saveData(STORES.COMPANY, scopedProfile);
  await saveData(STORES.COMPANY, {
    ...scopedProfile,
    id: LEGACY_COMPANY_KEY
  });

  markProfileLoaded(licenseKey);

  return scopedProfile;
};

const applyProfileState = (set, get, companyData, profileImportCandidate) => {
  set({ companyProfile: companyData, profileImportCandidate });

  if (hasUsableProfile(companyData)) {
    Logger.log('[AppStore] Aplicacion lista (ready)');
    set({ appStatus: 'ready' });
  } else if (get().currentDeviceRole === 'staff') {
    Logger.warn('[Profile] Staff sin perfil local/remoto usable; se permite entrada sin Setup.');
    set({ appStatus: 'ready' });
  } else {
    Logger.log('[AppStore] Requiere configuracion inicial');
    set({ appStatus: 'setup_required' });
  }
};

export const createProfileSlice = (set, get) => ({
  companyProfile: null,
  profileImportCandidate: null,

  _invalidateProfileLoads: () => {
    _profileSessionGeneration += 1;
  },

  _loadProfile: async (licenseKey, options = {}) => {
    const {
      forceRemote = false,
      refreshProfile = false,
      reason = 'manual'
    } = options || {};
    const sessionGeneration = _profileSessionGeneration;

    await assertLocalTenantSyncAccess(
      { license_key: licenseKey },
      { reason: `profile_${reason}` }
    );
    if (sessionGeneration !== _profileSessionGeneration) return null;
    get().refreshTenantUiPreferences?.();
    get().refreshDriveSession?.();

    const stateAtLoad = get();
    const isAuthenticatedStaffTransition =
      stateAtLoad.currentDeviceRole === 'staff' &&
      Boolean(stateAtLoad.currentStaffUser) &&
      stateAtLoad.appStatus === 'staff_login_required';
    const generation = ++_profileLoadGeneration;
    const shouldForceRemote = Boolean(
      forceRemote || refreshProfile || isAuthenticatedStaffTransition
    );
    const cacheMeta = getLastProfileLoadMeta(licenseKey);
    const currentProfile = stateAtLoad.companyProfile;

    let companyData = null;
    let profileMissingRemotely = false;
    let profileImportCandidate = null;

    if (!licenseKey) {
      applyProfileState(set, get, null, null);
      return null;
    }

    if (
      !shouldForceRemote &&
      cacheMeta.isFresh &&
      currentProfile?.license_key === licenseKey &&
      hasUsableProfile(currentProfile)
    ) {
      Logger.log(`[Profile] Usando perfil en memoria; TTL vigente (${reason}).`);
      return currentProfile;
    }

    try {
      const cachedProfile = await loadData(STORES.COMPANY, getProfileCacheKey(licenseKey));

      if (!isProfileLoadCurrent(generation, sessionGeneration)) {
        Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
        return null;
      }

      if (cachedProfile?.license_key === licenseKey) {
        companyData = buildCompanyData(cachedProfile, licenseKey);

        if (!shouldForceRemote && cacheMeta.isFresh && hasUsableProfile(companyData)) {
          Logger.log(`[Profile] Usando perfil local; TTL vigente (${reason}).`);
          applyProfileState(set, get, companyData, null);
          return companyData;
        }
      }
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[AppStore] Fallo carga perfil local:', error);
    }

    if (licenseKey && navigator.onLine && (!companyData || shouldForceRemote || !cacheMeta.isFresh)) {
      try {
        Logger.log(`[Profile] Refrescando perfil remoto (${reason}).`);
        const profileResult = await getBusinessProfile(licenseKey);

        if (!isProfileLoadCurrent(generation, sessionGeneration)) {
          Logger.log(`[Profile] Carga #${generation} descartada`);
          return null;
        }

        if (profileResult?.success && profileResult.data) {
          const responseIdentity = profileResult.data;
          if (
            responseIdentity.license_key
            || responseIdentity.licenseKey
            || responseIdentity.license_id
            || responseIdentity.licenseId
            || responseIdentity.details?.license_key
            || responseIdentity.details?.licenseKey
            || responseIdentity.details?.license_id
            || responseIdentity.details?.licenseId
          ) {
            await assertLocalTenantSyncAccess(responseIdentity, {
              reason: 'profile_remote_response_identity'
            });
          }
          companyData = buildCompanyData(profileResult.data, licenseKey);
          companyData = await saveProfileCache(licenseKey, companyData);

          if (!isProfileLoadCurrent(generation, sessionGeneration)) {
            Logger.log(`[Profile] Carga #${generation} descartada tras guardar local`);
            return null;
          }
        } else if (
          profileResult?.code === 'PROFILE_NOT_FOUND' ||
          profileResult?.reason === 'PROFILE_NOT_FOUND'
        ) {
          profileMissingRemotely = true;
        }
      } catch (error) {
        if (isLocalTenantAccessError(error)) throw error;
        Logger.warn('[AppStore] Fallo carga perfil online:', error);
      }
    }

    if (!companyData && licenseKey && !profileMissingRemotely) {
      try {
        const cachedProfile = await loadData(STORES.COMPANY, getProfileCacheKey(licenseKey));

        if (!isProfileLoadCurrent(generation, sessionGeneration)) {
          Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
          return null;
        }

        if (cachedProfile?.license_key === licenseKey) {
          companyData = buildCompanyData(cachedProfile, licenseKey);
        }
      } catch (error) {
        if (isLocalTenantAccessError(error)) throw error;
        Logger.warn('[AppStore] Fallo carga perfil local:', error);
      }
    }

    if (!companyData) {
      try {
        const legacyProfile = await loadData(STORES.COMPANY, LEGACY_COMPANY_KEY);
        const belongsToCurrentLicense = legacyProfile?.license_key === licenseKey;

        if (!belongsToCurrentLicense && hasUsableProfile(legacyProfile)) {
          profileImportCandidate = buildCompanyData(
            legacyProfile,
            legacyProfile.license_key || 'legacy',
            'profile-import-candidate'
          );
        }
      } catch (error) {
        if (isLocalTenantAccessError(error)) throw error;
        Logger.warn('[AppStore] Fallo leyendo perfil legado:', error);
      }
    }

    if (!isProfileLoadCurrent(generation, sessionGeneration)) {
      Logger.log(`[Profile] Carga #${generation} descartada antes de publicar estado`);
      return null;
    }

    applyProfileState(set, get, companyData, profileImportCandidate);
    return companyData;
  },

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    const sessionGeneration = _profileSessionGeneration;

    try {
      let logoUrl = setupData.logo_url || setupData.logo || null;

      if (setupData.logo instanceof File) {
        const uploadResult = await uploadImageFile({
          file: setupData.logo,
          licenseKey,
          purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO
        });
        logoUrl = uploadResult.publicUrl;
      }

      const profileData = {
        ...setupData,
        logo: logoUrl,
        business_type: normalizeBusinessTypes(setupData.business_type)
      };

      const saveResult = await saveBusinessProfile(licenseKey, profileData);
      if (!saveResult?.success) {
        throw new Error(
          saveResult?.message ||
          saveResult?.error ||
          'No se pudo guardar el perfil del negocio.'
        );
      }

      const companyData = await saveProfileCache(
        licenseKey,
        buildCompanyData(profileData, licenseKey)
      );

      if (sessionGeneration !== _profileSessionGeneration) return null;

      set({
        companyProfile: companyData,
        profileImportCandidate: null,
        appStatus: 'ready'
      });
    } catch (error) {
      Logger.error('Error en setup:', error);
      throw error;
    }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    const sessionGeneration = _profileSessionGeneration;

    try {
      const nextCompanyData = { ...companyData };

      if (nextCompanyData.logo instanceof File) {
        const uploadResult = await uploadImageFile({
          file: nextCompanyData.logo,
          licenseKey,
          purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO
        });
        nextCompanyData.logo = uploadResult.publicUrl;
      }

      nextCompanyData.business_type = normalizeBusinessTypes(nextCompanyData.business_type);

      const saveResult = await saveBusinessProfile(licenseKey, nextCompanyData);
      if (!saveResult?.success) {
        throw new Error(
          saveResult?.message ||
          saveResult?.error ||
          'No se pudo guardar el perfil del negocio.'
        );
      }

      const scopedCompanyData = await saveProfileCache(
        licenseKey,
        buildCompanyData(nextCompanyData, licenseKey)
      );

      if (sessionGeneration !== _profileSessionGeneration) return null;

      set({ companyProfile: scopedCompanyData });
    } catch (error) {
      Logger.error('Error actualizando perfil:', error);
      throw error;
    }
  },

  dismissProfileImportCandidate: () => {
    set({ profileImportCandidate: null });
  }
});
