import {
  isBasicLicense,
  isFreeLicense,
  isProLicense
} from '../../store/slices/license/licenseGuards';
import {
  getPlanFeaturesFromLicenseDetails,
  isCloudPosSyncEnabled
} from '../../services/sync/syncConstants';
import {
  getNotificationCapabilities,
  isNotificationCenterEnabled,
  isSupportCenterEnabled
} from '../../services/notifications/notificationCapabilities';
import { getLicenseStatusPresentation } from '../../utils/licenseStatusPresentation';

/**
 * This controls static discovery UI only. Existing feature and actor guards
 * continue to control every operational action and remote request.
 */
export const canShowLocalPlanDiscovery = (
  licenseDetails = {},
  settingsAccess = {},
  section = 'license'
) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  const status = getLicenseStatusPresentation(licenseDetails).status;

  return Boolean(
    settingsAccess?.isAuthorizedActor === true
    && settingsAccess?.isAdmin === true
    && settingsAccess?.canAccessSection?.(section) === true
    && licenseDetails?.valid === true
    && licenseDetails?.is_entitled !== false
    && status === 'active'
    && isFreeLicense(licenseDetails)
    && !isProLicense(licenseDetails)
    && !isBasicLicense(licenseDetails)
    && features?.staff_roles === false
    && features?.realtime_license_sync === false
    && isCloudPosSyncEnabled(licenseDetails) === false
  );
};

export const getLocalPlanDiscoveryCapabilities = (licenseDetails = {}, settingsAccess = {}, section = 'license') => {
  if (!canShowLocalPlanDiscovery(licenseDetails, settingsAccess, section)) return null;

  const capabilities = getNotificationCapabilities(licenseDetails);
  const showNotifications = (
    !isNotificationCenterEnabled(licenseDetails)
    && capabilities.cloud_notifications === false
  );
  const showSupport = (
    !isSupportCenterEnabled(licenseDetails)
    && capabilities.support_tickets === false
    && capabilities.support_ticket_history === false
  );

  return Object.freeze({
    team: true,
    notifications: showNotifications,
    support: showSupport,
    hasCloudCapabilities: showNotifications || showSupport
  });
};
