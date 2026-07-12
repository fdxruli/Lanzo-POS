import { useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getEcommercePublishedStockAlertContextKey } from '../services/ecommerce/ecommercePublishedStockAlertService';

export function useEcommercePublishedStockAlerts({
  enabled = true,
  autoLoad = true,
  reason = 'surface'
} = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const deviceFingerprint = useAppStore((state) => (
    state.deviceFingerprint || state.device_fingerprint || null
  ));
  const snapshot = useAppStore((state) => state.ecommercePublishedStockAlertSnapshot);
  const loading = useAppStore((state) => state.ecommercePublishedStockAlertLoading);
  const error = useAppStore((state) => state.ecommercePublishedStockAlertError);
  const loadedAt = useAppStore((state) => state.ecommercePublishedStockAlertLoadedAt);
  const storedContextKey = useAppStore((state) => state.ecommercePublishedStockAlertContextKey);
  const load = useAppStore((state) => state.loadEcommercePublishedStockAlerts);
  const invalidate = useAppStore((state) => state.invalidateEcommercePublishedStockAlerts);
  const clear = useAppStore((state) => state.clearEcommercePublishedStockAlerts);

  const contextKey = useMemo(() => getEcommercePublishedStockAlertContextKey({
    licenseDetails,
    currentDeviceRole,
    currentStaffUser,
    deviceFingerprint
  }), [currentDeviceRole, currentStaffUser, deviceFingerprint, licenseDetails]);

  const safeSnapshot = contextKey && storedContextKey === contextKey ? snapshot : null;

  useEffect(() => {
    if (!enabled || !autoLoad || !contextKey) return;
    void load?.({ force: false, reason, background: false });
  }, [autoLoad, contextKey, enabled, load, reason]);

  return {
    snapshot: safeSnapshot,
    loading: enabled ? loading : false,
    error: enabled ? error : null,
    loadedAt: enabled ? loadedAt : null,
    contextKey,
    load,
    invalidate,
    clear
  };
}
