// src/services/licenseRealtime.js
import { supabaseClient } from './supabase';

/**
 * Inicia la escucha en tiempo real para cambios en la licencia y el dispositivo.
 * * @param {string} licenseKey - La clave de licencia a monitorear.
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

  console.log(`📡 [Realtime] Conectando WebSocket para licencia: ${licenseKey}...`);

  // Creamos un canal único para esta sesión
  const channelId = `security-room-${licenseKey}`;
  
  const channel = supabaseClient
    .channel(channelId)

    // 1. ESCUCHAR CAMBIOS EN LA LICENCIA (Tabla 'licenses')
    // Se activa si cambia el estado (suspendida), fecha expiración, etc.
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'licenses',
        filter: `license_key=eq.${licenseKey}` // Filtro crucial: Solo mi licencia
      },
      (payload) => {
        console.log("🔔 [Realtime] Cambio detectado en LICENCIA:", payload.new);
        if (callbacks.onLicenseChanged) {
          callbacks.onLicenseChanged(payload.new);
        }
      }
    )

    // 2. ESCUCHAR CAMBIOS EN ESTE DISPOSITIVO (Tabla 'license_devices')
    // Se activa si un admin te expulsa (UPDATE is_active=false) o borra el dispositivo (DELETE)
    .on(
      'postgres_changes',
      {
        event: '*', // UPDATE o DELETE
        schema: 'public',
        table: 'license_devices',
        filter: `device_fingerprint=eq.${deviceFingerprint}` // Filtro crucial: Solo este PC
      },
      (payload) => {
        console.log("🔔 [Realtime] Cambio detectado en DISPOSITIVO:", payload);
        
        // Si el evento es UPDATE y me desactivaron
        if (payload.eventType === 'UPDATE' && payload.new.is_active === false) {
           if (callbacks.onDeviceChanged) callbacks.onDeviceChanged({ status: 'banned' });
        }
        
        // Si el evento es DELETE (me borraron de la base de datos)
        if (payload.eventType === 'DELETE') {
           if (callbacks.onDeviceChanged) callbacks.onDeviceChanged({ status: 'deleted' });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log("✅ [Realtime] Conexión establecida y segura.");
      } else if (status === 'CHANNEL_ERROR') {
        console.error("❌ [Realtime] Error en la conexión WebSocket.");
      }
    });

  return channel;
};

/**
 * Detiene la escucha y limpia la conexión.
 * @param {object} channel - El objeto canal retornado por startLicenseListener.
 */
export const stopLicenseListener = async (channel) => {
  if (channel) {
    console.log("🔕 [Realtime] Desconectando WebSocket...");
    await supabaseClient.removeChannel(channel);
  }
};