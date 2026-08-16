import {
  archiveCloudNotification,
  listCloudNotifications,
  markAllCloudNotificationsRead,
  markCloudNotificationRead,
  refreshOperationalNotifications
} from '../../services/notifications/cloudNotificationService';
import {
  closeSupportTicket,
  createSupportTicket,
  getSupportTicketThread,
  listSupportTickets,
  replySupportTicket
} from '../../services/support/supportTicketService';
import {
  canStaffAccessNotifications,
  canStaffAccessSupportCenter,
  getNotificationCapabilities,
  getSupportChannel,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled,
  isSupportCenterEnabled
} from '../../services/notifications/notificationCapabilities';
import {
  canUseNotificationRealtime,
  getNotificationRealtimeTopic,
  startNotificationRealtime as startNotificationRealtimeChannel,
  stopNotificationRealtime as stopNotificationRealtimeChannel
} from '../../services/notifications/notificationRealtimeService';
import {
  getNotificationPreferences,
  muteCategory as persistMutedNotificationCategory,
  resetNotificationPreferences as resetStoredNotificationPreferences,
  saveNotificationPreferences,
  unmuteCategory as persistUnmutedNotificationCategory
} from '../../services/notifications/notificationPreferencesService';
import Logger from '../../services/Logger';

let notificationRuntimeGeneration = 0;
let notificationRealtimeRefreshTimer = null;
let pendingNotificationRealtimeEvent = null;
let notificationsRequest = null;
let operationalRefreshRequest = null;
let supportTicketsRequest = null;
const supportThreadRequestPromises = new Map();

const NOTIFICATIONS_TTL_MS = 60 * 1000;
const OPERATIONAL_REFRESH_TTL_MS = 5 * 60 * 1000;
const SUPPORT_TICKETS_TTL_MS = 2 * 60 * 1000;
const SUPPORT_THREAD_TTL_MS = 30 * 1000;
const STALE_RUNTIME_RESULT = Object.freeze({
  success: false,
  skipped: true,
  stale: true,
  code: 'STALE_NOTIFICATION_RUNTIME'
});

const now = () => Date.now();
const isFresh = (timestamp, ttlMs) => (
  Number.isFinite(Number(timestamp)) && now() - Number(timestamp) < ttlMs
);

const logNotificationDebug = (...args) => {
  Logger.debug('[Notifications]', ...args);
};

const getStaffSessionContext = (state = {}) => ({
  currentDeviceRole: state.currentDeviceRole,
  currentStaffUser: state.currentStaffUser
});

const canUseCloudNotifications = (licenseDetails = {}, staffSession = {}) => (
  isNotificationCenterEnabled(licenseDetails) &&
  isCloudNotificationsEnabled(licenseDetails) &&
  canStaffAccessNotifications(licenseDetails, staffSession)
);

const canUseSupportTickets = (licenseDetails = {}, staffSession = {}) => {
  const capabilities = getNotificationCapabilities(licenseDetails);

  return (
    isSupportCenterEnabled(licenseDetails) &&
    getSupportChannel(licenseDetails) === 'in_app' &&
    capabilities.support_tickets === true &&
    canStaffAccessSupportCenter(licenseDetails, staffSession)
  );
};

const getNotificationErrorMessage = (error) => {
  if (error?.message === 'SUPABASE_NOT_CONFIGURED') {
    return 'No pudimos cargar tus notificaciones. Intenta de nuevo.';
  }

  if (error?.message === 'LICENSE_KEY_REQUIRED') {
    return 'No hay una licencia activa para cargar notificaciones.';
  }

  if (error?.message === 'POS_NOTIFICATIONS_AUTH_CONTEXT_INCOMPLETE') {
    return 'No se pudo confirmar este dispositivo. Vuelve a validar la licencia.';
  }

  return error?.message || 'No pudimos cargar tus notificaciones. Intenta de nuevo.';
};

const getSupportErrorMessage = (error) => {
  if (error?.message === 'SUPABASE_NOT_CONFIGURED') {
    return 'No pudimos cargar el soporte. Intenta de nuevo.';
  }

  if (error?.message === 'LICENSE_KEY_REQUIRED') {
    return 'No hay una licencia activa para soporte interno.';
  }

  if (error?.message === 'POS_SUPPORT_AUTH_CONTEXT_INCOMPLETE') {
    return 'No se pudo confirmar este dispositivo. Vuelve a validar la licencia.';
  }

  return 'No pudimos completar la acción de soporte. Intenta de nuevo.';
};

const resetNotificationState = {
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsLoading: false,
  notificationsError: null,
  notificationsLoaded: false,
  lastNotificationsLoadedAt: null,
  lastOperationalRefreshAt: null,
  notificationsStale: true,
  operationalRefreshStale: false,
  notificationsRequestInFlight: false,
  operationalRefreshInFlight: false,
  isRefreshingNotifications: false
};

const resetSupportState = {
  supportTickets: [],
  supportTicketsLoading: false,
  supportTicketsError: null,
  activeSupportTicket: null,
  supportTicketMessages: [],
  supportTicketThreadLoading: false,
  supportTicketThreadError: null,
  supportTicketSubmitting: false,
  supportTicketView: 'list',
  supportTicketsLoaded: false,
  lastSupportTicketsLoadedAt: null,
  activeThreadLoadedAtByTicketId: {},
  supportStale: true,
  supportThreadStaleByTicketId: {},
  supportTicketsRequestInFlight: false,
  supportThreadRequestInFlightByTicketId: {},
  isRefreshingSupport: false
};

const getLicenseRuntimeIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_id ||
  licenseDetails?.id ||
  licenseDetails?.details?.license_id ||
  licenseDetails?.details?.id ||
  licenseDetails?.license_key ||
  licenseDetails?.licenseKey ||
  licenseDetails?.details?.license_key ||
  licenseDetails?.details?.licenseKey ||
  null
);

const getActorRuntimeIdentity = (state = {}) => {
  if (state.currentDeviceRole === 'staff') {
    const staffIdentity = state.currentStaffUser?.id || state.currentStaffUser?.username || 'pending';
    return `staff:${staffIdentity}`;
  }

  if (state.currentDeviceRole === 'admin') {
    const adminIdentity = state.currentAdminUser?.id || state.currentAdminUser?.username || 'pending';
    return `admin:${adminIdentity}`;
  }

  return `role:${state.currentDeviceRole || 'unknown'}`;
};

export const getNotificationRuntimeOwner = (state = {}) => {
  const licenseIdentity = getLicenseRuntimeIdentity(state.licenseDetails);
  if (!licenseIdentity) return null;
  return `${licenseIdentity}|${getActorRuntimeIdentity(state)}`;
};

const clearRealtimeTimerHandle = () => {
  if (notificationRealtimeRefreshTimer && typeof window !== 'undefined') {
    window.clearTimeout(notificationRealtimeRefreshTimer);
  }
  notificationRealtimeRefreshTimer = null;
};

const clearRealtimeTimer = () => {
  clearRealtimeTimerHandle();
  pendingNotificationRealtimeEvent = null;
};

const invalidateNotificationRuntimeBookkeeping = () => {
  notificationRuntimeGeneration += 1;
  clearRealtimeTimer();
  notificationsRequest = null;
  operationalRefreshRequest = null;
  supportTicketsRequest = null;
  supportThreadRequestPromises.clear();
  return notificationRuntimeGeneration;
};

const buildRuntimeToken = (owner, generation) => ({ owner, generation });
const runtimeRequestKey = (token) => `${token.owner || 'none'}@${token.generation}`;

const isRuntimeTokenCurrent = (get, token) => {
  if (!token) return false;
  const state = get();
  return (
    state.notificationRuntimeOwner === token.owner
    && state.notificationRuntimeGeneration === token.generation
    && getNotificationRuntimeOwner(state) === token.owner
  );
};

const ensureNotificationRuntime = (set, get) => {
  const state = get();
  const owner = getNotificationRuntimeOwner(state);

  if (state.notificationRuntimeOwner === owner && owner) {
    return buildRuntimeToken(owner, state.notificationRuntimeGeneration);
  }

  const generation = invalidateNotificationRuntimeBookkeeping();
  const notificationPreferences = getNotificationPreferences(owner);

  set({
    ...resetNotificationState,
    ...resetSupportState,
    isNotificationCenterOpen: false,
    notificationRuntimeOwner: owner,
    notificationRuntimeGeneration: generation,
    notificationPreferences,
    notificationCenterRequestedTab: null,
    notificationCenterRequestedTicketId: null
  });

  return buildRuntimeToken(owner, generation);
};

const setIfRuntimeCurrent = (set, get, token, patch) => {
  if (!isRuntimeTokenCurrent(get, token)) return false;
  set(patch);
  return true;
};

const staleRuntimeResult = () => ({ ...STALE_RUNTIME_RESULT });

export const createNotificationSlice = (set, get) => ({
  ...resetNotificationState,
  ...resetSupportState,
  isNotificationCenterOpen: false,
  notificationCenterRequestedTab: null,
  notificationCenterRequestedTicketId: null,
  notificationRealtimeSubscription: null,
  notificationRealtimeTopic: null,
  notificationRuntimeOwner: null,
  notificationRuntimeGeneration: notificationRuntimeGeneration,
  notificationPreferences: getNotificationPreferences(),

  resetNotificationRuntime: () => {
    const generation = invalidateNotificationRuntimeBookkeeping();
    set({
      ...resetNotificationState,
      ...resetSupportState,
      isNotificationCenterOpen: false,
      notificationCenterRequestedTab: null,
      notificationCenterRequestedTicketId: null,
      notificationRealtimeSubscription: null,
      notificationRealtimeTopic: null,
      notificationRuntimeOwner: null,
      notificationRuntimeGeneration: generation,
      notificationPreferences: getNotificationPreferences()
    });
    return generation;
  },

  loadNotificationPreferences: () => {
    const token = ensureNotificationRuntime(set, get);
    const notificationPreferences = getNotificationPreferences(token.owner);
    setIfRuntimeCurrent(set, get, token, { notificationPreferences });
    return notificationPreferences;
  },

  updateNotificationPreferences: (nextPreferences = {}) => {
    const token = ensureNotificationRuntime(set, get);
    if (!isRuntimeTokenCurrent(get, token)) return getNotificationPreferences();

    const currentPreferences = get().notificationPreferences || getNotificationPreferences(token.owner);
    const notificationPreferences = saveNotificationPreferences({
      ...currentPreferences,
      ...nextPreferences,
      tickerCategories: {
        ...(currentPreferences.tickerCategories || {}),
        ...(nextPreferences.tickerCategories || {})
      },
      featuredCategories: {
        ...(currentPreferences.featuredCategories || {}),
        ...(nextPreferences.featuredCategories || {})
      },
      mutedCategories: {
        ...(currentPreferences.mutedCategories || {}),
        ...(nextPreferences.mutedCategories || {})
      },
      mutedEventKeys: {
        ...(currentPreferences.mutedEventKeys || {}),
        ...(nextPreferences.mutedEventKeys || {})
      }
    }, token.owner);
    setIfRuntimeCurrent(set, get, token, { notificationPreferences });
    return notificationPreferences;
  },

  resetNotificationPreferences: () => {
    const token = ensureNotificationRuntime(set, get);
    const notificationPreferences = resetStoredNotificationPreferences(token.owner);
    setIfRuntimeCurrent(set, get, token, { notificationPreferences });
    return notificationPreferences;
  },

  muteNotificationCategory: (category, durationMs) => {
    const token = ensureNotificationRuntime(set, get);
    const notificationPreferences = persistMutedNotificationCategory(
      category,
      durationMs,
      get().notificationPreferences,
      token.owner
    );
    setIfRuntimeCurrent(set, get, token, { notificationPreferences });
    return notificationPreferences;
  },

  unmuteNotificationCategory: (category) => {
    const token = ensureNotificationRuntime(set, get);
    const notificationPreferences = persistUnmutedNotificationCategory(
      category,
      get().notificationPreferences,
      token.owner
    );
    setIfRuntimeCurrent(set, get, token, { notificationPreferences });
    return notificationPreferences;
  },

  openNotificationCenter: ({
    tab = null,
    ticketId = null
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    setIfRuntimeCurrent(set, get, token, {
      isNotificationCenterOpen: true,
      notificationCenterRequestedTab: tab,
      notificationCenterRequestedTicketId: ticketId
    });
  },

  closeNotificationCenter: () => {
    set({ isNotificationCenterOpen: false });
  },

  clearNotificationCenterRequest: () => {
    set({
      notificationCenterRequestedTab: null,
      notificationCenterRequestedTicketId: null
    });
  },

  loadNotifications: async ({
    limit = 30,
    offset = 0,
    includeArchived = false,
    refreshOperational = true,
    force = false,
    background = false
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, resetNotificationState);
      return { success: true, notifications: [], unread_count: 0, skipped: true };
    }

    const state = get();
    const shouldUseCache = (
      state.notificationRuntimeOwner === token.owner
      && state.notificationRuntimeGeneration === token.generation
      && !force
      && state.notificationsLoaded
      && !state.notificationsStale
      && isFresh(state.lastNotificationsLoadedAt, NOTIFICATIONS_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using tenant-owned cached notifications', token.owner);
      return {
        success: true,
        notifications: state.notifications || [],
        unread_count: Number(state.notificationsUnreadCount || 0),
        unreadCount: Number(state.notificationsUnreadCount || 0),
        cached: true
      };
    }

    const requestKey = runtimeRequestKey(token);
    if (notificationsRequest?.key === requestKey) {
      logNotificationDebug('deduplicating notifications request', requestKey);
      return notificationsRequest.promise;
    }

    const hasCachedNotifications = state.notificationsLoaded && (state.notifications || []).length > 0;
    setIfRuntimeCurrent(set, get, token, {
      notificationsLoading: !background && !hasCachedNotifications,
      isRefreshingNotifications: background || hasCachedNotifications,
      notificationsRequestInFlight: true,
      notificationsError: null
    });

    const promise = (async () => {
      if (refreshOperational) {
        await get().refreshOperationalNotificationsIfNeeded?.({ force });
      }

      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      logNotificationDebug(
        force
          ? 'loading notifications because manual refresh requested'
          : 'loading notifications because stale',
        token.owner
      );

      const result = await listCloudNotifications({
        licenseDetails,
        limit,
        offset,
        includeArchived
      });

      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const message = result.message || result.code || 'No pudimos cargar tus notificaciones. Intenta de nuevo.';
        setIfRuntimeCurrent(set, get, token, {
          notifications: [],
          notificationsUnreadCount: 0,
          notificationsLoading: false,
          isRefreshingNotifications: false,
          notificationsRequestInFlight: false,
          notificationsError: message,
          notificationsLoaded: false,
          notificationsStale: true
        });
        return result;
      }

      setIfRuntimeCurrent(set, get, token, {
        notifications: result.notifications || [],
        notificationsUnreadCount: Number(result.unread_count ?? result.unreadCount ?? 0) || 0,
        notificationsLoading: false,
        isRefreshingNotifications: false,
        notificationsRequestInFlight: false,
        notificationsError: null,
        notificationsLoaded: true,
        lastNotificationsLoadedAt: now(),
        notificationsStale: false
      });

      return result;
    })();

    notificationsRequest = { key: requestKey, promise };

    try {
      return await promise;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getNotificationErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        notificationsLoading: false,
        isRefreshingNotifications: false,
        notificationsRequestInFlight: false,
        notificationsError: message
      });
      return { success: false, message };
    } finally {
      if (notificationsRequest?.key === requestKey) notificationsRequest = null;
    }
  },

  refreshOperationalNotificationsIfNeeded: async ({
    force = false
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, {
        lastOperationalRefreshAt: null,
        operationalRefreshStale: false,
        operationalRefreshInFlight: false
      });
      return { success: true, generated: 0, events: [], skipped: true };
    }

    const state = get();
    const shouldSkip = (
      !force
      && !state.operationalRefreshStale
      && isFresh(state.lastOperationalRefreshAt, OPERATIONAL_REFRESH_TTL_MS)
    );

    if (shouldSkip) {
      logNotificationDebug('skipping operational refresh due tenant TTL', token.owner);
      return { success: true, skipped: true, cached: true };
    }

    const requestKey = runtimeRequestKey(token);
    if (operationalRefreshRequest?.key === requestKey) {
      logNotificationDebug('deduplicating operational refresh', requestKey);
      return operationalRefreshRequest.promise;
    }

    setIfRuntimeCurrent(set, get, token, { operationalRefreshInFlight: true });

    const promise = (async () => {
      try {
        const result = await refreshOperationalNotifications({ licenseDetails });
        if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
        setIfRuntimeCurrent(set, get, token, {
          lastOperationalRefreshAt: now(),
          operationalRefreshStale: false,
          operationalRefreshInFlight: false
        });
        return result;
      } catch (error) {
        if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
        setIfRuntimeCurrent(set, get, token, { operationalRefreshInFlight: false });
        logNotificationDebug('operational refresh failed', error?.message || error);
        return { success: false, message: getNotificationErrorMessage(error) };
      }
    })();

    operationalRefreshRequest = { key: requestKey, promise };

    try {
      return await promise;
    } finally {
      if (operationalRefreshRequest?.key === requestKey) operationalRefreshRequest = null;
    }
  },

  invalidateNotificationCache: ({
    support = false,
    ticketId = null,
    operational = false
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const nextState = {
      notificationsStale: true
    };

    if (operational) nextState.operationalRefreshStale = true;
    if (support) nextState.supportStale = true;

    if (ticketId) {
      const currentThreadStale = get().supportThreadStaleByTicketId || {};
      nextState.supportThreadStaleByTicketId = {
        ...currentThreadStale,
        [ticketId]: true
      };
    }

    logNotificationDebug('realtime invalidated tenant cache', token.owner);
    setIfRuntimeCurrent(set, get, token, nextState);
  },

  startNotificationRealtime: async () => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseNotificationRealtime(licenseDetails, getStaffSessionContext(get()))) {
      await get().stopNotificationRealtime?.();
      return null;
    }

    const nextTopic = getNotificationRealtimeTopic(licenseDetails);
    const currentTopic = get().notificationRealtimeTopic;

    if (get().notificationRealtimeSubscription && currentTopic === nextTopic) {
      return get().notificationRealtimeSubscription;
    }

    await get().stopNotificationRealtime?.();
    if (!isRuntimeTokenCurrent(get, token)) return null;

    const channel = startNotificationRealtimeChannel({
      licenseDetails,
      staffSession: getStaffSessionContext(get()),
      onNotificationEvent: (event) => {
        if (!isRuntimeTokenCurrent(get, token)) return;
        get().handleNotificationRealtimeEvent?.(event);
      }
    });

    setIfRuntimeCurrent(set, get, token, {
      notificationRealtimeSubscription: channel,
      notificationRealtimeTopic: channel ? nextTopic : null
    });

    return isRuntimeTokenCurrent(get, token) ? channel : null;
  },

  stopNotificationRealtime: async () => {
    const subscription = get().notificationRealtimeSubscription;
    const topic = get().notificationRealtimeTopic;
    clearRealtimeTimer();
    await stopNotificationRealtimeChannel();

    const state = get();
    if (
      state.notificationRealtimeSubscription === subscription
      && state.notificationRealtimeTopic === topic
    ) {
      set({
        notificationRealtimeSubscription: null,
        notificationRealtimeTopic: null
      });
    }
  },

  handleNotificationRealtimeEvent: (event = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) return;

    const ticketId = event.ticketId || event.ticket_id || null;
    const reason = event.reason || '';
    const isSupportEvent = (
      ticketId ||
      reason === 'support_reply' ||
      reason === 'ticket_status_changed' ||
      reason === 'support_ticket_changed'
    );
    const isOperationalEvent = (
      reason === 'operational_refresh' ||
      reason === 'cash_changed' ||
      reason === 'sync_changed' ||
      ['cash', 'sync', 'staff', 'inventory', 'operation', 'operations'].includes(event.metadata?.category)
    );

    get().invalidateNotificationCache?.({
      support: isSupportEvent,
      ticketId,
      operational: isOperationalEvent
    });

    const previousPending = pendingNotificationRealtimeEvent;
    clearRealtimeTimerHandle();
    pendingNotificationRealtimeEvent = {
      ...(previousPending || {}),
      ...event,
      runtimeToken: token,
      ticketId: ticketId || previousPending?.ticketId || null,
      support: isSupportEvent || previousPending?.support || false
    };

    if (typeof window === 'undefined') return;

    notificationRealtimeRefreshTimer = window.setTimeout(async () => {
      const realtimeEvent = pendingNotificationRealtimeEvent || {};
      notificationRealtimeRefreshTimer = null;
      pendingNotificationRealtimeEvent = null;

      if (!isRuntimeTokenCurrent(get, realtimeEvent.runtimeToken)) return;

      await get().loadNotifications?.({
        refreshOperational: false,
        force: true,
        background: true
      });

      if (!isRuntimeTokenCurrent(get, realtimeEvent.runtimeToken)) return;

      const eventTicketId = realtimeEvent.ticketId;
      const shouldRefreshSupport = (
        realtimeEvent.support ||
        eventTicketId ||
        realtimeEvent.reason === 'support_reply' ||
        realtimeEvent.reason === 'ticket_status_changed' ||
        realtimeEvent.reason === 'support_ticket_changed'
      );

      if (!shouldRefreshSupport || !canUseSupportTickets(get().licenseDetails, getStaffSessionContext(get()))) return;

      const isDrawerOpen = get().isNotificationCenterOpen;
      const activeTicketId = get().activeSupportTicket?.id;

      if (isDrawerOpen) {
        await get().loadSupportTickets?.({ force: true, background: true });
      }

      if (eventTicketId && activeTicketId === eventTicketId) {
        await get().openSupportTicket?.(eventTicketId, { force: true, background: true });
      }
    }, 750);
  },

  markNotificationRead: async (notificationId) => {
    if (!notificationId) return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };

    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const currentNotifications = get().notifications || [];
    const currentNotification = currentNotifications.find((item) => item.id === notificationId);

    if (currentNotification?.is_read) return { success: true, skipped: true };

    setIfRuntimeCurrent(set, get, token, (state) => ({
      notifications: (state.notifications || []).map((item) => (
        item.id === notificationId
          ? { ...item, is_read: true, read_at: item.read_at || new Date().toISOString() }
          : item
      )),
      notificationsUnreadCount: Math.max(Number(state.notificationsUnreadCount || 0) - 1, 0),
      notificationsError: null
    }));

    try {
      const result = await markCloudNotificationRead({ licenseDetails, notificationId });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      }

      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getNotificationErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, { notificationsError: message });
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      return { success: false, message };
    }
  },

  markAllNotificationsRead: async () => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const previousNotifications = get().notifications || [];
    const previousUnreadCount = get().notificationsUnreadCount || 0;

    setIfRuntimeCurrent(set, get, token, (state) => ({
      notifications: (state.notifications || []).map((item) => ({
        ...item,
        is_read: true,
        read_at: item.read_at || new Date().toISOString()
      })),
      notificationsUnreadCount: 0,
      notificationsError: null
    }));

    try {
      const result = await markAllCloudNotificationsRead({ licenseDetails });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        setIfRuntimeCurrent(set, get, token, {
          notifications: previousNotifications,
          notificationsUnreadCount: previousUnreadCount
        });
      }

      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getNotificationErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        notifications: previousNotifications,
        notificationsUnreadCount: previousUnreadCount,
        notificationsError: message
      });
      return { success: false, message };
    }
  },

  archiveNotification: async (notificationId) => {
    if (!notificationId) return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };

    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const previousNotifications = get().notifications || [];
    const previousUnreadCount = get().notificationsUnreadCount || 0;
    const currentNotification = previousNotifications.find((item) => item.id === notificationId);

    setIfRuntimeCurrent(set, get, token, (state) => ({
      notifications: (state.notifications || []).filter((item) => item.id !== notificationId),
      notificationsUnreadCount: currentNotification?.is_read
        ? Number(state.notificationsUnreadCount || 0)
        : Math.max(Number(state.notificationsUnreadCount || 0) - 1, 0),
      notificationsError: null
    }));

    try {
      const result = await archiveCloudNotification({ licenseDetails, notificationId });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        setIfRuntimeCurrent(set, get, token, {
          notifications: previousNotifications,
          notificationsUnreadCount: previousUnreadCount
        });
        await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      }

      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getNotificationErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        notifications: previousNotifications,
        notificationsUnreadCount: previousUnreadCount,
        notificationsError: message
      });
      return { success: false, message };
    }
  },

  showSupportTicketForm: () => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, { supportTicketsError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return false;
    }

    setIfRuntimeCurrent(set, get, token, {
      supportTicketView: 'form',
      activeSupportTicket: null,
      supportTicketMessages: [],
      supportTicketThreadError: null
    });
    return true;
  },

  showSupportTicketList: () => {
    const token = ensureNotificationRuntime(set, get);
    setIfRuntimeCurrent(set, get, token, {
      supportTicketView: 'list',
      activeSupportTicket: null,
      supportTicketMessages: [],
      supportTicketThreadError: null
    });
  },

  loadSupportTickets: async ({
    limit = 20,
    offset = 0,
    includeClosed = false,
    force = false,
    background = false
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, resetSupportState);
      return { success: true, tickets: [], skipped: true };
    }

    const state = get();
    const shouldUseCache = (
      !force
      && state.supportTicketsLoaded
      && !state.supportStale
      && isFresh(state.lastSupportTicketsLoadedAt, SUPPORT_TICKETS_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using tenant-owned cached support tickets', token.owner);
      return { success: true, tickets: state.supportTickets || [], cached: true };
    }

    const requestKey = runtimeRequestKey(token);
    if (supportTicketsRequest?.key === requestKey) {
      logNotificationDebug('deduplicating support tickets request', requestKey);
      return supportTicketsRequest.promise;
    }

    const hasCachedTickets = state.supportTicketsLoaded && (state.supportTickets || []).length > 0;
    setIfRuntimeCurrent(set, get, token, {
      supportTicketsLoading: !background && !hasCachedTickets,
      isRefreshingSupport: background || hasCachedTickets,
      supportTicketsRequestInFlight: true,
      supportTicketsError: null
    });

    const promise = (async () => {
      logNotificationDebug(
        force
          ? 'loading support tickets because manual refresh requested'
          : 'loading support tickets because stale',
        token.owner
      );

      const result = await listSupportTickets({
        licenseDetails,
        limit,
        offset,
        includeClosed
      });

      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const message = 'No pudimos cargar el soporte. Intenta de nuevo.';
        setIfRuntimeCurrent(set, get, token, {
          supportTickets: [],
          supportTicketsLoading: false,
          isRefreshingSupport: false,
          supportTicketsRequestInFlight: false,
          supportTicketsError: message,
          supportTicketsLoaded: false,
          supportStale: true
        });
        return result;
      }

      setIfRuntimeCurrent(set, get, token, {
        supportTickets: result.tickets || [],
        supportTicketsLoading: false,
        isRefreshingSupport: false,
        supportTicketsRequestInFlight: false,
        supportTicketsError: null,
        supportTicketsLoaded: true,
        lastSupportTicketsLoadedAt: now(),
        supportStale: false
      });

      return result;
    })();

    supportTicketsRequest = { key: requestKey, promise };

    try {
      return await promise;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getSupportErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        supportTicketsLoading: false,
        isRefreshingSupport: false,
        supportTicketsRequestInFlight: false,
        supportTicketsError: message
      });
      return { success: false, message };
    } finally {
      if (supportTicketsRequest?.key === requestKey) supportTicketsRequest = null;
    }
  },

  openSupportTicket: async (ticketId, {
    force = false,
    background = false
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, { supportTicketThreadError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return { success: false, code: 'STAFF_SUPPORT_DISABLED' };
    }

    if (!ticketId) {
      setIfRuntimeCurrent(set, get, token, { supportTicketView: 'list' });
      return { success: false, code: 'TICKET_ID_REQUIRED' };
    }

    const state = get();
    const threadLoadedAt = state.activeThreadLoadedAtByTicketId?.[ticketId];
    const threadIsStale = state.supportThreadStaleByTicketId?.[ticketId] === true;
    const isActiveThread = state.activeSupportTicket?.id === ticketId;
    const shouldUseCache = (
      !force
      && isActiveThread
      && !threadIsStale
      && isFresh(threadLoadedAt, SUPPORT_THREAD_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using tenant-owned cached support thread', ticketId, token.owner);
      setIfRuntimeCurrent(set, get, token, { supportTicketView: 'thread' });
      return {
        success: true,
        ticket: state.activeSupportTicket,
        messages: state.supportTicketMessages || [],
        cached: true
      };
    }

    const requestKey = `${runtimeRequestKey(token)}:${ticketId}`;
    if (supportThreadRequestPromises.has(requestKey)) {
      logNotificationDebug('deduplicating support thread request', requestKey);
      return supportThreadRequestPromises.get(requestKey);
    }

    const currentThreadRequestState = get().supportThreadRequestInFlightByTicketId || {};
    setIfRuntimeCurrent(set, get, token, {
      supportTicketView: 'thread',
      supportTicketThreadLoading: !background && !isActiveThread,
      supportTicketThreadError: null,
      supportThreadRequestInFlightByTicketId: {
        ...currentThreadRequestState,
        [ticketId]: true
      }
    });

    const threadPromise = (async () => {
      logNotificationDebug(
        force
          ? 'loading support thread because manual refresh requested'
          : 'loading support thread because stale',
        ticketId,
        token.owner
      );

      const result = await getSupportTicketThread({ licenseDetails, ticketId });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const message = 'No pudimos cargar el hilo de soporte. Intenta de nuevo.';
        const requestState = get().supportThreadRequestInFlightByTicketId || {};
        setIfRuntimeCurrent(set, get, token, {
          supportTicketThreadLoading: false,
          supportTicketThreadError: message,
          supportThreadRequestInFlightByTicketId: {
            ...requestState,
            [ticketId]: false
          }
        });
        return result;
      }

      const loadedAtByTicketId = get().activeThreadLoadedAtByTicketId || {};
      const staleByTicketId = get().supportThreadStaleByTicketId || {};
      const requestState = get().supportThreadRequestInFlightByTicketId || {};
      setIfRuntimeCurrent(set, get, token, {
        activeSupportTicket: result.ticket,
        supportTicketMessages: result.messages || [],
        supportTicketThreadLoading: false,
        supportTicketThreadError: null,
        supportTicketView: 'thread',
        activeThreadLoadedAtByTicketId: {
          ...loadedAtByTicketId,
          [ticketId]: now()
        },
        supportThreadStaleByTicketId: {
          ...staleByTicketId,
          [ticketId]: false
        },
        supportThreadRequestInFlightByTicketId: {
          ...requestState,
          [ticketId]: false
        }
      });

      return result;
    })();

    supportThreadRequestPromises.set(requestKey, threadPromise);

    try {
      return await threadPromise;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const message = getSupportErrorMessage(error);
      const requestState = get().supportThreadRequestInFlightByTicketId || {};
      setIfRuntimeCurrent(set, get, token, {
        supportTicketThreadLoading: false,
        supportTicketThreadError: message,
        supportThreadRequestInFlightByTicketId: {
          ...requestState,
          [ticketId]: false
        }
      });
      return { success: false, message };
    } finally {
      supportThreadRequestPromises.delete(requestKey);
    }
  },

  createTicket: async ({
    subject,
    category = 'help',
    priority = 'normal',
    message,
    metadata = {}
  } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;

    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      setIfRuntimeCurrent(set, get, token, { supportTicketsError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return { success: false, code: 'STAFF_SUPPORT_DISABLED' };
    }

    setIfRuntimeCurrent(set, get, token, { supportTicketSubmitting: true, supportTicketsError: null });

    try {
      const result = await createSupportTicket({
        licenseDetails,
        subject,
        category,
        priority,
        message,
        metadata
      });

      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const messageText = 'No pudimos crear la solicitud. Intenta de nuevo.';
        setIfRuntimeCurrent(set, get, token, {
          supportTicketSubmitting: false,
          supportTicketsError: messageText
        });
        return result;
      }

      setIfRuntimeCurrent(set, get, token, {
        supportTicketSubmitting: false,
        supportTicketView: 'thread'
      });

      await get().loadSupportTickets?.({ force: true, background: true });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      if (result.ticket?.id && isRuntimeTokenCurrent(get, token)) {
        await get().openSupportTicket?.(result.ticket.id, { force: true });
      }

      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const messageText = getSupportErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        supportTicketSubmitting: false,
        supportTicketsError: messageText
      });
      return { success: false, message: messageText };
    }
  },

  replyTicket: async ({ ticketId, message } = {}) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_SUPPORT_DISABLED', message: 'Tu usuario staff no tiene acceso a soporte Lanzo.' };
    }

    const resolvedTicketId = ticketId || get().activeSupportTicket?.id;
    if (!resolvedTicketId) return { success: false, code: 'TICKET_ID_REQUIRED' };

    setIfRuntimeCurrent(set, get, token, { supportTicketSubmitting: true, supportTicketThreadError: null });

    try {
      const result = await replySupportTicket({
        licenseDetails,
        ticketId: resolvedTicketId,
        message
      });

      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const messageText = 'No pudimos enviar la respuesta. Intenta de nuevo.';
        setIfRuntimeCurrent(set, get, token, {
          supportTicketSubmitting: false,
          supportTicketThreadError: messageText
        });
        return result;
      }

      setIfRuntimeCurrent(set, get, token, { supportTicketSubmitting: false });
      await get().openSupportTicket?.(resolvedTicketId, { force: true, background: true });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      await get().loadSupportTickets?.({ force: true, background: true });
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const messageText = getSupportErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        supportTicketSubmitting: false,
        supportTicketThreadError: messageText
      });
      return { success: false, message: messageText };
    }
  },

  closeTicket: async (ticketId) => {
    const token = ensureNotificationRuntime(set, get);
    const licenseDetails = get().licenseDetails;
    if (!token.owner || !canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_SUPPORT_DISABLED', message: 'Tu usuario staff no tiene acceso a soporte Lanzo.' };
    }

    const resolvedTicketId = ticketId || get().activeSupportTicket?.id;
    if (!resolvedTicketId) return { success: false, code: 'TICKET_ID_REQUIRED' };

    setIfRuntimeCurrent(set, get, token, { supportTicketSubmitting: true, supportTicketThreadError: null });

    try {
      const result = await closeSupportTicket({ licenseDetails, ticketId: resolvedTicketId });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();

      if (result.success === false) {
        const messageText = 'No pudimos cerrar el ticket. Intenta de nuevo.';
        setIfRuntimeCurrent(set, get, token, {
          supportTicketSubmitting: false,
          supportTicketThreadError: messageText
        });
        return result;
      }

      setIfRuntimeCurrent(set, get, token, { supportTicketSubmitting: false });
      await get().openSupportTicket?.(resolvedTicketId, { force: true, background: true });
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      await get().loadSupportTickets?.({ includeClosed: true, force: true, background: true });
      return result;
    } catch (error) {
      if (!isRuntimeTokenCurrent(get, token)) return staleRuntimeResult();
      const messageText = getSupportErrorMessage(error);
      setIfRuntimeCurrent(set, get, token, {
        supportTicketSubmitting: false,
        supportTicketThreadError: messageText
      });
      return { success: false, message: messageText };
    }
  }
});
