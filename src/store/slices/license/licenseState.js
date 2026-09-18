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
  lastIntegrityFailure: null,
  licenseDetails: null,
  currentDeviceRole: null,
  currentAdminUser: null,
  adminLoginLicenseKey: null,
  adminLoginMessage: null,
  adminLoginError: null,
  adminEnrollmentRequired: false,
  // Ephemeral UX routing only; never persisted or used as authority.
  ownerEnrollmentContext: null,
  currentStaffUser: null,
  staffLoginLicenseKey: null,
  staffLoginMessage: null,
  staffLoginError: null,
  licensePlanBlockInfo: null,
  localTenantIsolation: null,

  _isInitializing: false,
  _isLoggingOut: false,
  pendingTermsUpdate: null
});
