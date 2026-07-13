import Logger from '../Logger';
import { supabaseClient } from '../supabase';
import { canUseEcommerceOrderRealtime } from '../ecommerce/ecommerceOrderCapabilities';
import { ECOMMERCE_ORDERS_CHANGED_EVENT } from '../ecommerce/ecommerceOrderRealtimeEvent';
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
  const topic = getNotificationRealtimeTopic(licenseDetails);
  const notificationsRealtimeEnabled = (
    isNotificationCenterEnabled(licenseDetails) &&
    isCloudNotificationsEnabled(licenseDetails) &&
    canStaffAccessNotifications(licenseDetails, staffSession) &&
    (isTrue(features.support_realtime) || isTrue(features.realtime_license_sync))
  );
  const ecommerceRealtimeEnabled = canUseEcommerceOrderRealtime(licenseDetails, staffSession);

  return Boolean(topic) && (notificationsRealtimeEnabled || ecommerceRealtimeEnabled);
};

const dispatchEcommerceOrderEvent = (event) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ECOMMERCE_ORDERS_CHANGED_EVENT, {
    detail: event
  }));
};

export const startNotificationRealtime = ({
  licenseDetails,
  staffSession,
  onNotificationEvent
} = {}) => {
  if (!canUseNotificationRealtime(licenseDetails, staffSession)) {
    Logger.log('[NotificationRealtime] Desactivado por plan, permiso o falta de topic.');
    return null;
  }

  if (!supabaseClient) {
    Logger.warn('[NotificationRealtime] Supabase no está configurado.');
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
      const rawEvent = payload?.payload || payload || {};
      const event = {
        event: rawEvent.event,
        notificationId: rawEvent.notification_id || rawEvent.notificationId || null,
        ticketId: rawEvent.ticket_id || rawEvent.ticketId || null,
        reason: rawEvent.reason || 'notification_created',
        createdAt: rawEvent.created_at || rawEvent.createdAt || null,
        metadata: rawEvent.metadata || {}
      };

      if (rawEvent?.event === 'ecommerce_orders_changed') {
        dispatchEcommerceOrderEvent(event);
        return;
      }

      if (rawEvent?.event !== 'notifications_changed') {
        Logger.log('[NotificationRealtime] Evento ignorado.', rawEvent?.event || 'unknown');
        return;
      }

      if (event.metadata?.category === 'ecommerce' || event.metadata?.source === 'ecommerce') {
        dispatchEcommerceOrderEvent(event);
      }

      onNotificationEvent?.(event);
    });

  channel.subscribe((status, error) => {
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
