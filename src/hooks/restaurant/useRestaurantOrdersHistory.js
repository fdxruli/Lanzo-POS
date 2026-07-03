import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../useFeatureConfig';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import {
  getLicenseKeyFromDetails,
  isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import { restaurantOrdersHistoryRepository } from '../../services/restaurant/restaurantOrdersHistoryRepository';

const DEFAULT_FILTERS = Object.freeze({
  range: '24h',
  status: null,
  limit: 100
});

const hasStaffPermission = (canAccess, permissions = []) => (
  typeof canAccess === 'function' && permissions.some((permission) => canAccess(permission))
);

const resolveHistoryRange = (range = '24h') => {
  const now = new Date();
  const from = new Date(now);

  if (range === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    from.setDate(from.getDate() - 7);
  } else {
    from.setHours(from.getHours() - 24);
  }

  return {
    from: from.toISOString(),
    to: now.toISOString()
  };
};

const normalizeHistoryStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'all' || value === 'todos') return null;
  if (value === 'completed') return 'delivered';
  if (value === 'delivered' || value === 'cancelled') return value;
  return null;
};

const friendlyHistoryError = (error) => {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'Sin conexión. No se pudo actualizar el historial de comandas cloud.';
  }

  if (normalized.includes('archive_not_terminal') || normalized.includes('solo se pueden archivar')) {
    return 'Solo se pueden archivar comandas entregadas o canceladas.';
  }

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) {
    return 'Tu usuario no tiene permiso para consultar o archivar comandas.';
  }

  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) {
    return 'El historial cloud de comandas solo está disponible para negocios tipo restaurante.';
  }

  if (normalized.includes('disabled') || normalized.includes('plan')) {
    return 'Tu plan actual no tiene activo el historial cloud de comandas.';
  }

  return 'No pudimos actualizar el historial de comandas en este momento.';
};

export function useRestaurantOrdersHistory({ autoLoad = true } = {}) {
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
  const hasReadPermission = currentDeviceRole !== 'staff' || hasStaffPermission(canAccess, ['orders', 'pos', 'kitchen', 'kds']);
  const hasWritePermission = currentDeviceRole !== 'staff' || hasStaffPermission(canAccess, ['orders', 'pos']);
  const isEnabled = Boolean(isCloudRestaurantOrdersEnabled && isFoodServiceBusiness && hasReadPermission);

  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archivingOrderId, setArchivingOrderId] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);

  const rpcFilters = useMemo(() => {
    const range = resolveHistoryRange(filters.range);
    return {
      ...range,
      status: normalizeHistoryStatus(filters.status),
      limit: Math.min(Math.max(Number(filters.limit) || DEFAULT_FILTERS.limit, 1), 300)
    };
  }, [filters.limit, filters.range, filters.status]);

  const setFilters = useCallback((nextFilters) => {
    setFiltersState((current) => {
      const resolved = typeof nextFilters === 'function' ? nextFilters(current) : nextFilters;
      return { ...current, ...(resolved || {}) };
    });
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isEnabled) {
      setOrders([]);
      setError(null);
      return { success: true, skipped: true, orders: [] };
    }

    setIsLoading(true);
    try {
      const response = await restaurantOrdersHistoryRepository.getRestaurantOrdersHistory({
        licenseKey,
        from: rpcFilters.from,
        to: rpcFilters.to,
        status: rpcFilters.status,
        limit: rpcFilters.limit,
        force
      });

      const nextOrders = Array.isArray(response?.orders) ? response.orders : [];
      setOrders(nextOrders);
      setError(response?.success === false ? (response.message || 'No se pudo cargar el historial de comandas.') : null);
      return response;
    } catch (refreshError) {
      const message = friendlyHistoryError(refreshError);
      setError(message);
      setOrders([]);
      return { success: false, orders: [], error: refreshError, message };
    } finally {
      setIsLoading(false);
    }
  }, [isEnabled, licenseKey, rpcFilters.from, rpcFilters.limit, rpcFilters.status, rpcFilters.to]);

  useEffect(() => {
    if (!autoLoad) return;
    refresh();
  }, [autoLoad, refresh]);

  const archiveOrder = useCallback(async ({ restaurantOrderId, reason = 'manual_archive', metadata = {}, idempotencyKey = null } = {}) => {
    if (!isEnabled) {
      return { success: false, skipped: true, message: 'El historial cloud de comandas no está disponible.' };
    }

    if (!hasWritePermission) {
      const message = 'Tu usuario no tiene permiso para archivar comandas.';
      setError(message);
      return { success: false, message };
    }

    if (!restaurantOrderId) {
      const message = 'No se encontró la comanda para archivar.';
      setError(message);
      return { success: false, message };
    }

    setIsArchiving(true);
    setArchivingOrderId(restaurantOrderId);
    setError(null);

    try {
      const response = await restaurantOrdersHistoryRepository.archiveRestaurantOrder({
        licenseKey,
        restaurantOrderId,
        reason,
        metadata,
        idempotencyKey
      });

      if (response?.success === false) {
        const message = friendlyHistoryError(response) || response.message || 'No se pudo archivar la comanda.';
        setError(message);
        return { ...response, message };
      }

      await refresh({ force: true });
      return response;
    } catch (archiveError) {
      const message = friendlyHistoryError(archiveError);
      setError(message);
      return { success: false, error: archiveError, message };
    } finally {
      setIsArchiving(false);
      setArchivingOrderId(null);
    }
  }, [hasWritePermission, isEnabled, licenseKey, refresh]);

  return {
    orders,
    isLoading,
    isArchiving,
    archivingOrderId,
    error,
    refresh,
    archiveOrder,
    filters,
    setFilters,
    isEnabled,
    hasReadPermission,
    hasWritePermission
  };
}

export default useRestaurantOrdersHistory;
