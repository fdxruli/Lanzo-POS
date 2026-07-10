import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildPosSyncAuthContext: vi.fn(),
  isNotificationCenterEnabled: vi.fn(),
  isCloudNotificationsEnabled: vi.fn()
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: mocks.rpc }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: mocks.buildPosSyncAuthContext
}));

vi.mock('../notificationCapabilities', () => ({
  isNotificationCenterEnabled: mocks.isNotificationCenterEnabled,
  isCloudNotificationsEnabled: mocks.isCloudNotificationsEnabled
}));

import {
  archiveCloudNotification,
  listCloudNotifications,
  markAllCloudNotificationsRead,
  markCloudNotificationRead,
  refreshOperationalNotifications
} from '../cloudNotificationService';

const licenseDetails = {
  license_key: 'license-fixture',
  features: {
    notification_center: true,
    cloud_notifications: true
  }
};

const authArgs = {
  p_license_key: 'license-fixture',
  p_device_fingerprint: 'device-fixture',
  p_security_token: 'security-fixture',
  p_staff_session_token: 'staff-session-fixture'
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNotificationCenterEnabled.mockReturnValue(true);
  mocks.isCloudNotificationsEnabled.mockReturnValue(true);
  mocks.buildPosSyncAuthContext.mockResolvedValue({
    licenseKey: 'license-fixture',
    deviceFingerprint: 'device-fixture',
    securityToken: 'security-fixture',
    staffSessionToken: 'staff-session-fixture'
  });
});

describe('cloudNotificationService custom-auth RPC access', () => {
  it('lists and normalizes notifications through the public Supabase client', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        success: true,
        unread_count: '2',
        notifications: [{
          id: 'notification-1',
          type: 'ecommerce',
          severity: 'info',
          title: 'Nuevo pedido online',
          body: 'Pedido EC-00000011',
          action_label: 'Abrir pedido',
          action_route: '/pedidos-online?order=11111111-1111-4111-8111-111111111111',
          metadata: { required_permission: 'ecommerce' },
          created_at: '2026-07-10T12:00:00Z',
          is_read: false,
          is_archived: false,
          is_dismissible: true
        }]
      },
      error: null
    });

    const result = await listCloudNotifications({
      licenseDetails,
      limit: 500,
      offset: -2,
      includeArchived: true
    });

    expect(mocks.rpc).toHaveBeenCalledWith('list_pos_notifications', {
      ...authArgs,
      p_limit: 100,
      p_offset: 0,
      p_include_archived: true
    });
    expect(result).toMatchObject({
      success: true,
      unread_count: 2,
      unreadCount: 2,
      notifications: [{
        id: 'notification-1',
        section: 'ecommerce',
        title: 'Nuevo pedido online',
        action_route: '/pedidos-online?order=11111111-1111-4111-8111-111111111111',
        metadata: { required_permission: 'ecommerce' }
      }]
    });
  });

  it('uses the same custom-auth context for read, read-all, archive and refresh RPCs', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });

    await markCloudNotificationRead({
      licenseDetails,
      notificationId: 'notification-1'
    });
    await markAllCloudNotificationsRead({ licenseDetails });
    await archiveCloudNotification({
      licenseDetails,
      notificationId: 'notification-1'
    });
    await refreshOperationalNotifications({ licenseDetails });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'mark_pos_notification_read', {
      ...authArgs,
      p_notification_id: 'notification-1'
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'mark_all_pos_notifications_read', authArgs);
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'archive_pos_notification', {
      ...authArgs,
      p_notification_id: 'notification-1'
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, 'refresh_operational_notifications', authArgs);
  });

  it('does not call PostgREST when the notification center capability is disabled', async () => {
    mocks.isNotificationCenterEnabled.mockReturnValue(false);

    const result = await listCloudNotifications({ licenseDetails });

    expect(result).toMatchObject({ success: true, skipped: true, notifications: [] });
    expect(mocks.buildPosSyncAuthContext).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a complete device security context before calling an RPC', async () => {
    mocks.buildPosSyncAuthContext.mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: null,
      staffSessionToken: 'staff-session-fixture'
    });

    await expect(listCloudNotifications({ licenseDetails }))
      .rejects.toThrow('POS_NOTIFICATIONS_AUTH_CONTEXT_INCOMPLETE');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
