// src/services/licenseService.js
import { supabaseClient } from './supabase';
import { loadData, saveData, STORES } from './database';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

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
        // 1. Verificar conexión primero
        if (!navigator.onLine) throw new Error("OFFLINE_MODE");

        const deviceFingerprint = await getStableFingerprint();

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
        console.warn("⚠️ Error de red o servidor, buscando en caché...", error.message);

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
    if (!navigator.onLine) {
        return { success: false, message: "Necesitas conexión a internet para desactivar dispositivos." };
    }

    try {
        const deviceFingerprint = await getStableFingerprint();

        const { data, error } = await supabaseClient.rpc('deactivate_device_anon', {
            device_id_param: deviceId,
            license_key_param: licenseKey,
            requester_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;
        
        // Si desactivamos con éxito, forzamos actualización del caché en la siguiente lectura
        return data; 

    } catch (error) {
        return { success: false, message: error.message };
    }
};