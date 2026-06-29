import { supabaseClient } from './supabase';
import Logger from './Logger';
import { SYNC_STATUS } from './sync/syncConstants';

let activeChannel = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let isConnecting = false;
let onlineListener = null;

const closingChannels = new WeakSet();
const handledClosedChannels = new WeakSet();

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000;

export const buildPosRealtimeTopic = (licenseDetailsOrTopic = null) => {
  const sourceTopic = typeof licenseDetailsOrTopic === 'string'
    ? licenseDetailsOrTopic
    : licenseDetailsOrTopic?.pos_realtime_topic ||
      licenseDetailsOrTopic?.posRealtimeTopic ||
      licenseDetailsOrTopic?.realtime_topic ||
      licenseDetailsOrTopic?.details?.realtime_topic ||
      null;

  if (!sourceTopic) return null;
  if (sourceTopic.startsWith('pos:')) return sourceTopic;
  if (sourceTopic.startsWith('license:')) {
    const [, suffix] = sourceTopic.split(':');
    return suffix ? `pos:${suffix}` : null;
  }

  return null;
};

const notifyStatus = (callbacks = {}, status, extra = {}) => {
  callbacks.onStatusChange?.({ status, ...extra });
};

export const startPosRealtimeListener = ({ posTopic, licenseDetails, callbacks = {} } = {}) => {
  const resolvedTopic = posTopic || buildPosRealtimeTopic(licenseDetails);

  if (!supabaseClient) {
    Logger.warn('[PosRealtime] Supabase no esta configurado. POS sync queda degradado.');
    notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'supabase_not_configured' });
    return null;
  }

  if (!resolvedTopic) {
    Logger.warn('[PosRealtime] Falta topic privado POS. POS sync seguirá con pull manual/intervalos futuros.');
    notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'missing_pos_topic' });
    return null;
  }

  if (isConnecting || reconnectTimer) {
    return activeChannel;
  }

  if (!navigator.onLine) {
    Logger.warn('[PosRealtime] Sin conexión. Esperando reconexión para POS realtime.');
    notifyStatus(callbacks, SYNC_STATUS.OFFLINE, { reason: 'offline' });
    scheduleReconnect(resolvedTopic, callbacks);
    return null;
  }

  if (activeChannel) {
    stopPosRealtimeListener(activeChannel);
  }

  isConnecting = true;
  notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'connecting' });

  const channel = supabaseClient
    .channel(resolvedTopic, {
      config: { private: true }
    })
    .on('broadcast', { event: 'pos_event' }, (payload) => {
      const event = payload?.payload || payload || {};
      const changeSeq = event?.change_seq ?? event?.changeSeq ?? null;
      const entity = event?.entity_type ?? event?.entityType ?? event?.entity ?? null;
      const eventType = event?.event_type ?? event?.eventType ?? event?.operation ?? null;

      Logger.log('[PosRealtime] Aviso POS recibido. Se debe hacer pull incremental.', changeSeq || 'sin_seq');
      callbacks.onPosChangeAvailable?.({
        source: 'realtime',
        eventType,
        entity,
        changeSeq,
        event
      });
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        isConnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        Logger.log('[PosRealtime] Canal POS privado conectado.');
        notifyStatus(callbacks, SYNC_STATUS.ONLINE, { reason: 'subscribed' });
        callbacks.onConnectionRestored?.();
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        Logger.warn('[PosRealtime] Error de canal POS:', error || status);
        isConnecting = false;
        if (activeChannel === channel) activeChannel = null;
        handledClosedChannels.add(channel);
        supabaseClient.removeChannel(channel).catch(() => {});
        notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: status });
        scheduleReconnect(resolvedTopic, callbacks);
        return;
      }

      if (status === 'CLOSED') {
        if (handledClosedChannels.has(channel)) return;
        handledClosedChannels.add(channel);

        const wasManualClose = closingChannels.has(channel);
        closingChannels.delete(channel);
        isConnecting = false;
        if (activeChannel === channel) activeChannel = null;
        supabaseClient.removeChannel(channel).catch(() => {});

        if (!wasManualClose) {
          Logger.warn('[PosRealtime] Canal POS cerrado inesperadamente.');
          notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'closed' });
          scheduleReconnect(resolvedTopic, callbacks);
        }
      }
    });

  return channel;
};

const scheduleReconnect = (posTopic, callbacks = {}) => {
  if (reconnectTimer) return;

  if (!navigator.onLine) {
    if (onlineListener) {
      window.removeEventListener('online', onlineListener);
    }

    onlineListener = () => {
      window.removeEventListener('online', onlineListener);
      onlineListener = null;
      reconnectAttempts = 0;
      Logger.log('[PosRealtime] Red recuperada. Reconectando POS realtime.');
      startPosRealtimeListener({ posTopic, callbacks });
    };

    window.addEventListener('online', onlineListener);
    notifyStatus(callbacks, SYNC_STATUS.OFFLINE, { reason: 'offline_waiting_online' });
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    Logger.warn('[PosRealtime] Maximos reintentos alcanzados. POS sync queda degradado.');
    notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'max_reconnect_attempts' });
    return;
  }

  const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startPosRealtimeListener({ posTopic, callbacks });
  }, delay);
};

export const stopPosRealtimeListener = async (channel = activeChannel) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (onlineListener) {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
  }

  isConnecting = false;
  reconnectAttempts = 0;

  if (channel && supabaseClient) {
    try {
      closingChannels.add(channel);
      await supabaseClient.removeChannel(channel);
    } catch {
      // Best effort cleanup.
    }
  }

  if (activeChannel === channel) activeChannel = null;
};

export const getPosRealtimeStatus = () => ({
  isActive: Boolean(activeChannel),
  isConnecting,
  reconnectAttempts
});
