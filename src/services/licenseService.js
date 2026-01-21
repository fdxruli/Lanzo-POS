// src/services/licenseService.js
import { supabaseClient } from './supabase';
import { loadData, saveData, STORES } from './database';
import Logger from './Logger';
import { checkInternetConnection, getStableDeviceId} from './utils';

// --- CORRECCIÓN CRÍTICA DE IDENTIDAD ---
// Esta función ahora se asegura de usar EL MISMO ID que tiene 'supabase.js'
async function getStableFingerprint() {
    const STORAGE_KEY = 'lanzo_device_id'; // Misma clave que usa supabase.js
    
    // 1. Intentar leer del almacenamiento local (LO MÁS IMPORTANTE)
    let existingId = localStorage.getItem(STORAGE_KEY);
    if (existingId) return existingId;

    // 2. Si no existe (raro si ya activaste), generar uno nuevo y guardarlo
    try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const newId = result.visitorId;
        localStorage.setItem(STORAGE_KEY, newId);
        return newId;
    } catch (e) {
        // Fallback extremo
        const fallback = `fallback-${Date.now()}`;
        localStorage.setItem(STORAGE_KEY, fallback);
        return fallback;
    }
}

/**
 * Obtiene dispositivos: Intenta Internet -> Si falla, usa Caché Local.
 */
export const getLicenseDevicesSmart = async (licenseKey) => {
    const CACHE_KEY = `devices_${licenseKey}`;

    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) throw new Error("OFFLINE_MODE");

        // USAR LA FUNCIÓN IMPORTADA (Unificada y Robusta)
        const deviceFingerprint = await getStableDeviceId(); 

        // 2. Llamada a Supabase
        const { data, error } = await supabaseClient.rpc('get_license_devices_anon', {
            license_key_param: licenseKey,
            current_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (data.success) {
            // ✅ ÉXITO: Guardamos en base de datos local (IndexedDB)
            await saveData(STORES.SYNC_CACHE, {
                key: CACHE_KEY,
                data: data.data || [],
                updatedAt: new Date().toISOString()
            });

            return { 
                success: true, 
                data: data.data || [], 
                source: 'network' // Indica que vino de internet
            };
        } else {
            // Si el servidor dice "No autorizado", es un error lógico, no de red.
            throw new Error(data.message);
        }

    } catch (error) {
        Logger.warn("⚠️ Error de red o servidor, buscando en caché...", error.message);

        // 3. Fallback: Leer de IndexedDB
        const cachedRecord = await loadData(STORES.SYNC_CACHE, CACHE_KEY);

        if (cachedRecord && cachedRecord.data) {
            return { 
                success: true, 
                data: cachedRecord.data, 
                source: 'cache', // Indica que vino del caché
                lastUpdated: cachedRecord.updatedAt,
                originalError: error.message
            };
        }

        // 4. Si no hay internet Y no hay caché
        const isNetworkError = error.message === "OFFLINE_MODE" || error.message.includes("fetch");
        return { 
            success: false, 
            message: isNetworkError 
                ? "Sin conexión y sin datos guardados. Conéctate para sincronizar por primera vez." 
                : error.message 
        };
    }
};

/**
 * Desactivar dispositivo (Requiere Internet obligatoriamente)
 */
export const deactivateDeviceSmart = async (deviceId, licenseKey) => {
    const isOnline = await checkInternetConnection();
    if (!isOnline) {
        return { success: false, message: "Necesitas conexión a internet real para desactivar dispositivos." };
    }

    try {
        // USAR LA FUNCIÓN IMPORTADA AQUÍ TAMBIÉN
        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc('deactivate_device_anon', {
            device_id_param: deviceId,
            license_key_param: licenseKey,
            requester_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;
        return data; 

    } catch (error) {
        return { success: false, message: error.message };
    }
};

export const renewLicenseService = async (licenseKey) => {
    try {
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return { 
                success: false, 
                message: "No tienes conexión a internet. Conéctate para renovar." 
            };
        }

        const deviceFingerprint = await getStableDeviceId();

        // Llamada a la función SQL que acabamos de crear
        const { data, error } = await supabaseClient.rpc('renew_license_free', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        // Estandarizamos la respuesta para el Store
        if (data && data.success) {
            return {
                success: true,
                message: data.message,
                newExpiry: data.new_expiry, // Fecha que viene de SQL
                status: data.status         // 'active'
            };
        } else {
            return {
                success: false,
                message: data.message || "No se pudo renovar la licencia."
            };
        }

    } catch (error) {
        Logger.error('❌ Error renovando licencia:', error);
        return { 
            success: false, 
            message: error.message || "Error de conexión al renovar." 
        };
    }
};