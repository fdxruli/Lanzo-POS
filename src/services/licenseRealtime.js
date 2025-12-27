// src/services/licenseRealtime.js

import { supabaseClient } from './supabase';
import Logger from './Logger';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;
let isReconnecting = false; // NUEVO: Estado para controlar el periodo de espera
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000;

/**
 * Inicia la escucha en tiempo real para cambios en la licencia y el dispositivo.
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, callbacks) => {
  if (!licenseKey || !deviceFingerprint) {
    Logger.warn("[Realtime] Faltan datos para iniciar la conexión WebSocket.");
    return null;
  }

  // CORRECCIÓN: Bloquear si está conectando O reconectando (esperando timeout)
  if (isConnecting || isReconnecting) {
    Logger.warn("[Realtime] Ya hay una operación de conexión en progreso, retornando canal actual.");
    return activeChannel;
  }

  // Limpiar canal previo si existe (para evitar duplicados forzados)
  if (activeChannel) {
    Logger.warn("[Realtime] Limpiando canal existente antes de crear uno nuevo.");
    // No esperamos el async aquí para no bloquear, pero el lock de isConnecting protege
    stopLicenseListener(activeChannel);
  }

  isConnecting = true;
  Logger.log(`📡 [Realtime] Conectando WebSocket para licencia: ${licenseKey}...`);

  const channelId = `security-room-${licenseKey}-${Date.now()}`;
  
  const channel = supabaseClient
    .channel(channelId, {
      config: {
        broadcast: { self: false },
        presence: { key: deviceFingerprint }
      }
    })
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'licenses',
        filter: `license_key=eq.${licenseKey}`
      },
      (payload) => {
        if (!payload.new) return;
        Logger.log("🔔 [Realtime] Cambio detectado en LICENCIA:", payload.new);
        if (callbacks.onLicenseChanged) {
          try {
            callbacks.onLicenseChanged(payload.new);
          } catch (err) {
            Logger.error("[Realtime] Error en callback onLicenseChanged:", err);
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'license_devices',
        filter: `device_fingerprint=eq.${deviceFingerprint}`
      },
      (payload) => {
        if (!payload.new) return;
        
        if (payload.new.is_active === false) {
          Logger.log("🔔 [Realtime] DISPOSITIVO BLOQUEADO detectado");
          if (callbacks.onDeviceChanged) {
            try {
              callbacks.onDeviceChanged({ status: 'banned', data: payload.new });
            } catch (err) {
              Logger.error("[Realtime] Error en callback onDeviceChanged:", err);
            }
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'license_devices',
        filter: `device_fingerprint=eq.${deviceFingerprint}`
      },
      (payload) => {
        Logger.log("🔔 [Realtime] DELETE detectado en DISPOSITIVO:", payload);
        if (callbacks.onDeviceChanged) {
          try {
            callbacks.onDeviceChanged({ status: 'deleted', data: payload.old });
          } catch (err) {
            Logger.error("[Realtime] Error en callback onDeviceChanged:", err);
          }
        }
      }
    )
    .subscribe((status, err) => {
      // Nota: isConnecting se gestiona dentro de cada estado para mayor precisión

      if (status === 'SUBSCRIBED') {
        Logger.log("✅ [Realtime] Conexión establecida y segura.");
        isConnecting = false;
        isReconnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      } 
      else if (status === 'CHANNEL_ERROR') {
        Logger.error("❌ [Realtime] Error en la conexión WebSocket:", err);
        isConnecting = false; // La conexión falló, ya no estamos "conectando" activamente
        activeChannel = null;
        
        // CORRECCIÓN: Usar isReconnecting para evitar loops paralelos
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !reconnectTimer && !isReconnecting) {
          const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          isReconnecting = true; // Activar lock de reconexión
          
          Logger.log(`🔄 [Realtime] Reintentando conexión en ${delay}ms (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            isReconnecting = false; // Liberar lock justo antes de intentar de nuevo
            startLicenseListener(licenseKey, deviceFingerprint, callbacks);
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          Logger.error("❌ [Realtime] Máximo de reintentos alcanzado. Se requiere intervención manual.");
          isReconnecting = false;
        }
      }
      else if (status === 'CLOSED') {
        Logger.warn("⚠️ [Realtime] Canal cerrado.");
        if (activeChannel === channel) activeChannel = null;
        isConnecting = false;
        isReconnecting = false;
      }
      else if (status === 'TIMED_OUT') {
        Logger.warn("⏱️ [Realtime] Timeout de conexión.");
        isConnecting = false;
        activeChannel = null;
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !reconnectTimer && !isReconnecting) {
          const delay = BASE_RECONNECT_DELAY;
          reconnectAttempts++;
          isReconnecting = true;
          
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            isReconnecting = false;
            startLicenseListener(licenseKey, deviceFingerprint, callbacks);
          }, delay);
        }
      }
    });

  return channel;
};

/**
 * Detiene la escucha y limpia la conexión.
 */
export const stopLicenseListener = async (channel) => {
  // Limpiar timer si existe
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Importante: Resetear banderas de estado para permitir futuras conexiones manuales
  isConnecting = false;
  isReconnecting = false;
  reconnectAttempts = 0;

  if (channel) {
    Logger.log("🔕 [Realtime] Desconectando WebSocket...");
    try {
      await supabaseClient.removeChannel(channel);
    } catch (err) {
      Logger.warn("[Realtime] Error al remover canal:", err);
    }
  }

  if (activeChannel === channel) {
    activeChannel = null;
  }
};

/**
 * Limpieza global: desconecta todos los canales activos.
 */
export const cleanupAllChannels = async () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeChannel) {
    await stopLicenseListener(activeChannel);
  }

  // Asegurar reseteo total
  isConnecting = false;
  isReconnecting = false;
  reconnectAttempts = 0;
  Logger.log("🧹 [Realtime] Limpieza completa ejecutada.");
};

/**
 * Obtiene el estado actual de la conexión.
 */
export const getConnectionStatus = () => {
  return {
    isActive: activeChannel !== null,
    isConnecting,
    isReconnecting, // Agregado al reporte de estado
    reconnectAttempts,
    channelId: activeChannel?.topic || null
  };
};