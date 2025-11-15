// src/store/useAppStore.js
import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
// Importamos las utilidades de tu proyecto original
import { isLocalStorageEnabled, normalizeDate } from '../services/utils'; 
// Importamos las funciones de Supabase
// (Asegúrate de que supabase.js cargue FingerprintJS y Supabase en tu index.html)

// --- Funciones Helper (tomadas de tu lógica en app.js) ---
// ... (getLicenseFromStorage, saveLicenseToStorage, clearLicenseFromStorage SIN CAMBIOS) ...
const getLicenseFromStorage = async () => {
  if (!isLocalStorageEnabled()) return null;
  let savedLicenseJSON = localStorage.getItem('lanzo_license');
  if (savedLicenseJSON) {
    try {
      return JSON.parse(savedLicenseJSON);
    } catch (e) {
      return null;
    }
  }
  return null;
};
const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };
  dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  localStorage.setItem('lanzo_license', JSON.stringify(dataToStore));
};
const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
};


// --- Creamos el Store ---

export const useAppStore = create((set, get) => ({
  
  // ======================================================
  // 1. EL ESTADO (SIN CAMBIOS)
  // ======================================================
  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

  // ======================================================
  // 2. LAS ACCIONES (¡MODIFICADAS!)
  // ======================================================

  /**
   * ¡MODIFICADO!
   * Ahora también intenta descargar el perfil de negocio de Supabase.
   */
  initializeApp: async () => {
    const license = await getLicenseFromStorage();

    if (!license || !license.valid) {
      set({ appStatus: 'unauthenticated' });
      return;
    }

    try {
      const serverValidation = await window.revalidateLicense(); 
      
      if (serverValidation && serverValidation.valid) {
        await saveLicenseToStorage(serverValidation); 
        set({ 
          licenseDetails: serverValidation,
          licenseStatus: serverValidation.reason || 'active',
          gracePeriodEnds: serverValidation.grace_period_ends || null
        });
        
        // --- ¡NUEVA LÓGICA DE PERFIL DE NEGOCIO! ---
        // 1. Intentamos cargar el perfil desde Supabase
        const profileResult = await window.getBusinessProfile();
        let companyData = null;

        if (profileResult.success && profileResult.data) {
            // 2. Éxito: Sincronizamos Supabase -> Local
            console.log("Perfil de negocio cargado desde Supabase.");
            // Mapeamos los nombres (ej: business_name a name)
            const mappedData = {
                id: 'company',
                name: profileResult.data.business_name,
                phone: profileResult.data.phone_number,
                address: profileResult.data.address,
                logo: profileResult.data.logo_url,
                business_type: profileResult.data.business_type
            };
            await saveData(STORES.COMPANY, mappedData); // Guardamos en IndexedDB
            companyData = mappedData;
        } else {
            // 3. Fallo (o no hay perfil): Cargamos desde IndexedDB (local)
            console.log("No hay perfil en Supabase, cargando desde local.");
            companyData = await loadData(STORES.COMPANY, 'company');
        }
        
        set({ companyProfile: companyData });
        
        // 4. Decidimos el estado de la app
        if (companyData && (companyData.name || companyData.business_name)) {
            set({ appStatus: 'ready' });
        } else {
            // Hay licencia, pero no perfil ni local ni en Supabase
            set({ appStatus: 'setup_required' });
        }
        // --- FIN DE LA NUEVA LÓGICA ---

      } else {
        // ... (lógica de 'unauthenticated') ...
        clearLicenseFromStorage();
        set({ 
          appStatus: 'unauthenticated', 
          licenseDetails: null, 
          licenseStatus: serverValidation.reason || 'expired'
        });
      }
    } catch (error) {
      // ... (Lógica de caché/sin red existente) ...
      console.warn("No se pudo revalidar la licencia (¿sin red?). Confiando en caché local.");
      
      if (license.localExpiry) {
        const localExpiryDate = normalizeDate(license.localExpiry);
        if (localExpiryDate <= new Date()) {
          clearLicenseFromStorage();
          set({ appStatus: 'unauthenticated', licenseDetails: null });
          return;
        }
      }
      
      set({ 
        licenseDetails: license,
        licenseStatus: license.reason || 'active',
        gracePeriodEnds: license.grace_period_ends || null
      });
      // Cargamos el perfil local si no hay red
      const companyData = await loadData(STORES.COMPANY, 'company');
      if (companyData && companyData.name) {
        set({ companyProfile: companyData, appStatus: 'ready' });
      } else {
        set({ appStatus: 'setup_required' });
      }
    }
  },

  // ... (handleLogin y handleFreeTrial SIN CAMBIOS) ...
  handleLogin: async (licenseKey) => {
    try {
      const result = await window.activateLicense(licenseKey); 
      if (result.valid) {
        await saveLicenseToStorage(result.details);
        set({ licenseDetails: result.details, appStatus: 'setup_required' });
        return { success: true };
      } else {
        return { success: false, message: result.message || 'Licencia no válida' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  },
  handleFreeTrial: async () => {
    try {
      const result = await window.createFreeTrial(); 
      if (result.success && result.details) {
        await saveLicenseToStorage(result.details);
        set({ licenseDetails: result.details, appStatus: 'setup_required' });
        return { success: true };
      } else {
        return { success: false, message: result.error || 'No se pudo crear la prueba gratuita.' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  /**
   * ¡MODIFICADO!
   * Ahora guarda en Supabase Y en IndexedDB.
   */
  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) {
        console.error("No hay clave de licencia para guardar el perfil");
        return;
    }

    try {
        // 1. Guardamos en Supabase
        // (setupData tiene name, phone, etc., que 'saveBusinessProfile' ya sabe mapear)
        await window.saveBusinessProfile(licenseKey, setupData); //
        console.log("Perfil de negocio guardado en Supabase.");

        // 2. Guardamos en IndexedDB (local)
        const companyData = { id: 'company', ...setupData };
        await saveData(STORES.COMPANY, companyData);
        
        set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) {
        console.error("Error al guardar setup:", error);
    }
  },

  /**
   * ¡MODIFICADO!
   * Ahora guarda en Supabase Y en IndexedDB.
   */
  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) {
        console.error("No hay clave de licencia para actualizar el perfil");
        return;
    }

    try {
        // 1. Guardamos en Supabase
        // (companyData tiene id: 'company', name, phone... 'saveBusinessProfile' lo maneja)
        await window.saveBusinessProfile(licenseKey, companyData); //
        console.log("Perfil de negocio actualizado en Supabase.");

        // 2. Guardamos en IndexedDB (local)
        await saveData(STORES.COMPANY, companyData);
        set({ companyProfile: companyData });
    } catch (error) {
        console.error("Error al actualizar perfil:", error);
    }
  },

  logout: async () => {
    // ... (logout SIN CAMBIOS) ...
    try {
      const licenseKey = get().licenseDetails?.license_key;
      if (licenseKey) {
        await window.deactivateCurrentDevice(licenseKey); 
        console.log("Dispositivo desactivado del servidor.");
      }
    } catch (error) {
      console.error("Error al desactivar dispositivo en servidor:", error);
    }
    
    clearLicenseFromStorage();
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null
    });
  }
}));