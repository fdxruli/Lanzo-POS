import { useEffect } from 'react';
import { useEcommercePublishedStockAlerts } from '../../hooks/useEcommercePublishedStockAlerts';
import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import {
  canStaffAccessEcommerceOperationalAlert,
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  shouldUseLocalTicker
} from '../../services/notifications/notificationCapabilities';
import { TICKER_INVENTORY_ALERT_EVENT } from '../../services/tickerAlertEvents';
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
  const {
    contextKey,
    invalidate,
    load
  } = useEcommercePublishedStockAlerts({
    enabled,
    autoLoad: enabled,
    reason: 'application-runtime'
  });

  useEffect(() => {
    if (!enabled || !contextKey || typeof window === 'undefined') return undefined;

    const handleInventoryChange = () => {
      invalidate?.({ reason: 'inventory-event' });
      void load?.({
        force: true,
        reason: 'inventory-event',
        background: true
      });
    };

    window.addEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryChange);
    return () => {
      window.removeEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryChange);
    };
  }, [contextKey, enabled, invalidate, load]);

  return null;
}
