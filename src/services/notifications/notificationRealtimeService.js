import Logger from '../Logger';
import { supabaseClient } from '../supabase';
import {
  canStaffAccessNotifications,
  isCloudNotificationsEnabled,
  isNotificationCenterEnabled
} from './notificationCapabilities';

let activeNotificationChannel = null;
let activeNotificationTopic = null;
let isNotificationRealtimeConnecting = false;

const isTrue = (value) => value === true || value === 'true';

const getFeatures = (licenseDetails = {}) => (
  licenseDetails?.features ||
  licenseDetails?.details?.features ||
  {}
);

export const getNotificationRealtimeTopic = (licenseDetails = {}) => (
  licenseDetails?.realtime_topic ||
  licenseDetails?.realtimeTopic ||
  licenseDetails?.details?.realtime_topic ||
  null
);

export const canUseNotificationRealtime = (licenseDetails = {}, staffSession = {}) => {
  const features = getFeatures(licenseDetails);

  return (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession) &&
    (isTrue(features.support_realtime) || isTrue(features.realtime_license_sync)) &&
    Boolean(getNotificationRealtimeTopic(licenseDetails))
  );
};

export const startNotificationRealtime = ({
  licenseDetails,
  staffSession,
  onNotificationEvent
} = {}) => {
  if (!canUseNotificationRealtime(licenseDetails, staffSession)) {
    Logger.log('[NotificationRealtime] Desactivado por plan o falta de topic.');
    return null;
  }

  if (!supabaseClient) {
    Logger.warn('[NotificationRealtime] Supabase no esta configurado.');
    return null;
  }

  const realtimeTopic = getNotificationRealtimeTopic(licenseDetails);

  if (activeNotificationChannel && activeNotificationTopic === realtimeTopic) {
    return activeNotificationChannel;
  }

  if (isNotificationRealtimeConnecting) {
    return activeNotificationChannel;
  }

  if (activeNotificationChannel) {
    stopNotificationRealtime();
  }

  isNotificationRealtimeConnecting = true;
  activeNotificationTopic = realtimeTopic;

  const channel = supabaseClient
    .channel(realtimeTopic, {
      config: { private: true }
    })
    .on('broadcast', { event: 'notification_event' }, (payload) => {
      const event = payload?.payload || payload || {};

      if (event?.event !== 'notifications_changed') {
        Logger.log('[NotificationRealtime] Evento ignorado.', event?.event || 'unknown');
        return;
      }

      onNotificationEvent?.({
        event: event.event,
        notificationId: event.notification_id || event.notificationId || null,
        ticketId: event.ticket_id || event.ticketId || null,
        reason: event.reason || 'notification_created',
        createdAt: event.created_at || event.createdAt || null,
        metadata: event.metadata || {}
      });
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        isNotificationRealtimeConnecting = false;
        activeNotificationChannel = channel;
        Logger.log('[NotificationRealtime] Canal privado conectado.');
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        isNotificationRealtimeConnecting = false;
        if (activeNotificationChannel === channel) {
          activeNotificationChannel = null;
        }
        Logger.warn('[NotificationRealtime] Error de canal:', error || status);
        return;
      }

      if (status === 'CLOSED') {
        isNotificationRealtimeConnecting = false;
        if (activeNotificationChannel === channel) {
          activeNotificationChannel = null;
        }
        Logger.log('[NotificationRealtime] Canal cerrado.');
      }
    });

  return channel;
};

export const stopNotificationRealtime = async () => {
  const channel = activeNotificationChannel;

  isNotificationRealtimeConnecting = false;
  activeNotificationChannel = null;
  activeNotificationTopic = null;

  if (!channel || !supabaseClient) return;

  try {
    await supabaseClient.removeChannel(channel);
  } catch {
    // Best effort cleanup.
  }
};

export const getNotificationRealtimeStatus = () => ({
  isActive: Boolean(activeNotificationChannel),
  isConnecting: isNotificationRealtimeConnecting,
  topic: activeNotificationTopic
});
