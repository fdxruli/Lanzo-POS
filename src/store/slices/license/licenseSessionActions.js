// src/store/slices/license/licenseSessionActions.js

import Logger from '../../../services/Logger';
import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';

import {
  clearAdminSessionCache,
  clearStaffSessionCache
} from '../../../services/supabase';

import {
  clearLicenseFromStorage
} from '../../../services/licenseStorage';

import {
  buildLicensePlanBlockInfo
} from './licenseGuards';
import { invalidateProfileRefreshMetadata } from './profileRefreshCache';
import {
  getLocalTenantGuardState,
  lockLocalTenantAccess
} from '../../../services/tenant/localTenantGuard';
import { closeTenantRuntime } from '../../../services/db/tenantRuntimeRouter';

const clearLocalLicenseSession = async () => {
  clearLicenseFromStorage();
  invalidateProfileRefreshMetadata();
  // Preserve device validation + last-valid offline state. Logout revokes
  // actor sessions only; the sticky tenant must remain usable offline.
  try {
    if (getLocalTenantGuardState().status === 'granted') {
      await Promise.all([
        clearAdminSessionCache(),
        clearStaffSessionCache()
      ]);
    }
  } catch (error) {
    Logger.warn('[LicenseSession] No se pudieron limpiar todos los tokens de actor:', error);
  } finally {
    lockLocalTenantAccess('license_session_cleared');
    // This invalidates all DB proxy operations but preserves the physical DB
    // and its tenant-scoped browser namespace for the next actor of A.
    closeTenantRuntime();
  }
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

    get()._invalidateProfileLoads?.();
    get().resetNotificationRuntime?.();

    await get().stopLicenseSync();
    await clearStaffSessionCache();
    await clearLocalLicenseSession();
    notifyPosCatalogSessionReset();

    set({
      appStatus: 'license_change_required',
      licenseDetails: null,
      licenseStatus: blockInfo.reason || 'license_plan_blocked',
      licensePlanBlockInfo: blockInfo,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentAdminUser: null,
      adminLoginLicenseKey: null,
      adminLoginMessage: null,
      adminLoginError: null,
      adminEnrollmentRequired: false,
      pendingAdminSessionResult: null,
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
    get()._invalidateProfileLoads?.();
    get().resetNotificationRuntime?.();
    await clearLocalLicenseSession();
    get().lockDriveSession?.();
    notifyPosCatalogSessionReset();

    set({
      appStatus: 'unauthenticated',
      licenseDetails: null,
      licenseStatus: 'active',
      licensePlanBlockInfo: null,
      gracePeriodEnds: null,
      companyProfile: null,
      profileImportCandidate: null,
      currentDeviceRole: null,
      currentAdminUser: null,
      adminLoginLicenseKey: null,
      adminLoginMessage: null,
      adminLoginError: null,
      adminEnrollmentRequired: false,
      pendingAdminSessionResult: null,
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
    // Remove tenant-owned UI synchronously. The compatible A session remains
    // authorized only long enough to revoke its own actor credentials.
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().resetNotificationRuntime?.();
    set({
      appStatus: 'loading',
      _isLoggingOut: true,
      companyProfile: null,
      profileImportCandidate: null,
      cashOpeningPolicy: 'manual'
    });
    get().lockDriveSession?.();
    notifyPosCatalogSessionReset();
    await get().stopLicenseSync();

    await clearLocalLicenseSession();
    get().lockDriveSession?.();

    set({
      appStatus: 'unauthenticated',
      _isLoggingOut: false,
      licenseDetails: null,
      licensePlanBlockInfo: null,
      companyProfile: null,
      profileImportCandidate: null,
      cashOpeningPolicy: 'manual',
      licenseStatus: 'active',
      gracePeriodEnds: null,
      currentDeviceRole: null,
      currentAdminUser: null,
      adminLoginLicenseKey: null,
      adminLoginMessage: null,
      adminLoginError: null,
      adminEnrollmentRequired: false,
      pendingAdminSessionResult: null,
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
  },

  leaveLocalTenantMismatch: async () => {
    // A mismatch must never clear sync_cache: those credentials and recovery
    // records belong to the database's original tenant, not the attempted one.
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().resetNotificationRuntime?.();
    await get().stopLicenseSync();
    get().lockDriveSession?.();
    clearLicenseFromStorage();
    invalidateProfileRefreshMetadata();
    lockLocalTenantAccess('mismatch_dismissed');
    notifyPosCatalogSessionReset();

    set({
      appStatus: 'unauthenticated',
      _isLoggingOut: false,
      licenseDetails: null,
      companyProfile: null,
      profileImportCandidate: null,
      cashOpeningPolicy: 'manual',
      licenseStatus: 'active',
      gracePeriodEnds: null,
      currentDeviceRole: null,
      currentAdminUser: null,
      currentStaffUser: null,
      adminLoginLicenseKey: null,
      staffLoginLicenseKey: null,
      pendingAdminSessionResult: null,
      localTenantIsolation: null,
      pendingTermsUpdate: null,
      realtimeSubscription: null,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false
    });
  }
});

export const clearLocalLicenseSessionForLicenseSlice = clearLocalLicenseSession;
