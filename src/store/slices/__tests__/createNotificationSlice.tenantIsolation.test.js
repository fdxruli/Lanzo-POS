import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudMocks = vi.hoisted(() => ({
  archiveCloudNotification: vi.fn(),
  listCloudNotifications: vi.fn(),
  markAllCloudNotificationsRead: vi.fn(),
  markCloudNotificationRead: vi.fn(),
  refreshOperationalNotifications: vi.fn()
}));

const supportMocks = vi.hoisted(() => ({
  closeSupportTicket: vi.fn(),
  createSupportTicket: vi.fn(),
  getSupportTicketThread: vi.fn(),
  listSupportTickets: vi.fn(),
  replySupportTicket: vi.fn()
}));

vi.mock('../../../services/notifications/cloudNotificationService', () => cloudMocks);
vi.mock('../../../services/support/supportTicketService', () => supportMocks);
vi.mock('../../../services/notifications/notificationRealtimeService', () => ({
  canUseNotificationRealtime: vi.fn(() => false),
  getNotificationRealtimeTopic: vi.fn(() => null),
  startNotificationRealtime: vi.fn(() => null),
  stopNotificationRealtime: vi.fn(async () => undefined)
}));

import {
  createNotificationSlice,
  getNotificationRuntimeOwner
} from '../createNotificationSlice';

const license = (key) => ({
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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createNotificationSlice tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudMocks.refreshOperationalNotifications.mockResolvedValue({
      success: true,
      generated: 0,
      events: []
    });
    supportMocks.listSupportTickets.mockResolvedValue({ success: true, tickets: [] });
  });

  it('builds runtime ownership from license and actor', () => {
    expect(getNotificationRuntimeOwner({
      licenseDetails: license('A'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    })).toBe('A|admin:admin-a');

    expect(getNotificationRuntimeOwner({
      licenseDetails: license('A'),
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a' }
    })).toBe('A|staff:staff-a');
  });

  it('does not reuse Tenant A notification cache after switching to Tenant B', async () => {
    cloudMocks.listCloudNotifications.mockImplementation(async ({ licenseDetails }) => ({
      success: true,
      notifications: [{ id: `notification-${licenseDetails.license_key}` }],
      unread_count: 1
    }));

    const harness = createHarness({
      licenseDetails: license('A'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    });

    await harness.get().loadNotifications({ refreshOperational: false });
    expect(harness.get().notifications.map((item) => item.id)).toEqual(['notification-A']);

    harness.set({
      licenseDetails: license('B'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-b' }
    });

    await harness.get().loadNotifications({ refreshOperational: false });

    expect(cloudMocks.listCloudNotifications).toHaveBeenCalledTimes(2);
    expect(harness.get().notifications.map((item) => item.id)).toEqual(['notification-B']);
    expect(harness.get().notificationRuntimeOwner).toBe('B|admin:admin-b');
  });

  it('drops a late Tenant A response after Tenant B owns the runtime', async () => {
    const tenantA = deferred();

    cloudMocks.listCloudNotifications.mockImplementation(({ licenseDetails }) => {
      if (licenseDetails.license_key === 'A') return tenantA.promise;
      return Promise.resolve({
        success: true,
        notifications: [{ id: 'notification-B' }],
        unread_count: 1
      });
    });

    const harness = createHarness({
      licenseDetails: license('A'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    });

    const pendingA = harness.get().loadNotifications({ refreshOperational: false });

    harness.set({
      licenseDetails: license('B'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-b' }
    });

    const pendingB = harness.get().loadNotifications({ refreshOperational: false });
    await pendingB;

    tenantA.resolve({
      success: true,
      notifications: [{ id: 'notification-A-late' }],
      unread_count: 1
    });
    const resultA = await pendingA;

    expect(resultA).toEqual(expect.objectContaining({
      stale: true,
      code: 'STALE_NOTIFICATION_RUNTIME'
    }));
    expect(harness.get().notifications.map((item) => item.id)).toEqual(['notification-B']);
    expect(harness.get().notificationRuntimeOwner).toBe('B|admin:admin-b');
  });

  it('drops a late support response from Tenant A after Tenant B takes over', async () => {
    const tenantA = deferred();

    supportMocks.listSupportTickets.mockImplementation(({ licenseDetails }) => {
      if (licenseDetails.license_key === 'A') return tenantA.promise;
      return Promise.resolve({
        success: true,
        tickets: [{ id: 'ticket-B' }]
      });
    });

    const harness = createHarness({
      licenseDetails: license('A'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    });

    const pendingA = harness.get().loadSupportTickets();

    harness.set({
      licenseDetails: license('B'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-b' }
    });

    await harness.get().loadSupportTickets();
    tenantA.resolve({ success: true, tickets: [{ id: 'ticket-A-late' }] });
    await pendingA;

    expect(harness.get().supportTickets.map((item) => item.id)).toEqual(['ticket-B']);
    expect(harness.get().notificationRuntimeOwner).toBe('B|admin:admin-b');
  });

  it('clears notification and support UI synchronously at a session boundary', async () => {
    cloudMocks.listCloudNotifications.mockResolvedValue({
      success: true,
      notifications: [{ id: 'notification-A' }],
      unread_count: 1
    });
    supportMocks.listSupportTickets.mockResolvedValue({
      success: true,
      tickets: [{ id: 'ticket-A' }]
    });

    const harness = createHarness({
      licenseDetails: license('A'),
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-a' }
    });

    await harness.get().loadNotifications({ refreshOperational: false });
    await harness.get().loadSupportTickets();
    harness.get().resetNotificationRuntime();

    expect(harness.get().notifications).toEqual([]);
    expect(harness.get().notificationsUnreadCount).toBe(0);
    expect(harness.get().supportTickets).toEqual([]);
    expect(harness.get().activeSupportTicket).toBeNull();
    expect(harness.get().notificationRuntimeOwner).toBeNull();
  });
});
