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

let listRequestPromise = null;
let summaryRequestPromise = null;
const detailRequestPromises = new Map();
let actionRequestPromise = null;

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

const EMPTY_COUNTS = Object.freeze({
  new: 0,
  seen: 0,
  pending: 0,
  accepted: 0,
  rejected: 0,
  total: 0
});

const initialState = {
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
  ecommerceOrderActionLoading: null,
  ecommerceOrdersStale: true,
  ecommerceOrderSummaryStale: true,
  lastEcommerceOrdersLoadedAt: null,
  lastEcommerceOrderSummaryLoadedAt: null,
  ecommerceOrdersLicenseIdentity: null
};

const canUseInbox = (state = {}) => (
  canAccessEcommerceOrders(state.licenseDetails, getStaffSession(state))
);

const updateOrderInList = (orders = [], nextOrder = {}) => orders.map((order) => (
  order.id === nextOrder.id
    ? { ...order, ...nextOrder }
    : order
));

export const createEcommerceOrderSlice = (set, get) => ({
  ...initialState,

  loadEcommerceOrders: async ({
    filter,
    limit = 50,
    offset = 0,
    force = false,
    background = false
  } = {}) => {
    const state = get();
    if (!canUseInbox(state)) {
      set({ ...initialState });
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    const licenseIdentity = getLicenseIdentity(state.licenseDetails);
    const resolvedFilter = filter || state.ecommerceOrdersFilter || 'all';
    const sameLicense = state.ecommerceOrdersLicenseIdentity === licenseIdentity;
    const sameFilter = state.ecommerceOrdersFilter === resolvedFilter;
    const canUseCache = (
      !force &&
      sameLicense &&
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

    if (listRequestPromise) return listRequestPromise;

    const hasCachedList = sameLicense && state.ecommerceOrdersLoaded;
    set({
      ecommerceOrdersLoading: !background && !hasCachedList,
      ecommerceOrdersRefreshing: background || hasCachedList,
      ecommerceOrdersError: null,
      ecommerceOrdersFilter: resolvedFilter,
      ecommerceOrdersLicenseIdentity: licenseIdentity
    });

    listRequestPromise = (async () => {
      const result = await listEcommerceOrders({
        licenseDetails: get().licenseDetails,
        status: resolvedFilter,
        limit,
        offset
      });

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
        ecommerceOrdersLicenseIdentity: licenseIdentity
      });
      return result;
    })();

    try {
      return await listRequestPromise;
    } finally {
      listRequestPromise = null;
    }
  },

  loadEcommerceOrderSummary: async ({ force = false, background = true } = {}) => {
    const state = get();
    if (!canUseInbox(state)) {
      set({ ecommerceOrderCounts: { ...EMPTY_COUNTS }, ecommerceOrderSummaryStale: true });
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    const licenseIdentity = getLicenseIdentity(state.licenseDetails);
    const canUseCache = (
      !force &&
      state.ecommerceOrdersLicenseIdentity === licenseIdentity &&
      !state.ecommerceOrderSummaryStale &&
      isFresh(state.lastEcommerceOrderSummaryLoadedAt, SUMMARY_TTL_MS)
    );
    if (canUseCache) return { success: true, counts: state.ecommerceOrderCounts, cached: true };
    if (summaryRequestPromise) return summaryRequestPromise;

    summaryRequestPromise = (async () => {
      const result = await listEcommerceOrders({
        licenseDetails: get().licenseDetails,
        status: 'all',
        limit: 1,
        offset: 0
      });
      if (result.success === false) return result;

      set({
        ecommerceOrderCounts: result.counts,
        ecommerceOrderSummaryStale: false,
        lastEcommerceOrderSummaryLoadedAt: now(),
        ecommerceOrdersLicenseIdentity: licenseIdentity,
        ...(background ? {} : { ecommerceOrdersError: null })
      });
      return { success: true, counts: result.counts };
    })();

    try {
      return await summaryRequestPromise;
    } finally {
      summaryRequestPromise = null;
    }
  },

  openEcommerceOrder: async (orderId, { force = false, markSeen = true } = {}) => {
    if (!orderId) return { success: false, code: 'ECOMMERCE_ORDER_NOT_FOUND' };
    const state = get();
    if (!canUseInbox(state)) {
      set({ selectedEcommerceOrder: null, selectedEcommerceOrderError: 'No tienes permiso para abrir pedidos online.' });
      return { success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' };
    }

    if (
      !force &&
      state.selectedEcommerceOrder?.id === orderId &&
      isFresh(state.selectedEcommerceOrderLoadedAt, DETAIL_TTL_MS)
    ) {
      return { success: true, order: state.selectedEcommerceOrder, cached: true };
    }

    if (detailRequestPromises.has(orderId)) return detailRequestPromises.get(orderId);

    set({ selectedEcommerceOrderLoading: true, selectedEcommerceOrderError: null });
    const request = (async () => {
      let result = await getEcommerceOrder({ licenseDetails: get().licenseDetails, orderId });
      if (result.success === false) {
        set({
          selectedEcommerceOrderLoading: false,
          selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result)
        });
        return result;
      }

      if (markSeen && result.order.status === 'new') {
        const seenResult = await markSeenRequest({ licenseDetails: get().licenseDetails, orderId });
        if (seenResult.success !== false && seenResult.changed) {
          const refreshed = await getEcommerceOrder({ licenseDetails: get().licenseDetails, orderId });
          if (refreshed.success !== false) result = refreshed;
          set((current) => ({
            ecommerceOrders: updateOrderInList(current.ecommerceOrders, { id: orderId, status: 'seen', seenAt: new Date().toISOString() }),
            ecommerceOrderCounts: {
              ...current.ecommerceOrderCounts,
              new: Math.max(Number(current.ecommerceOrderCounts.new || 0) - 1, 0),
              seen: Number(current.ecommerceOrderCounts.seen || 0) + 1
            }
          }));
        }
      }

      set({
        selectedEcommerceOrder: result.order,
        selectedEcommerceOrderLoading: false,
        selectedEcommerceOrderError: null,
        selectedEcommerceOrderLoadedAt: now()
      });
      return result;
    })();

    detailRequestPromises.set(orderId, request);
    try {
      return await request;
    } finally {
      detailRequestPromises.delete(orderId);
    }
  },

  markEcommerceOrderSeen: async (orderId) => {
    const result = await markSeenRequest({ licenseDetails: get().licenseDetails, orderId });
    if (result.success !== false && result.changed) {
      get().invalidateEcommerceOrdersCache?.();
      await get().openEcommerceOrder?.(orderId, { force: true, markSeen: false });
      await get().refreshEcommerceOrders?.({ background: true });
    }
    return result;
  },

  acceptEcommerceOrder: async (orderId) => {
    if (actionRequestPromise) return actionRequestPromise;
    set({ ecommerceOrderActionLoading: 'accept', selectedEcommerceOrderError: null });
    actionRequestPromise = acceptOrderRequest({ licenseDetails: get().licenseDetails, orderId });
    try {
      const result = await actionRequestPromise;
      if (result.success === false) {
        set({ selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result) });
        return result;
      }
      get().invalidateEcommerceOrdersCache?.();
      await Promise.all([
        get().openEcommerceOrder?.(orderId, { force: true, markSeen: false }),
        get().refreshEcommerceOrders?.({ background: true })
      ]);
      return result;
    } finally {
      actionRequestPromise = null;
      set({ ecommerceOrderActionLoading: null });
    }
  },

  rejectEcommerceOrder: async (orderId, reason) => {
    if (actionRequestPromise) return actionRequestPromise;
    set({ ecommerceOrderActionLoading: 'reject', selectedEcommerceOrderError: null });
    actionRequestPromise = rejectOrderRequest({ licenseDetails: get().licenseDetails, orderId, reason });
    try {
      const result = await actionRequestPromise;
      if (result.success === false) {
        set({ selectedEcommerceOrderError: result.message || getEcommerceOrderErrorMessage(result) });
        return result;
      }
      get().invalidateEcommerceOrdersCache?.();
      await Promise.all([
        get().openEcommerceOrder?.(orderId, { force: true, markSeen: false }),
        get().refreshEcommerceOrders?.({ background: true })
      ]);
      return result;
    } finally {
      actionRequestPromise = null;
      set({ ecommerceOrderActionLoading: null });
    }
  },

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
    selectedEcommerceOrderLoadedAt: null
  }),

  resetEcommerceOrdersState: () => {
    listRequestPromise = null;
    summaryRequestPromise = null;
    detailRequestPromises.clear();
    actionRequestPromise = null;
    set({ ...initialState, ecommerceOrderCounts: { ...EMPTY_COUNTS } });
  }
});

export const ecommerceOrderSliceInternals = Object.freeze({
  LIST_TTL_MS,
  SUMMARY_TTL_MS,
  DETAIL_TTL_MS,
  initialState
});
