// src/store/slices/license/licenseState.js

export const createLicenseInitialState = () => ({
  realtimeSubscription: null,
  _isInitializingSecurity: false,
  _isRecoveringRealtime: false,
  _securityCleanupScheduled: false,
  licenseSyncActive: false,
  licenseSyncMode: 'idle',
  licenseSyncLicenseKey: null,
  _isLicenseSyncChecking: false,

  licenseStatus: 'active',
  gracePeriodEnds: null,
  licenseDetails: null,
  currentDeviceRole: null,
  currentStaffUser: null,
  staffLoginLicenseKey: null,
  staffLoginMessage: null,
  staffLoginError: null,
  licensePlanBlockInfo: null,

  _isInitializing: false,
  pendingTermsUpdate: null
});