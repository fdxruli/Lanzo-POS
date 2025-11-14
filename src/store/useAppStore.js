// src/store/useAppStore.js
import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
// Importamos las utilidades de tu proyecto original
import { isLocalStorageEnabled, normalizeDate } from '../services/utils'; 
// Importamos las funciones de Supabase
// (Asegúrate de que supabase.js cargue FingerprintJS y Supabase en tu index.html)

// --- Funciones Helper (tomadas de tu lógica en app.js) ---

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
  // (Aquí iría tu lógica de fallback a IndexedDB si la añades)
  return null;
};

const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };
  // Añadimos una expiración local de 30 días
  dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  localStorage.setItem('lanzo_license', JSON.stringify(dataToStore));
  // (Aquí iría tu lógica de guardado en IndexedDB)
};

const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
  // (Aquí iría tu lógica de borrado de IndexedDB)
};


// --- Creamos el Store ---

export const useAppStore = create((set, get) => ({
  
  // ======================================================
  // 1. EL ESTADO
  // ======================================================
  
  /**
   * 'loading': Revisando si hay licencia
   * 'unauthenticated': No hay licencia válida, mostrar <WelcomeModal />
   * 'setup_required': Hay licencia, pero no perfil, mostrar <SetupModal />
   * 'ready': Hay licencia y perfil, mostrar la app (<Layout />)
   */
  appStatus: 'loading',
  companyProfile: null,
  licenseDetails: null,

  // ======================================================
  // 2. LAS ACCIONES (Lógica de app.js migrada)
  // ======================================================

  /**
   * Reemplaza a 'initializeLicense'.
   * Se llamará 1 vez cuando la app se cargue.
   */
  initializeApp: async () => {
    const license = await getLicenseFromStorage();

    // -- No hay licencia --
    if (!license || !license.valid) {
      set({ appStatus: 'unauthenticated' });
      return;
    }

    // -- Hay licencia, verificar si expiró localmente --
    if (license.localExpiry) {
      const localExpiryDate = normalizeDate(license.localExpiry);
      if (localExpiryDate <= new Date()) {
        clearLicenseFromStorage();
        set({ appStatus: 'unauthenticated', licenseDetails: null });
        return;
      }
    }
    
    // -- Licencia válida, cargar perfil de empresa --
    set({ licenseDetails: license });
    const companyData = await loadData(STORES.COMPANY, 'company');
    
    if (companyData && companyData.name) {
      // ¡Todo listo!
      set({ companyProfile: companyData, appStatus: 'ready' });
    } else {
      // Hay licencia, pero falta configurar la empresa
      set({ appStatus: 'setup_required' });
    }
  },

  /**
   * Reemplaza la lógica de envío del 'welcome-modal'
   */
  handleLogin: async (licenseKey) => {
    try {
      // 'window.activateLicense' viene de tu supabase.js
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

  /**
   * Reemplaza la lógica de guardado del 'business-setup-modal'
   */
  handleSetup: async (setupData) => {
    try {
      const companyData = {
        id: 'company',
        name: setupData.name,
        phone: setupData.phone,
        address: setupData.address,
        logo: setupData.logo,
        business_type: setupData.business_type
      };
      
      await saveData(STORES.COMPANY, companyData);
      // (Aquí iría la sincronización con Supabase)
      
      set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) {
      console.error("Error al guardar setup:", error);
    }
  },

  /**
   * Reemplaza la lógica de 'saveCompanyData'
   * Se usará en 'SettingsPage.jsx'
   */
  updateCompanyProfile: async (companyData) => {
    await saveData(STORES.COMPANY, companyData);
    set({ companyProfile: companyData });
  },

  /**
   * Reemplaza la lógica del 'delete-license-btn'
   */
  logout: () => {
    clearLicenseFromStorage();
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null
    });
  }
}));