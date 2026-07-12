import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import { PRODUCT_SYNC_EVENT } from '../../services/products/productConstants';
import { TICKER_INVENTORY_ALERT_EVENT } from '../../services/tickerAlertEvents';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ecommerceCatalogSyncService
} from '../../services/ecommerce/ecommerceCatalogSyncService';

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
    if (!getLicenseKeyFromDetails(licenseDetails || {})) return undefined;

    ecommerceCatalogSyncService.scheduleSync({
      fullReconcile: true,
      reason: 'runtime-context-ready'
    });

    return () => {
      ecommerceCatalogSyncService.invalidateContext();
    };
  }, [contextIdentity, licenseDetails]);

  useEffect(() => {
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
      void ecommerceCatalogSyncService.syncNow({ reason: 'online', fullReconcile: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        ecommerceCatalogSyncService.scheduleSync({
          fullReconcile: true,
          reason: 'visibility'
        });
      }
    };
    const handleManualRequest = (event) => {
      void ecommerceCatalogSyncService.syncNow({
        productIds: event?.detail?.productIds || [],
        fullReconcile: event?.detail?.fullReconcile !== false,
        reason: event?.detail?.reason || 'manual'
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
