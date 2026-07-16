import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import { PRODUCT_SYNC_EVENT } from '../../services/products/productConstants';
import { TICKER_INVENTORY_ALERT_EVENT } from '../../services/tickerAlertEvents';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ecommerceCatalogSyncService
} from '../../services/ecommerce/ecommerceCatalogSyncService';
import { syncEcommerceCatalogAfterHydration } from '../../services/ecommerce/ecommerceCatalogHydration';

const getStaffIdentity = (staff = {}) => String(
  staff.sessionToken
  || staff.session_token
  || staff.staffSessionToken
  || staff.staff_session_token
  || staff.id
  || staff.staffId
  || staff.staff_id
  || ''
);

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(
  useAppStore.getState()?.licenseDetails || {}
);

export default function EcommerceCatalogSyncRuntime() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const contextIdentity = useMemo(() => [
    getLicenseKeyFromDetails(licenseDetails || {}),
    currentDeviceRole || 'unknown',
    getStaffIdentity(currentStaffUser || {})
  ].join(':'), [currentDeviceRole, currentStaffUser, licenseDetails]);

  useEffect(() => {
    ecommerceCatalogSyncService.invalidateContext();
    const licenseKey = getLicenseKeyFromDetails(licenseDetails || {});
    if (!licenseKey) return undefined;

    let active = true;
    void syncEcommerceCatalogAfterHydration({
      licenseKey,
      forceHydration: true,
      request: { reason: 'runtime-context-ready' },
      shouldContinue: () => active && getRuntimeLicenseKey() === licenseKey
    });

    return () => {
      active = false;
      ecommerceCatalogSyncService.invalidateContext();
    };
  }, [contextIdentity, licenseDetails]);

  useEffect(() => {
    const runHydratedReconcile = ({ reason, forceHydration = false } = {}) => {
      const licenseKey = getRuntimeLicenseKey();
      if (!licenseKey) return Promise.resolve({ skipped: true, reason: 'missing_license' });
      return syncEcommerceCatalogAfterHydration({
        licenseKey,
        forceHydration,
        request: { reason },
        shouldContinue: () => getRuntimeLicenseKey() === licenseKey
      });
    };

    const scheduleFromEvent = (event, fallbackReason) => {
      const productIds = Array.isArray(event?.detail?.productIds)
        ? event.detail.productIds
        : [];
      ecommerceCatalogSyncService.scheduleSync({
        productIds,
        fullReconcile: productIds.length === 0,
        reason: event?.detail?.reason || event?.detail?.source || fallbackReason
      });
    };

    const handleProductChange = (event) => scheduleFromEvent(event, 'product-change');
    const handleInventoryChange = (event) => scheduleFromEvent(event, 'inventory-change');
    const handleOnline = () => {
      void runHydratedReconcile({ reason: 'online', forceHydration: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runHydratedReconcile({ reason: 'visibility', forceHydration: false });
      }
    };
    const handleManualRequest = (event) => {
      const productIds = Array.isArray(event?.detail?.productIds)
        ? event.detail.productIds
        : [];
      const fullReconcile = event?.detail?.fullReconcile !== false;
      const reason = event?.detail?.reason || 'manual';

      if (fullReconcile) {
        void runHydratedReconcile({ reason, forceHydration: true });
        return;
      }

      void ecommerceCatalogSyncService.syncNow({
        productIds,
        fullReconcile: false,
        reason
      });
    };

    window.addEventListener(PRODUCT_SYNC_EVENT, handleProductChange);
    window.addEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, handleManualRequest);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener(PRODUCT_SYNC_EVENT, handleProductChange);
      window.removeEventListener(TICKER_INVENTORY_ALERT_EVENT, handleInventoryChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, handleManualRequest);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return null;
}
