import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';
import { isLocalTenantAccessError } from '../../../services/tenant/localTenantGuard';
import { CASH_OPENING_POLICY } from '../../../services/cashOpeningPolicyService';

export const toLocalTenantIsolationInfo = (error) => ({
  code: error?.code || 'LOCAL_TENANT_ACCESS_REQUIRED',
  reason: error?.details?.reason || 'blocked',
  hasTenantOwnedData: error?.details?.hasTenantOwnedData === true,
  occupiedStores: Array.isArray(error?.details?.occupiedStores)
    ? [...error.details.occupiedStores]
    : [],
  evidenceSources: Array.isArray(error?.details?.evidenceSources)
    ? [...error.details.evidenceSources]
    : []
});

export const enterLocalTenantIsolationFailure = (set, error) => {
  if (!isLocalTenantAccessError(error)) return false;

  notifyPosCatalogSessionReset();
  set({
    appStatus: 'local_tenant_mismatch',
    licenseDetails: null,
    companyProfile: null,
    profileImportCandidate: null,
    currentDeviceRole: null,
    currentAdminUser: null,
    currentStaffUser: null,
    ecommerceOrders: [],
    ecommerceOrderCounts: {
      new: 0,
      seen: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      total: 0
    },
    ecommerceOrdersLicenseIdentity: null,
    ecommerceOrdersActorIdentity: null,
    selectedEcommerceOrder: null,
    selectedEcommerceOrderLicenseIdentity: null,
    selectedEcommerceOrderActorIdentity: null,
    driveAccessToken: null,
    driveTokenExpiresAt: null,
    isDriveConnected: false,
    needsDriveReauth: false,
    cashOpeningPolicy: CASH_OPENING_POLICY.MANUAL,
    pendingTermsUpdate: null,
    licenseSyncActive: false,
    licenseSyncMode: 'idle',
    licenseSyncLicenseKey: null,
    _isLicenseSyncChecking: false,
    localTenantIsolation: toLocalTenantIsolationInfo(error)
  });
  return true;
};
