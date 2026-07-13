import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import '../../../store/installEcommerceOrderStore';
import { useAppStore } from '../../../store/useAppStore';
import { canAccessEcommerceOrders } from '../../../services/ecommerce/ecommerceOrderCapabilities';
import {
  canPrepareEcommercePosDraft,
  getEcommercePosContextIdentity
} from '../../../services/ecommerce/ecommercePosDraftService';
import { installEcommercePosActiveOrderGuards } from '../../../services/ecommerce/installEcommercePosActiveOrderGuards';
import {
  ECOMMERCE_ORDERS_CHANGED_EVENT,
  ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS,
  getEcommerceOrderIdFromEvent,
  normalizeEcommerceOrderId
} from '../../../services/ecommerce/ecommerceOrderRealtimeEvent';
import { useActiveOrders } from '../../../hooks/pos/useActiveOrders';

installEcommercePosActiveOrderGuards();

const ECOMMERCE_LIST_REFRESH_DEBOUNCE_MS = 600;

const getLicenseIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_key
  || licenseDetails?.licenseKey
  || licenseDetails?.details?.license_key
  || licenseDetails?.details?.licenseKey
  || null
);

export default function EcommerceOrdersRuntime() {
  const location = useLocation();
  const listTimerRef = useRef(null);
  const selectedTimerRef = useRef(null);
  const selectedFlightRef = useRef(null);
  const selectedRefreshEpochRef = useRef(0);
  const previousLicenseRef = useRef(null);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const loadSummary = useAppStore((state) => state.loadEcommerceOrderSummary);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const invalidateOrders = useAppStore((state) => state.invalidateEcommerceOrdersCache);
  const openOrder = useAppStore((state) => state.openEcommerceOrder);
  const markSelectedOrderStale = useAppStore((state) => state.markSelectedEcommerceOrderStale);
  const requestSelectedOrderRefresh = useAppStore((state) => state.requestSelectedEcommerceOrderRefresh);
  const markSelectedOrderFresh = useAppStore((state) => state.markSelectedEcommerceOrderFresh);
  const resetOrders = useAppStore((state) => state.resetEcommerceOrdersState);

  const staffSession = { currentDeviceRole, currentStaffUser };
  const canAccess = canAccessEcommerceOrders(licenseDetails, staffSession);
  const licenseIdentity = getLicenseIdentity(licenseDetails);
  const pageIsOpen = location.pathname.startsWith('/pedidos-online');
  const posContextState = { licenseDetails, currentDeviceRole, currentStaffUser };
  const posContextIdentity = getEcommercePosContextIdentity(posContextState);
  const canPrepareInPos = canPrepareEcommercePosDraft(posContextState);

  const runSelectedOrderRefresh = useCallback(function refreshSelectedOrder(orderId) {
    const normalizedOrderId = normalizeEcommerceOrderId(orderId);
    if (!normalizedOrderId || !pageIsOpen) return Promise.resolve(null);

    const current = useAppStore.getState();
    const currentStaffSession = {
      currentDeviceRole: current.currentDeviceRole,
      currentStaffUser: current.currentStaffUser
    };
    if (
      !canAccessEcommerceOrders(current.licenseDetails, currentStaffSession)
      || current.selectedEcommerceOrderRequestId !== normalizedOrderId
      || current.selectedEcommerceOrder?.id !== normalizedOrderId
    ) {
      return Promise.resolve(null);
    }

    const activeFlight = selectedFlightRef.current;
    if (activeFlight?.orderId === normalizedOrderId) {
      activeFlight.dirty = true;
      return activeFlight.promise;
    }

    const requested = requestSelectedOrderRefresh?.(normalizedOrderId);
    if (requested?.success !== true) return Promise.resolve(null);

    const refreshEpoch = selectedRefreshEpochRef.current;
    const flight = {
      orderId: normalizedOrderId,
      dirty: false,
      result: null,
      promise: null,
      refreshEpoch
    };
    const promise = (async () => {
      try {
        const result = await openOrder?.(normalizedOrderId, {
          force: true,
          markSeen: false,
          background: true
        });
        flight.result = result || null;
        return result || null;
      } catch {
        flight.result = { success: false };
        return flight.result;
      }
    })();
    flight.promise = promise;
    selectedFlightRef.current = flight;

    void promise.finally(() => {
      if (selectedFlightRef.current !== flight) return;
      selectedFlightRef.current = null;
      if (selectedRefreshEpochRef.current !== refreshEpoch) return;

      const latest = useAppStore.getState();
      const selectionIsCurrent = (
        latest.selectedEcommerceOrderRequestId === normalizedOrderId
        && latest.selectedEcommerceOrder?.id === normalizedOrderId
      );
      if (!selectionIsCurrent) return;

      if (flight.dirty) {
        void refreshSelectedOrder(normalizedOrderId);
        return;
      }
      if (flight.result?.success === true) {
        markSelectedOrderFresh?.(normalizedOrderId);
      }
    });

    return promise;
  }, [markSelectedOrderFresh, openOrder, pageIsOpen, requestSelectedOrderRefresh]);

  const scheduleSelectedOrderRefresh = useCallback((orderId, {
    delay = ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS
  } = {}) => {
    const normalizedOrderId = normalizeEcommerceOrderId(orderId);
    if (!normalizedOrderId || !pageIsOpen) return;
    if (selectedTimerRef.current) window.clearTimeout(selectedTimerRef.current);
    selectedTimerRef.current = window.setTimeout(() => {
      selectedTimerRef.current = null;
      void runSelectedOrderRefresh(normalizedOrderId);
    }, Math.max(0, Number(delay) || 0));
  }, [pageIsOpen, runSelectedOrderRefresh]);

  useEffect(() => {
    selectedRefreshEpochRef.current += 1;
    if (selectedTimerRef.current) {
      window.clearTimeout(selectedTimerRef.current);
      selectedTimerRef.current = null;
    }
    selectedFlightRef.current = null;

    return () => {
      selectedRefreshEpochRef.current += 1;
      if (selectedTimerRef.current) {
        window.clearTimeout(selectedTimerRef.current);
        selectedTimerRef.current = null;
      }
      selectedFlightRef.current = null;
    };
  }, [canAccess, licenseIdentity, pageIsOpen, posContextIdentity]);

  useEffect(() => {
    useActiveOrders.getState().pruneEcommerceDraftsForContext({
      licenseIdentity: posContextIdentity,
      canPrepare: canPrepareInPos
    });
  }, [canPrepareInPos, posContextIdentity]);

  useEffect(() => {
    if (previousLicenseRef.current && previousLicenseRef.current !== licenseIdentity) resetOrders?.();
    previousLicenseRef.current = licenseIdentity;
    if (!canAccess || !licenseIdentity) {
      resetOrders?.();
      return undefined;
    }
    loadSummary?.({ background: true });
    return undefined;
  }, [canAccess, licenseIdentity, loadSummary, resetOrders]);

  useEffect(() => () => { resetOrders?.(); }, [resetOrders]);

  useEffect(() => {
    if (!canAccess) return undefined;
    const refreshOnResume = () => {
      if (document.visibilityState === 'hidden') return;
      loadSummary?.({ background: true });
      if (pageIsOpen) {
        refreshOrders?.({ background: true });
        const current = useAppStore.getState();
        if (
          current.ecommerceSelectedOrderStale
          && current.selectedEcommerceOrderRequestId
        ) {
          scheduleSelectedOrderRefresh(current.selectedEcommerceOrderRequestId, { delay: 0 });
        }
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };
    window.addEventListener('focus', refreshOnResume);
    window.addEventListener('pageshow', refreshOnResume);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('pageshow', refreshOnResume);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canAccess, loadSummary, pageIsOpen, refreshOrders, scheduleSelectedOrderRefresh]);

  useEffect(() => {
    if (!canAccess) return undefined;
    const handleRealtime = (event) => {
      invalidateOrders?.();

      const eventOrderId = getEcommerceOrderIdFromEvent(event);
      if (pageIsOpen) {
        const current = useAppStore.getState();
        const selectedOrderId = current.selectedEcommerceOrderRequestId;
        const eventTargetsSelection = Boolean(
          selectedOrderId
          && current.selectedEcommerceOrder?.id === selectedOrderId
          && (!eventOrderId || eventOrderId === selectedOrderId)
        );
        if (eventTargetsSelection) {
          const marked = markSelectedOrderStale?.(selectedOrderId);
          if (marked?.success === true) scheduleSelectedOrderRefresh(selectedOrderId);
        }
      }

      if (listTimerRef.current) window.clearTimeout(listTimerRef.current);
      listTimerRef.current = window.setTimeout(async () => {
        listTimerRef.current = null;
        await loadSummary?.({ force: true, background: true });
        if (pageIsOpen) await refreshOrders?.({ background: true });
      }, ECOMMERCE_LIST_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(ECOMMERCE_ORDERS_CHANGED_EVENT, handleRealtime);
    return () => {
      window.removeEventListener(ECOMMERCE_ORDERS_CHANGED_EVENT, handleRealtime);
      if (listTimerRef.current) {
        window.clearTimeout(listTimerRef.current);
        listTimerRef.current = null;
      }
    };
  }, [
    canAccess,
    invalidateOrders,
    loadSummary,
    markSelectedOrderStale,
    pageIsOpen,
    refreshOrders,
    scheduleSelectedOrderRefresh
  ]);

  return null;
}
