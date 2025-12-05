// src/services/supabase.js
import { createClient } from "@supabase/supabase-js";
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseClient = createClient(supabaseUrl, supabaseKey);

// --- Helpers ---

function getFriendlyDeviceName(userAgent) {
    let os = 'Dispositivo';
    let browser = 'Navegador';
    const ua = userAgent.toLowerCase();

    if (ua.includes('win')) os = 'Windows';
    else if (ua.includes('mac')) os = 'Mac';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('iphone')) os = 'iPhone';
    else if (ua.includes('ipad')) os = 'iPad';

    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('opr/')) browser = 'Opera';
    else if (ua.includes('chrome') && !ua.includes('chromium')) browser = 'Chrome';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')) browser = 'Safari';

    return `${browser} en ${os}`;
}

async function getStableDeviceId() {
    const STORAGE_KEY = 'lanzo_device_id';
    let existingId = localStorage.getItem(STORAGE_KEY);
    if (existingId) return existingId;

    try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const newId = result.visitorId;
        localStorage.setItem(STORAGE_KEY, newId);
        return newId;
    } catch (error) {
        console.error("Error generando fingerprint, usando fallback UUID", error);
        const fallbackId = `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(STORAGE_KEY, fallbackId);
        return fallbackId;
    }
}

// Configuración del Rate Limit
const RATE_LIMIT_KEY = 'lanzo_license_attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 5 * 60 * 1000;

function checkRateLimit() {
    const storedData = localStorage.getItem(RATE_LIMIT_KEY);
    if (!storedData) return { attempts: 0, lockedUntil: null };
    const { attempts, lockedUntil } = JSON.parse(storedData);

    if (lockedUntil && new Date().getTime() < lockedUntil) {
        const remainingSeconds = Math.ceil((lockedUntil - new Date().getTime()) / 1000);
        throw new Error(`Demasiados intentos. Por favor espera ${Math.ceil(remainingSeconds / 60)} minutos.`);
    }

    if (lockedUntil && new Date().getTime() > lockedUntil) {
        localStorage.removeItem(RATE_LIMIT_KEY);
        return { attempts: 0, lockedUntil: null };
    }
    return { attempts, lockedUntil };
}

function registerFailedAttempt() {
    const { attempts } = checkRateLimit();
    const newAttempts = attempts + 1;
    let newData = { attempts: newAttempts, lockedUntil: null };
    if (newAttempts >= MAX_ATTEMPTS) {
        newData.lockedUntil = new Date().getTime() + LOCKOUT_TIME;
    }
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(newData));
}

function resetRateLimit() {
    localStorage.removeItem(RATE_LIMIT_KEY);
}

// --- Funciones Principales ---

export const activateLicense = async function (licenseKey) {
    try {
        checkRateLimit();
        const deviceFingerprint = await getStableDeviceId();
        const friendlyName = getFriendlyDeviceName(navigator.userAgent);
        const deviceInfo = { userAgent: navigator.userAgent, platform: navigator.platform };

        const { data, error } = await supabaseClient.rpc(
            'activate_license_on_device', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint,
            device_name_param: friendlyName,
            device_info_param: deviceInfo
        });

        if (error) throw error;

        if (data && data.success) {
            resetRateLimit();
            localStorage.setItem('fp', deviceFingerprint);
            return { valid: true, message: data.message, details: data.details };
        } else {
            registerFailedAttempt();
            return { valid: false, message: data.error || 'Error de activación.' };
        }

    } catch (error) {
        const isRateLimit = error.message && error.message.includes('Demasiados intentos');
        if (!isRateLimit) {
            console.error('❌ Error activando licencia:', error);
            registerFailedAttempt();
        }
        return { valid: false, message: error.message };
    }
};

// ✅ REVALIDACIÓN ROBUSTA CON TIMEOUT MANUAL
// src/services/supabase.js

// ... (El resto de tus imports y helpers como getStableDeviceId se mantienen igual)

// ✅ REVALIDACIÓN ROBUSTA CON TIMEOUT MANUAL Y PRIORIDAD DE SERVIDOR
export const revalidateLicense = async function (licenseKeyProp) {
    // 1. Configurar un Timeout de 8 segundos (tiempo justo para redes lentas)
    const timeoutMs = 8000;
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error('VALIDATION_TIMEOUT'));
        }, timeoutMs);
    });

    try {
        // 2. Obtener clave de licencia (desde argumento o storage)
        let storedLicense = null;
        try {
            const ls = localStorage.getItem('lanzo_license');
            if (ls) storedLicense = JSON.parse(ls)?.data;
        } catch (e) { }

        const licenseKey = licenseKeyProp || storedLicense?.license_key;

        if (!licenseKey) {
            clearTimeout(timeoutId);
            return { valid: false, reason: 'no_license_key' };
        }

        // 3. Verificación PREVIA de conexión
        // Si el navegador dice que no hay internet, ni intentamos el fetch
        if (!navigator.onLine) {
            throw new Error("OFFLINE_PRECHECK");
        }

        const deviceFingerprint = await getStableDeviceId();

        // 4. Intentar validar con el servidor (compite contra el timeout)
        const validationPromise = supabaseClient.rpc(
            'verify_device_license', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint
        });

        // Promise.race ganará quien termine primero (la respuesta o el timeout)
        const { data, error } = await Promise.race([validationPromise, timeoutPromise]);

        clearTimeout(timeoutId);

        // Si Supabase devuelve error técnico (ej. error 500, error de sintaxis), lanzamos excepción
        if (error) throw error;

        // 5. ÉXITO DEL SERVIDOR:
        // Aquí es donde corregimos el problema. Si el servidor respondió, 
        // devolvemos SU verdad, aunque sea { valid: false }.
        // NO activamos el catch ni el modo offline.
        if (!data.valid) {
            console.warn("⛔ Servidor: Licencia no válida o expirada:", data.reason);
        } else {
            console.log("✅ Servidor: Licencia válida.");
        }

        return data;

    } catch (error) {
        clearTimeout(timeoutId);

        // 6. DIAGNÓSTICO DE ERROR (Solo usamos caché si es culpa de la RED)
        const errorMessage = error.message || '';

        console.warn('⚠️ Fallo al validar con servidor:', errorMessage);

        const isNetworkError =
            errorMessage === 'VALIDATION_TIMEOUT' ||
            errorMessage === 'OFFLINE_PRECHECK' ||
            errorMessage.includes('fetch') ||
            errorMessage.includes('network') ||
            errorMessage.includes('Failed to fetch');

        // Si es error de RED, activamos el "Modo Gracia Offline"
        if (isNetworkError) {
            console.log('☁️ Activando modo offline por falta de conexión...');

            // Intentar cargar caché local
            let storedLicense = null;
            try {
                const ls = localStorage.getItem('lanzo_license');
                if (ls) storedLicense = JSON.parse(ls)?.data;
            } catch (e) { }

            if (storedLicense && storedLicense.license_key) {
                return {
                    ...storedLicense,
                    valid: true, // Asumimos válido temporalmente porque no podemos comprobar
                    reason: 'offline_grace', // Marcador especial para la UI
                    is_fallback: true
                };
            }
        }

        // Si es otro tipo de error (ej. base de datos corrupta, error lógico)
        // o si no hay caché, devolvemos fallo.
        return { valid: false, reason: 'error_unknown', details: errorMessage };
    }
};

export const saveBusinessProfile = async function (licenseKey, profileData) {
    try {
        const { data, error } = await supabaseClient.rpc(
            'save_business_profile_anon', {
            license_key_param: licenseKey,
            profile_data: {
                name: profileData.name,
                phone: profileData.phone,
                address: profileData.address,
                logo_url: profileData.logo,
                business_type: profileData.business_type
            }
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error guardando perfil:', error);
        return { success: false, message: error.message };
    }
};

export const getBusinessProfile = async function (licenseKey) {
    try {
        const { data, error } = await supabaseClient.rpc(
            'get_business_profile_anon', {
            license_key_param: licenseKey
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        return { success: false, message: error.message };
    }
};

export const uploadFile = async function (file, type = 'product') {
    if (!file) return null;

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;
        const filePath = `public_uploads/${fileName}`;

        let { error: uploadError } = await supabaseClient
            .storage
            .from('images')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) throw uploadError;

        const { data } = supabaseClient
            .storage
            .from('images')
            .getPublicUrl(filePath);

        return data.publicUrl;

    } catch (error) {
        console.error('Error subiendo archivo:', error);
        return null;
    }
};

export const deactivateCurrentDevice = async () => {
    console.warn("Desactivación manual pendiente de implementación en backend anónimo.");
    return { success: true };
};

export const createFreeTrial = async function () {
    try {
        checkRateLimit();

        const deviceFingerprint = await getStableDeviceId();
        const friendlyName = getFriendlyDeviceName(navigator.userAgent);
        const deviceInfo = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language
        };

        const { data, error } = await supabaseClient.rpc(
            'create_free_trial_license', {
            device_fingerprint_param: deviceFingerprint,
            device_name_param: friendlyName,
            device_info_param: deviceInfo
        });

        if (error) throw error;

        if (data && data.success) {
            localStorage.setItem('fp', deviceFingerprint);
            const licenseData = data.details || data;
            return { success: true, details: licenseData };
        } else {
            registerFailedAttempt();
            return { success: false, error: data.error || 'No se pudo crear la licencia.' };
        }

    } catch (error) {
        const isRateLimit = error.message && error.message.includes('Demasiados intentos');
        if (!isRateLimit) {
            console.error('❌ Error creando trial:', error);
            registerFailedAttempt();
        }
        return { success: false, error: error.message };
    }
};



export const deactivateDeviceById = async function (deviceId) {
    try {
        const storedData = localStorage.getItem('lanzo_license');
        const licenseKey = storedData ? JSON.parse(storedData).data.license_key : null;
        const deviceFingerprint = await getStableDeviceId();

        if (!licenseKey || !deviceFingerprint) {
            return { success: false, message: "No hay sesión activa para realizar esta acción." };
        }

        const { data, error } = await supabaseClient.rpc('deactivate_device_anon', {
            device_id_param: deviceId,
            license_key_param: licenseKey,
            requester_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('Error deactivating device:', error);
        return { success: false, message: error.message };
    }
};

export const subscribeToSecurityChanges = async () => {
    return null;
};

export const removeRealtimeChannel = async (channel) => {
    if (channel) await supabaseClient.removeChannel(channel);
};