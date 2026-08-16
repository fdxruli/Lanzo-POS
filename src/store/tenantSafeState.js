import { LOCAL_TENANT_STATUS } from '../services/tenant/localTenantPolicy';

const TENANT_VISIBLE_APP_STATUSES = new Set(['ready', 'setup_required']);
const isPresent = (value) => value !== null && value !== undefined;

export const isUnsafeTenantStatePatch = (patch = {}, guardState = {}, currentState = {}) => {
  const exposesEcommerceRuntime = (
    (Array.isArray(patch.ecommerceOrders) && patch.ecommerceOrders.length > 0)
    || isPresent(patch.selectedEcommerceOrder)
    || isPresent(patch.ecommerceOrdersLicenseIdentity)
    || isPresent(patch.ecommerceOrdersActorIdentity)
    || isPresent(patch.selectedEcommerceOrderLicenseIdentity)
    || isPresent(patch.selectedEcommerceOrderActorIdentity)
    || Object.values(patch.ecommerceOrderCounts || {}).some((value) => Number(value) > 0)
  );
  const exposesNotificationRuntime = (
    (Array.isArray(patch.notifications) && patch.notifications.length > 0)
    || Number(patch.notificationsUnreadCount || 0) > 0
    || (Array.isArray(patch.supportTickets) && patch.supportTickets.length > 0)
    || isPresent(patch.activeSupportTicket)
    || (Array.isArray(patch.supportTicketMessages) && patch.supportTicketMessages.length > 0)
  );
  const exposesTenantRuntime = TENANT_VISIBLE_APP_STATUSES.has(patch.appStatus)
    || isPresent(patch.companyProfile)
    || isPresent(patch.profileImportCandidate)
    || isPresent(patch.driveAccessToken)
    || patch.isDriveConnected === true
    || patch.cashOpeningPolicy === 'automatic'
    || exposesEcommerceRuntime
    || exposesNotificationRuntime;
  const actorLoginBoundary = (
    currentState.appStatus === 'admin_login_required' && !currentState.currentAdminUser
  ) || (
    currentState.appStatus === 'staff_login_required' && !currentState.currentStaffUser
  );
  const logoutBoundary = currentState._isLoggingOut === true;

  if (guardState.enabled && (actorLoginBoundary || logoutBoundary) && exposesTenantRuntime) return true;
  if (!guardState.enabled || guardState.status === LOCAL_TENANT_STATUS.GRANTED) return false;

  if (
    guardState.status === LOCAL_TENANT_STATUS.MISMATCH
    || guardState.status === LOCAL_TENANT_STATUS.LEGACY_UNRESOLVED
  ) {
    if (
      currentState.appStatus === 'local_tenant_mismatch'
      && patch.appStatus
      && patch.appStatus !== 'local_tenant_mismatch'
    ) return true;
  }

  return exposesTenantRuntime
    || isPresent(patch.currentAdminUser)
    || isPresent(patch.currentStaffUser);
};
