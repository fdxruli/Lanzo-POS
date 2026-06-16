import { supabaseClient } from './supabase';
import Logger from './Logger';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;
let isReconnecting = false;
let reconnectAttempts = 0;
let onlineListener = null;

const closingChannels = new WeakSet();
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

/**
 * Inicia la escucha segura en tiempo real.
 * Usa Broadcast privado con un topic opaco por dispositivo. El evento recibido
 * no es autoridad; solo dispara verifySessionIntegrity() desde el store.
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, realtimeTopic, callbacks = {}) => {
  if (!supabaseClient) {
    Logger.warn('[Realtime] Supabase no esta configurado. Usando fallback hibrido.');
    callbacks.onPermanentFailure?.(
      'Realtime no esta disponible. Se trabajara con sincronizacion hibrida.'
    );
    return null;
  }

  if (!licenseKey || !deviceFingerprint || !realtimeTopic) {
    Logger.warn('[Realtime] Faltan datos para iniciar Broadcast privado.');
    return null;
  }

  if (!navigator.onLine) {
    Logger.warn('[Realtime] Sin conexion. Abortando WebSocket y esperando red.');
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
        Logger.log('[Realtime] Canal privado conectado.');
        isConnecting = false;
        isReconnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        callbacks.onConnectionRestored?.();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        Logger.error('[Realtime] Error de conexion:', err || status);
        isConnecting = false;

        supabaseClient.removeChannel(channel).catch(() => {});
        if (activeChannel === channel) activeChannel = null;

        handleReconnect(licenseKey, deviceFingerprint, realtimeTopic, callbacks);
      } else if (status === 'CLOSED') {
        isConnecting = false;
        isReconnecting = false;
        const wasManualClose = closingChannels.has(channel);
        closingChannels.delete(channel);
        supabaseClient.removeChannel(channel).catch(() => {});
        if (activeChannel === channel) activeChannel = null;

        if (!wasManualClose) {
          Logger.warn('[Realtime] Canal cerrado inesperadamente. Usando fallback/reintento.');
          callbacks.onPermanentFailure?.(
            'La conexion en tiempo real se cerro. Se usara sincronizacion hibrida.'
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
    callbacks.onPermanentFailure?.(
      'Conexion perdida. Lanzo POS trabajara offline hasta que regrese.'
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
    callbacks.onPermanentFailure?.(
      'No se pudo establecer conexion en tiempo real con el servidor. Se trabajara en modo hibrido.'
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
};

export const cleanupAllChannels = async () => {
  await stopLicenseListener(activeChannel);
};

export const getConnectionStatus = () => ({
  isActive: activeChannel !== null,
  isConnecting,
  isReconnecting
});
