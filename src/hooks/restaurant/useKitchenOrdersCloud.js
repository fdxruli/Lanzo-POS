import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../useFeatureConfig';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import {
  getLicenseKeyFromDetails,
  isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import usePreparationStations from './usePreparationStations';
import useRestaurantOrders from './useRestaurantOrders';

const CLOUD_KDS_POLL_MS = 10000;
const RESTAURANT_ORDERS_UPDATED_EVENT = 'lanzo:restaurant-orders-cloud-updated';

const KDS_ACTIVE_STATUSES = new Set(['pending', 'preparing', 'open']);
const KDS_READY_STATUSES = new Set(['ready']);
const KDS_TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'completed']);

const getOnlineState = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const hasStaffPermission = (canAccess, permissions = []) => (
  typeof canAccess === 'function' && permissions.some((permission) => canAccess(permission))
);

const normalizeStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const friendlyKitchenError = (error) => {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'No se pudieron actualizar las comandas porque el dispositivo está sin conexión.';
  }

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) {
    return 'Tu usuario no tiene permiso para ver pedidos de cocina.';
  }

  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) {
    return 'El monitor cloud de cocina solo está disponible para negocios tipo restaurante.';
  }

  if (normalized.includes('disabled') || normalized.includes('plan')) {
    return 'Tu plan actual no tiene activo el monitor cloud de cocina.';
  }

  return 'No pudimos actualizar cocina en este momento. Intenta de nuevo.';
};

const normalizeStationCode = (code) => {
  const value = String(code || '').trim().toLowerCase();
  return value || null;
};

const buildStationOptions = (activeStations = []) => {
  const seen = new Set();
  const options = [{ code: null, name: 'Todas', isAll: true }];

  (Array.isArray(activeStations) ? activeStations : []).forEach((station) => {
    const code = normalizeStationCode(station?.code);
    if (!code || seen.has(code) || station?.isActive === false) return;
    seen.add(code);
    options.push({
      code,
      name: String(station?.name || (code === 'kitchen' ? 'Cocina' : code)).trim(),
      isDefault: Boolean(station?.isDefault)
    });
  });

  if (!seen.has('kitchen')) {
    options.splice(1, 0, { code: 'kitchen', name: 'Cocina', isDefault: true });
  }

  return options;
};

const filterOrdersByBucket = (orders = [], statusFilter = 'pending') => (
  (Array.isArray(orders) ? orders : []).filter((order) => {
    const status = normalizeStatus(order?.fulfillmentStatus || order?.status);
    if (statusFilter === 'pending') return KDS_ACTIVE_STATUSES.has(status);
    if (statusFilter === 'ready') return KDS_READY_STATUSES.has(status);
    if (statusFilter === 'history') return KDS_TERMINAL_STATUSES.has(status);
    return true;
  })
);

const countByBucket = (orders = []) => {
  const counts = { pending: 0, ready: 0, history: 0 };
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const status = normalizeStatus(order?.fulfillmentStatus || order?.status);
    if (KDS_ACTIVE_STATUSES.has(status)) counts.pending += 1;
    if (KDS_READY_STATUSES.has(status)) counts.ready += 1;
    if (KDS_TERMINAL_STATUSES.has(status)) counts.history += 1;
  });
  return counts;
};

export function useKitchenOrdersCloud({ pollMs = CLOUD_KDS_POLL_MS } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const featureConfig = useFeatureConfig();

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const isCloudRestaurantOrdersEnabled = Boolean(
    licenseKey &&
    licenseDetails?.valid !== false &&
    isRestaurantOrdersCloudEnabled(licenseDetails)
  );
  const isFoodServiceBusiness = (featureConfig.activeRubros || []).includes(CANONICAL_BUSINESS_TYPES.FOOD_SERVICE);
  const hasKitchenSurface = Boolean(featureConfig.hasKDS || featureConfig.hasTables);
  const isCloudKdsEnabled = Boolean(isCloudRestaurantOrdersEnabled && isFoodServiceBusiness && hasKitchenSurface);

  const hasReadPermission = currentDeviceRole !== 'staff' || hasStaffPermission(canAccess, ['orders', 'pos', 'kitchen', 'kds']);
  const hasWritePermission = currentDeviceRole !== 'staff' || hasStaffPermission(canAccess, ['orders', 'pos']);

  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedStationCode, setSelectedStationCode] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [isOnline, setIsOnline] = useState(getOnlineState);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const includeCompleted = statusFilter === 'history';

  const {
    activeStations,
    isLoading: isLoadingStations,
    error: stationsError,
    source: stationsSource,
    refreshStations
  } = usePreparationStations({
    includeInactive: false,
    autoLoad: isCloudKdsEnabled && hasReadPermission
  });

  const {
    orders,
    isLoading: isLoadingOrders,
    error: ordersError,
    refreshOrders,
    updateOrderStatus,
    updateOrderItemStatus
  } = useRestaurantOrders({
    autoLoad: isCloudKdsEnabled && hasReadPermission,
    status: null,
    stationCode: selectedStationCode,
    includeCompleted
  });

  const stationOptions = useMemo(() => buildStationOptions(activeStations), [activeStations]);

  useEffect(() => {
    if (!selectedStationCode) return;
    const stationExists = stationOptions.some((station) => station.code === selectedStationCode);
    if (!stationExists) setSelectedStationCode(null);
  }, [selectedStationCode, stationOptions]);

  const refreshKitchenOrders = useCallback(async ({ force = false } = {}) => {
    if (!isCloudKdsEnabled || !hasReadPermission) {
      return { success: true, skipped: true, orders: [] };
    }

    setActionError(null);
    setIsOnline(getOnlineState());

    const [stationsResult, ordersResult] = await Promise.allSettled([
      refreshStations({ force }),
      refreshOrders({ force })
    ]);

    if (ordersResult.status === 'fulfilled') {
      setLastUpdatedAt(new Date().toISOString());
      return ordersResult.value;
    }

    setActionError(ordersResult.reason);
    return { success: false, error: ordersResult.reason, stationsResult };
  }, [hasReadPermission, isCloudKdsEnabled, refreshOrders, refreshStations]);

  const loadingRef = useRef(false);
  const refreshRef = useRef(refreshKitchenOrders);

  useEffect(() => {
    loadingRef.current = isLoadingOrders || isLoadingStations || Boolean(updatingOrderId) || Boolean(updatingItemId);
  }, [isLoadingOrders, isLoadingStations, updatingItemId, updatingOrderId]);

  useEffect(() => {
    refreshRef.current = refreshKitchenOrders;
  }, [refreshKitchenOrders]);

  useEffect(() => {
    if (!isCloudKdsEnabled || !hasReadPermission) return undefined;
    if (typeof window === 'undefined') return undefined;

    let refreshTimer = null;

    const clearRefreshTimer = () => {
      if (!refreshTimer) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    };

    const requestForceRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (loadingRef.current) return;

      clearRefreshTimer();
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!loadingRef.current) {
          refreshRef.current({ force: true }).catch(() => {});
        }
      }, 700);
    };

    const interval = window.setInterval(requestForceRefresh, Math.max(Number(pollMs) || CLOUD_KDS_POLL_MS, 8000));

    const handleRestaurantOrdersUpdated = () => requestForceRefresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestForceRefresh();
    };
    const handleOnline = () => {
      setIsOnline(true);
      requestForceRefresh();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener(RESTAURANT_ORDERS_UPDATED_EVENT, handleRestaurantOrdersUpdated);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearRefreshTimer();
      window.clearInterval(interval);
      window.removeEventListener(RESTAURANT_ORDERS_UPDATED_EVENT, handleRestaurantOrdersUpdated);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasReadPermission, isCloudKdsEnabled, pollMs]);

  useEffect(() => {
    if (Array.isArray(orders)) setLastUpdatedAt(new Date().toISOString());
  }, [orders]);

  const displayedOrders = useMemo(
    () => filterOrdersByBucket(orders, statusFilter),
    [orders, statusFilter]
  );

  const statusCounts = useMemo(() => countByBucket(orders), [orders]);

  const changeOrderStatus = useCallback(async ({ restaurantOrderId, status }) => {
    if (!isCloudKdsEnabled) {
      return { success: false, message: 'Tu plan actual no tiene activo el monitor cloud de cocina.' };
    }

    if (!hasWritePermission) {
      const message = 'Tu usuario no tiene permiso para cambiar el estado de comandas.';
      setActionError(message);
      return { success: false, message };
    }

    const normalizedStatus = normalizeStatus(status);
    if (!restaurantOrderId || (KDS_TERMINAL_STATUSES.has(normalizedStatus) === false && !['pending', 'preparing', 'ready'].includes(normalizedStatus))) {
      const message = 'No se pudo cambiar el estado de la comanda.';
      setActionError(message);
      return { success: false, message };
    }

    setUpdatingOrderId(restaurantOrderId);
    setActionError(null);

    try {
      const response = await updateOrderStatus({ restaurantOrderId, status: normalizedStatus });
      if (response?.success === false) {
        const message = response.message || response.code || 'No se pudo cambiar el estado de la comanda.';
        setActionError(message);
        return { ...response, message };
      }
      setLastUpdatedAt(new Date().toISOString());
      return response;
    } catch (error) {
      setActionError(error);
      return { success: false, error, message: friendlyKitchenError(error) };
    } finally {
      setUpdatingOrderId(null);
    }
  }, [hasWritePermission, isCloudKdsEnabled, updateOrderStatus]);

  const changeOrderItemStatus = useCallback(async ({ restaurantOrderId, restaurantOrderItemId, status }) => {
    if (!isCloudKdsEnabled) {
      return { success: false, message: 'Tu plan actual no tiene activo el monitor cloud de cocina.' };
    }

    if (!hasWritePermission) {
      const message = 'Tu usuario no tiene permiso para cambiar items de cocina.';
      setActionError(message);
      return { success: false, message };
    }

    const normalizedStatus = normalizeStatus(status);
    if (!restaurantOrderId || !restaurantOrderItemId || !['pending', 'preparing', 'ready', 'delivered', 'cancelled'].includes(normalizedStatus)) {
      const message = 'No se pudo cambiar el estado del item.';
      setActionError(message);
      return { success: false, message };
    }

    setUpdatingItemId(restaurantOrderItemId);
    setActionError(null);

    try {
      const response = await updateOrderItemStatus({
        restaurantOrderId,
        restaurantOrderItemId,
        status: normalizedStatus
      });
      if (response?.success === false) {
        const message = response.message || response.code || 'No se pudo cambiar el estado del item.';
        setActionError(message);
        return { ...response, message };
      }
      setLastUpdatedAt(new Date().toISOString());
      return response;
    } catch (error) {
      setActionError(error);
      return { success: false, error, message: friendlyKitchenError(error) };
    } finally {
      setUpdatingItemId(null);
    }
  }, [hasWritePermission, isCloudKdsEnabled, updateOrderItemStatus]);

  const rawError = !hasReadPermission
    ? 'POS_PERMISSION_DENIED:restaurant_orders_read'
    : (!isOnline ? 'offline' : (actionError || ordersError || (stationsSource === 'fallback' ? null : stationsError)));

  return {
    orders,
    displayedOrders,
    statusFilter,
    setStatusFilter,
    selectedStationCode,
    setSelectedStationCode,
    stationOptions,
    statusCounts,
    isCloudKdsEnabled,
    isCloudRestaurantOrdersEnabled,
    isFoodServiceBusiness,
    hasKitchenSurface,
    hasReadPermission,
    hasWritePermission,
    isLoading: isLoadingOrders || isLoadingStations,
    isUpdating: Boolean(updatingOrderId) || Boolean(updatingItemId),
    updatingOrderId,
    updatingItemId,
    isUpdatingItem: (itemId) => Boolean(itemId && updatingItemId === itemId),
    error: friendlyKitchenError(rawError),
    lastUpdatedAt,
    includeCompleted,
    refreshKitchenOrders,
    changeOrderStatus,
    changeOrderItemStatus
  };
}

export default useKitchenOrdersCloud;
