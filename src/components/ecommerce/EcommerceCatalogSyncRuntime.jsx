import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled
} from '../../services/sync/syncConstants';
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

const getRuntimeLicenseDetails = () => useAppStore.getState()?.licenseDetails || {};
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(getRuntimeLicenseDetails());
const canHydrateRuntimeCloudCatalog = () => isCloudProductsSyncEnabled(
  getRuntimeLicenseDetails()
);

export default function EcommerceCatalogSyncRuntime() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const contextIdentity = useMemo(() => [
    getLicenseKeyFromDetails(licenseDetails || {}),
    isCloudProductsSyncEnabled(licenseDetails || {}) ? 'cloud-products' : 'local-products',
    currentDeviceRole || 'unknown',
    getStaffIdentity(currentStaffUser || {})
  ].join(':'), [currentDeviceRole, currentStaffUser, licenseDetails]);

  useEffect(() => {
    ecommerceCatalogSyncService.invalidateContext();
    const licenseKey = getLicenseKeyFromDetails(licenseDetails || {});
    if (!licenseKey) return undefined;

    let active = true;
    void (async () => {
      const request = {
        licenseKey,
        forceHydration: true,
        hydrateCloudCatalog: isCloudProductsSyncEnabled(licenseDetails || {}),
        suppressRecoverableConflictLog: true,
        request: { reason: 'runtime-context-ready' },
        shouldContinue: () => active && getRuntimeLicenseKey() === licenseKey
      };
      const result = await syncEcommerceCatalogAfterHydration(request);

      // La ruta inicial también puede arrancar con un IndexedDB anterior al
      // snapshot actual. Rehidratar y reintentar una vez evita dejar el portal
      // permanentemente bloqueado por una firma heredada.
      if (
        active
        && result?.code === 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'
        && getRuntimeLicenseKey() === licenseKey
      ) {
        await syncEcommerceCatalogAfterHydration({
          ...request,
          suppressRecoverableConflictLog: false,
          request: { reason: 'runtime-context-conflict-recovery' }
        });
      }
    })();

    return () => {
      active = false;
      ecommerceCatalogSyncService.invalidateContext();
    };
  }, [contextIdentity, licenseDetails]);

  useEffect(() => {
    const runHydratedReconcile = async ({
      reason,
      forceHydration = false,
      recoveryAttempt = false,
      suppressRecoverableConflictLog = true
    } = {}) => {
      const licenseKey = getRuntimeLicenseKey();
      if (!licenseKey) return Promise.resolve({ skipped: true, reason: 'missing_license' });
      const result = await syncEcommerceCatalogAfterHydration({
        licenseKey,
        forceHydration,
        hydrateCloudCatalog: canHydrateRuntimeCloudCatalog(),
        suppressRecoverableConflictLog,
        request: { reason },
        shouldContinue: () => getRuntimeLicenseKey() === licenseKey
      });

      // Una copia IndexedDB puede conservar una proyección de la misma revisión
      // pero con una firma anterior. Descargamos una vez el snapshot cloud y
      // reintentamos, sin entrar en un ciclo si el conflicto es genuino.
      if (
        recoveryAttempt !== true
        && result?.code === 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'
        && getRuntimeLicenseKey() === licenseKey
      ) {
        return runHydratedReconcile({
          reason: `${reason || 'catalog-sync'}-conflict-recovery`,
          forceHydration: true,
          recoveryAttempt: true,
          suppressRecoverableConflictLog: false
        });
      }

      return result;
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
