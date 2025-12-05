// src/services/licenseRealtime.js

import { supabaseClient } from './supabase';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;

/**
 * Inicia la escucha en tiempo real para cambios en la licencia y el dispositivo.
 * @param {string} licenseKey - La clave de licencia a monitorear.
 * @param {string} deviceFingerprint - El ID único del dispositivo actual.
 * @param {object} callbacks - Funciones a ejecutar cuando ocurran eventos.
 * @param {function} callbacks.onLicenseChanged - (newData) => void
 * @param {function} callbacks.onDeviceChanged - (newData) => void
 * @returns {object} El canal de suscripción (para poder desuscribirse después).
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, callbacks) => {
  if (!licenseKey || !deviceFingerprint) {
    console.warn("[Realtime] Faltan datos para iniciar la conexión WebSocket.");
    return null;
  }

  // Evitar duplicados: Si ya hay un canal activo, limpiarlo primero
  if (activeChannel) {
    console.warn("[Realtime] Limpiando canal existente antes de crear uno nuevo.");
    stopLicenseListener(activeChannel);
  }

  if (isConnecting) {
    console.warn("[Realtime] Ya hay una conexión en progreso, espere...");
    return null;
  }

  isConnecting = true;
  console.log(`📡 [Realtime] Conectando WebSocket para licencia: ${licenseKey}...`);

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
        console.log("🔔 [Realtime] Cambio detectado en LICENCIA:", payload.new);
        if (callbacks.onLicenseChanged) {
          callbacks.onLicenseChanged(payload.new);
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
        console.log("🔔 [Realtime] UPDATE detectado en DISPOSITIVO:", payload.new);
        
        if (payload.new.is_active === false) {
          if (callbacks.onDeviceChanged) {
            callbacks.onDeviceChanged({ status: 'banned', data: payload.new });
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
        console.log("🔔 [Realtime] DELETE detectado en DISPOSITIVO:", payload);
        if (callbacks.onDeviceChanged) {
          callbacks.onDeviceChanged({ status: 'deleted', data: payload.old });
        }
      }
    )
    .subscribe((status, err) => {
      isConnecting = false;

      if (status === 'SUBSCRIBED') {
        console.log("✅ [Realtime] Conexión establecida y segura.");
        activeChannel = channel;
        
        // Limpiar timer de reconexión si existía
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      } 
      else if (status === 'CHANNEL_ERROR') {
        console.error("❌ [Realtime] Error en la conexión WebSocket:", err);
        activeChannel = null;
        
        // Reconexión automática con backoff
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            console.log("🔄 [Realtime] Intentando reconectar...");
            reconnectTimer = null;
            startLicenseListener(licenseKey, deviceFingerprint, callbacks);
          }, 5000);
        }
      }
      else if (status === 'CLOSED') {
        console.warn("⚠️ [Realtime] Canal cerrado.");
        activeChannel = null;
      }
      else if (status === 'TIMED_OUT') {
        console.warn("⏱️ [Realtime] Timeout de conexión.");
        activeChannel = null;
      }
    });

  return channel;
};

/**
 * Detiene la escucha y limpia la conexión.
 * @param {object} channel - El objeto canal retornado por startLicenseListener.
 */
export const stopLicenseListener = async (channel) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (channel) {
    console.log("🔕 [Realtime] Desconectando WebSocket...");
    try {
      await supabaseClient.removeChannel(channel);
    } catch (err) {
      console.warn("[Realtime] Error al remover canal:", err);
    }
  }

  if (activeChannel === channel) {
    activeChannel = null;
  }

  isConnecting = false;
};

/**
 * Limpieza global: desconecta todos los canales activos.
 * Útil para llamar en logout o unmount de la app.
 */
export const cleanupAllChannels = async () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeChannel) {
    await stopLicenseListener(activeChannel);
  }

  isConnecting = false;
  console.log("🧹 [Realtime] Limpieza completa ejecutada.");
};