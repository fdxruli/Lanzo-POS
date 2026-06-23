import { loadData, saveData, STORES } from '../../services/database';
import Logger from '../../services/Logger';
import {
  getBusinessProfile,
  saveBusinessProfile,
  uploadFile
} from '../../services/supabase';
import { normalizeBusinessTypes as normalizeCanonicalBusinessTypes } from '../../utils/businessType';

let _profileLoadGeneration = 0;

const LEGACY_COMPANY_KEY = 'company';

const getProfileCacheKey = (licenseKey) => `company:${licenseKey}`;

const normalizeBusinessTypes = (businessType) => {
  let rawTypes = [];

  if (Array.isArray(businessType)) {
    rawTypes = businessType.filter(Boolean);
  } else if (typeof businessType === 'string') {
    rawTypes = businessType
      .replace(/[{}"]/g, '')
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

  return scopedProfile;
};

export const createProfileSlice = (set, get) => ({
  companyProfile: null,
  profileImportCandidate: null,

  _loadProfile: async (licenseKey) => {
    const generation = ++_profileLoadGeneration;
    let companyData = null;
    let profileMissingRemotely = false;
    let profileImportCandidate = null;

    if (licenseKey && navigator.onLine) {
      try {
        const profileResult = await getBusinessProfile(licenseKey);

        if (generation !== _profileLoadGeneration) {
          Logger.log(`[Profile] Carga #${generation} descartada`);
          return;
        }

        if (profileResult?.success && profileResult.data) {
          companyData = buildCompanyData(profileResult.data, licenseKey);
          companyData = await saveProfileCache(licenseKey, companyData);

          if (generation !== _profileLoadGeneration) {
            Logger.log(`[Profile] Carga #${generation} descartada tras guardar local`);
            return;
          }
        } else if (
          profileResult?.code === 'PROFILE_NOT_FOUND' ||
          profileResult?.reason === 'PROFILE_NOT_FOUND'
        ) {
          profileMissingRemotely = true;
        }
      } catch (error) {
        Logger.warn('[AppStore] Fallo carga perfil online:', error);
      }
    }

    if (!companyData && licenseKey && !profileMissingRemotely) {
      try {
        const cachedProfile = await loadData(STORES.COMPANY, getProfileCacheKey(licenseKey));

        if (generation !== _profileLoadGeneration) {
          Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
          return;
        }

        if (cachedProfile?.license_key === licenseKey) {
          companyData = buildCompanyData(cachedProfile, licenseKey);
        }
      } catch (error) {
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
        Logger.warn('[AppStore] Fallo leyendo perfil legado:', error);
      }
    }

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
  },

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;

    try {
      let logoUrl = setupData.logo_url || setupData.logo || null;

      if (setupData.logo instanceof File) {
        logoUrl = await uploadFile(setupData.logo, 'logo');
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

    try {
      const nextCompanyData = { ...companyData };

      if (nextCompanyData.logo instanceof File) {
        const logoUrl = await uploadFile(nextCompanyData.logo, 'logo');
        nextCompanyData.logo = logoUrl;
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
