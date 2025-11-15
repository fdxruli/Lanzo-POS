// src/store/useAppStore.js
import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
// Importamos las utilidades de tu proyecto original
import { isLocalStorageEnabled, normalizeDate } from '../services/utils'; 
// Importamos las funciones de Supabase
// (Asegúrate de que supabase.js cargue FingerprintJS y Supabase en tu index.html)

// --- Funciones Helper (SIN CAMBIOS) ---

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
  // Añadimos una expiración local de 30 días
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
  // 2. LAS ACCIONES (¡MODIFICADAS!)
  // ======================================================

  /**
   * ¡MEJORA 1: "Heartbeat"!
   * Revalida la licencia con el servidor CADA VEZ que la app carga.
   */
  initializeApp: async () => {
    // 1. Obtenemos la licencia local
    const license = await getLicenseFromStorage();

    // 2. Si no hay licencia local, estamos desautenticados.
    if (!license || !license.valid) {
      set({ appStatus: 'unauthenticated' });
      return;
    }

    // --- INICIO DE LA MEJORA ---
    try {
      // 3. ¡EL CAMBIO! Revalidamos con el servidor.
      // 'window.revalidateLicense' llama a tu 'verify_device_license'
      const serverValidation = await window.revalidateLicense(); 
      
      if (serverValidation && serverValidation.valid) {
        // ¡Éxito! El servidor dice que la licencia sigue activa.
        // Guardamos los detalles frescos (por si cambiaron)
        await saveLicenseToStorage(serverValidation); 
        set({ licenseDetails: serverValidation });
        
        // Continuar con la carga del perfil
        const companyData = await loadData(STORES.COMPANY, 'company');
        if (companyData && companyData.name) {
          set({ companyProfile: companyData, appStatus: 'ready' });
        } else {
          set({ appStatus: 'setup_required' });
        }
        
      } else {
        // ¡FALLO! El servidor dice que la licencia NO es válida
        // (Expiró, fue suspendida, dispositivo eliminado, etc.)
        clearLicenseFromStorage();
        set({ appStatus: 'unauthenticated', licenseDetails: null });
      }
    } catch (error) {
      // Error de red (quizás no hay internet)
      console.warn("No se pudo revalidar la licencia (¿sin red?). Confiando en caché local.");
      
      // Confiamos en la expiración local de 30 días
      if (license.localExpiry) {
        const localExpiryDate = normalizeDate(license.localExpiry);
        if (localExpiryDate <= new Date()) {
          clearLicenseFromStorage();
          set({ appStatus: 'unauthenticated', licenseDetails: null });
          return;
        }
      }
      
      // La caché local es válida, cargar perfil
      set({ licenseDetails: license });
      const companyData = await loadData(STORES.COMPANY, 'company');
      if (companyData && companyData.name) {
        set({ companyProfile: companyData, appStatus: 'ready' });
      } else {
        set({ appStatus: 'setup_required' });
      }
    }
    // --- FIN DE LA MEJORA ---
  },

  /**
   * Reemplaza la lógica de envío del 'welcome-modal' (SIN CAMBIOS)
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
   * Reemplaza la lógica de guardado del 'business-setup-modal' (SIN CAMBIOS)
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
   * Reemplaza la lógica de 'saveCompanyData' (SIN CAMBIOS)
   */
  updateCompanyProfile: async (companyData) => {
    await saveData(STORES.COMPANY, companyData);
    set({ companyProfile: companyData });
  },

  /**
   * ¡MEJORA 2: Desactivación en Servidor!
   * Llama a la BD antes de borrar la licencia local.
   */
  logout: async () => { // <--- Convertido en async
    
    // --- INICIO DE LA MEJORA ---
    try {
      // 1. Notificar al servidor que este dispositivo se va a desactivar
      // Asumimos que la licencia está en 'licenseDetails'
      const licenseKey = get().licenseDetails?.license_key;
      if (licenseKey) {
        // 'deactivateCurrentDevice' es tu 'deactivate_device'
        await window.deactivateCurrentDevice(licenseKey); 
        console.log("Dispositivo desactivado del servidor.");
      }
    } catch (error) {
      // No importa si falla, procedemos a borrar localmente
      console.error("Error al desactivar dispositivo en servidor:", error);
    }
    // --- FIN DE LA MEJORA ---

    // 2. Borrar todo localmente
    clearLicenseFromStorage();
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null
    });
  }
}));