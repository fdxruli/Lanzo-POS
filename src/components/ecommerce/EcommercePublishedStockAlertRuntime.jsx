import { useEcommercePublishedStockAlerts } from '../../hooks/useEcommercePublishedStockAlerts';
import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  shouldUseLocalTicker
} from '../../services/notifications/notificationCapabilities';
import { useAppStore } from '../../store/useAppStore';

export default function EcommercePublishedStockAlertRuntime() {
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const staffSession = { currentDeviceRole, currentStaffUser };

  const canManagePortal = evaluateEcommercePortalAccess({
    canAccess,
    currentDeviceRole
  });
  const canUseNotificationSurface = (
    isNotificationCenterEnabled(licenseDetails)
    && isCloudNotificationsEnabled(licenseDetails)
    && canStaffAccessNotifications(licenseDetails, staffSession)
    && canStaffAccessEcommerceOperationalAlert(licenseDetails, staffSession)
  );
  const enabled = canManagePortal && (
    shouldUseLocalTicker(licenseDetails)
    || canUseNotificationSurface
  );

  useEcommercePublishedStockAlerts({
    enabled,
    autoLoad: enabled,
    reason: 'application-runtime'
  });

  return null;
}
