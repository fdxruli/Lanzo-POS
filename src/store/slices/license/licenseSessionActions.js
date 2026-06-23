// src/store/slices/license/licenseSessionActions.js

import Logger from '../../../services/Logger';

import {
  clearLicenseSecurityCache,
  clearStaffSessionCache
} from '../../../services/supabase';

import {
  clearLicenseFromStorage
} from '../../../services/licenseStorage';

import {
  buildLicensePlanBlockInfo
} from './licenseGuards';

const clearLocalLicenseSession = async () => {
  clearLicenseFromStorage();
  await clearLicenseSecurityCache();
};

export const createLicenseSessionActions = ({
  set,
  get
}) => ({
  _requireLicenseChange: async (licenseSource = null, validation = {}) => {
    const state = get();
    const sourceLicense = licenseSource || state.licenseDetails || {};
    const blockInfo = buildLicensePlanBlockInfo(validation, sourceLicense);

    Logger.warn('[LicensePlan] Licencia bloqueada por cambio de plan:', blockInfo);

    await get().stopLicenseSync();
    await clearStaffSessionCache();
    await clearLocalLicenseSession();

    set({
      appStatus: 'license_change_required',
      licenseDetails: null,
      licenseStatus: blockInfo.reason || 'license_plan_blocked',
      licensePlanBlockInfo: blockInfo,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      pendingTermsUpdate: null,
      realtimeSubscription: null,
      _isInitializing: false,
      _isInitializingSecurity: false,
      _isRecoveringRealtime: false,
      _securityCleanupScheduled: false,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false,
      serverHealth: 'ok',
      serverMessage: null
    });
  },

  confirmLicenseChangeRequired: async () => {
    await clearLocalLicenseSession();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      licenseStatus: 'active',
      licensePlanBlockInfo: null,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      pendingTermsUpdate: null,
      serverHealth: 'ok',
      serverMessage: null
    });
  },

  logout: async () => {
    await get().stopLicenseSync();

    await clearLocalLicenseSession();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      licensePlanBlockInfo: null,
      companyProfile: null,
      profileImportCandidate: null,
      licenseStatus: 'active',
      gracePeriodEnds: null,
      currentDeviceRole: null,
      currentStaffUser: null,
      staffLoginLicenseKey: null,
      staffLoginMessage: null,
      staffLoginError: null,
      realtimeSubscription: null,
      _isInitializingSecurity: false,
      _isRecoveringRealtime: false,
      _securityCleanupScheduled: false,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false,
      serverHealth: 'ok',
      serverMessage: null
    });
  }
});

export const clearLocalLicenseSessionForLicenseSlice = clearLocalLicenseSession;