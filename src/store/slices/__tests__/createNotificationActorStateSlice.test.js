// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudMocks = vi.hoisted(() => ({
  archiveCloudNotification: vi.fn(),
  listCloudNotifications: vi.fn(),
  markAllCloudNotificationsRead: vi.fn(),
  markCloudNotificationRead: vi.fn(),
  markCloudNotificationsSeen: vi.fn(),
  refreshOperationalNotifications: vi.fn()
}));

const supportMocks = vi.hoisted(() => ({
  closeSupportTicket: vi.fn(),
  createSupportTicket: vi.fn(),
  getSupportTicketThread: vi.fn(),
  listSupportTickets: vi.fn(),
  replySupportTicket: vi.fn()
}));

const realtimeMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => undefined)
}));

vi.mock('../../../services/notifications/cloudNotificationService', () => cloudMocks);
vi.mock('../../../services/support/supportTicketService', () => supportMocks);
vi.mock('../../../services/notifications/notificationRealtimeService', () => ({
  canUseNotificationRealtime: vi.fn(() => true),
  getNotificationRealtimeTopic: vi.fn(() => 'notifications:license-a'),
  startNotificationRealtime: realtimeMocks.start,
  stopNotificationRealtime: realtimeMocks.stop
}));

import {
  createNotificationSlice,
  getNotificationRuntimeOwner
} from '../createNotificationActorStateSlice';

const license = (key = 'license-a') => ({
  license_key: key,
  features: {
    notification_center: true,
    cloud_notifications: true,
    support_center: true,
    support_tickets: true,
    support_channel: 'in_app'
  }
});

const createHarness = (initialState = {}) => {
  let state = { ...initialState };
  const get = () => state;
  const set = (patch) => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...next };
  };

  const slice = createNotificationSlice(set, get);
  state = { ...state, ...slice };
  return { get, set };
};

const adminState = (adminId = 'admin-a') => ({
  licenseDetails: license(),
  currentDeviceRole: 'admin',
  currentAdminUser: { id: adminId }
});

const staffState = (staffId = 'staff-a') => ({
  licenseDetails: license(),
  currentDeviceRole: 'staff',
  currentStaffUser: { id: staffId, permissions: { notifications: true } }
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  cloudMocks.refreshOperationalNotifications.mockResolvedValue({ success: true, generated: 0, events: [] });
  cloudMocks.markCloudNotificationsSeen.mockResolvedValue({ success: true, unread_count: 1, unseen_count: 0 });
  cloudMocks.markCloudNotificationRead.mockResolvedValue({ success: true, unread_count: 0, unseen_count: 0 });
  cloudMocks.markAllCloudNotificationsRead.mockResolvedValue({ success: true, unread_count: 0, unseen_count: 0 });
  cloudMocks.archiveCloudNotification.mockResolvedValue({ success: true, unread_count: 0, unseen_count: 0 });
  supportMocks.listSupportTickets.mockResolvedValue({ success: true, tickets: [] });
});

describe('createNotificationActorStateSlice', () => {
  it('keeps admin runtime ownership actor-scoped, not device-scoped', () => {
    expect(getNotificationRuntimeOwner({
      ...adminState('admin-a'),
      deviceFingerprint: 'device-1'
    })).toBe('license-a|admin:admin-a');

    expect(getNotificationRuntimeOwner({
      ...adminState('admin-a'),
      deviceFingerprint: 'device-2'
    })).toBe('license-a|admin:admin-a');

    expect(getNotificationRuntimeOwner({
      ...adminState('admin-b'),
      deviceFingerprint: 'device-1'
    })).toBe('license-a|admin:admin-b');
  });

  it('keeps staff runtime ownership actor-scoped across devices and isolated between staff actors', () => {
    expect(getNotificationRuntimeOwner({
      ...staffState('staff-a'),
      deviceFingerprint: 'device-1'
    })).toBe('license-a|staff:staff-a');

    expect(getNotificationRuntimeOwner({
      ...staffState('staff-a'),
      deviceFingerprint: 'device-2'
    })).toBe('license-a|staff:staff-a');

    expect(getNotificationRuntimeOwner({
      ...staffState('staff-b'),
      deviceFingerprint: 'device-1'
    })).toBe('license-a|staff:staff-b');
  });

  it('keeps identical actor ids isolated across licenses', () => {
    expect(getNotificationRuntimeOwner({
      ...adminState('admin-a'),
      licenseDetails: license('license-a'),
      deviceFingerprint: 'device-1'
    })).toBe('license-a|admin:admin-a');

    expect(getNotificationRuntimeOwner({
      ...adminState('admin-a'),
      licenseDetails: license('license-b'),
      deviceFingerprint: 'device-1'
    })).toBe('license-b|admin:admin-a');
  });

  it('loads separate authoritative unread and unseen counts', async () => {
    cloudMocks.listCloudNotifications.mockResolvedValue({
      success: true,
      notifications: [{ id: 'n1', is_seen: false, is_read: false }],
      unread_count: 7,
      unseen_count: 3
    });

    const harness = createHarness(adminState());
    await harness.get().loadNotifications({ refreshOperational: false });

    expect(harness.get().notificationsUnreadCount).toBe(7);
    expect(harness.get().notificationsUnseenCount).toBe(3);
  });

  it('resets actor-owned notification state before the next owner first load can fail', async () => {
    let rejectActorBLoad;
    cloudMocks.listCloudNotifications
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'actor-a-notification', is_seen: false, is_read: false }],
        unread_count: 5,
        unseen_count: 5
      })
      .mockImplementationOnce(() => new Promise((resolve, reject) => {
        rejectActorBLoad = reject;
      }))
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'actor-b-notification', is_seen: false, is_read: false }],
        unread_count: 3,
        unseen_count: 2
      });

    const harness = createHarness(adminState('admin-a'));
    await harness.get().loadNotifications({ refreshOperational: false });

    expect(harness.get().notificationsUnseenCount).toBe(5);
    expect(harness.get().notificationsUnreadCount).toBe(5);
    expect(harness.get().notifications.map((item) => item.id)).toEqual(['actor-a-notification']);

    harness.set({ currentAdminUser: { id: 'admin-b' } });
    const failedLoad = harness.get().loadNotifications({
      refreshOperational: false,
      force: true
    });

    expect(harness.get().notificationRuntimeOwner).toBe('license-a|admin:admin-b');
    expect(harness.get().notificationsUnseenCount).toBe(0);
    expect(harness.get().notificationsUnreadCount).toBe(0);
    expect(harness.get().notifications).toEqual([]);

    rejectActorBLoad(new Error('actor-b-first-load-failed'));
    await expect(failedLoad).resolves.toMatchObject({
      success: false,
      message: 'actor-b-first-load-failed'
    });

    expect(harness.get().notificationRuntimeOwner).toBe('license-a|admin:admin-b');
    expect(harness.get().notificationsUnseenCount).toBe(0);
    expect(harness.get().notificationsUnreadCount).toBe(0);
    expect(harness.get().notifications).toEqual([]);

    await harness.get().loadNotifications({
      refreshOperational: false,
      force: true
    });

    expect(harness.get().notificationRuntimeOwner).toBe('license-a|admin:admin-b');
    expect(harness.get().notificationsUnseenCount).toBe(2);
    expect(harness.get().notificationsUnreadCount).toBe(3);
    expect(harness.get().notifications.map((item) => item.id)).toEqual(['actor-b-notification']);
  });

  it('opening/seen marks notifications seen without marking them read', async () => {
    cloudMocks.listCloudNotifications.mockResolvedValue({
      success: true,
      notifications: [{ id: 'n1', is_seen: false, seen_at: null, is_read: false, read_at: null }],
      unread_count: 1,
      unseen_count: 1
    });

    const harness = createHarness(adminState());
    await harness.get().loadNotifications({ refreshOperational: false });
    const result = await harness.get().markNotificationsSeen();

    expect(cloudMocks.markCloudNotificationsSeen).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, unread_count: 1, unseen_count: 0 });
    expect(harness.get().notifications[0]).toMatchObject({
      is_seen: true,
      is_read: false,
      read_at: null
    });
    expect(harness.get().notificationsUnreadCount).toBe(1);
    expect(harness.get().notificationsUnseenCount).toBe(0);
  });

  it('reconciles a successful optimistic read with the authoritative server list', async () => {
    cloudMocks.listCloudNotifications
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'n1', is_seen: true, is_read: false }],
        unread_count: 1,
        unseen_count: 0
      })
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'n1', is_seen: true, is_read: true }],
        unread_count: 0,
        unseen_count: 0
      });

    const harness = createHarness(adminState());
    await harness.get().loadNotifications({ refreshOperational: false });
    await harness.get().markNotificationRead('n1');

    expect(cloudMocks.markCloudNotificationRead).toHaveBeenCalledWith(expect.objectContaining({
      notificationId: 'n1'
    }));
    expect(cloudMocks.listCloudNotifications).toHaveBeenCalledTimes(2);
    expect(harness.get().notifications[0].is_read).toBe(true);
    expect(harness.get().notificationsUnreadCount).toBe(0);
  });

  it('realtime invalidation force-reloads the current actor state', async () => {
    vi.useFakeTimers();
    cloudMocks.listCloudNotifications
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'n1', is_read: false, is_seen: true }],
        unread_count: 1,
        unseen_count: 0
      })
      .mockResolvedValueOnce({
        success: true,
        notifications: [{ id: 'n1', is_read: true, is_seen: true }],
        unread_count: 0,
        unseen_count: 0
      });

    const harness = createHarness(adminState());
    await harness.get().loadNotifications({ refreshOperational: false });

    harness.get().handleNotificationRealtimeEvent({
      event: 'notifications_changed',
      reason: 'notification_read_changed',
      notificationId: 'n1'
    });

    await vi.advanceTimersByTimeAsync(800);

    expect(cloudMocks.listCloudNotifications).toHaveBeenCalledTimes(2);
    expect(harness.get().notifications[0].is_read).toBe(true);
    expect(harness.get().notificationsUnreadCount).toBe(0);
  });

  it('drops seen mutation state when another actor takes over the runtime', async () => {
    let resolveSeen;
    cloudMocks.listCloudNotifications.mockResolvedValue({
      success: true,
      notifications: [{ id: 'n1', is_seen: false, is_read: false }],
      unread_count: 1,
      unseen_count: 1
    });
    cloudMocks.markCloudNotificationsSeen.mockImplementation(() => new Promise((resolve) => {
      resolveSeen = resolve;
    }));

    const harness = createHarness(adminState('admin-a'));
    await harness.get().loadNotifications({ refreshOperational: false });
    const pending = harness.get().markNotificationsSeen();

    harness.set({ currentAdminUser: { id: 'admin-b' } });
    await harness.get().loadNotifications({ refreshOperational: false, force: true });
    resolveSeen({ success: true, unread_count: 1, unseen_count: 0 });

    await expect(pending).resolves.toMatchObject({
      stale: true,
      code: 'STALE_NOTIFICATION_RUNTIME'
    });
    expect(harness.get().notificationRuntimeOwner).toBe('license-a|admin:admin-b');
  });
});
