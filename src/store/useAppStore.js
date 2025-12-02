import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
import { isLocalStorageEnabled, normalizeDate, showMessageModal } from '../services/utils';
import { activateLicense, revalidateLicense, getBusinessProfile, saveBusinessProfile, createFreeTrial, uploadFile, deactivateCurrentDevice, subscribeToSecurityChanges, removeRealtimeChannel } from '../services/supabase';

const _ui_render_config_v2 = "LANZO_SECURE_KEY_v1_X9Z";

const generateSignature = (data) => {
  const stringData = JSON.stringify(data);
  let hash = 0;
  if (stringData.length === 0) return hash;
  const mixedString = stringData + _ui_render_config_v2;
  for (let i = 0; i < mixedString.length; i++) {
    const char = mixedString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
};

const saveLicenseToStorage = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };
  dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const signature = generateSignature(dataToStore);
  const packageToStore = { data: dataToStore, signature: signature };
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
  
  // 1. NUEVA BANDERA DE ESTADO (MUTEX)
  _isInitializingSecurity: false,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

  initializeApp: async () => {
    const license = await getLicenseFromStorage();

    // AQUÍ FALLABA: Si 'license' existía pero no tenía 'valid: true', te sacaba.
    if (!license || !license.valid) {
      set({ appStatus: 'unauthenticated' });
      return;
    }

    try {
      const serverValidation = await revalidateLicense();

      if (serverValidation && serverValidation.valid) {
        // CASO 1: ÉXITO ROTUNDO (El servidor dice que sí) -> Guardamos y seguimos
        await saveLicenseToStorage(serverValidation);
        set({
          licenseDetails: serverValidation,
          licenseStatus: serverValidation.reason || 'active',
          gracePeriodEnds: serverValidation.grace_period_ends || null
        });

        const currentLicenseKey = serverValidation.license_key || license.license_key;
        const profileResult = await getBusinessProfile(currentLicenseKey);
        
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
        // CASO 2: FALLO DE VALIDACIÓN (Puede ser error de red o licencia vencida)
        
        // Si el servidor nos dio una RAZÓN específica de rechazo (ej: 'expired', 'revoked')
        if (serverValidation.reason) {
            console.warn("⛔ Licencia rechazada por servidor:", serverValidation.reason);
            clearLicenseFromStorage();
            set({
              appStatus: 'unauthenticated',
              licenseDetails: null,
              licenseStatus: serverValidation.reason || 'expired'
            });
        } else {
            // Si NO hay razón, asumimos que fue un error de red/cancelación (refresh rápido)
            // y CONFIAMOS en la licencia local para no sacar al usuario.
            console.warn("⚠️ Validación interrumpida (Refresh rápido o Red). Manteniendo sesión local.");
            
            set({
                licenseDetails: license,
                licenseStatus: license.reason || 'active',
                gracePeriodEnds: license.grace_period_ends || null
            });

            // Intentamos cargar perfil local
            const companyData = await loadData(STORES.COMPANY, 'company');
            if (companyData && companyData.name) {
                set({ companyProfile: companyData, appStatus: 'ready' });
            } else {
                set({ appStatus: 'setup_required' });
            }
        }
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

  // ============================================================
  // GESTIÓN DE SEGURIDAD REALTIME
  // ============================================================

  startRealtimeSecurity: async () => {
    const { 
      licenseDetails, 
      realtimeSubscription, 
      stopRealtimeSecurity, 
      _isInitializingSecurity 
    } = get();

    if (_isInitializingSecurity) return;

    if (!licenseDetails?.license_key) return;

    set({ _isInitializingSecurity: true });

    try {
      if (realtimeSubscription) {
        await stopRealtimeSecurity();
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const sub = await subscribeToSecurityChanges(
        licenseDetails.license_key,
        (newLicenseData) => {
          const currentSub = get().realtimeSubscription;
          if (!currentSub || currentSub !== sub) return;

          if (newLicenseData.status !== 'active') {
            showMessageModal(
              `⚠️ ALERTA DE SEGURIDAD: Tu licencia ahora está marcada como "${newLicenseData.status}".`,
              () => {
                get().logout();
                window.location.reload();
              }
            );
          } else {
            set((state) => ({
              licenseDetails: { ...state.licenseDetails, ...newLicenseData }
            }));
          }
        },
        (newDeviceData, eventType) => {
          const currentSub = get().realtimeSubscription;
          if (!currentSub || currentSub !== sub) return;

          if (eventType === 'DELETE' || (newDeviceData && !newDeviceData.is_active)) {
            showMessageModal(
              `⚠️ ACCESO REVOCADO: Este dispositivo ha sido desactivado remotamente.`,
              () => {
                get().logout();
                window.location.reload();
              }
            );
          }
        }
      );
      set({ realtimeSubscription: sub });

    } catch (error) {
      console.error('Error al iniciar seguridad realtime:', error);
      set({ realtimeSubscription: null });
    } finally {
      set({ _isInitializingSecurity: false });
    }
  },

  stopRealtimeSecurity: async () => {
    const { realtimeSubscription } = get();
    if (!realtimeSubscription) return;
    set({ realtimeSubscription: null });
    try {
      if (typeof removeRealtimeChannel === 'function') {
        await removeRealtimeChannel(realtimeSubscription);
      }
    } catch (err) {
      console.warn("Advertencia al desconectar canal:", err);
    }
  },

  handleLogin: async (licenseKey) => {
    try {
      const result = await activateLicense(licenseKey);
      if (result.valid) {
        // === CORRECCIÓN CLAVE AQUÍ ===
        // Inyectamos "valid: true" manualmente porque el objeto 'details'
        // que viene de la base de datos NO lo trae por defecto.
        const licenseDataToSave = { 
            ...result.details, 
            valid: true 
        };
        
        await saveLicenseToStorage(licenseDataToSave);
        
        try {
          const profileResult = await getBusinessProfile(licenseKey);
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
              licenseDetails: licenseDataToSave,
              companyProfile: mappedData,
              appStatus: 'ready'
            });
          } else {
            console.log("Licencia nueva sin perfil. Requiere configuración.");
            set({ licenseDetails: licenseDataToSave, appStatus: 'setup_required' });
          }
        } catch (profileError) {
          console.error("Error al recuperar perfil:", profileError);
          set({ licenseDetails: licenseDataToSave, appStatus: 'setup_required' });
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
      const result = await createFreeTrial();
      // Nota: Tu SQL de trial devuelve los campos planos (license_key, etc),
      // NO devuelve un objeto "details". Ajustamos para soportar ambas estructuras.
      if (result.success) {
        
        // Si result.details existe úsalo, sino usa result mismo (menos success)
        const rawData = result.details || result;
        
        // === CORRECCIÓN CLAVE AQUÍ TAMBIÉN ===
        const licenseDataToSave = {
            ...rawData,
            valid: true,
            // Aseguramos campos mínimos si faltan
            product_name: rawData.product_name || 'Lanzo Trial', 
            max_devices: rawData.max_devices || 1
        };

        await saveLicenseToStorage(licenseDataToSave);
        
        set({ licenseDetails: licenseDataToSave, appStatus: 'setup_required' });
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
        logoUrl = await uploadFile(setupData.logo, 'logo');
      }
      const profileData = { ...setupData, logo: logoUrl };
      await saveBusinessProfile(licenseKey, profileData);
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
        const logoUrl = await uploadFile(companyData.logo, 'logo');
        companyData.logo = logoUrl;
      }
      await saveBusinessProfile(licenseKey, companyData);
      console.log("Perfil de negocio actualizado en Supabase DB.");
      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData });
    } catch (error) {
      console.error("Error al actualizar perfil:", error);
    }
  },

  logout: async () => {
    const { licenseDetails } = get();
    await get().stopRealtimeSecurity();
    try {
      const licenseKey = licenseDetails?.license_key;
      if (licenseKey) {
        await deactivateCurrentDevice(licenseKey);
        console.log("Dispositivo desactivado del servidor.");
      }
    } catch (error) {
      console.error("Error al desactivar dispositivo (logout local):", error);
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
  },

  // ============================================================
  // seguridad
  // ============================================================
  verifySessionIntegrity: async () => {
    const { licenseDetails, logout } = get();

    // 1. Validación Básica
    if (!licenseDetails || !licenseDetails.license_key) {
        return false;
    }

    // 2. Validación Local (Anti-Tamper)
    const storedPackage = await getLicenseFromStorage();
    if (!storedPackage) {
       console.warn("⚠️ Error de integridad local.");
    }

    // 3. Validación Remota (Server-Side Authority)
    if (navigator.onLine) {
        try {
            const serverCheck = await revalidateLicense(licenseDetails.license_key);
            
            // === CORRECCIÓN CRÍTICA PARA SOPORTAR 7 DÍAS DE TOLERANCIA ===
            
            // Definimos qué se considera "Permitido trabajar":
            // 1. La licencia es válida (valid: true)
            // 2. O BIEN, está en periodo de gracia (status: 'grace_period')
            const isAccessAllowed = serverCheck.valid || serverCheck.status === 'grace_period';

            if (!isAccessAllowed) {
                console.error(`⛔ SEGURIDAD: Acceso denegado. Estado: ${serverCheck.status}`);
                await logout(); // Expulsión inmediata solo si NO hay permiso
                return false;
            }
            
            // Actualizamos fechas de gracia en el estado para que el Ticker avise
            if (serverCheck.grace_period_ends) {
                set({ 
                    gracePeriodEnds: serverCheck.grace_period_ends,
                    licenseStatus: serverCheck.status // Actualizamos estado (active/grace_period)
                });
            }
            // ==============================================================

        } catch (error) {
            console.warn("⚠️ Verificación online falló (red inestable). Continuando offline.");
        }
    }

    return true; 
  },
}));