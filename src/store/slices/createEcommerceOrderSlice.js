import {
  acceptEcommerceOrder as acceptOrderRequest,
  getEcommerceOrder,
  getEcommerceOrderErrorMessage,
  listEcommerceOrders,
  markEcommerceOrderSeen as markSeenRequest,
  rejectEcommerceOrder as rejectOrderRequest
} from '../../services/ecommerce/ecommerceOrderService';
import { canAccessEcommerceOrders } from '../../services/ecommerce/ecommerceOrderCapabilities';

const LIST_TTL_MS = 30 * 1000;
const SUMMARY_TTL_MS = 60 * 1000;
const DETAIL_TTL_MS = 15 * 1000;

const listRequestPromises = new Map();
const summaryRequestPromises = new Map();
const detailRequestPromises = new Map();
const actionRequestPromises = new Map();
let requestEpoch = 0;
let listIntentEpoch = 0;
let detailIntentEpoch = 0;

const now = () => Date.now();
const isFresh = (value, ttl) => Number.isFinite(Number(value)) && now() - Number(value) < ttl;

const getLicenseIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_key ||
  licenseDetails?.licenseKey ||
  licenseDetails?.details?.license_key ||
  licenseDetails?.details?.licenseKey ||
  null
);

const getStaffSession = (state = {}) => ({
  currentDeviceRole: state.currentDeviceRole,
  currentStaffUser: state.currentStaffUser
});

const getActorIdentity = (state = {}) => {
  const staffUser = state.currentStaffUser || {};
  const staffIdentity = (
    staffUser.id ||
    staffUser.staff_user_id ||
    staffUser.user_id ||
    staffUser.username ||
    'none'
  );
  const ecommercePermission = staffUser.permissions?.ecommerce === true ? 'allow' : 'deny';

  return `${state.currentDeviceRole || 'unresolved'}:${staffIdentity}:${ecommercePermission}`;
};

const captureRequestContext = (state = {}) => ({
  epoch: requestEpoch,
  licenseIdentity: getLicenseIdentity(state.licenseDetails),
  actorIdentity: getActorIdentity(state)
});

const isRequestContextCurrent = (context, state = {}) => (
  context?.epoch === requestEpoch &&
  context?.licenseIdentity === getLicenseIdentity(state.licenseDetails) &&
  context?.actorIdentity === getActorIdentity(state) &&
  canAccessEcommerceOrders(state.licenseDetails, getStaffSession(state))
);

const isListIntentCurrent = (context, intentAtStart, requestKey, state = {}) => (
  isRequestContextCurrent(context, state) &&
  intentAtStart === listIntentEpoch &&
  state.ecommerceOrdersActiveRequestKey === requestKey
);

const isDetailIntentCurrent = (context, intentAtStart, orderId, state = {}) => (
  isRequestContextCurrent(context, state) &&
  intentAtStart === detailIntentEpoch &&
  state.selectedEcommerceOrderRequestId === orderId
);

const staleResponse = () => ({
  success: false,
  code: 'ECOMMERCE_ORDERS_STALE_RESPONSE',
  message: 'La sesión o la selección cambió antes de completar la solicitud.',
  stale: true
});

const EMPTY_COUNTS = Object.freeze({
  new: 0,
  seen: 0,
  pending: 0,
  accepted: 0,
  rejected: 0,
  total: 0
});

const createInitialState = () => ({
  ecommerceOrders: [],
  ecommerceOrderCounts: { ...EMPTY_COUNTS },
  ecommerceOrdersLoading: false,
  ecommerceOrdersRefreshing: false,
  ecommerceOrdersError: null,
  ecommerceOrdersLoaded: false,
  ecommerceOrdersFilter: 'all',
  ecommerceOrdersPagination: { limit: 50, offset: 0, hasMore: false },
  ecommerceOrdersActiveRequestKey: null,
  selectedEcommerceOrder: null,
  selectedEcommerceOrderLoading: false,
  selectedEcommerceOrderRefreshing: false,
  selectedEcommerceOrderError: null,
  selectedEcommerceOrderLoadedAt: null,
  selectedEcommerceOrderLicenseIdentity: null,
  selectedEcommerceOrderActorIdentity: null,
  selectedEcommerceOrderRequestId: null,
  ecommerceSelectedOrderStale: false,
  ecommerceSelectedOrderRefreshRevision: 0,
  ecommerceSelectedOrderRefreshOrderId: null,
  ecommerceOrderActionLoading: null,
  ecommerceOrderActionOrderId: null,
  ecommerceOrdersStale: true,
  ecommerceOrderSummaryStale: true,
  lastEcommerceOrdersLoadedAt: null,
  lastEcommerceOrderSummaryLoadedAt: null,
  ecommerceOrdersLicenseIdentity: null,
  ecommerceOrdersActorIdentity: null
});

const canUseInbox = (state = {}) => (
  canAccessEcommerceOrders(state.licenseDetails, getStaffSession(state))
);

const clearRequestMaps = () => {
  listRequestPromises.clear();
  summaryRequestPromises.clear();
  detailRequestPromises.clear();
  actionRequestPromises.clear();
};

const resetRequestState = (set) => {
  requestEpoch += 1;
  listIntentEpoch += 1;
  detailIntentEpoch += 1;
  clearRequestMaps();
  set(createInitialState());
};

const updateOrderInList = (orders = [], nextOrder = {}) => orders.map((order) => (
  order.id === nextOrder.id
    ? { ...order, ...nextOrder }
    : order
));

const normalizeLimit = (value, fallback = 50) => (
  Math.min(Math.max(Number.isFinite(Number(value)) ? Number(value) : fallback, 1), 100)
);

const normalizeOffset = (value) => Math.max(Number.isFinite(Number(value)) ? Number(value) : 0, 0);

const runOrderAction = async ({
  set,
  get,
  orderId,
  actionName,
  exclusiveKey = actionName,
  loadingValue,
  request,
  requestArgs = {},
  requireVisibleSelection = false
}) => {
  if (!orderId) return { success: false, code: 'ECOMMERCE_ORDER_NOT_FOUND' };

  const state = get();
  if (!canUseInbox(state)) {
    resetRequestState(set);
    return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
  }

  const hasVisibleSelection = (
    state.selectedEcommerceOrder?.id === orderId &&
    state.selectedEcommerceOrderRequestId === orderId &&
    !state.selectedEcommerceOrderLoading
  );
  if (requireVisibleSelection && !hasVisibleSelection) return staleResponse();

  const requestContext = captureRequestContext(state);
  const detailIntentAtStart = detailIntentEpoch;
  const requestLicenseDetails = state.licenseDetails;
  const requestKey = [
    requestContext.licenseIdentity,
    requestContext.actorIdentity,
    orderId,
    exclusiveKey
  ].join(':');

  if (actionRequestPromises.has(requestKey)) {
    return actionRequestPromises.get(requestKey);
  }

  const isActionIntentCurrent = () => {
    const current = get();
    if (!isRequestContextCurrent(requestContext, current)) return false;
    if (!requireVisibleSelection) return true;

    return (
      detailIntentAtStart === detailIntentEpoch &&
      current.selectedEcommerceOrderRequestId === orderId &&
      current.selectedEcommerceOrder?.id === orderId
    );
  };

  if (loadingValue) {
    set({
      ecommerceOrderActionLoading: loadingValue,
      ecommerceOrderActionOrderId: orderId,
      selectedEcommerceOrderError: null
    });
  }

  const actionPromise = (async () => {
    const result = await request({
      licenseDetails: requestLicenseDetails,
      orderId,
      ...requestArgs
    });

    if (!isActionIntentCurrent()) return staleResponse();

    if (result.success === false) {
      set({ selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result) });
      return result;
    }

    if (result.changed) {
      set({ ecommerceOrdersStale: true, ecommerceOrderSummaryStale: true });

      const current = get();
      const shouldRefreshVisibleDetail = (
        current.selectedEcommerceOrderRequestId === orderId &&
        current.selectedEcommerceOrder?.id === orderId
      );

      await Promise.all([
        shouldRefreshVisibleDetail
          ? get().openEcommerceOrder?.(orderId, { force: true, markSeen: false })
          : Promise.resolve(),
        get().refreshEcommerceOrders?.({ background: true })
      ]);

      if (!isActionIntentCurrent()) return staleResponse();
    }

    return result;
  })();

  actionRequestPromises.set(requestKey, actionPromise);

  try {
    return await actionPromise;
  } finally {
    if (actionRequestPromises.get(requestKey) === actionPromise) {
      actionRequestPromises.delete(requestKey);
    }

    const current = get();
    if (
      loadingValue &&
      current.ecommerceOrderActionOrderId === orderId &&
      current.ecommerceOrderActionLoading === loadingValue
    ) {
      set({ ecommerceOrderActionLoading: null, ecommerceOrderActionOrderId: null });
    }
  }
};

export const createEcommerceOrderSlice = (set, get) => ({
  ...createInitialState(),

  loadEcommerceOrders: async ({
    filter,
    limit = 50,
    offset = 0,
    force = false,
    background = false
  } = {}) => {
    const state = get();
    if (!canUseInbox(state)) {
      resetRequestState(set);
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    const requestContext = captureRequestContext(state);
    const licenseIdentity = requestContext.licenseIdentity;
    const actorIdentity = requestContext.actorIdentity;
    const requestLicenseDetails = state.licenseDetails;
    const resolvedFilter = filter || state.ecommerceOrdersFilter || 'all';
    const resolvedLimit = normalizeLimit(limit);
    const resolvedOffset = normalizeOffset(offset);
    const sameLicense = state.ecommerceOrdersLicenseIdentity === licenseIdentity;
    const sameActor = state.ecommerceOrdersActorIdentity === actorIdentity;
    const sameFilter = state.ecommerceOrdersFilter === resolvedFilter;
    const samePagination = (
      Number(state.ecommerceOrdersPagination?.limit) === resolvedLimit &&
      Number(state.ecommerceOrdersPagination?.offset) === resolvedOffset
    );
    const canUseCache = (
      !force &&
      sameLicense &&
      sameActor &&
      sameFilter &&
      samePagination &&
      state.ecommerceOrdersLoaded &&
      !state.ecommerceOrdersStale &&
      isFresh(state.lastEcommerceOrdersLoadedAt, LIST_TTL_MS)
    );

    if (canUseCache) {
      return {
        success: true,
        orders: state.ecommerceOrders,
        counts: state.ecommerceOrderCounts,
        pagination: state.ecommerceOrdersPagination,
        cached: true
      };
    }

    const requestKey = [
      licenseIdentity,
      actorIdentity,
      resolvedFilter,
      resolvedLimit,
      resolvedOffset
    ].join(':');
    const sameActiveIntent = state.ecommerceOrdersActiveRequestKey === requestKey;

    if (sameActiveIntent && listRequestPromises.has(requestKey)) {
      return listRequestPromises.get(requestKey);
    }

    if (!sameActiveIntent) listIntentEpoch += 1;
    const listIntentAtStart = listIntentEpoch;
    const hasCachedList = sameLicense && sameActor && state.ecommerceOrdersLoaded;

    set({
      ecommerceOrdersLoading: !background && !hasCachedList,
      ecommerceOrdersRefreshing: background || hasCachedList,
      ecommerceOrdersError: null,
      ecommerceOrdersFilter: resolvedFilter,
      ecommerceOrdersActiveRequestKey: requestKey,
      ecommerceOrdersLicenseIdentity: licenseIdentity,
      ecommerceOrdersActorIdentity: actorIdentity
    });

    const request = (async () => {
      const result = await listEcommerceOrders({
        licenseDetails: requestLicenseDetails,
        status: resolvedFilter,
        limit: resolvedLimit,
        offset: resolvedOffset
      });

      if (!isListIntentCurrent(requestContext, listIntentAtStart, requestKey, get())) {
        return staleResponse();
      }

      if (result.success === false) {
          const preservedCache = hasCachedList;
          set({
            ecommerceOrdersLoading: false,
            ecommerceOrdersRefreshing: false,
            ecommerceOrdersError: result.message || getEcommerceOrderErrorMessage(result),
            ecommerceOrdersStale: true
          });
          return preservedCache ? { ...result, preservedCache: true } : result;
      }

      set({
        ecommerceOrders: result.orders,
        ecommerceOrderCounts: result.counts,
        ecommerceOrdersPagination: result.pagination,
        ecommerceOrdersLoading: false,
        ecommerceOrdersRefreshing: false,
        ecommerceOrdersError: null,
        ecommerceOrdersLoaded: true,
        ecommerceOrdersStale: false,
        ecommerceOrderSummaryStale: false,
        lastEcommerceOrdersLoadedAt: now(),
        lastEcommerceOrderSummaryLoadedAt: now(),
        ecommerceOrdersLicenseIdentity: licenseIdentity,
        ecommerceOrdersActorIdentity: actorIdentity
      });
      return result;
    })();

    listRequestPromises.set(requestKey, request);

    try {
      return await request;
    } finally {
      if (listRequestPromises.get(requestKey) === request) {
        listRequestPromises.delete(requestKey);
      }
    }
  },

  loadEcommerceOrderSummary: async ({ force = false } = {}) => {
    const state = get();
    if (!canUseInbox(state)) {
      resetRequestState(set);
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    const requestContext = captureRequestContext(state);
    const licenseIdentity = requestContext.licenseIdentity;
    const actorIdentity = requestContext.actorIdentity;
    const requestLicenseDetails = state.licenseDetails;
    const canUseCache = (
      !force &&
      state.ecommerceOrdersLicenseIdentity === licenseIdentity &&
      state.ecommerceOrdersActorIdentity === actorIdentity &&
      !state.ecommerceOrderSummaryStale &&
      isFresh(state.lastEcommerceOrderSummaryLoadedAt, SUMMARY_TTL_MS)
    );

    if (canUseCache) return { success: true, counts: state.ecommerceOrderCounts, cached: true };

    const requestKey = `${licenseIdentity}:${actorIdentity}`;
    if (summaryRequestPromises.has(requestKey)) {
      return summaryRequestPromises.get(requestKey);
    }

    const compatibleListRequestKey = [
      licenseIdentity,
      actorIdentity,
      'all',
      50,
      0
    ].join(':');
    if (listRequestPromises.has(compatibleListRequestKey)) {
      const compatibleListRequest = listRequestPromises.get(compatibleListRequestKey);
      const request = (async () => {
        const result = await compatibleListRequest;
        if (!isRequestContextCurrent(requestContext, get())) return staleResponse();
        if (result.success === false) return result;
        return { success: true, counts: result.counts, sharedListRequest: true };
      })();

      summaryRequestPromises.set(requestKey, request);
      try {
        return await request;
      } finally {
        if (summaryRequestPromises.get(requestKey) === request) {
          summaryRequestPromises.delete(requestKey);
        }
      }
    }

    const request = (async () => {
      const result = await listEcommerceOrders({
        licenseDetails: requestLicenseDetails,
        status: 'all',
        limit: 1,
        offset: 0
      });

      if (!isRequestContextCurrent(requestContext, get())) return staleResponse();
      if (result.success === false) return result;

      set({
        ecommerceOrderCounts: result.counts,
        ecommerceOrderSummaryStale: false,
        lastEcommerceOrderSummaryLoadedAt: now()
      });
      return { success: true, counts: result.counts };
    })();

    summaryRequestPromises.set(requestKey, request);

    try {
      return await request;
    } finally {
      if (summaryRequestPromises.get(requestKey) === request) {
        summaryRequestPromises.delete(requestKey);
      }
    }
  },

  openEcommerceOrder: async (orderId, {
    force = false,
    markSeen = true,
    background = false
  } = {}) => {
    if (!orderId) return { success: false, code: 'ECOMMERCE_ORDER_NOT_FOUND' };

    const state = get();
    if (!canUseInbox(state)) {
      resetRequestState(set);
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    const requestContext = captureRequestContext(state);
    const licenseIdentity = requestContext.licenseIdentity;
    const actorIdentity = requestContext.actorIdentity;
    const requestLicenseDetails = state.licenseDetails;
    const sameActiveIntent = state.selectedEcommerceOrderRequestId === orderId;
    const isBackgroundRefresh = Boolean(
      background &&
      sameActiveIntent &&
      state.selectedEcommerceOrder?.id === orderId
    );

    if (
      !force &&
      sameActiveIntent &&
      state.selectedEcommerceOrder?.id === orderId &&
      state.selectedEcommerceOrderLicenseIdentity === licenseIdentity &&
      state.selectedEcommerceOrderActorIdentity === actorIdentity &&
      isFresh(state.selectedEcommerceOrderLoadedAt, DETAIL_TTL_MS)
    ) {
      return { success: true, order: state.selectedEcommerceOrder, cached: true };
    }

    const requestKey = `${licenseIdentity}:${actorIdentity}:${orderId}`;
    if (sameActiveIntent && detailRequestPromises.has(requestKey)) {
      return detailRequestPromises.get(requestKey);
    }

    if (!sameActiveIntent) detailIntentEpoch += 1;
    const detailIntentAtStart = detailIntentEpoch;

    set({
      selectedEcommerceOrder: sameActiveIntent ? state.selectedEcommerceOrder : null,
      selectedEcommerceOrderLoading: isBackgroundRefresh
        ? state.selectedEcommerceOrderLoading
        : true,
      selectedEcommerceOrderRefreshing: isBackgroundRefresh,
      selectedEcommerceOrderError: null,
      selectedEcommerceOrderLoadedAt: sameActiveIntent ? state.selectedEcommerceOrderLoadedAt : null,
      selectedEcommerceOrderLicenseIdentity: licenseIdentity,
      selectedEcommerceOrderActorIdentity: actorIdentity,
      selectedEcommerceOrderRequestId: orderId,
      ecommerceSelectedOrderStale: sameActiveIntent
        ? state.ecommerceSelectedOrderStale
        : false,
      ecommerceSelectedOrderRefreshOrderId: sameActiveIntent
        ? state.ecommerceSelectedOrderRefreshOrderId
        : null
    });

    const request = (async () => {
      let result = await getEcommerceOrder({
        licenseDetails: requestLicenseDetails,
        orderId
      });

      if (!isDetailIntentCurrent(requestContext, detailIntentAtStart, orderId, get())) {
        return staleResponse();
      }

      if (result.success === false) {
        set({
          selectedEcommerceOrderLoading: false,
          selectedEcommerceOrderRefreshing: false,
          selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result),
          selectedEcommerceOrderLoadedAt: null
        });
        return result;
      }

      if (markSeen && result.order.status === 'new') {
        const seenResult = await markSeenRequest({
          licenseDetails: requestLicenseDetails,
          orderId
        });

        if (!isDetailIntentCurrent(requestContext, detailIntentAtStart, orderId, get())) {
          return staleResponse();
        }

        if (seenResult.success !== false && seenResult.changed) {
          const refreshed = await getEcommerceOrder({
            licenseDetails: requestLicenseDetails,
            orderId
          });

          if (!isDetailIntentCurrent(requestContext, detailIntentAtStart, orderId, get())) {
            return staleResponse();
          }
          if (refreshed.success !== false) result = refreshed;

          set((current) => ({
            ecommerceOrders: updateOrderInList(current.ecommerceOrders, {
              id: orderId,
              status: 'seen',
              seenAt: new Date().toISOString()
            }),
            ecommerceOrderCounts: {
              ...current.ecommerceOrderCounts,
              new: Math.max(Number(current.ecommerceOrderCounts.new || 0) - 1, 0),
              seen: Number(current.ecommerceOrderCounts.seen || 0) + 1
            }
          }));
        }
      }

      if (!isDetailIntentCurrent(requestContext, detailIntentAtStart, orderId, get())) {
        return staleResponse();
      }

      set({
        selectedEcommerceOrder: result.order,
        selectedEcommerceOrderLoading: false,
        selectedEcommerceOrderRefreshing: false,
        selectedEcommerceOrderError: null,
        selectedEcommerceOrderLoadedAt: now(),
        selectedEcommerceOrderLicenseIdentity: licenseIdentity,
        selectedEcommerceOrderActorIdentity: actorIdentity,
        selectedEcommerceOrderRequestId: orderId
      });
      return result;
    })();

    detailRequestPromises.set(requestKey, request);

    try {
      return await request;
    } finally {
      if (detailRequestPromises.get(requestKey) === request) {
        detailRequestPromises.delete(requestKey);
      }
    }
  },

  markEcommerceOrderSeen: (orderId) => runOrderAction({
    set,
    get,
    orderId,
    actionName: 'seen',
    exclusiveKey: 'seen',
    loadingValue: null,
    request: markSeenRequest
  }),

  acceptEcommerceOrder: (orderId) => runOrderAction({
    set,
    get,
    orderId,
    actionName: 'accept',
    exclusiveKey: 'status',
    loadingValue: 'accept',
    request: acceptOrderRequest,
    requireVisibleSelection: true
  }),

  rejectEcommerceOrder: (orderId, reason) => runOrderAction({
    set,
    get,
    orderId,
    actionName: 'reject',
    exclusiveKey: 'status',
    loadingValue: 'reject',
    request: rejectOrderRequest,
    requestArgs: { reason },
    requireVisibleSelection: true
  }),

  refreshEcommerceOrders: ({ background = false } = {}) => get().loadEcommerceOrders({
    filter: get().ecommerceOrdersFilter,
    limit: get().ecommerceOrdersPagination?.limit || 50,
    offset: get().ecommerceOrdersPagination?.offset || 0,
    force: true,
    background
  }),

  setEcommerceOrdersFilter: (filter) => {
    const resolvedFilter = filter || 'all';
    if (get().ecommerceOrdersFilter === resolvedFilter) return;

    listIntentEpoch += 1;
    set({
      ecommerceOrdersFilter: resolvedFilter,
      ecommerceOrdersStale: true,
      ecommerceOrdersActiveRequestKey: null
    });
  },

  invalidateEcommerceOrdersCache: () => {
    set({ ecommerceOrdersStale: true, ecommerceOrderSummaryStale: true });
  },

  markSelectedEcommerceOrderStale: (orderId = null) => {
    const state = get();
    const selectedOrderId = state.selectedEcommerceOrderRequestId;
    const requestedOrderId = orderId === null || orderId === undefined
      ? null
      : String(orderId).trim();
    if (
      !selectedOrderId ||
      state.selectedEcommerceOrder?.id !== selectedOrderId ||
      (requestedOrderId && requestedOrderId !== selectedOrderId)
    ) {
      return { success: false, changed: false, orderId: selectedOrderId || null };
    }

    if (!state.ecommerceSelectedOrderStale) {
      set({ ecommerceSelectedOrderStale: true });
    }
    return { success: true, changed: !state.ecommerceSelectedOrderStale, orderId: selectedOrderId };
  },

  requestSelectedEcommerceOrderRefresh: (orderId = null) => {
    const state = get();
    const selectedOrderId = state.selectedEcommerceOrderRequestId;
    const requestedOrderId = orderId === null || orderId === undefined
      ? null
      : String(orderId).trim();
    if (
      !selectedOrderId ||
      state.selectedEcommerceOrder?.id !== selectedOrderId ||
      (requestedOrderId && requestedOrderId !== selectedOrderId)
    ) {
      return { success: false, changed: false, orderId: selectedOrderId || null };
    }

    set((current) => ({
      ecommerceSelectedOrderStale: true,
      ecommerceSelectedOrderRefreshRevision:
        Number(current.ecommerceSelectedOrderRefreshRevision || 0) + 1,
      ecommerceSelectedOrderRefreshOrderId: selectedOrderId
    }));
    return { success: true, changed: true, orderId: selectedOrderId };
  },

  markSelectedEcommerceOrderFresh: (orderId) => {
    const state = get();
    const selectedOrderId = state.selectedEcommerceOrderRequestId;
    if (!orderId || selectedOrderId !== String(orderId).trim()) return false;
    set({ ecommerceSelectedOrderStale: false });
    return true;
  },

  clearSelectedEcommerceOrder: () => {
    detailIntentEpoch += 1;
    set({
      selectedEcommerceOrder: null,
      selectedEcommerceOrderLoading: false,
      selectedEcommerceOrderRefreshing: false,
      selectedEcommerceOrderError: null,
      selectedEcommerceOrderLoadedAt: null,
      selectedEcommerceOrderLicenseIdentity: null,
      selectedEcommerceOrderActorIdentity: null,
      selectedEcommerceOrderRequestId: null,
      ecommerceSelectedOrderStale: false,
      ecommerceSelectedOrderRefreshOrderId: null
    });
  },

  resetEcommerceOrdersState: () => {
    resetRequestState(set);
  }
});

export const ecommerceOrderSliceInternals = Object.freeze({
  LIST_TTL_MS,
  SUMMARY_TTL_MS,
  DETAIL_TTL_MS,
  captureRequestContext,
  getLicenseIdentity,
  isRequestContextCurrent,
  initialState: createInitialState()
});
