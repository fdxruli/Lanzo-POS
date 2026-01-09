// src/services/licenseRealtime.js

import { supabaseClient } from './supabase';
import Logger from './Logger';

let activeChannel = null;
let reconnectTimer = null;
let isConnecting = false;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000;

/**
 * Inicia la escucha SEGURA en tiempo real.
 * Ahora escucha la tabla 'license_events' en lugar de las tablas maestras.
 */
export const startLicenseListener = (licenseKey, deviceFingerprint, callbacks) => {
  if (!licenseKey || !deviceFingerprint) {
    Logger.warn("[Realtime] Faltan datos para iniciar la conexión WebSocket.");
    return null;
  }

  if (isConnecting || isReconnecting) {
    return activeChannel;
  }

  if (activeChannel) {
    stopLicenseListener(activeChannel);
  }

  isConnecting = true;
  // Logger.log(`📡 [Realtime] Conectando canal seguro para: ${licenseKey}...`);

  const channelId = `secure-events-${licenseKey}-${Date.now()}`;
  
  const channel = supabaseClient
    .channel(channelId) // Canal público estándar, filtrado por lógica
    .on(
      'postgres_changes',
      {
        event: 'INSERT', // Solo nos importan nuevos eventos
        schema: 'public',
        table: 'license_events', 
        filter: `license_key=eq.${licenseKey}` // 🔒 FILTRO CLAVE
      },
      async (payload) => {
        const event = payload.new;
        if (!event) return;

        Logger.log(`🔔 [Realtime] Evento recibido: ${event.event_type}`);

        // --- LÓGICA DE REACCIÓN SEGURA ---
        
        // 1. Cambios en la Licencia (Plan, Expiración, Features)
        if (event.event_type === 'LICENSE_UPDATE') {
          if (callbacks.onLicenseChanged) {
            // No pasamos datos. Avisamos que "algo cambió" para que la app re-valide.
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
                Logger.warn("🚫 [Realtime] ¡Alerta de seguridad! Este dispositivo ha sido desactivado.");
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
        Logger.log("✅ [Realtime] Canal seguro conectado.");
        isConnecting = false;
        isReconnecting = false;
        activeChannel = channel;
        reconnectAttempts = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
      } 
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        Logger.error("❌ [Realtime] Error de conexión:", err || status);
        isConnecting = false;
        activeChannel = null;
        handleReconnect(licenseKey, deviceFingerprint, callbacks);
      }
      else if (status === 'CLOSED') {
        isConnecting = false;
        isReconnecting = false;
        if (activeChannel === channel) activeChannel = null;
      }
    });

  return channel;
};

// --- Helper de Reconexión (Extraído para limpieza) ---
const handleReconnect = (key, fp, cb) => {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !reconnectTimer && !isReconnecting) {
        const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;
        isReconnecting = true;
        
        Logger.log(`🔄 [Realtime] Reintentando en ${delay/1000}s...`);
        
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          isReconnecting = false;
          startLicenseListener(key, fp, cb);
        }, delay);
    } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        Logger.error("❌ [Realtime] Sin conexión permanente. Se pasará a modo offline.");
    }
};

export const stopLicenseListener = async (channel) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isConnecting = false;
  isReconnecting = false;
  reconnectAttempts = 0;

  if (channel) {
    try {
      await supabaseClient.removeChannel(channel);
    } catch (e) { /* ignore */ }
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