import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import { useFeatureConfig } from '../useFeatureConfig';
import {
  getLicenseKeyFromDetails,
  isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';

const REFRESH_DEBOUNCE_MS = 700;

import { buildRestaurantCloudStatusSummary, RESTAURANT_ORDER_STATUS_LABELS, RESTAURANT_ORDER_ITEM_STATUS_LABELS, hasStaffPermission, friendlyStatusError, getStatusLabel, RESTAURANT_CLOUD_STATUS_EVENT } from '../../services/restaurant/restaurantCloudStatusSummary';
export { buildRestaurantCloudStatusSummary, normalizeRestaurantCloudStatus, RESTAURANT_ORDER_STATUS_LABELS, RESTAURANT_ORDER_ITEM_STATUS_LABELS, RESTAURANT_CLOUD_STATUS_EVENT } from '../../services/restaurant/restaurantCloudStatusSummary';

const resolveCloudStatusEnabled = ({ enabled, licenseDetails, featureConfig, currentDeviceRole, canAccess, localOrderId }) => {
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const isCloudRestaurantOrdersEnabled = Boolean(
    licenseKey &&
    licenseDetails?.valid !== false &&
    isRestaurantOrdersCloudEnabled(licenseDetails)
  );
  const isFoodServiceBusiness = (featureConfig?.activeRubros || []).includes(CANONICAL_BUSINESS_TYPES.FOOD_SERVICE);
  const hasReadPermission = currentDeviceRole !== 'staff'
    || hasStaffPermission(canAccess, ['orders', 'pos', 'kitchen', 'kds']);

  return {
    licenseKey,
    isCloudRestaurantOrdersEnabled,
    isFoodServiceBusiness,
    hasReadPermission,
    isEnabled: Boolean(enabled && localOrderId && isCloudRestaurantOrdersEnabled && isFoodServiceBusiness && hasReadPermission)
  };
};

export const getRestaurantOrderCloudStatusSnapshot = async ({ licenseDetails, localOrderId, force = true } = {}) => {
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const enabled = Boolean(
    licenseKey &&
    localOrderId &&
    licenseDetails?.valid !== false &&
    isRestaurantOrdersCloudEnabled(licenseDetails)
  );

  if (!enabled) {
    return { success: true, skipped: true, found: false, order: null, summary: buildRestaurantCloudStatusSummary(null) };
  }

  const response = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({
    licenseKey,
    localOrderId,
    force
  });

  const cloudOrder = response?.order || null;
  return {
    ...response,
    found: response?.success === false ? null : response?.found,
    order: cloudOrder,
    summary: buildRestaurantCloudStatusSummary(cloudOrder)
  };
};

export function useRestaurantOrderCloudStatus({ localOrderId, enabled = true } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const featureConfig = useFeatureConfig();

  const {
    licenseKey,
    isCloudRestaurantOrdersEnabled,
    isFoodServiceBusiness,
    hasReadPermission,
    isEnabled
  } = resolveCloudStatusEnabled({
    enabled,
    licenseDetails,
    featureConfig,
    currentDeviceRole,
    canAccess,
    localOrderId
  });

  const [cloudOrder, setCloudOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isEnabled || !licenseKey) {
      setCloudOrder(null);
      setError(null);
      return { success: true, skipped: true, found: false, order: null };
    }

    setIsLoading(true);
    try {
      const response = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({
        licenseKey,
        localOrderId,
        force
      });

      const nextOrder = response?.order || null;
      setCloudOrder(nextOrder);
      setError(response?.success === false ? friendlyStatusError(response) : null);
      setLastUpdatedAt(new Date().toISOString());
      return response;
    } catch (refreshError) {
      const message = friendlyStatusError(refreshError);
      setError(message);
      setLastUpdatedAt(new Date().toISOString());
      return { success: false, found: false, order: null, error: refreshError, message };
    } finally {
      setIsLoading(false);
    }
  }, [isEnabled, licenseKey, localOrderId]);

  useEffect(() => {
    if (!isEnabled) {
      setCloudOrder(null);
      setError(null);
      return;
    }

    refresh({ force: false });
  }, [isEnabled, refresh]);

  const refreshRef = useRef(refresh);
  const loadingRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (!isEnabled || typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    let refreshTimer = null;

    const clearRefreshTimer = () => {
      if (!refreshTimer) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    };

    const requestRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (loadingRef.current) return;
      clearRefreshTimer();
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!loadingRef.current) refreshRef.current({ force: true }).catch(() => {});
      }, REFRESH_DEBOUNCE_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestRefresh();
    };

    window.addEventListener(RESTAURANT_CLOUD_STATUS_EVENT, requestRefresh);
    window.addEventListener('online', requestRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearRefreshTimer();
      window.removeEventListener(RESTAURANT_CLOUD_STATUS_EVENT, requestRefresh);
      window.removeEventListener('online', requestRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isEnabled]);

  const summary = useMemo(() => buildRestaurantCloudStatusSummary(cloudOrder), [cloudOrder]);

  return {
    cloudOrder,
    isLoading,
    error,
    refresh,
    lastUpdatedAt,
    hasCancelledItems: summary.hasCancelledItems,
    cancelledItems: summary.cancelledItems,
    hasPendingItems: summary.hasPendingItems,
    pendingItems: summary.pendingItems,
    hasPreparingItems: summary.hasPreparingItems,
    preparingItems: summary.preparingItems,
    readyItems: summary.readyItems,
    doneItems: summary.doneItems,
    activeItems: summary.activeItems,
    items: summary.items,
    status: summary.status,
    statusLabel: summary.statusLabel,
    paymentStatus: summary.paymentStatus,
    isPaid: summary.isPaid,
    isPaidPendingKitchen: summary.isPaidPendingKitchen,
    paidAt: summary.paidAt,
    paidSaleId: summary.paidSaleId,
    paidSaleFolio: summary.paidSaleFolio,
    paidTotal: summary.paidTotal,
    checkoutClosedAt: summary.checkoutClosedAt,
    isReady: summary.isReady,
    isCancelled: summary.isCancelled,
    isCloudStatusEnabled: isEnabled,
    isCloudRestaurantOrdersEnabled,
    isFoodServiceBusiness,
    hasReadPermission,
    getOrderStatusLabel: (status) => getStatusLabel(status, RESTAURANT_ORDER_STATUS_LABELS),
    getItemStatusLabel: (status) => getStatusLabel(status, RESTAURANT_ORDER_ITEM_STATUS_LABELS)
  };
}

export default useRestaurantOrderCloudStatus;
