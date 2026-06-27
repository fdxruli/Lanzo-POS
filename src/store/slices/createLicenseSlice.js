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
import { createLicenseBootstrapActions } from './license/licenseBootstrapActions';
import {
  getLicenseSyncIntervalMs,
  getLicenseSyncMode
} from './license/licenseGuards';

const clearLocalLicenseSession = clearLocalLicenseSessionForLicenseSlice;
const LAST_VALIDATION_STORAGE_KEY = 'Lanzo_last_validation_persistent';

const readLastValidationMs = () => {
  try {
    const localValue = Number(localStorage.getItem(LAST_VALIDATION_STORAGE_KEY) || 0);
    const sessionValue = Number(sessionStorage.getItem('Lanzo_last_validation') || 0);
    const candidate = Math.max(localValue || 0, sessionValue || 0);
    return Number.isFinite(candidate) ? candidate : 0;
  } catch {
    return 0;
  }
};

const isCriticalBackgroundReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();
  return (
    normalized.includes('realtime') ||
    normalized.includes('force') ||
    normalized.includes('staff') ||
    normalized.includes('plan') ||
    normalized.includes('device') ||
    normalized.includes('renewal') ||
    normalized.includes('activation')
  );
};

const shouldSkipBackgroundValidation = (licenseDetails, options = {}) => {
  if (options.refreshProfile) return false;
  if (isCriticalBackgroundReason(options.reason)) return false;
  if (!licenseDetails?.license_key) return false;

  const intervalMs = getLicenseSyncIntervalMs(
    licenseDetails,
    getLicenseSyncMode(licenseDetails)
  );
  const lastValidationMs = readLastValidationMs();

  return lastValidationMs > 0 && Date.now() - lastValidationMs < intervalMs;
};

export const createLicenseSlice = (set, get) => {
  const backgroundValidationActions = createLicenseBackgroundValidationActions({
    set,
    get,
    clearLocalLicenseSession,
    hasStaffValidationContext
  });

  return {
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

    ...backgroundValidationActions,

    ...createLicenseBootstrapActions({
      set,
      get
    }),

    _validateInBackground: async (licenseKey, options = {}) => {
      const normalizedOptions = {
        reason: 'background',
        refreshProfile: false,
        ...(options || {})
      };

      if (shouldSkipBackgroundValidation(get().licenseDetails, normalizedOptions)) {
        return false;
      }

      return backgroundValidationActions._validateInBackground(licenseKey, normalizedOptions);
    }
  };
};
