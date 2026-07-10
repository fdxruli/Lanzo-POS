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

let notificationRealtimeRefreshTimer = null;
let pendingNotificationRealtimeEvent = null;
let notificationsRequestPromise = null;
let operationalRefreshPromise = null;
let supportTicketsRequestPromise = null;
const supportThreadRequestPromises = new Map();

const NOTIFICATIONS_TTL_MS = 60 * 1000;
const OPERATIONAL_REFRESH_TTL_MS = 5 * 60 * 1000;
const SUPPORT_TICKETS_TTL_MS = 2 * 60 * 1000;
const SUPPORT_THREAD_TTL_MS = 30 * 1000;

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

export const createNotificationSlice = (set, get) => ({
  ...resetNotificationState,
  ...resetSupportState,
  isNotificationCenterOpen: false,
  notificationCenterRequestedTab: null,
  notificationCenterRequestedTicketId: null,
  notificationRealtimeSubscription: null,
  notificationRealtimeTopic: null,
  notificationPreferences: getNotificationPreferences(),

  loadNotificationPreferences: () => {
    const notificationPreferences = getNotificationPreferences();
    set({ notificationPreferences });
    return notificationPreferences;
  },

  updateNotificationPreferences: (nextPreferences = {}) => {
    const currentPreferences = get().notificationPreferences || getNotificationPreferences();
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
    });
    set({ notificationPreferences });
    return notificationPreferences;
  },

  resetNotificationPreferences: () => {
    const notificationPreferences = resetStoredNotificationPreferences();
    set({ notificationPreferences });
    return notificationPreferences;
  },

  muteNotificationCategory: (category, durationMs) => {
    const notificationPreferences = persistMutedNotificationCategory(
      category,
      durationMs,
      get().notificationPreferences
    );
    set({ notificationPreferences });
    return notificationPreferences;
  },

  unmuteNotificationCategory: (category) => {
    const notificationPreferences = persistUnmutedNotificationCategory(
      category,
      get().notificationPreferences
    );
    set({ notificationPreferences });
    return notificationPreferences;
  },

  openNotificationCenter: ({
    tab = null,
    ticketId = null
  } = {}) => {
    set({
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
    const licenseDetails = get().licenseDetails;

    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      set(resetNotificationState);
      return { success: true, notifications: [], unread_count: 0, skipped: true };
    }

    const state = get();
    const shouldUseCache = (
      !force &&
      state.notificationsLoaded &&
      !state.notificationsStale &&
      isFresh(state.lastNotificationsLoadedAt, NOTIFICATIONS_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using cached notifications');
      return {
        success: true,
        notifications: state.notifications || [],
        unread_count: Number(state.notificationsUnreadCount || 0),
        unreadCount: Number(state.notificationsUnreadCount || 0),
        cached: true
      };
    }

    if (notificationsRequestPromise) {
      logNotificationDebug('deduplicating notifications request');
      return notificationsRequestPromise;
    }

    const hasCachedNotifications = state.notificationsLoaded && (state.notifications || []).length > 0;
    set({
      notificationsLoading: !background && !hasCachedNotifications,
      isRefreshingNotifications: background || hasCachedNotifications,
      notificationsRequestInFlight: true,
      notificationsError: null
    });

    notificationsRequestPromise = (async () => {
      if (refreshOperational) {
        await get().refreshOperationalNotificationsIfNeeded?.({ force });
      }

      logNotificationDebug(
        force
          ? 'loading notifications because manual refresh requested'
          : 'loading notifications because stale'
      );

      const result = await listCloudNotifications({
        licenseDetails,
        limit,
        offset,
        includeArchived
      });

      if (result.success === false) {
        const message = result.message || result.code || 'No pudimos cargar tus notificaciones. Intenta de nuevo.';
        set({
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

      set({
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

    try {
      return await notificationsRequestPromise;
    } catch (error) {
      const message = getNotificationErrorMessage(error);
      set({
        notificationsLoading: false,
        isRefreshingNotifications: false,
        notificationsRequestInFlight: false,
        notificationsError: message
      });
      return { success: false, message };
    } finally {
      notificationsRequestPromise = null;
    }
  },

  refreshOperationalNotificationsIfNeeded: async ({
    force = false
  } = {}) => {
    const licenseDetails = get().licenseDetails;

    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      set({
        lastOperationalRefreshAt: null,
        operationalRefreshStale: false,
        operationalRefreshInFlight: false
      });
      return { success: true, generated: 0, events: [], skipped: true };
    }

    const state = get();
    const shouldSkip = (
      !force &&
      !state.operationalRefreshStale &&
      isFresh(state.lastOperationalRefreshAt, OPERATIONAL_REFRESH_TTL_MS)
    );

    if (shouldSkip) {
      logNotificationDebug('skipping operational refresh due TTL');
      return { success: true, skipped: true, cached: true };
    }

    if (operationalRefreshPromise) {
      logNotificationDebug('deduplicating operational refresh');
      return operationalRefreshPromise;
    }

    set({ operationalRefreshInFlight: true });

    operationalRefreshPromise = (async () => {
      try {
        const result = await refreshOperationalNotifications({ licenseDetails });
        set({
          lastOperationalRefreshAt: now(),
          operationalRefreshStale: false,
          operationalRefreshInFlight: false
        });
        return result;
      } catch (error) {
        set({ operationalRefreshInFlight: false });
        logNotificationDebug('operational refresh failed', error?.message || error);
        return { success: false, message: getNotificationErrorMessage(error) };
      } finally {
        operationalRefreshPromise = null;
      }
    })();

    return operationalRefreshPromise;
  },

  invalidateNotificationCache: ({
    support = false,
    ticketId = null,
    operational = false
  } = {}) => {
    const nextState = {
      notificationsStale: true
    };

    if (operational) {
      nextState.operationalRefreshStale = true;
    }

    if (support) {
      nextState.supportStale = true;
    }

    if (ticketId) {
      const currentThreadStale = get().supportThreadStaleByTicketId || {};
      nextState.supportThreadStaleByTicketId = {
        ...currentThreadStale,
        [ticketId]: true
      };
    }

    logNotificationDebug('realtime invalidated cache');
    set(nextState);
  },

  startNotificationRealtime: async () => {
    const licenseDetails = get().licenseDetails;

    if (!canUseNotificationRealtime(licenseDetails, getStaffSessionContext(get()))) {
      await get().stopNotificationRealtime?.();
      return null;
    }

    const nextTopic = getNotificationRealtimeTopic(licenseDetails);
    const currentTopic = get().notificationRealtimeTopic;

    if (get().notificationRealtimeSubscription && currentTopic === nextTopic) {
      return get().notificationRealtimeSubscription;
    }

    await get().stopNotificationRealtime?.();

    const channel = startNotificationRealtimeChannel({
      licenseDetails,
      staffSession: getStaffSessionContext(get()),
      onNotificationEvent: (event) => {
        get().handleNotificationRealtimeEvent?.(event);
      }
    });

    set({
      notificationRealtimeSubscription: channel,
      notificationRealtimeTopic: channel ? nextTopic : null
    });

    return channel;
  },

  stopNotificationRealtime: async () => {
    if (notificationRealtimeRefreshTimer) {
      window.clearTimeout(notificationRealtimeRefreshTimer);
      notificationRealtimeRefreshTimer = null;
    }

    pendingNotificationRealtimeEvent = null;

    await stopNotificationRealtimeChannel();
    set({
      notificationRealtimeSubscription: null,
      notificationRealtimeTopic: null
    });
  },

  handleNotificationRealtimeEvent: (event = {}) => {
    const licenseDetails = get().licenseDetails;

    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) return;

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
      ['cash', 'sync', 'staff'].includes(event.metadata?.category)
    );

    get().invalidateNotificationCache?.({
      support: isSupportEvent,
      ticketId,
      operational: isOperationalEvent
    });

    pendingNotificationRealtimeEvent = {
      ...(pendingNotificationRealtimeEvent || {}),
      ...event,
      ticketId: ticketId || pendingNotificationRealtimeEvent?.ticketId || null,
      support: isSupportEvent || pendingNotificationRealtimeEvent?.support || false
    };

    if (notificationRealtimeRefreshTimer) {
      window.clearTimeout(notificationRealtimeRefreshTimer);
    }

    notificationRealtimeRefreshTimer = window.setTimeout(async () => {
      const realtimeEvent = pendingNotificationRealtimeEvent || {};
      notificationRealtimeRefreshTimer = null;
      pendingNotificationRealtimeEvent = null;

      await get().loadNotifications?.({
        refreshOperational: false,
        force: true,
        background: true
      });

      const ticketId = realtimeEvent.ticketId;
      const shouldRefreshSupport = (
        realtimeEvent.support ||
        ticketId ||
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

      if (ticketId && activeTicketId === ticketId) {
        await get().openSupportTicket?.(ticketId, { force: true, background: true });
      }
    }, 750);
  },

  markNotificationRead: async (notificationId) => {
    if (!notificationId) return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };

    const licenseDetails = get().licenseDetails;
    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const currentNotifications = get().notifications || [];
    const currentNotification = currentNotifications.find((item) => item.id === notificationId);

    if (currentNotification?.is_read) {
      return { success: true, skipped: true };
    }

    set((state) => ({
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

      if (result.success === false) {
        await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      }

      return result;
    } catch (error) {
      const message = getNotificationErrorMessage(error);
      set({ notificationsError: message });
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      return { success: false, message };
    }
  },

  markAllNotificationsRead: async () => {
    const licenseDetails = get().licenseDetails;
    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const previousNotifications = get().notifications || [];
    const previousUnreadCount = get().notificationsUnreadCount || 0;

    set((state) => ({
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

      if (result.success === false) {
        set({
          notifications: previousNotifications,
          notificationsUnreadCount: previousUnreadCount
        });
      }

      return result;
    } catch (error) {
      const message = getNotificationErrorMessage(error);
      set({
        notifications: previousNotifications,
        notificationsUnreadCount: previousUnreadCount,
        notificationsError: message
      });
      return { success: false, message };
    }
  },

  archiveNotification: async (notificationId) => {
    if (!notificationId) return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };

    const licenseDetails = get().licenseDetails;
    if (!canUseCloudNotifications(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_NOTIFICATIONS_DISABLED', message: 'Tu usuario staff no tiene acceso al Centro de Notificaciones.' };
    }

    const previousNotifications = get().notifications || [];
    const previousUnreadCount = get().notificationsUnreadCount || 0;
    const currentNotification = previousNotifications.find((item) => item.id === notificationId);

    set((state) => ({
      notifications: (state.notifications || []).filter((item) => item.id !== notificationId),
      notificationsUnreadCount: currentNotification?.is_read
        ? Number(state.notificationsUnreadCount || 0)
        : Math.max(Number(state.notificationsUnreadCount || 0) - 1, 0),
      notificationsError: null
    }));

    try {
      const result = await archiveCloudNotification({ licenseDetails, notificationId });

      if (result.success === false) {
        set({
          notifications: previousNotifications,
          notificationsUnreadCount: previousUnreadCount
        });
        await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      }

      return result;
    } catch (error) {
      const message = getNotificationErrorMessage(error);
      set({
        notifications: previousNotifications,
        notificationsUnreadCount: previousUnreadCount,
        notificationsError: message
      });
      return { success: false, message };
    }
  },

  showSupportTicketForm: () => {
    const licenseDetails = get().licenseDetails;
    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      set({ supportTicketsError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return false;
    }

    set({
      supportTicketView: 'form',
      activeSupportTicket: null,
      supportTicketMessages: [],
      supportTicketThreadError: null
    });
    return true;
  },

  showSupportTicketList: () => {
    set({
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
    const licenseDetails = get().licenseDetails;

    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      set(resetSupportState);
      return { success: true, tickets: [], skipped: true };
    }

    const state = get();
    const shouldUseCache = (
      !force &&
      state.supportTicketsLoaded &&
      !state.supportStale &&
      isFresh(state.lastSupportTicketsLoadedAt, SUPPORT_TICKETS_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using cached support tickets');
      return { success: true, tickets: state.supportTickets || [], cached: true };
    }

    if (supportTicketsRequestPromise) {
      logNotificationDebug('deduplicating support tickets request');
      return supportTicketsRequestPromise;
    }

    const hasCachedTickets = state.supportTicketsLoaded && (state.supportTickets || []).length > 0;
    set({
      supportTicketsLoading: !background && !hasCachedTickets,
      isRefreshingSupport: background || hasCachedTickets,
      supportTicketsRequestInFlight: true,
      supportTicketsError: null
    });

    supportTicketsRequestPromise = (async () => {
      logNotificationDebug(
        force
          ? 'loading support tickets because manual refresh requested'
          : 'loading support tickets because stale'
      );

      const result = await listSupportTickets({
        licenseDetails,
        limit,
        offset,
        includeClosed
      });

      if (result.success === false) {
        const message = 'No pudimos cargar el soporte. Intenta de nuevo.';
        set({
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

      set({
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

    try {
      return await supportTicketsRequestPromise;
    } catch (error) {
      const message = getSupportErrorMessage(error);
      set({
        supportTicketsLoading: false,
        isRefreshingSupport: false,
        supportTicketsRequestInFlight: false,
        supportTicketsError: message
      });
      return { success: false, message };
    } finally {
      supportTicketsRequestPromise = null;
    }
  },

  openSupportTicket: async (ticketId, {
    force = false,
    background = false
  } = {}) => {
    const licenseDetails = get().licenseDetails;

    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      set({ supportTicketThreadError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return { success: false, code: 'STAFF_SUPPORT_DISABLED' };
    }

    if (!ticketId) {
      set({ supportTicketView: 'list' });
      return { success: false, code: 'TICKET_ID_REQUIRED' };
    }

    const state = get();
    const threadLoadedAt = state.activeThreadLoadedAtByTicketId?.[ticketId];
    const threadIsStale = state.supportThreadStaleByTicketId?.[ticketId] === true;
    const isActiveThread = state.activeSupportTicket?.id === ticketId;
    const shouldUseCache = (
      !force &&
      isActiveThread &&
      !threadIsStale &&
      isFresh(threadLoadedAt, SUPPORT_THREAD_TTL_MS)
    );

    if (shouldUseCache) {
      logNotificationDebug('using cached support thread', ticketId);
      set({ supportTicketView: 'thread' });
      return {
        success: true,
        ticket: state.activeSupportTicket,
        messages: state.supportTicketMessages || [],
        cached: true
      };
    }

    if (supportThreadRequestPromises.has(ticketId)) {
      logNotificationDebug('deduplicating support thread request', ticketId);
      return supportThreadRequestPromises.get(ticketId);
    }

    const currentThreadRequestState = get().supportThreadRequestInFlightByTicketId || {};
    set({
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
        ticketId
      );

      const result = await getSupportTicketThread({ licenseDetails, ticketId });

      if (result.success === false) {
        const message = 'No pudimos cargar el hilo de soporte. Intenta de nuevo.';
        const requestState = get().supportThreadRequestInFlightByTicketId || {};
        set({
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
      set({
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

    supportThreadRequestPromises.set(ticketId, threadPromise);

    try {
      return await threadPromise;
    } catch (error) {
      const message = getSupportErrorMessage(error);
      const requestState = get().supportThreadRequestInFlightByTicketId || {};
      set({
        supportTicketThreadLoading: false,
        supportTicketThreadError: message,
        supportThreadRequestInFlightByTicketId: {
          ...requestState,
          [ticketId]: false
        }
      });
      return { success: false, message };
    } finally {
      supportThreadRequestPromises.delete(ticketId);
    }
  },

  createTicket: async ({
    subject,
    category = 'help',
    priority = 'normal',
    message,
    metadata = {}
  } = {}) => {
    const licenseDetails = get().licenseDetails;

    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      set({ supportTicketsError: 'Tu usuario staff no tiene acceso a soporte Lanzo.' });
      return { success: false, code: 'STAFF_SUPPORT_DISABLED' };
    }

    set({ supportTicketSubmitting: true, supportTicketsError: null });

    try {
      const result = await createSupportTicket({
        licenseDetails,
        subject,
        category,
        priority,
        message,
        metadata
      });

      if (result.success === false) {
        const messageText = 'No pudimos crear la solicitud. Intenta de nuevo.';
        set({
          supportTicketSubmitting: false,
          supportTicketsError: messageText
        });
        return result;
      }

      set({
        supportTicketSubmitting: false,
        supportTicketView: 'thread'
      });

      await get().loadSupportTickets?.({ force: true, background: true });
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      if (result.ticket?.id) {
        await get().openSupportTicket?.(result.ticket.id, { force: true });
      }

      return result;
    } catch (error) {
      const messageText = getSupportErrorMessage(error);
      set({
        supportTicketSubmitting: false,
        supportTicketsError: messageText
      });
      return { success: false, message: messageText };
    }
  },

  replyTicket: async ({ ticketId, message } = {}) => {
    const licenseDetails = get().licenseDetails;
    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_SUPPORT_DISABLED', message: 'Tu usuario staff no tiene acceso a soporte Lanzo.' };
    }

    const resolvedTicketId = ticketId || get().activeSupportTicket?.id;
    if (!resolvedTicketId) return { success: false, code: 'TICKET_ID_REQUIRED' };

    set({ supportTicketSubmitting: true, supportTicketThreadError: null });

    try {
      const result = await replySupportTicket({
        licenseDetails,
        ticketId: resolvedTicketId,
        message
      });

      if (result.success === false) {
        const messageText = 'No pudimos enviar la respuesta. Intenta de nuevo.';
        set({
          supportTicketSubmitting: false,
          supportTicketThreadError: messageText
        });
        return result;
      }

      set({ supportTicketSubmitting: false });
      await get().openSupportTicket?.(resolvedTicketId, { force: true, background: true });
      await get().loadSupportTickets?.({ force: true, background: true });
      await get().loadNotifications?.({ force: true, refreshOperational: false, background: true });
      return result;
    } catch (error) {
      const messageText = getSupportErrorMessage(error);
      set({
        supportTicketSubmitting: false,
        supportTicketThreadError: messageText
      });
      return { success: false, message: messageText };
    }
  },

  closeTicket: async (ticketId) => {
    const licenseDetails = get().licenseDetails;
    if (!canUseSupportTickets(licenseDetails, getStaffSessionContext(get()))) {
      return { success: false, code: 'STAFF_SUPPORT_DISABLED', message: 'Tu usuario staff no tiene acceso a soporte Lanzo.' };
    }

    const resolvedTicketId = ticketId || get().activeSupportTicket?.id;
    if (!resolvedTicketId) return { success: false, code: 'TICKET_ID_REQUIRED' };

    set({ supportTicketSubmitting: true, supportTicketThreadError: null });

    try {
      const result = await closeSupportTicket({ licenseDetails, ticketId: resolvedTicketId });

      if (result.success === false) {
        const messageText = 'No pudimos cerrar el ticket. Intenta de nuevo.';
        set({
          supportTicketSubmitting: false,
          supportTicketThreadError: messageText
        });
        return result;
      }

      set({ supportTicketSubmitting: false });
      await get().openSupportTicket?.(resolvedTicketId, { force: true, background: true });
      await get().loadSupportTickets?.({ includeClosed: true, force: true, background: true });
      return result;
    } catch (error) {
      const messageText = getSupportErrorMessage(error);
      set({
        supportTicketSubmitting: false,
        supportTicketThreadError: messageText
      });
      return { success: false, message: messageText };
    }
  }
});
