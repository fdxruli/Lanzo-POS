// src/store/useAppStore.js
import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
import { isLocalStorageEnabled, normalizeDate, showMessageModal } from '../services/utils';

const _ui_render_config_v2 = "LANZO_SECURE_KEY_v1_X9Z";

const generateSignature = (data) => {
  const stringData = JSON.stringify(data);
  let hash = 0;
  if (stringData.length === 0) return hash;
  const mixedString = stringData + _ui_render_config_v2;
  for (let i = 0; i < mixedString.length; i++) {
    const char = mixedString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convertir a 32bit integer
  }
  return hash.toString(16); // Retornar como hex
};

const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;

  const dataToStore = { ...licenseData };
  dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const signature = generateSignature(dataToStore);

  const packageToStore = {
    data: dataToStore,
    signature: signature
  };

  localStorage.setItem('lanzo_license', JSON.stringify(packageToStore));
};

const getLicenseFromStorage = async () => {
  if (!isLocalStorageEnabled()) return null;

  const storedString = localStorage.getItem('lanzo_license');
  if (!storedString) return null;

  try {
    const parsedPackage = JSON.parse(storedString);

    if (!parsedPackage.data || !parsedPackage.signature) {
      localStorage.removeItem('lanzo_license');
      return null;
    }

    const expectedSignature = generateSignature(parsedPackage.data);

    if (parsedPackage.signature !== expectedSignature) {
      console.warn("Error de integridad en datos locales. Reiniciando sesión.");
      localStorage.removeItem('lanzo_license');
      return null;
    }

    return parsedPackage.data;

  } catch (e) {
    localStorage.removeItem('lanzo_license');
    return null;
  }
};

const clearLicenseFromStorage = () => {
  if (!isLocalStorageEnabled()) return;
  localStorage.removeItem('lanzo_license');
};

export const useAppStore = create((set, get) => ({

  realtimeSubscription: null,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

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

        const currentLicenseKey = serverValidation.license_key || license.license_key;

        const profileResult = await window.getBusinessProfile(currentLicenseKey);

        let companyData = null;

        if (profileResult.success && profileResult.data) {
          console.log("Perfil de negocio cargado desde Supabase.");
          const mappedData = {
            id: 'company',
            name: profileResult.data.business_name || profileResult.data.name,
            phone: profileResult.data.phone_number || profileResult.data.phone,
            address: profileResult.data.address,
            logo: profileResult.data.logo_url || profileResult.data.logo,
            business_type: profileResult.data.business_type
          };
          await saveData(STORES.COMPANY, mappedData);
          companyData = mappedData;
        } else {
          console.log("No hay perfil en Supabase, cargando desde local.");
          companyData = await loadData(STORES.COMPANY, 'company');
        }

        set({ companyProfile: companyData });

        if (companyData && (companyData.name || companyData.business_name)) {
          set({ appStatus: 'ready' });
        } else {
          set({ appStatus: 'setup_required' });
        }

      } else {
        clearLicenseFromStorage();
        set({
          appStatus: 'unauthenticated',
          licenseDetails: null,
          licenseStatus: serverValidation.reason || 'expired'
        });
      }
    } catch (error) {
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
      const companyData = await loadData(STORES.COMPANY, 'company');
      if (companyData && companyData.name) {
        set({ companyProfile: companyData, appStatus: 'ready' });
      } else {
        set({ appStatus: 'setup_required' });
      }
    }
  },

  /**
   * REFACTORIZADO: Gestión robusta de suscripción a seguridad.
   * Evita duplicidad de listeners y fugas de memoria.
   */
  startRealtimeSecurity: async () => {
    const { licenseDetails, realtimeSubscription, stopRealtimeSecurity } = get();

    // 1. Si ya existe una suscripción activa, la limpiamos primero para evitar duplicados (Idempotencia)
    if (realtimeSubscription) {
      console.log("♻️ Limpiando suscripción anterior antes de reiniciar seguridad...");
      await stopRealtimeSecurity();
    }

    if (!licenseDetails?.license_key) return;

    console.log("🔌 Iniciando nueva suscripción de seguridad...");

    const sub = await window.subscribeToSecurityChanges(
      licenseDetails.license_key,

      (newLicenseData) => {
        if (newLicenseData.status !== 'active') {
          showMessageModal(
            `⚠️ ALERTA DE SEGURIDAD: Tu licencia ha sido marcada como "${newLicenseData.status}". La sesión se cerrará.`,
            () => {
              get().logout();
              window.location.reload(); // Recarga para limpiar todo estado residual
            }
          );
          get().logout();
        } else {
          set((state) => ({
            licenseDetails: { ...state.licenseDetails, ...newLicenseData }
          }));
          console.log("Licencia actualizada en tiempo real (sigue activa).");
        }
      },

      (newDeviceData, eventType) => {
        if (eventType === 'DELETE' || (newDeviceData && !newDeviceData.is_active)) {
          showMessageModal(
            `⚠️ ACCESO REVOCADO: Este dispositivo ha sido desactivado por el administrador.`,
            () => {
              get().logout();
              window.location.reload();
            }
          );
          get().logout();
        }
      }
    );

    set({ realtimeSubscription: sub });
  },

  /**
   * NUEVA ACCIÓN: Detiene la vigilancia en tiempo real.
   * Crucial para desmontaje de componentes y logout.
   */
  stopRealtimeSecurity: async () => {
    const { realtimeSubscription } = get();
    
    if (realtimeSubscription) {
      console.log("🔌 Deteniendo vigilancia en tiempo real...");
      try {
        if (typeof window.removeRealtimeChannel === 'function') {
          await window.removeRealtimeChannel(realtimeSubscription);
        }
      } catch (err) {
        console.warn("Advertencia no crítica al desconectar canal:", err);
      }
      // Limpiamos la referencia en el estado
      set({ realtimeSubscription: null });
    }
  },

  handleLogin: async (licenseKey) => {
    try {
      const result = await window.activateLicense(licenseKey);

      if (result.valid) {
        await saveLicenseToStorage(result.details);
        try {
          const profileResult = await window.getBusinessProfile(licenseKey);

          if (profileResult.success && profileResult.data) {
            console.log("¡Perfil encontrado al iniciar sesión! Sincronizando...");

            const mappedData = {
              id: 'company',
              name: profileResult.data.business_name || profileResult.data.name,
              phone: profileResult.data.phone_number || profileResult.data.phone,
              address: profileResult.data.address,
              logo: profileResult.data.logo_url || profileResult.data.logo,
              business_type: profileResult.data.business_type
            };

            await saveData(STORES.COMPANY, mappedData);

            set({
              licenseDetails: result.details,
              companyProfile: mappedData,
              appStatus: 'ready'
            });

          } else {
            console.log("Licencia nueva sin perfil. Requiere configuración.");
            set({
              licenseDetails: result.details,
              appStatus: 'setup_required'
            });
          }
        } catch (profileError) {
          console.error("Error al intentar recuperar perfil tras login:", profileError);
          set({ licenseDetails: result.details, appStatus: 'setup_required' });
        }

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

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) {
      console.error("No hay clave de licencia para guardar el perfil");
      return;
    }

    try {
      let logoUrl = null;

      if (setupData.logo && setupData.logo instanceof File) {
        console.log("Subiendo logo a Supabase Storage...");
        logoUrl = await window.uploadFile(setupData.logo, 'logo');
      }

      const profileData = {
        ...setupData,
        logo: logoUrl 
      };

      await window.saveBusinessProfile(licenseKey, profileData);
      console.log("Perfil de negocio guardado en Supabase DB.");

      const companyData = { id: 'company', ...profileData };
      await saveData(STORES.COMPANY, companyData);

      set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) {
      console.error("Error al guardar setup:", error);
    }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) {
      console.error("No hay clave de licencia para actualizar el perfil");
      return;
    }

    try {
      if (companyData.logo && companyData.logo instanceof File) {
        console.log("Subiendo nuevo logo a Supabase Storage...");
        const logoUrl = await window.uploadFile(companyData.logo, 'logo');
        companyData.logo = logoUrl;
      }

      await window.saveBusinessProfile(licenseKey, companyData);
      console.log("Perfil de negocio actualizado en Supabase DB.");

      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData });
    } catch (error) {
      console.error("Error al actualizar perfil:", error);
    }
  },

  logout: async () => {
    const { licenseDetails } = get();

    // 1. REFACTORIZADO: Detener escucha de seguridad explícitamente antes de salir
    await get().stopRealtimeSecurity();

    try {
      const licenseKey = licenseDetails?.license_key;
      if (licenseKey) {
        await window.deactivateCurrentDevice(licenseKey);
        console.log("Dispositivo desactivado del servidor.");
      }
    } catch (error) {
      console.error("Error al desactivar dispositivo en servidor (continuando logout local):", error);
    }

    clearLicenseFromStorage();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      realtimeSubscription: null 
    });

    console.log("Sesión cerrada correctamente.");
  }
}));