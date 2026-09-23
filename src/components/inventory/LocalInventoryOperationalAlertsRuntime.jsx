import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  shouldUseLocalInventoryOperationalBell
} from '../../services/notifications/notificationCapabilities';
import {
  refreshLocalInventoryOperationalAlertsSnapshot,
  resetLocalInventoryOperationalAlertsRuntime
} from '../../services/localInventoryOperationalAlerts';
import {
  TICKER_ALERT_POLL_INTERVAL_MS
} from '../../services/tickerAlerts';
import { TICKER_INVENTORY_ALERT_EVENT } from '../../services/tickerAlertEvents';

export default function LocalInventoryOperationalAlertsRuntime() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const enabled = shouldUseLocalInventoryOperationalBell(licenseDetails);
  const runtimeIdentity = (
    licenseDetails?.license_id
    || licenseDetails?.id
    || licenseDetails?.license_key
    || licenseDetails?.licenseKey
    || 'local'
  );

  useEffect(() => {
    if (!enabled) {
      resetLocalInventoryOperationalAlertsRuntime();
      return undefined;
    }

    let cancelled = false;

    const refreshIfVisible = () => {
      if (
        cancelled
        || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      ) {
        return;
      }
      void refreshLocalInventoryOperationalAlertsSnapshot();
    };

    const initialTimer = window.setTimeout(refreshIfVisible, 0);
    const intervalId = window.setInterval(
      refreshIfVisible,
      TICKER_ALERT_POLL_INTERVAL_MS
    );

    const handleInventoryEvent = () => refreshIfVisible();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfVisible();
    };

    window.addEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryEvent);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      window.removeEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryEvent);
      document.removeEventListener('visibilitychange', handleVisibility);
      resetLocalInventoryOperationalAlertsRuntime();
    };
  }, [enabled, runtimeIdentity]);

  return null;
}
