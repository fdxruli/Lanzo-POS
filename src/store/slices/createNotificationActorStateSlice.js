import { markCloudNotificationsSeen } from '../../services/notifications/cloudNotificationService';
import {
  createNotificationSlice as createBaseNotificationSlice,
  getNotificationRuntimeOwner
} from './createNotificationSlice';

export { getNotificationRuntimeOwner } from './createNotificationSlice';

const hasCount = (result, snakeKey, camelKey) => (
  result?.[snakeKey] !== undefined || result?.[camelKey] !== undefined
);

const readCount = (result, snakeKey, camelKey) => (
  Number(result?.[snakeKey] ?? result?.[camelKey] ?? 0) || 0
);

const captureRuntime = (get) => ({
  owner: getNotificationRuntimeOwner(get()),
  generation: get().notificationRuntimeGeneration
});

const isRuntimeCurrent = (get, token) => (
  Boolean(token?.owner)
  && getNotificationRuntimeOwner(get()) === token.owner
  && get().notificationRuntimeOwner === token.owner
  && get().notificationRuntimeGeneration === token.generation
);

export const createNotificationSlice = (set, get) => {
  const base = createBaseNotificationSlice(set, get);

  const applyAuthoritativeCounts = (result) => {
    const patch = {};
    if (hasCount(result, 'unread_count', 'unreadCount')) {
      patch.notificationsUnreadCount = readCount(result, 'unread_count', 'unreadCount');
    }
    if (hasCount(result, 'unseen_count', 'unseenCount')) {
      patch.notificationsUnseenCount = readCount(result, 'unseen_count', 'unseenCount');
    }
    if (Object.keys(patch).length > 0) set(patch);
  };

  const loadNotifications = async (options = {}) => {
    const result = await base.loadNotifications(options);

    if (result?.stale) return result;
    if (result?.success === false) return result;

    if (result?.skipped && Array.isArray(result.notifications) && result.notifications.length === 0) {
      set({ notificationsUnseenCount: 0 });
      return result;
    }

    applyAuthoritativeCounts(result);
    return result;
  };

  const reconcileAfterMutation = async (result) => {
    if (result?.stale || result?.success === false) return result;
    applyAuthoritativeCounts(result);
    await get().loadNotifications?.({
      force: true,
      refreshOperational: false,
      background: true
    });
    return result;
  };

  return {
    ...base,
    notificationsUnseenCount: 0,

    resetNotificationRuntime: () => {
      const generation = base.resetNotificationRuntime();
      set({ notificationsUnseenCount: 0 });
      return generation;
    },

    loadNotifications,

    markNotificationsSeen: async () => {
      const token = captureRuntime(get);
      const licenseDetails = get().licenseDetails;

      if (!token.owner) {
        return { success: true, skipped: true, unread_count: 0, unseen_count: 0 };
      }

      const previousNotifications = get().notifications || [];
      const previousUnseenCount = get().notificationsUnseenCount || 0;
      const seenAt = new Date().toISOString();

      set((state) => ({
        notifications: (state.notifications || []).map((item) => (
          item.is_archived
            ? item
            : { ...item, is_seen: true, seen_at: item.seen_at || seenAt }
        )),
        notificationsUnseenCount: 0
      }));

      try {
        const result = await markCloudNotificationsSeen({ licenseDetails });
        if (!isRuntimeCurrent(get, token)) {
          return { success: false, skipped: true, stale: true, code: 'STALE_NOTIFICATION_RUNTIME' };
        }

        if (result.success === false) {
          set({
            notifications: previousNotifications,
            notificationsUnseenCount: previousUnseenCount
          });
          await get().loadNotifications?.({
            force: true,
            refreshOperational: false,
            background: true
          });
          return result;
        }

        applyAuthoritativeCounts(result);
        return result;
      } catch (error) {
        if (!isRuntimeCurrent(get, token)) {
          return { success: false, skipped: true, stale: true, code: 'STALE_NOTIFICATION_RUNTIME' };
        }

        set({
          notifications: previousNotifications,
          notificationsUnseenCount: previousUnseenCount
        });
        await get().loadNotifications?.({
          force: true,
          refreshOperational: false,
          background: true
        });
        return {
          success: false,
          message: error?.message || 'No se pudieron marcar las notificaciones como vistas.'
        };
      }
    },

    markNotificationRead: async (notificationId) => (
      reconcileAfterMutation(await base.markNotificationRead(notificationId))
    ),

    markAllNotificationsRead: async () => (
      reconcileAfterMutation(await base.markAllNotificationsRead())
    ),

    archiveNotification: async (notificationId) => (
      reconcileAfterMutation(await base.archiveNotification(notificationId))
    )
  };
};

export default createNotificationSlice;
