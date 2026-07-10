import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import {
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled
} from './notificationCapabilities';

const EMPTY_CLOUD_NOTIFICATIONS = Object.freeze({
  success: true,
  notifications: [],
  unread_count: 0,
  unreadCount: 0,
  skipped: true
});

const clampLimit = (limit) => Math.min(Math.max(Number(limit) || 30, 1), 100);
const clampOffset = (offset) => Math.max(Number(offset) || 0, 0);

const parseRpcPayload = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { success: false, code: 'INVALID_RPC_RESPONSE' };
    }
  }

  return data || {};
};

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key ||
  licenseDetails.licenseKey ||
  licenseDetails.details?.license_key ||
  licenseDetails.details?.licenseKey ||
  null
);

const canUseCloudNotifications = (licenseDetails = {}) => (
  isNotificationCenterEnabled(licenseDetails) &&
  isCloudNotificationsEnabled(licenseDetails)
);

const normalizeNotification = (notification = {}) => ({
  id: notification.id,
  type: notification.type || 'system',
  section: notification.type || 'system',
  severity: notification.severity || 'info',
  tone: notification.severity || 'info',
  title: notification.title || 'Notificación',
  body: notification.body || '',
  description: notification.body || '',
  action_label: notification.action_label || null,
  action_route: notification.action_route || null,
  metadata: notification.metadata || {},
  created_at: notification.created_at || null,
  createdAt: notification.created_at || '',
  read_at: notification.read_at || null,
  archived_at: notification.archived_at || null,
  is_read: Boolean(notification.is_read),
  is_archived: Boolean(notification.is_archived),
  is_dismissible: notification.is_dismissible !== false
});

const normalizeListResponse = (data) => {
  const payload = parseRpcPayload(data);
  const notifications = Array.isArray(payload.notifications)
    ? payload.notifications.map(normalizeNotification).filter((item) => item.id)
    : [];
  const unreadCount = Number(payload.unread_count ?? payload.unreadCount ?? 0) || 0;

  return {
    ...payload,
    success: payload.success !== false,
    notifications,
    unread_count: unreadCount,
    unreadCount
  };
};

const normalizeMutationResponse = (data) => {
  const payload = parseRpcPayload(data);
  return {
    ...payload,
    success: payload.success !== false
  };
};

const buildRpcAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);

  if (!licenseKey) {
    throw new Error('LICENSE_KEY_REQUIRED');
  }

  const authContext = await buildPosSyncAuthContext({ licenseKey });

  if (!authContext.deviceFingerprint || !authContext.securityToken) {
    throw new Error('POS_NOTIFICATIONS_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken || null
  };
};

const ensureRpcAvailable = (licenseDetails = {}) => {
  if (!canUseCloudNotifications(licenseDetails)) {
    return false;
  }

  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  return true;
};

export async function listCloudNotifications({
  licenseDetails,
  limit = 30,
  offset = 0,
  includeArchived = false
} = {}) {
  if (!ensureRpcAvailable(licenseDetails)) {
    return { ...EMPTY_CLOUD_NOTIFICATIONS };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('list_pos_notifications', {
    ...authArgs,
    p_limit: clampLimit(limit),
    p_offset: clampOffset(offset),
    p_include_archived: Boolean(includeArchived)
  });

  if (error) throw error;

  return normalizeListResponse(data);
}

export async function refreshOperationalNotifications({
  licenseDetails
} = {}) {
  if (!ensureRpcAvailable(licenseDetails)) {
    return { success: true, generated: 0, events: [], skipped: true };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('refresh_operational_notifications', authArgs);

  if (error) throw error;

  const payload = normalizeMutationResponse(data);
  return {
    ...payload,
    generated: Number(payload.generated || 0),
    events: Array.isArray(payload.events) ? payload.events : []
  };
}

export async function markCloudNotificationRead({
  licenseDetails,
  notificationId
} = {}) {
  if (!ensureRpcAvailable(licenseDetails)) {
    return { success: true, skipped: true };
  }

  if (!notificationId) {
    return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('mark_pos_notification_read', {
    ...authArgs,
    p_notification_id: notificationId
  });

  if (error) throw error;

  return normalizeMutationResponse(data);
}

export async function markAllCloudNotificationsRead({
  licenseDetails
} = {}) {
  if (!ensureRpcAvailable(licenseDetails)) {
    return { success: true, skipped: true };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('mark_all_pos_notifications_read', authArgs);

  if (error) throw error;

  return normalizeMutationResponse(data);
}

export async function archiveCloudNotification({
  licenseDetails,
  notificationId
} = {}) {
  if (!ensureRpcAvailable(licenseDetails)) {
    return { success: true, skipped: true };
  }

  if (!notificationId) {
    return { success: false, code: 'NOTIFICATION_ID_REQUIRED' };
  }

  const authArgs = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('archive_pos_notification', {
    ...authArgs,
    p_notification_id: notificationId
  });

  if (error) throw error;

  return normalizeMutationResponse(data);
}
