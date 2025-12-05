// src/store/useAppStore.js
import { create } from 'zustand';
import { loadData, saveData, STORES, checkStorageQuota } from '../services/database';
import { isLocalStorageEnabled, normalizeDate, showMessageModal } from '../services/utils';

// ✅ IMPORTS ACTIVOS (Ya no están comentados)
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

// Función auxiliar para guardar en disco (usada internamente y por realtime)
const saveLicenseToStorageHelper = async (licenseData) => {
  if (!isLocalStorageEnabled()) return;
  const dataToStore = { ...licenseData };
  // Renovamos la expiración local cada vez que guardamos
  dataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const signature = generateSignature(dataToStore);
  const packageToStore = { data: dataToStore, signature: signature };
  localStorage.setItem('lanzo_license', JSON.stringify(packageToStore));
};

const saveLicenseToStorage = async (licenseData) => saveLicenseToStorageHelper(licenseData);

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
  _isInitializingSecurity: false,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

  // ============================================================
  // PROCESO DE INICIO (SERVIDOR > CACHÉ)
  // ============================================================
  initializeApp: async () => {
    const localLicense = await getLicenseFromStorage();

    // 1. CHEQUEO RÁPIDO: Si no hay licencia local, pedir login.
    // Esto evita el error "no_license_key" y el bloqueo rojo en consola.
    if (!localLicense || !localLicense.license_key) {
      console.log("ℹ️ No hay sesión activa. Solicitando login.");
      set({ appStatus: 'unauthenticated' });
      return;
    }

    const isOnline = navigator.onLine;

    try {
      // 2. Si estamos ONLINE, el SERVIDOR tiene prioridad absoluta.
      if (isOnline) {
        console.log('🌍 Conectado a internet. Validando con servidor...');

        const serverValidation = await revalidateLicense(localLicense.license_key);

        // CASO A: El servidor respondió explícitamente
        if (serverValidation && serverValidation.valid !== undefined) {

          // Si es INVÁLIDA (expirada, baneada) y NO es error de red
          if (!serverValidation.valid && serverValidation.reason !== 'offline_grace') {
            console.error(`⛔ Servidor denegó acceso: ${serverValidation.reason}`);

            // 🔥 BORRAMOS EL CACHÉ: El servidor manda.
            clearLicenseFromStorage();

            set({
              appStatus: 'unauthenticated',
              licenseDetails: null,
              licenseStatus: serverValidation.reason
            });
            return; // Fin del camino.
          }

          // Si es VÁLIDA
          if (serverValidation.valid) {
            console.log("✅ Servidor confirmó licencia.");
            const finalLicenseData = { ...localLicense, ...serverValidation };

            // Actualizamos caché con la verdad del servidor
            await saveLicenseToStorageHelper(finalLicenseData);

            set({
              licenseDetails: finalLicenseData,
              licenseStatus: 'active',
              gracePeriodEnds: finalLicenseData.grace_period_ends || null
            });

            await get()._loadProfile(finalLicenseData.license_key);
            return; // Éxito online.
          }
        }
      }

      // 3. FALLBACK: Solo si NO hay internet o el servidor falló (Timeout)
      console.warn("⚠️ Usando caché local (Modo Offline o Servidor Inalcanzable).");

      if (localLicense && localLicense.valid) {
        // Seguridad extra: Expiración local de 30 días
        if (localLicense.localExpiry && normalizeDate(localLicense.localExpiry) <= new Date()) {
          console.error("⏰ Licencia local caducada por tiempo.");
          clearLicenseFromStorage();
          set({ appStatus: 'unauthenticated' });
          return;
        }

        set({
          licenseDetails: localLicense,
          licenseStatus: localLicense.status || 'active',
          gracePeriodEnds: localLicense.grace_period_ends || null
        });

        await get()._loadProfile(null);
      } else {
        set({ appStatus: 'unauthenticated' });
      }

    } catch (error) {
      console.error("Error crítico en inicio:", error);
      set({ appStatus: 'unauthenticated' });
    }
  },

  // Helper interno para cargar perfil
  _loadProfile: async (licenseKey) => {
    let companyData = null;

    // Intento Online
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
          await saveData(STORES.COMPANY, companyData);
        }
      } catch (e) { console.warn("Fallo carga perfil online", e); }
    }

    // Fallback Local
    if (!companyData) {
      companyData = await loadData(STORES.COMPANY, 'company');
    }

    set({ companyProfile: companyData });

    if (companyData && (companyData.name || companyData.business_name)) {
      set({ appStatus: 'ready' });
    } else {
      set({ appStatus: 'setup_required' });
    }
  },

  // ============================================================
  // SEGURIDAD EN TIEMPO REAL (WEBSOCKETS)
  // ============================================================
  startRealtimeSecurity: async () => {
    const { licenseDetails, realtimeSubscription, stopRealtimeSecurity, logout, _isInitializingSecurity } = get();

    if (_isInitializingSecurity) return;
    if (!licenseDetails?.license_key) return;

    set({ _isInitializingSecurity: true });

    try {
      if (realtimeSubscription) {
        await stopRealtimeSecurity();
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const deviceFingerprint = localStorage.getItem('lanzo_device_id');
      if (!deviceFingerprint) {
        set({ _isInitializingSecurity: false });
        return;
      }

      const channel = startLicenseListener(
        licenseDetails.license_key,
        deviceFingerprint,
        {
          onLicenseChanged: (newLicenseData) => {
            console.log("🔄 [Realtime] Cambio recibido:", newLicenseData);

            // 1. OBTENER ESTADO ACTUALIZADO
            const currentDetails = get().licenseDetails || {};
            // Mezclamos lo nuevo con lo viejo para no perder datos que no vengan en el payload
            const mergedLicense = { ...currentDetails, ...newLicenseData };

            // 2. LÓGICA DE RE-CÁLCULO INTELIGENTE (Aquí está la magia)
            // No confiamos ciegamente en el 'status' de la BD si las fechas dicen otra cosa.
            const now = new Date();
            const expiresAt = mergedLicense.expires_at ? new Date(mergedLicense.expires_at) : null;
            const graceEnds = mergedLicense.grace_period_ends ? new Date(mergedLicense.grace_period_ends) : null;
            
            let smartStatus = newLicenseData.status || currentDetails.status;

            // Si ya expiró la fecha principal...
            if (expiresAt && expiresAt < now) {
                // ...verificamos si estamos en periodo de gracia
                if (graceEnds && graceEnds > now) {
                    smartStatus = 'grace_period'; // Forzamos estado de Gracia
                } else {
                    smartStatus = 'expired'; // Forzamos expiración
                }
            } else if (expiresAt && expiresAt > now && smartStatus !== 'suspended') {
                // Si la fecha se extendió (renovación), reactivamos
                smartStatus = 'active';
            }

            // 3. ACTUALIZAR BANDERA 'VALID'
            // Solo es válido si está activo o en gracia
            const isValidNow = smartStatus === 'active' || smartStatus === 'grace_period';

            // 4. GUARDAR EN EL STORE CON DATOS CALCULADOS
            const finalDetails = {
                ...mergedLicense,
                status: smartStatus,
                valid: isValidNow
            };

            set({
              licenseDetails: finalDetails,
              licenseStatus: smartStatus,
              gracePeriodEnds: finalDetails.grace_period_ends
            });

            // Guardar en caché local inmediatamente
            saveLicenseToStorageHelper(finalDetails);

            // 5. ALERTAS CRÍTICAS
            if (!isValidNow) {
               showMessageModal(
                 `⛔ ACCESO DENEGADO: Tu licencia ha cambiado a estado: ${smartStatus.toUpperCase()}`,
                 () => window.location.reload(),
                 { type: 'error', confirmButtonText: 'Recargar Sistema' }
               );
            } else if (smartStatus === 'grace_period') {
                // Notificar discretamente si entró en gracia en vivo
                console.warn("⚠️ El sistema ha entrado en periodo de gracia.");
            }
          },
          
          // ... resto del código (onDeviceChanged) ...
          onDeviceChanged: (event) => {
            if (event.status === 'banned' || event.status === 'deleted') {
              showMessageModal(
                `🚫 ACCESO REVOCADO: Este dispositivo ha sido desactivado.`,
                () => { logout(); window.location.reload(); },
                { type: 'error', confirmButtonText: 'Cerrar Sesión' }
              );
            }
          }
        }
      );
      set({ realtimeSubscription: channel });

    } catch (error) {
      console.error('Error security realtime:', error);
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
      await stopLicenseListener(realtimeSubscription);
    } catch (err) { console.warn(err); }
  },

  handleLogin: async (licenseKey) => {
    try {
      const result = await activateLicense(licenseKey);
      if (result.valid) {
        const licenseDataToSave = { ...result.details, valid: true };
        await saveLicenseToStorage(licenseDataToSave);
        set({ licenseDetails: licenseDataToSave });
        await get()._loadProfile(licenseKey);
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
      } else {
        return { success: false, message: result.error || 'No se pudo crear prueba.' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  handleSetup: async (setupData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    try {
      let logoUrl = null;
      if (setupData.logo && setupData.logo instanceof File) {
        logoUrl = await uploadFile(setupData.logo, 'logo');
      }
      const profileData = { ...setupData, logo: logoUrl };
      await saveBusinessProfile(licenseKey, profileData);
      const companyData = { id: 'company', ...profileData };
      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData, appStatus: 'ready' });
    } catch (error) { console.error(error); }
  },

  updateCompanyProfile: async (companyData) => {
    const licenseKey = get().licenseDetails?.license_key;
    if (!licenseKey) return;
    try {
      if (companyData.logo && companyData.logo instanceof File) {
        const logoUrl = await uploadFile(companyData.logo, 'logo');
        companyData.logo = logoUrl;
      }
      await saveBusinessProfile(licenseKey, companyData);
      await saveData(STORES.COMPANY, companyData);
      set({ companyProfile: companyData });
    } catch (error) { console.error(error); }
  },

  logout: async () => {
    const { licenseDetails } = get();
    await get().stopRealtimeSecurity();
    try {
      if (licenseDetails?.license_key) {
        await deactivateCurrentDevice(licenseDetails.license_key);
      }
    } catch (error) { }
    clearLicenseFromStorage();
    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      companyProfile: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      realtimeSubscription: null
    });
  },

  verifySessionIntegrity: async () => {
    const { licenseDetails, logout } = get();
    if (!licenseDetails || !licenseDetails.license_key) return false;

    if (navigator.onLine) {
      try {
        const serverCheck = await revalidateLicense(licenseDetails.license_key);

        // Si el servidor responde explícitamente inválido, sacamos al usuario
        if (serverCheck && serverCheck.valid === false && serverCheck.reason !== 'offline_grace') {
          console.error(`⛔ Sesión invalidada por servidor: ${serverCheck.reason}`);
          await logout();
          return false;
        }

        // Si es válido, actualizamos estado local
        if (serverCheck.grace_period_ends) {
          set({
            gracePeriodEnds: serverCheck.grace_period_ends,
            licenseStatus: serverCheck.status
          });
        }
      } catch (error) {
        console.warn("⚠️ Verificación online falló, manteniendo sesión offline.");
      }
    }
    return true;
  },
}));