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

  ...createLicenseBootstrapActions({
    set,
    get
  })
});
