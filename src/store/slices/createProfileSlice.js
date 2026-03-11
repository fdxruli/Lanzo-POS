import { loadData, saveData, STORES } from '../../services/database';
import Logger from '../../services/Logger';
import {
  getBusinessProfile,
  saveBusinessProfile,
  uploadFile
} from '../../services/supabase';

// Variable de módulo para controlar race conditions en carga de perfil.
// Si se disparan dos _loadProfile simultáneos, solo el más reciente escribe al store.
let _profileLoadGeneration = 0;

export const createProfileSlice = (set, get) => ({
  companyProfile: null,

  _loadProfile: async (licenseKey) => {
    // 1. Tomamos el número de esta generación antes de cualquier await
    const generation = ++_profileLoadGeneration;

    let companyData = null;

    if (licenseKey && navigator.onLine) {
      try {
        const profileResult = await getBusinessProfile(licenseKey);

        // 2. Después de cada await, verificamos si seguimos siendo la llamada más reciente
        if (generation !== _profileLoadGeneration) {
          Logger.log(`[Profile] Carga #${generation} descartada (superada por #${_profileLoadGeneration})`);
          return;
        }

        if (profileResult.success && profileResult.data) {
          companyData = {
            id: 'company',
            name: profileResult.data.business_name || profileResult.data.name,
            phone: profileResult.data.phone_number || profileResult.data.phone,
            address: profileResult.data.address,
            logo: profileResult.data.logo_url || profileResult.data.logo,
            business_type: profileResult.data.business_type
          };
          await saveData(STORES.COMPANY, companyData);

          // 3. Verificamos de nuevo tras el segundo await
          if (generation !== _profileLoadGeneration) {
            Logger.log(`[Profile] Carga #${generation} descartada tras guardar local`);
            return;
          }
        }
      } catch (e) {
        Logger.warn('[AppStore] Fallo carga perfil online:', e);
      }
    }

    if (!companyData) {
      try {
        companyData = await loadData(STORES.COMPANY, 'company');

        // 4. Verificamos tras cargar de IndexedDB también
        if (generation !== _profileLoadGeneration) {
          Logger.log(`[Profile] Carga #${generation} descartada tras leer IndexedDB`);
          return;
        }
      } catch (e) {
        Logger.warn('[AppStore] Fallo carga perfil local:', e);
      }
    }

    // 5. Solo llegamos aquí si somos la llamada más reciente — escribimos al store
    set({ companyProfile: companyData });

    if (companyData && (companyData.name || companyData.business_name)) {
      Logger.log('[AppStore] Aplicación lista (ready)');
      set({ appStatus: 'ready' });
    } else {
      Logger.log('[AppStore] Requiere configuración inicial');
      set({ appStatus: 'setup_required' });
    }
  },

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;

    try {
      let logoUrl = null;
      if (setupData.logo instanceof File) {
        logoUrl = await uploadFile(setupData.logo, 'logo');
      }

      const profileData = { ...setupData, logo: logoUrl };
      await saveBusinessProfile(licenseKey, profileData);

      const companyData = { id: 'company', ...profileData };
      await saveData(STORES.COMPANY, companyData);

      set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) {
      Logger.error('Error en setup:', error);
    }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;

    try {
      if (companyData.logo instanceof File) {
        const logoUrl = await uploadFile(companyData.logo, 'logo');
        companyData.logo = logoUrl;
      }

      await saveBusinessProfile(licenseKey, companyData);
      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData });
    } catch (error) {
      Logger.error('Error actualizando perfil:', error);
    }
  }
});