import { supabaseClient } from './supabase';
import Logger from './Logger';
import {
  REALTIME_FORCE_VALIDATE_AFTER_OFFLINE_MS,
  REALTIME_SHORT_RECONNECT_GRACE_MS
} from '../store/slices/license/licenseConstants';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;
let isReconnecting = false;
let reconnectAttempts = 0;
let onlineListener = null;

let hasEverSubscribed = false;
let lastDisconnectedAt = 0;
let lastSubscribedAt = 0;

const closingChannels = new WeakSet();
const handledClosedChannels = new WeakSet();

let realtimeFallbackReported = false;

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000;

const LICENSE_WIDE_EVENTS = new Set([
  'LICENSE_UPDATE',
  'LICENSE_REVOKED',
  'LICENSE_SUSPENDED',
  'SUBSCRIPTION_UPDATED',
  'PLAN_CHANGED',
  'LICENSE_RENEWED'
]);

const DEVICE_EVENTS = new Set([
  'DEVICE_BANNED',
  'DEVICE_DELETED',
  'DEVICE_RELEASED'
]);

const resetRealtimeConnectionState = () => {
  hasEverSubscribed = false;
  lastDisconnectedAt = 0;
  lastSubscribedAt = 0;
};

const markRealtimeDisconnected = () => {
  if (!lastDisconnectedAt) {
    lastDisconnectedAt = Date.now();
  }

  return lastDisconnectedAt;
};

const buildReconnectMetadata = (topic) => {
  const subscribedAt = Date.now();
  const disconnectedDurationMs = lastDisconnectedAt > 0
    ? Math.max(0, subscribedAt - lastDisconnectedAt)
    : 0;
  const wasLongDisconnect = disconnectedDurationMs >= REALTIME_FORCE_VALIDATE_AFTER_OFFLINE_MS;
  const wasShortReconnect = disconnectedDurationMs > 0 && disconnectedDurationMs <= REALTIME_SHORT_RECONNECT_GRACE_MS;

  return {
    reason: wasShortReconnect ? 'resubscribed' : 'reconnected',
    subscribedAt,
    topic,
    disconnectedDurationMs,
    wasLongDisconnect
  };
};

const reportRealtimeFallbackOnce = (callbacks = {}, message, metadata = {}) => {
  const isPermanentFailure = metadata.permanent === true;

  if (realtimeFallbackReported && !isPermanentFailure) return;

  realtimeFallbackReported = true;
  callbacks.onPermanentFailure?.(
    message || 'La conexión en tiempo real se interrumpió. Lanzo POS seguirá funcionando en modo híbrido.',
    metadata
  );
};

/**
 * Inicia la escucha segura en tiempo real.
 * Usa Broadcast privado con un topic opaco por dispositivo. El evento recibido
 * no es autoridad; solo dispara verifySessionIntegrity() desde el store.
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, realtimeTopic, callbacks = {}) => {
  if (!supabaseClient) {
    Logger.warn('[Realtime] Supabase no esta configurado. Usando fallback hibrido.');
    callbacks.onPermanentFailure?.(
      'Realtime no esta disponible. Se trabajara con sincronizacion hibrida.',
      { permanent: true, reason: 'supabase_not_configured' }
    );
    return null;
  }

  if (!licenseKey || !deviceFingerprint || !realtimeTopic) {
    Logger.warn('[Realtime] Faltan datos para iniciar Broadcast privado.');
    return null;
  }

  if (isConnecting || isReconnecting || reconnectTimer) {
    return activeChannel;
  }

  if (!navigator.onLine) {
    Logger.warn('[Realtime] Sin conexión. Realtime queda en espera hasta recuperar red.');
    markRealtimeDisconnected();
    callbacks.onDisconnected?.({
      reason: 'disconnected',
      disconnectedAt: lastDisconnectedAt,
      topic: realtimeTopic
    });
    handleReconnect(licenseKey, deviceFingerprint, realtimeTopic, callbacks);
    return null;
  }

  if (isConnecting || isReconnecting) {
    return activeChannel;
  }

  if (activeChannel) {
    stopLicenseListener(activeChannel);
  }

  isConnecting = true;

  const channel = supabaseClient
    .channel(realtimeTopic, {
      config: {
        private: true
      }
    })
    .on('broadcast', { event: 'license_event' }, async (payload) => {
      const event = payload?.payload || payload;
      const eventType = event?.event_type;

      if (!eventType) {
        Logger.warn('[Realtime] Broadcast sin tipo de evento. Forzando revalidacion.');
        callbacks.onLicenseChanged?.({ source: 'realtime_event', type: 'unknown' });
        return;
      }

      Logger.log(`[Realtime] Evento privado recibido: ${eventType}`);

      if (LICENSE_WIDE_EVENTS.has(eventType)) {
        callbacks.onLicenseChanged?.({
          source: 'realtime_event',
          type: eventType
        });
        return;
      }

      if (DEVICE_EVENTS.has(eventType)) {
        const targetFingerprint =
          event.metadata?.fingerprint ||
          event.metadata?.target_fingerprint ||
          event.metadata?.device_fingerprint;

        if (!targetFingerprint || targetFingerprint === deviceFingerprint) {
          Logger.warn('[Realtime] Este dispositivo fue marcado para revalidacion de seguridad.');
          callbacks.onDeviceChanged?.({
            status: eventType === 'DEVICE_BANNED' ? 'banned' : 'deleted',
            reason: 'remote_admin_action'
          });
        }
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        const subscribedAt = Date.now();
        const isInitialSubscription = !hasEverSubscribed;
        const metadata = buildReconnectMetadata(realtimeTopic);

        Logger.log(
          isInitialSubscription
            ? '[Realtime] Canal conectado inicialmente; sin validación remota forzada.'
            : `[Realtime] Canal reconectado (${metadata.reason}) tras ${Math.round(metadata.disconnectedDurationMs / 1000)}s.`
        );

        isConnecting = false;
        isReconnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        realtimeFallbackReported = false;
        lastSubscribedAt = subscribedAt;
        hasEverSubscribed = true;
        lastDisconnectedAt = 0;

        if (reconnectTimer) clearTimeout(reconnectTimer);

        if (isInitialSubscription) {
          callbacks.onInitialSubscribed?.({
            subscribedAt,
            topic: realtimeTopic
          });
          return;
        }

        callbacks.onConnectionRestored?.(metadata);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const reason = status === 'TIMED_OUT' ? 'timed_out' : 'channel_error';
        markRealtimeDisconnected();

        Logger.error('[Realtime] Error de conexion:', err || status);
        callbacks.onDisconnected?.({
          reason,
          disconnectedAt: lastDisconnectedAt,
          topic: realtimeTopic
        });
        isConnecting = false;

        handledClosedChannels.add(channel);
        supabaseClient.removeChannel(channel).catch(() => { });
        if (activeChannel === channel) activeChannel = null;

        handleReconnect(licenseKey, deviceFingerprint, realtimeTopic, callbacks);
      } else if (status === 'CLOSED') {
        if (handledClosedChannels.has(channel)) {
          return;
        }

        handledClosedChannels.add(channel);

        isConnecting = false;
        isReconnecting = false;

        const wasManualClose = closingChannels.has(channel);
        closingChannels.delete(channel);

        supabaseClient.removeChannel(channel).catch(() => { });

        if (activeChannel === channel) {
          activeChannel = null;
        }

        if (!wasManualClose) {
          markRealtimeDisconnected();
          callbacks.onDisconnected?.({
            reason: 'disconnected',
            disconnectedAt: lastDisconnectedAt,
            topic: realtimeTopic
          });

          Logger.warn('[Realtime] Canal cerrado inesperadamente. Usando fallback/reintento.');

          reportRealtimeFallbackOnce(
            callbacks,
            'La conexión en tiempo real se interrumpió. Lanzo POS seguirá funcionando en modo híbrido.',
            { permanent: false, reason: 'channel_closed' }
          );

          handleReconnect(licenseKey, deviceFingerprint, realtimeTopic, callbacks);
        }
      }
    });

  return channel;
};

const handleReconnect = (key, fp, topic, callbacks = {}) => {
  if (reconnectTimer || isReconnecting) return;

  if (!navigator.onLine) {
    markRealtimeDisconnected();
    Logger.log('[Realtime] Red caida. Esperando reconexion del sistema operativo.');
    isReconnecting = true;

    if (onlineListener) {
      window.removeEventListener('online', onlineListener);
    }

    onlineListener = () => {
      window.removeEventListener('online', onlineListener);
      onlineListener = null;
      isReconnecting = false;
      Logger.log('[Realtime] Red recuperada. Retomando Broadcast privado.');
      reconnectAttempts = 0;
      startLicenseListener(key, fp, topic, callbacks);
    };

    window.addEventListener('online', onlineListener);
    reportRealtimeFallbackOnce(
      callbacks,
      'Conexión perdida. Lanzo POS trabajará offline hasta que regrese internet.',
      { permanent: false, reason: 'offline' }
    );
    return;
  }

  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    isReconnecting = true;

    Logger.log(
      `[Realtime] Reintentando en ${delay / 1000}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      isReconnecting = false;
      startLicenseListener(key, fp, topic, callbacks);
    }, delay);
  } else {
    Logger.error('[Realtime] Sin conexion tras maximos reintentos. Modo hibrido.');
    reportRealtimeFallbackOnce(
      callbacks,
      'No se pudo establecer conexión en tiempo real con el servidor. Se trabajará en modo híbrido.',
      { permanent: true, reason: 'max_reconnect_attempts' }
    );
  }
};

export const stopLicenseListener = async (channel) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (onlineListener) {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
  }

  isConnecting = false;
  isReconnecting = false;
  reconnectAttempts = 0;

  if (channel) {
    try {
      closingChannels.add(channel);
      if (supabaseClient) {
        await supabaseClient.removeChannel(channel);
      }
    } catch {
      // Best effort cleanup.
    }
  }
  if (activeChannel === channel) activeChannel = null;
  resetRealtimeConnectionState();
};

export const cleanupAllChannels = async () => {
  await stopLicenseListener(activeChannel);
};

export const getConnectionStatus = () => ({
  isActive: activeChannel !== null,
  isConnecting,
  isReconnecting,
  hasEverSubscribed,
  lastDisconnectedAt,
  lastSubscribedAt
});
