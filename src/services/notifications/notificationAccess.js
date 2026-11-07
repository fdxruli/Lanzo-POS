import { readActorAccess } from '../auth/actorAccessPolicy';
import { getNotificationCapabilities } from './notificationCapabilities';

export const getNotificationLicenseIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_id || licenseDetails?.id
  || licenseDetails?.details?.license_id || licenseDetails?.details?.id
  || licenseDetails?.license_key || licenseDetails?.licenseKey
  || licenseDetails?.details?.license_key || licenseDetails?.details?.licenseKey
  || null
);

export const canAccessCloudNotificationCenter = (licenseDetails, access) => {
  const capabilities = getNotificationCapabilities(licenseDetails);
  return Boolean(getNotificationLicenseIdentity(licenseDetails)) && access.canAccessPermission('notifications')
    && capabilities.notification_center && capabilities.cloud_notifications;
};

// Includes the live runtime generation/session and grants, never a historical role.
export const getNotificationAuthorizationKey = (state, access = readActorAccess(state)) => (
  access.isAuthorizedActor ? JSON.stringify([
    access.runtimeSnapshot.sessionId,
    access.runtimeSnapshot.generation,
    access.runtimeSnapshot.tenant,
    access.runtimeSnapshot.deviceRef,
    getNotificationLicenseIdentity(state.licenseDetails),
    access.permissionSession,
    getNotificationCapabilities(state.licenseDetails)
  ]) : null
);

const DENIED_CODES = new Set([
  'STAFF_NOTIFICATIONS_DISABLED', 'NOTIFICATION_CENTER_DISABLED',
  'STAFF_SESSION_REQUIRED', 'STAFF_SESSION_INVALID', 'STAFF_SESSION_EXPIRED',
  'POS_NOTIFICATIONS_AUTH_CONTEXT_INCOMPLETE', 'LICENSE_KEY_REQUIRED',
  '42501', 'PGRST301', 'PGRST302'
]);

export const isNotificationAccessDenied = (error) => (
  DENIED_CODES.has(error?.code) || DENIED_CODES.has(error?.message)
  || error?.status === 401 || error?.status === 403
);

export const NOTIFICATION_ACCESS_MESSAGE = 'No tienes acceso a las notificaciones en esta sesión. Si necesitas acceso, consulta al administrador del negocio.';
