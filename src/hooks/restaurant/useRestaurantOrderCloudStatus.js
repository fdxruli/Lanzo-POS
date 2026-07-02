import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import { useFeatureConfig } from '../useFeatureConfig';
import {
  getLicenseKeyFromDetails,
  isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';

export const RESTAURANT_CLOUD_STATUS_EVENT = 'lanzo:restaurant-orders-cloud-updated';
const REFRESH_DEBOUNCE_MS = 700;

const ACTIVE_PENDING_STATUSES = new Set(['pending', 'open', 'sent', 'sent_to_kitchen']);
const PREPARING_STATUSES = new Set(['preparing']);
const READY_STATUSES = new Set(['ready']);
const CANCELLED_STATUSES = new Set(['cancelled']);

export const RESTAURANT_ORDER_STATUS_LABELS = Object.freeze({
  pending: 'En cocina',
  preparing: 'En preparación',
  ready: 'Lista',
  cancelled: 'Cancelada',
  delivered: 'Entregada'
});

export const RESTAURANT_ORDER_ITEM_STATUS_LABELS = Object.freeze({
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  cancelled: 'Cancelado',
  delivered: 'Entregado'
});

export const normalizeRestaurantCloudStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const hasStaffPermission = (canAccess, permissions = []) => (
  typeof canAccess === 'function' && permissions.some((permission) => canAccess(permission))
);

const getCloudItems = (cloudOrder) => (
  Array.isArray(cloudOrder?.items) ? cloudOrder.items : []
);

const getStatusLabel = (status, labels = RESTAURANT_ORDER_STATUS_LABELS) => (
  labels[normalizeRestaurantCloudStatus(status)] || 'En cocina'
);

const friendlyStatusError = (error) => {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.';
  }

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) {
    return 'Tu usuario no tiene permiso para ver el estado de cocina de esta mesa.';
  }

  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) {
    return 'El estado de cocina cloud solo está disponible para negocios tipo restaurante.';
  }

  if (normalized.includes('disabled') || normalized.includes('plan')) {
    return 'Tu plan actual no tiene activo el estado de cocina cloud.';
  }

  return message || 'No se pudo verificar cocina cloud en este momento.';
};

export const buildRestaurantCloudStatusSummary = (cloudOrder) => {
  const items = getCloudItems(cloudOrder);
  const normalizedOrderStatus = normalizeRestaurantCloudStatus(
    cloudOrder?.fulfillmentStatus || cloudOrder?.status
  );

  const cancelledItems = items.filter((item) => CANCELLED_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const pendingItems = items.filter((item) => ACTIVE_PENDING_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const preparingItems = items.filter((item) => PREPARING_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const readyItems = items.filter((item) => READY_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));
  const activeItems = items.filter((item) => !CANCELLED_STATUSES.has(normalizeRestaurantCloudStatus(item?.status)));

  const hasCancelledItems = cancelledItems.length > 0;
  const hasPendingItems = pendingItems.length > 0;
  const hasPreparingItems = preparingItems.length > 0;
  const isCancelled = normalizedOrderStatus === 'cancelled' || (items.length > 0 && activeItems.length === 0);
  const isReady = !isCancelled && (
    normalizedOrderStatus === 'ready' ||
    (activeItems.length > 0 && readyItems.length === activeItems.length)
  );

  return {
    items,
    status: normalizedOrderStatus,
    statusLabel: getStatusLabel(normalizedOrderStatus),
    hasCancelledItems,
    cancelledItems,
    hasPendingItems,
    pendingItems,
    hasPreparingItems,
    preparingItems,
    readyItems,
    activeItems,
    isReady,
    isCancelled
  };
};

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
    activeItems: summary.activeItems,
    items: summary.items,
    status: summary.status,
    statusLabel: summary.statusLabel,
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
