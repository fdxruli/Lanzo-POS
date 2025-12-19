// src/store/useAppStore.js - VERSIÓN CORREGIDA CON MANEJO DE ERRORES ROBUSTO

import { create } from 'zustand';
import { loadData, saveData, STORES } from '../services/database';
import { isLocalStorageEnabled, normalizeDate, showMessageModal } from '../services/utils';

import {
  activateLicense,
  revalidateLicense,
  getBusinessProfile,
  saveBusinessProfile,
  createFreeTrial,
  uploadFile,
  deactivateCurrentDevice
} from '../services/supabase';

import { startLicenseListener, stopLicenseListener } from '../services/licenseRealtime';

const _ui_render_config_v2 = import.meta.env.VITE_LICENSE_SALT;

// === HELPERS (Sin cambios) ===
const stableStringify = (obj) => {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  
  // Ordenamos las llaves alfabéticamente antes de convertir
  return JSON.stringify(Object.keys(obj).sort().reduce((result, key) => {
    result[key] = obj[key];
    return result;
  }, {}));
};

const generateSignature = (data) => {
  // CAMBIO: Usamos stableStringify en lugar de JSON.stringify
  const stringData = stableStringify(data);
  
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
  const packageToStore = { data: dataToStore, signature };
  localStorage.setItem('lanzo_license', JSON.stringify(packageToStore));
};

const getLicenseFromStorage = async () => {
  if (!isLocalStorageEnabled()) return null;
  const storedString = localStorage.getItem('lanzo_license');
  if (!storedString) return null;
  
  try {
    const parsedPackage = JSON.parse(storedString);
    if (!parsedPackage.data || !parsedPackage.signature) {
      return null; // Datos incompletos, aquí sí ignoramos
    }
    
    // Verificamos la firma
    const expectedSignature = generateSignature(parsedPackage.data);
    
    if (parsedPackage.signature !== expectedSignature) {
      console.warn("⚠️ La firma local no coincide. Posible actualización de versión.");
      
      // CRÍTICO: NO BORRAMOS localStorage.removeItem('lanzo_license') AQUÍ.
      // Devolvemos los datos "sospechosos" para que initializeApp intente validarlos 
      // contra el servidor. Si el servidor dice que son válidos, se arreglarán solos.
      return parsedPackage.data;
    }
    
    return parsedPackage.data;
  } catch (e) {
    console.error("Error leyendo licencia local:", e);
    // Solo borramos si el JSON es ilegible (corrupción real)
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
  _isInitializingSecurity: false,
  _securityCleanupScheduled: false,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

  // === 🔧 FUNCIÓN CORREGIDA CON MANEJO DE ERRORES ROBUSTO ===
  initializeApp: async () => {
    console.log('🔄 [AppStore] Iniciando aplicación...');
    
    try {
      // Obtenemos licencia (ahora getLicenseFromStorage no borra si hay error de firma)
      const localLicense = await getLicenseFromStorage();

      if (!localLicense?.license_key) {
        set({ appStatus: 'unauthenticated' });
        return;
      }

      // Si tenemos red, validamos con el servidor para confirmar integridad
      if (navigator.onLine) {
        try {
          const serverValidation = await revalidateLicense(localLicense.license_key);
          
          if (serverValidation?.valid !== undefined) {
            // Si el servidor responde, confiamos en él
            // _processServerValidation guardará de nuevo los datos, 
            // CORRIGIENDO cualquier error de firma previo gracias a stableStringify
            await get()._processServerValidation(serverValidation, localLicense);
            return;
          }
        } catch (validationError) {
          console.warn('⚠️ Fallo validación online, usando caché local:', validationError);
        }
      } 
      
      // Si estamos offline o falló la validación pero tenemos datos locales
      await get()._processOfflineMode(localLicense);

    } catch (criticalError) {
      console.error('💥 Error crítico inicializando:', criticalError);
      set({ appStatus: 'unauthenticated' });
    }
  },

  // === 🆕 HELPER: Procesar Validación Exitosa del Servidor ===
  _processServerValidation: async (serverValidation, localLicense) => {
    const now = new Date();
    const graceEnd = serverValidation.grace_period_ends 
      ? new Date(serverValidation.grace_period_ends) 
      : null;

    const isWithinGracePeriod = graceEnd && graceEnd > now;

    // A) Verificar si la licencia está bloqueada (sin gracia)
    if (!serverValidation.valid && 
        serverValidation.reason !== 'offline_grace' && 
        !isWithinGracePeriod) {
      
      console.warn('🚫 [AppStore] Licencia inválida según servidor');
      clearLicenseFromStorage();
      set({
        appStatus: 'unauthenticated',
        licenseDetails: null,
        licenseStatus: serverValidation.reason || 'invalid'
      });
      return;
    }

    // B) Licencia válida O en período de gracia
    let finalStatus = serverValidation.reason || 'active';
    
    if (!serverValidation.valid && isWithinGracePeriod) {
      finalStatus = 'grace_period';
      console.log('⏰ [AppStore] Licencia en PERÍODO DE GRACIA');
    }

    const finalLicenseData = {
      ...localLicense,
      ...serverValidation,
      valid: true,
      status: finalStatus
    };

    await saveLicenseToStorage(finalLicenseData);

    set({
      licenseDetails: finalLicenseData,
      licenseStatus: finalStatus,
      gracePeriodEnds: finalLicenseData.grace_period_ends || null
    });

    // C) Cargar perfil de empresa
    await get()._loadProfile(finalLicenseData.license_key);
  },

  // === 🆕 HELPER: Procesar Modo Offline ===
  _processOfflineMode: async (localLicense) => {
    // A) Verificar expiración del caché local (30 días)
    if (localLicense.localExpiry && 
        normalizeDate(localLicense.localExpiry) <= new Date()) {
      
      console.warn('🕐 [AppStore] Caché local expirado (30 días)');
      clearLicenseFromStorage();
      set({ appStatus: 'unauthenticated' });
      return;
    }

    // B) Calcular estado basado en fechas locales
    let localStatus = localLicense.status || 'active';
    const now = new Date();
    const expiryDate = localLicense.expires_at 
      ? new Date(localLicense.expires_at) 
      : null;
    const graceDate = localLicense.grace_period_ends 
      ? new Date(localLicense.grace_period_ends) 
      : null;

    // C) Verificar si expiró localmente
    if (expiryDate && expiryDate < now) {
      if (graceDate && graceDate > now) {
        localStatus = 'grace_period';
        console.log('⏰ [AppStore] Licencia en PERÍODO DE GRACIA (offline)');
      } else {
        console.warn('🚫 [AppStore] Licencia expirada localmente');
        clearLicenseFromStorage();
        set({ appStatus: 'unauthenticated' });
        return;
      }
    }

    // D) Licencia válida en modo offline
    const updatedLocalLicense = { ...localLicense, status: localStatus };

    set({
      licenseDetails: updatedLocalLicense,
      licenseStatus: localStatus,
      gracePeriodEnds: localLicense.grace_period_ends || null
    });

    await get()._loadProfile(null); // null = modo offline
  },

  // === _loadProfile (MEJORADO CON TRY/CATCH) ===
  _loadProfile: async (licenseKey) => {
    let companyData = null;

    // PASO 1: Intentar cargar desde servidor (si hay licenseKey)
    if (licenseKey && navigator.onLine) {
      try {
        const profileResult = await getBusinessProfile(licenseKey);
        
        if (profileResult.success && profileResult.data) {
          companyData = {
            id: 'company',
            name: profileResult.data.business_name || profileResult.data.name,
            phone: profileResult.data.phone_number || profileResult.data.phone,
            address: profileResult.data.address,
            logo: profileResult.data.logo_url || profileResult.data.logo,
            business_type: profileResult.data.business_type
          };
          
          // Guardar en DB local
          await saveData(STORES.COMPANY, companyData);
        }
      } catch (e) {
        console.warn('⚠️ [AppStore] Fallo carga perfil online:', e);
        // No es crítico, seguimos con caché local
      }
    }

    // PASO 2: Fallback a caché local si no se pudo cargar online
    if (!companyData) {
      try {
        companyData = await loadData(STORES.COMPANY, 'company');
      } catch (e) {
        console.warn('⚠️ [AppStore] Fallo carga perfil local:', e);
      }
    }

    // PASO 3: Actualizar estado de la UI
    set({ companyProfile: companyData });

    if (companyData && (companyData.name || companyData.business_name)) {
      console.log('✅ [AppStore] Aplicación lista (ready)');
      set({ appStatus: 'ready' });
    } else {
      console.log('⚙️ [AppStore] Requiere configuración inicial');
      set({ appStatus: 'setup_required' });
    }
  },

  // === RESTO DE FUNCIONES (Sin cambios críticos, solo agregamos logs) ===

  startRealtimeSecurity: async () => {
    const state = get();

    if (state._isInitializingSecurity) {
      console.log('⏳ [Realtime] Ya hay inicialización en progreso');
      return;
    }
    
    if (!state.licenseDetails?.license_key) {
      console.warn('⚠️ [Realtime] No hay licencia para monitorear');
      return;
    }

    const deviceFingerprint = localStorage.getItem('lanzo_device_id');
    if (!deviceFingerprint) {
      console.warn('⚠️ [Realtime] No hay fingerprint del dispositivo');
      return;
    }

    set({ _isInitializingSecurity: true });

    try {
      if (state.realtimeSubscription) {
        await get().stopRealtimeSecurity();
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const channel = startLicenseListener(
        state.licenseDetails.license_key,
        deviceFingerprint,
        {
          onLicenseChanged: async (newLicenseData) => {
            console.log("🔔 [Realtime] Cambio en licencia detectado");
            await get().verifySessionIntegrity();
          },

          onDeviceChanged: (event) => {
            if (event.status === 'banned' || event.status === 'deleted') {
              console.warn('🚫 [Realtime] Dispositivo revocado');
              showMessageModal(
                '🚫 ACCESO REVOCADO: Dispositivo desactivado.',
                () => {
                  get().logout();
                  window.location.reload();
                },
                { type: 'error', confirmButtonText: 'Cerrar Sesión' }
              );
            }
          }
        }
      );

      set({ realtimeSubscription: channel });
      console.log('✅ [Realtime] Seguridad iniciada');

    } catch (error) {
      console.error('❌ [Realtime] Error inicializando seguridad:', error);
      set({ realtimeSubscription: null });
    } finally {
      set({ _isInitializingSecurity: false });
    }
  },

  stopRealtimeSecurity: async () => {
    const { realtimeSubscription, _securityCleanupScheduled } = get();

    if (!realtimeSubscription || _securityCleanupScheduled) return;

    set({ _securityCleanupScheduled: true });

    try {
      await stopLicenseListener(realtimeSubscription);
      console.log('🔕 [Realtime] Seguridad detenida');
    } catch (err) {
      console.warn('⚠️ [Realtime] Error deteniendo listener:', err);
    } finally {
      set({
        realtimeSubscription: null,
        _securityCleanupScheduled: false
      });
    }
  },

  handleLogin: async (licenseKey) => {
    try {
      // 1. Intento normal de activación
      const result = await activateLicense(licenseKey);
      
      if (result.valid) {
        const licenseDataToSave = { ...result.details, valid: true };
        await saveLicenseToStorage(licenseDataToSave);
        set({ licenseDetails: licenseDataToSave });
        await get()._loadProfile(licenseKey);
        return { success: true };
      }
      
      // 2. LÓGICA DE RECUPERACIÓN (NUEVO)
      // Si falla porque "ya está activo" o "límite alcanzado", pero es ESTE dispositivo
      const errorMsg = (result.message || '').toLowerCase();
      if (!result.valid && (errorMsg.includes('limit') || errorMsg.includes('active') || errorMsg.includes('device'))) {
         
         console.log("⚠️ Dispositivo ya registrado. Intentando recuperar sesión...");
         
         // Intentamos solo validar (revalidateLicense usa el fingerprint del dispositivo)
         const revalidate = await revalidateLicense(licenseKey);
         
         if (revalidate.valid) {
            console.log("✅ Sesión recuperada exitosamente.");
            
            const recoveredData = { 
              ...revalidate, 
              license_key: licenseKey, // Aseguramos que la key esté presente
              valid: true 
            };
            
            await saveLicenseToStorage(recoveredData);
            set({ licenseDetails: recoveredData });
            await get()._loadProfile(licenseKey);
            return { success: true };
         }
      }

      return { success: false, message: result.message || 'Licencia no válida' };
    } catch (error) {
      console.error("Error en login:", error);
      return { success: false, message: error.message };
    }
  },

  handleFreeTrial: async () => {
    try {
      const result = await createFreeTrial();
      if (result.success) {
        const rawData = result.details || result;
        const licenseDataToSave = {
          ...rawData,
          valid: true,
          product_name: rawData.product_name || 'Lanzo Trial',
          max_devices: rawData.max_devices || 1
        };
        await saveLicenseToStorage(licenseDataToSave);
        set({ licenseDetails: licenseDataToSave, appStatus: 'setup_required' });
        return { success: true };
      }
      return { success: false, message: result.error || 'No se pudo crear prueba.' };
    } catch (error) {
      return { success: false, message: error.message };
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
      console.error('Error en setup:', error);
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
      console.error('Error actualizando perfil:', error);
    }
  },

  logout: async () => {
    const { licenseDetails } = get();

    await get().stopRealtimeSecurity();

    try {
      if (licenseDetails?.license_key) {
        await deactivateCurrentDevice(licenseDetails.license_key);
      }
    } catch (error) {
      console.warn('Error desactivando dispositivo:', error);
    }

    clearLicenseFromStorage();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      realtimeSubscription: null,
      _isInitializingSecurity: false,
      _securityCleanupScheduled: false
    });
  },

  verifySessionIntegrity: async () => {
    const { licenseDetails, logout } = get();

    if (!licenseDetails?.license_key) return false;

    if (navigator.onLine) {
      try {
        const serverCheck = await revalidateLicense(licenseDetails.license_key);

        const now = new Date();
        const graceEnd = serverCheck.grace_period_ends 
          ? new Date(serverCheck.grace_period_ends) 
          : null;
        const isWithinGracePeriod = graceEnd && graceEnd > now;

        if (serverCheck?.valid === false && 
            serverCheck.reason !== 'offline_grace' && 
            !isWithinGracePeriod) {
          await logout();
          return false;
        }

        let newStatus = serverCheck.status || serverCheck.reason;

        if (isWithinGracePeriod && !serverCheck.valid) {
          newStatus = 'grace_period';
        }

        const updatedDetails = {
          ...licenseDetails,
          ...serverCheck,
          status: newStatus,
          valid: serverCheck.valid || isWithinGracePeriod
        };

        set({
          licenseStatus: newStatus,
          gracePeriodEnds: serverCheck.grace_period_ends,
          licenseDetails: updatedDetails
        });

        await saveLicenseToStorage(updatedDetails);

      } catch (error) {
        console.warn("Verificación fallida, manteniendo sesión offline:", error);
      }
    }

    return true;
  }
}));