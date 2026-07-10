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

const staleResponse = () => ({
  success: false,
  code: 'ECOMMERCE_ORDERS_STALE_RESPONSE',
  message: 'La sesión cambió antes de completar la solicitud.',
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
  selectedEcommerceOrder: null,
  selectedEcommerceOrderLoading: false,
  selectedEcommerceOrderError: null,
  selectedEcommerceOrderLoadedAt: null,
  selectedEcommerceOrderLicenseIdentity: null,
  selectedEcommerceOrderActorIdentity: null,
  ecommerceOrderActionLoading: null,
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
  loadingValue,
  request,
  requestArgs = {}
}) => {
  if (!orderId) return { success: false, code: 'ECOMMERCE_ORDER_NOT_FOUND' };

  const state = get();
  if (!canUseInbox(state)) {
    resetRequestState(set);
    return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
  }

  const requestContext = captureRequestContext(state);
  const requestLicenseDetails = state.licenseDetails;
  const requestKey = [
    requestContext.licenseIdentity,
    requestContext.actorIdentity,
    orderId,
    actionName
  ].join(':');

  if (actionRequestPromises.has(requestKey)) {
    return actionRequestPromises.get(requestKey);
  }

  if (loadingValue) {
    set({ ecommerceOrderActionLoading: loadingValue, selectedEcommerceOrderError: null });
  }

  const actionPromise = (async () => {
    const result = await request({
      licenseDetails: requestLicenseDetails,
      orderId,
      ...requestArgs
    });

    if (!isRequestContextCurrent(requestContext, get())) return staleResponse();

    if (result.success === false) {
      set({ selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result) });
      return result;
    }

    if (result.changed) {
      set({ ecommerceOrdersStale: true, ecommerceOrderSummaryStale: true });

      await Promise.all([
        get().openEcommerceOrder?.(orderId, { force: true, markSeen: false }),
        get().refreshEcommerceOrders?.({ background: true })
      ]);

      if (!isRequestContextCurrent(requestContext, get())) return staleResponse();
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

    if (loadingValue && isRequestContextCurrent(requestContext, get())) {
      set({ ecommerceOrderActionLoading: null });
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
    const canUseCache = (
      !force &&
      sameLicense &&
      sameActor &&
      sameFilter &&
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

    if (listRequestPromises.has(requestKey)) {
      return listRequestPromises.get(requestKey);
    }

    const hasCachedList = sameLicense && sameActor && state.ecommerceOrdersLoaded;
    set({
      ecommerceOrdersLoading: !background && !hasCachedList,
      ecommerceOrdersRefreshing: background || hasCachedList,
      ecommerceOrdersError: null,
      ecommerceOrdersFilter: resolvedFilter,
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

      if (!isRequestContextCurrent(requestContext, get())) return staleResponse();

      if (result.success === false) {
        set({
          ecommerceOrdersLoading: false,
          ecommerceOrdersRefreshing: false,
          ecommerceOrdersError: result.message || getEcommerceOrderErrorMessage(result),
          ecommerceOrdersStale: true
        });
        return result;
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

  loadEcommerceOrderSummary: async ({ force = false, background = true } = {}) => {
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
        lastEcommerceOrderSummaryLoadedAt: now(),
        ecommerceOrdersLicenseIdentity: licenseIdentity,
        ecommerceOrdersActorIdentity: actorIdentity,
        ...(background ? {} : { ecommerceOrdersError: null })
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

  openEcommerceOrder: async (orderId, { force = false, markSeen = true } = {}) => {
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

    if (
      !force &&
      state.selectedEcommerceOrder?.id === orderId &&
      state.selectedEcommerceOrderLicenseIdentity === licenseIdentity &&
      state.selectedEcommerceOrderActorIdentity === actorIdentity &&
      isFresh(state.selectedEcommerceOrderLoadedAt, DETAIL_TTL_MS)
    ) {
      return { success: true, order: state.selectedEcommerceOrder, cached: true };
    }

    const requestKey = `${licenseIdentity}:${actorIdentity}:${orderId}`;
    if (detailRequestPromises.has(requestKey)) {
      return detailRequestPromises.get(requestKey);
    }

    set({
      selectedEcommerceOrderLoading: true,
      selectedEcommerceOrderError: null,
      selectedEcommerceOrderLicenseIdentity: licenseIdentity,
      selectedEcommerceOrderActorIdentity: actorIdentity
    });

    const request = (async () => {
      let result = await getEcommerceOrder({
        licenseDetails: requestLicenseDetails,
        orderId
      });

      if (!isRequestContextCurrent(requestContext, get())) return staleResponse();

      if (result.success === false) {
        set({
          selectedEcommerceOrderLoading: false,
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

        if (!isRequestContextCurrent(requestContext, get())) return staleResponse();

        if (seenResult.success !== false && seenResult.changed) {
          const refreshed = await getEcommerceOrder({
            licenseDetails: requestLicenseDetails,
            orderId
          });

          if (!isRequestContextCurrent(requestContext, get())) return staleResponse();
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

      if (!isRequestContextCurrent(requestContext, get())) return staleResponse();

      set({
        selectedEcommerceOrder: result.order,
        selectedEcommerceOrderLoading: false,
        selectedEcommerceOrderError: null,
        selectedEcommerceOrderLoadedAt: now(),
        selectedEcommerceOrderLicenseIdentity: licenseIdentity,
        selectedEcommerceOrderActorIdentity: actorIdentity
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
    loadingValue: null,
    request: markSeenRequest
  }),

  acceptEcommerceOrder: (orderId) => runOrderAction({
    set,
    get,
    orderId,
    actionName: 'accept',
    loadingValue: 'accept',
    request: acceptOrderRequest
  }),

  rejectEcommerceOrder: (orderId, reason) => runOrderAction({
    set,
    get,
    orderId,
    actionName: 'reject',
    loadingValue: 'reject',
    request: rejectOrderRequest,
    requestArgs: { reason }
  }),

  refreshEcommerceOrders: ({ background = false } = {}) => get().loadEcommerceOrders({
    filter: get().ecommerceOrdersFilter,
    limit: get().ecommerceOrdersPagination?.limit || 50,
    offset: 0,
    force: true,
    background
  }),

  setEcommerceOrdersFilter: (filter) => {
    set({ ecommerceOrdersFilter: filter || 'all', ecommerceOrdersStale: true });
  },

  invalidateEcommerceOrdersCache: () => {
    set({ ecommerceOrdersStale: true, ecommerceOrderSummaryStale: true });
  },

  clearSelectedEcommerceOrder: () => set({
    selectedEcommerceOrder: null,
    selectedEcommerceOrderLoading: false,
    selectedEcommerceOrderError: null,
    selectedEcommerceOrderLoadedAt: null,
    selectedEcommerceOrderLicenseIdentity: null,
    selectedEcommerceOrderActorIdentity: null
  }),

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
