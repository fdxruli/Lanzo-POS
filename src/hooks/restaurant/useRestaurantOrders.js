import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';

export function useRestaurantOrders({ autoLoad = true, status = null, stationCode = null, includeCompleted = false } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const isCloudRestaurantOrdersEnabled = Boolean(
    licenseKey &&
    licenseDetails?.valid !== false &&
    isRestaurantOrdersCloudEnabled(licenseDetails)
  );
  const hasReadPermission = currentDeviceRole !== 'staff'
    || canAccess('orders')
    || canAccess('pos')
    || canAccess('kitchen')
    || canAccess('kds');

  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshOrders = useCallback(async ({ force = false } = {}) => {
    if (!isCloudRestaurantOrdersEnabled || !hasReadPermission) {
      setOrders([]);
      setError(null);
      return { success: true, orders: [], skipped: true };
    }

    setIsLoading(true);
    try {
      const response = await restaurantOrdersRepository.getRestaurantOrders({
        licenseKey,
        status,
        stationCode,
        includeCompleted,
        force
      });
      const nextOrders = Array.isArray(response?.orders) ? response.orders : [];
      setOrders(nextOrders);
      setError(response?.success === false ? (response.message || 'No se pudieron cargar las comandas.') : null);
      return response;
    } catch (refreshError) {
      setError(refreshError?.message || 'No se pudieron cargar las comandas.');
      return { success: false, orders: [], error: refreshError };
    } finally {
      setIsLoading(false);
    }
  }, [hasReadPermission, includeCompleted, isCloudRestaurantOrdersEnabled, licenseKey, stationCode, status]);

  useEffect(() => {
    if (!autoLoad) return;
    refreshOrders();
  }, [autoLoad, refreshOrders]);

  const upsertOrder = useCallback(async ({ order, items, idempotencyKey = null }) => {
    if (!isCloudRestaurantOrdersEnabled) {
      return { success: false, skipped: true, message: 'Las comandas cloud no están disponibles en este plan.' };
    }
    return restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey, order, items, idempotencyKey });
  }, [isCloudRestaurantOrdersEnabled, licenseKey]);

  const updateOrderStatus = useCallback(async ({ restaurantOrderId, status: nextStatus, idempotencyKey = null }) => {
    if (!isCloudRestaurantOrdersEnabled) {
      return { success: false, skipped: true, message: 'Las comandas cloud no están disponibles en este plan.' };
    }
    const response = await restaurantOrdersRepository.updateRestaurantOrderStatus({
      licenseKey,
      restaurantOrderId,
      status: nextStatus,
      idempotencyKey
    });
    await refreshOrders({ force: true });
    return response;
  }, [isCloudRestaurantOrdersEnabled, licenseKey, refreshOrders]);

  const updateOrderItemStatus = useCallback(async ({ restaurantOrderId, restaurantOrderItemId, status: nextStatus, idempotencyKey = null }) => {
    if (!isCloudRestaurantOrdersEnabled) {
      return { success: false, skipped: true, message: 'Las comandas cloud no están disponibles en este plan.' };
    }
    const response = await restaurantOrdersRepository.updateRestaurantOrderItemStatus({
      licenseKey,
      restaurantOrderId,
      restaurantOrderItemId,
      status: nextStatus,
      idempotencyKey
    });
    await refreshOrders({ force: true });
    return response;
  }, [isCloudRestaurantOrdersEnabled, licenseKey, refreshOrders]);

  return {
    orders,
    isLoading,
    error,
    refreshOrders,
    upsertOrder,
    updateOrderStatus,
    updateOrderItemStatus,
    isCloudRestaurantOrdersEnabled
  };
}

export default useRestaurantOrders;
