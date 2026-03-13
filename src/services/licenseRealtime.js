import { supabaseClient } from './supabase';
import Logger from './Logger';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;
let isReconnecting = false;
let reconnectAttempts = 0;
let onlineListener = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000;

/**
 * Inicia la escucha SEGURA en tiempo real.
 * Escucha la tabla 'license_events' en lugar de las tablas maestras.
 *
 * @param {string} licenseKey
 * @param {string} deviceFingerprint
 * @param {object} callbacks
 * @param {function} callbacks.onLicenseChanged   - Se llama cuando hay un LICENSE_UPDATE
 * @param {function} callbacks.onDeviceChanged    - Se llama cuando el dispositivo es baneado/eliminado
 * @param {function} callbacks.onPermanentFailure - Se llama cuando se agotan todos los reintentos
 *                                                  Recibe (message: string)
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, callbacks) => {
  if (!licenseKey || !deviceFingerprint) {
    Logger.warn('[Realtime] Faltan datos para iniciar la conexión WebSocket.');
    return null;
  }

  if (!navigator.onLine) {
    Logger.warn('[Realtime] Sin conexion a internet fisica. Abortando WebSocket y esperando red...');
    // Llamar a handleReconnect garantiza que volvamos a colocar el listener de 'online' 
    // en caso de que esto haya sido invocado por un microcorte.
    handleReconnect(licenseKey, deviceFingerprint, callbacks);
    return null;
  }

  if (isConnecting || isReconnecting) {
    return activeChannel;
  }

  if (activeChannel) {
    stopLicenseListener(activeChannel);
  }

  isConnecting = true;

  const channelId = `secure-events-${licenseKey}-${Date.now()}`;

  const channel = supabaseClient
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'license_events',
        filter: `license_key=eq.${licenseKey}`
      },
      async (payload) => {
        const event = payload.new;
        if (!event) return;

        Logger.log(`🔔 [Realtime] Evento recibido: ${event.event_type}`);

        // 1. Cambios en la Licencia (Plan, Expiración, Features)
        if (event.event_type === 'LICENSE_UPDATE') {
          if (callbacks.onLicenseChanged) {
            callbacks.onLicenseChanged({
              source: 'realtime_event',
              type: 'update'
            });
          }
        }

        // 2. Seguridad del Dispositivo (Baneos remotos)
        if (event.event_type === 'DEVICE_BANNED' || event.event_type === 'DEVICE_DELETED') {
          const targetFingerprint = event.metadata?.fingerprint;

          // Solo reaccionamos si el evento es PARA ESTE dispositivo
          if (targetFingerprint === deviceFingerprint) {
            Logger.warn('🚫 [Realtime] ¡Alerta de seguridad! Este dispositivo ha sido desactivado.');
            if (callbacks.onDeviceChanged) {
              callbacks.onDeviceChanged({
                status: event.event_type === 'DEVICE_BANNED' ? 'banned' : 'deleted',
                reason: 'remote_admin_action'
              });
            }
          }
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        Logger.log('✅ [Realtime] Canal seguro conectado.');
        isConnecting = false;
        isReconnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        Logger.error('❌ [Realtime] Error de conexión:', err || status);
        isConnecting = false;
        activeChannel = null;
        handleReconnect(licenseKey, deviceFingerprint, callbacks);
      } else if (status === 'CLOSED') {
        isConnecting = false;
        isReconnecting = false;
        if (activeChannel === channel) activeChannel = null;
      }
    });

  return channel;
};

// --- CORRECCIÓN: handleReconnect ya no importa useAppStore.
// En su lugar, invoca callbacks.onPermanentFailure cuando se agotan los reintentos.
const handleReconnect = (key, fp, callbacks) => {
  // Si ya hay un timer pendiente o estamos reconectando, no hacemos nada
  if (reconnectTimer || isReconnecting) return;

  if (!navigator.onLine) {
    Logger.log('⏸️ [Realtime] Red caída. Esperando a que el sistema operativo reporte conexión...');

    isReconnecting = true;

    // Limpiar listener previo por seguridad antes de asignar uno nuevo
    if (onlineListener) {
      window.removeEventListener('online', onlineListener);
    }

    onlineListener = () => {
      window.removeEventListener('online', onlineListener);
      onlineListener = null;
      isReconnecting = false;
      Logger.log('▶️ [Realtime] Red recuperada. Retomando conexión...');
      reconnectAttempts = 0;
      startLicenseListener(key, fp, callbacks);
    };

    window.addEventListener('online', onlineListener);

    if (callbacks.onPermanentFailure) {
      callbacks.onPermanentFailure('Conexión perdida. Lanzo POS trabajará offline hasta que regrese.');
    }
    return;
  }

  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    isReconnecting = true;

    Logger.log(`🔄 [Realtime] Reintentando en ${delay / 1000}s... (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      isReconnecting = false;
      startLicenseListener(key, fp, callbacks);
    }, delay);

  } else {
    // CORRECCIÓN CRÍTICA: Se eliminó el `if (intentos >= MAX_INTENTOS)` que causaba ReferenceError.
    // Llegamos aquí directamente cuando reconnectAttempts >= MAX_RECONNECT_ATTEMPTS.
    Logger.error('[Realtime] Sin conexión permanente tras máximos reintentos. Modo offline.');

    // Notificamos al store a través del callback (sin importar useAppStore directamente)
    if (callbacks.onPermanentFailure) {
      callbacks.onPermanentFailure(
        'No se pudo establecer conexión en tiempo real con el servidor. Se trabajará en modo offline.'
      );
    }
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
      await supabaseClient.removeChannel(channel);
    } catch (e) { /* ignorar */ }
  }
  if (activeChannel === channel) activeChannel = null;
};

export const cleanupAllChannels = async () => {
  await stopLicenseListener(activeChannel);
};

export const getConnectionStatus = () => {
  return {
    isActive: activeChannel !== null,
    isConnecting,
    isReconnecting
  };
};