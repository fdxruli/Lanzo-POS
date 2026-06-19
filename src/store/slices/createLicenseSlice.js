import { checkInternetConnection, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';

import {
  revalidateLicense,
  clearStaffSessionCache,
  hasStaffSessionToken,
  verifyStaffSession
} from '../../services/supabase';

import {
  getLicenseFromStorage
} from '../../services/licenseStorage';

import {
  isLicensePlanBlockFailure
} from './license/licenseGuards';

import { createLicenseInitialState } from './license/licenseState';
import { createLicenseRealtimeActions } from './license/licenseRealtimeActions';
import { createLicenseSyncActions } from './license/licenseSyncActions';

import {
  createLicenseStaffActions,
  hasStaffValidationContext
} from './license/licenseStaffActions';

import {
  createLicenseSessionActions,
  clearLocalLicenseSessionForLicenseSlice
} from './license/licenseSessionActions';

import { createLicenseActivationActions } from './license/licenseActivationActions';

import { createLicenseMaintenanceActions } from './license/licenseMaintenanceActions';

import { createLicenseProcessingActions } from './license/licenseProcessingActions';

import { createLicenseIntegrityActions } from './license/licenseIntegrityActions';

import { createLicenseBackgroundValidationActions } from './license/licenseBackgroundValidationActions';

const clearLocalLicenseSession = clearLocalLicenseSessionForLicenseSlice;

export const createLicenseSlice = (set, get) => ({
  ...createLicenseInitialState(),
  isAdminDevice: () => get().currentDeviceRole !== 'staff',
  canAccess: (permission) => {
    const state = get();
    if (state.currentDeviceRole !== 'staff') return true;
    if (!state.currentStaffUser) return false;
    return state.currentStaffUser.permissions?.[permission] === true;
  },

  ...createLicenseRealtimeActions({
    set,
    get,
    hasStaffValidationContext
  }),

  ...createLicenseSyncActions({
    set,
    get
  }),

  ...createLicenseStaffActions({
    set,
    get
  }),

  ...createLicenseSessionActions({
    set,
    get
  }),

  ...createLicenseActivationActions({
    set,
    get,
    hasStaffValidationContext
  }),

  ...createLicenseMaintenanceActions({
    set,
    get
  }),

  ...createLicenseProcessingActions({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
  }),

  ...createLicenseIntegrityActions({
    set,
    get,
    hasStaffValidationContext
  }),

  ...createLicenseBackgroundValidationActions({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
  }),

  initializeApp: async () => {
    if (get()._isInitializing) {
      Logger.warn('initializeApp ya está en ejecución, saltando...');
      return;
    }

    set({ _isInitializing: true });
    Logger.log('[AppStore] Iniciando aplicación (Modo Instantáneo)...');

    try {
      const localLicense = await getLicenseFromStorage();

      if (!localLicense?.license_key) {
        set({ appStatus: 'unauthenticated', _isInitializing: false });
        return;
      }

      Logger.log('[AppStore] Carga rápida activada - Usando caché local');
      const hasStoredStaffSession = await hasStaffSessionToken();
      const localDeviceRole = localLicense.device_role || (localLicense.staff_user ? 'staff' : 'admin');

      if (localDeviceRole === 'staff' || hasStoredStaffSession) {
        set({
          licenseDetails: { ...localLicense, device_role: 'staff' },
          currentDeviceRole: 'staff',
          currentStaffUser: null,
          staffLoginLicenseKey: localLicense.license_key
        });

        if (!navigator.onLine) {
          Logger.warn('[Staff] Sesion staff requiere verificacion online al iniciar.');
          set({
            appStatus: 'staff_login_required',
            staffLoginMessage: 'Necesitas internet para iniciar sesion staff.',
            staffLoginError: null,
            _isInitializing: false
          });
          return;
        }

        const staffSession = await verifyStaffSession(localLicense.license_key);

        if (!staffSession?.valid) {
          const serverCheck = await revalidateLicense(localLicense.license_key);

          if (isLicensePlanBlockFailure(serverCheck)) {
            await get()._requireLicenseChange(localLicense, serverCheck);
            return;
          }

          await clearStaffSessionCache();
          set({
            appStatus: 'staff_login_required',
            currentStaffUser: null,
            staffLoginMessage: staffSession?.message || 'Inicia sesion staff para continuar.',
            staffLoginError: null,
            _isInitializing: false
          });
          return;
        }

        const restoredLicense = {
          ...localLicense,
          device_role: 'staff',
          staff_user: staffSession.staff_user || localLicense.staff_user || null
        };

        await saveLicenseToStorage(restoredLicense);
        set({
          licenseDetails: restoredLicense,
          currentDeviceRole: 'staff',
          currentStaffUser: restoredLicense.staff_user,
          staffLoginMessage: null,
          staffLoginError: null
        });

        await get()._loadProfile(restoredLicense.license_key);
        set({ _isInitializing: false });
        get()._validateInBackground(restoredLicense.license_key);
        return;
      }

      await get()._processOfflineMode(localLicense);
      set({ _isInitializing: false });

      if (navigator.onLine) {
        get()._validateInBackground(localLicense.license_key);
      } else {
        Logger.log('[AppStore] Sin red al iniciar, se mantiene cache local.');
      }
    } catch (criticalError) {
      Logger.error('Error crítico inicializando:', criticalError);
      set({ appStatus: 'unauthenticated', _isInitializing: false });
    }
  },

});
