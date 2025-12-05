// src/store/useAppStore.js
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
      localStorage.removeItem('lanzo_license');
      return null;
    }
    const expectedSignature = generateSignature(parsedPackage.data);
    if (parsedPackage.signature !== expectedSignature) {
      console.warn("Integridad comprometida. Limpiando sesión.");
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
  _securityCleanupScheduled: false,

  appStatus: 'loading',
  licenseStatus: 'active',
  gracePeriodEnds: null,
  companyProfile: null,
  licenseDetails: null,

  initializeApp: async () => {
    const localLicense = await getLicenseFromStorage();

    if (!localLicense?.license_key) {
      set({ appStatus: 'unauthenticated' });
      return;
    }

    const isOnline = navigator.onLine;

    try {
      if (isOnline) {
        const serverValidation = await revalidateLicense(localLicense.license_key);

        if (serverValidation?.valid !== undefined) {
          if (!serverValidation.valid && serverValidation.reason !== 'offline_grace') {
            clearLicenseFromStorage();
            set({
              appStatus: 'unauthenticated',
              licenseDetails: null,
              licenseStatus: serverValidation.reason || 'invalid'
            });
            return;
          }

          if (serverValidation.valid) {
            const finalLicenseData = { ...localLicense, ...serverValidation };
            await saveLicenseToStorage(finalLicenseData);

            set({
              licenseDetails: finalLicenseData,
              licenseStatus: serverValidation.reason || 'active',
              gracePeriodEnds: finalLicenseData.grace_period_ends || null
            });

            await get()._loadProfile(finalLicenseData.license_key);
            return;
          }
        }
      }

      if (localLicense?.valid) {
        if (localLicense.localExpiry && normalizeDate(localLicense.localExpiry) <= new Date()) {
          clearLicenseFromStorage();
          set({ appStatus: 'unauthenticated' });
          return;
        }

        set({
          licenseDetails: localLicense,
          licenseStatus: localLicense.status || (localLicense.reason === 'grace_period' ? 'grace_period' : 'active'),
          gracePeriodEnds: localLicense.grace_period_ends || null
        });

        await get()._loadProfile(null);
      } else {
        set({ appStatus: 'unauthenticated' });
      }
    } catch (error) {
      console.error("Error crítico en inicialización:", error);
      set({ appStatus: 'unauthenticated' });
    }
  },

  _loadProfile: async (licenseKey) => {
    let companyData = null;

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
      } catch (e) {
        console.warn("Fallo carga perfil online:", e);
      }
    }

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

  startRealtimeSecurity: async () => {
    const state = get();
    
    if (state._isInitializingSecurity) return;
    if (!state.licenseDetails?.license_key) return;

    const deviceFingerprint = localStorage.getItem('lanzo_device_id');
    if (!deviceFingerprint) return;

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
          onLicenseChanged: (newLicenseData) => {
            const currentDetails = get().licenseDetails || {};
            const mergedLicense = { ...currentDetails, ...newLicenseData };

            const now = new Date();
            const expiresAt = mergedLicense.expires_at ? new Date(mergedLicense.expires_at) : null;
            const graceEnds = mergedLicense.grace_period_ends ? new Date(mergedLicense.grace_period_ends) : null;

            let smartStatus = newLicenseData.status || currentDetails.status;

            if (expiresAt && expiresAt < now) {
              if (graceEnds && graceEnds > now) {
                smartStatus = 'grace_period';
              } else {
                smartStatus = 'expired';
              }
            } else if (expiresAt && expiresAt > now && smartStatus !== 'suspended') {
              smartStatus = 'active';
            }

            const isValidNow = smartStatus === 'active' || smartStatus === 'grace_period';

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

            saveLicenseToStorage(finalDetails);

            if (!isValidNow) {
              showMessageModal(
                `⛔ ACCESO DENEGADO: Licencia en estado ${smartStatus.toUpperCase()}`,
                () => window.location.reload(),
                { type: 'error', confirmButtonText: 'Recargar Sistema' }
              );
            }
          },

          onDeviceChanged: (event) => {
            if (event.status === 'banned' || event.status === 'deleted') {
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
    } catch (error) {
      console.error('Error inicializando seguridad realtime:', error);
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
    } catch (err) {
      console.warn('Error deteniendo listener:', err);
    } finally {
      set({ 
        realtimeSubscription: null,
        _securityCleanupScheduled: false 
      });
    }
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
      }
      return { success: false, message: result.message || 'Licencia no válida' };
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

        if (serverCheck?.valid === false && serverCheck.reason !== 'offline_grace') {
          await logout();
          return false;
        }

        if (serverCheck?.grace_period_ends) {
          set({
            gracePeriodEnds: serverCheck.grace_period_ends,
            licenseStatus: serverCheck.status || serverCheck.reason
          });
        }
      } catch (error) {
        console.warn("Verificación fallida, manteniendo sesión offline:", error);
      }
    }

    return true;
  }
}));