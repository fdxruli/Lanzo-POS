// src/services/supabase.js
import { createClient } from "@supabase/supabase-js";
import FingerprintJS from '@fingerprintjs/fingerprintjs';

// Usamos las variables de entorno
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseClient = createClient(supabaseUrl, supabaseKey);

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

export const revalidateLicense = async function (licenseKeyProp) {
    try {
        let storedLicense = null;
        try {
            const ls = localStorage.getItem('lanzo_license');
            if (ls) storedLicense = JSON.parse(ls)?.data;
        } catch (e) { }

        const licenseKey = licenseKeyProp || storedLicense?.license_key;

        if (!licenseKey) return { valid: false, message: 'No license key found' };

        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc(
            'verify_device_license', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (!data.valid) {
            console.warn("Licencia invalidada por el servidor:", data.reason);
        }

        return data;

    } catch (error) {
        console.error('Error de conexión al revalidar (Modo Offline Activado):', error);

        // --- CAMBIO: BLINDAJE TOTAL ---
        // Ante CUALQUIER error de conexión (timeout, DNS, cambio de red, etc.),
        // si ya teníamos una licencia, asumimos que sigue siendo válida temporalmente.
        return {
            valid: true,
            reason: 'offline_grace',
            license_key: licenseKeyProp,
            // Importante: Marcamos esto para que el store sepa que es data parcial
            is_fallback: true
        };
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
    console.warn("Deactivación manual pendiente de implementación en backend anónimo.");
    return { success: true };
};

// --- FUNCIÓN CORREGIDA ---
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

            // --- CORRECCIÓN AQUÍ: ---
            // Si la SQL devuelve 'details', úsalo. Si no (nueva SQL), usa 'data' completo.
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

export const getLicenseDevices = async function (licenseKey) {
    try {
        if (!licenseKey) return { success: false, message: 'Falta la clave de licencia.' };

        const deviceFingerprint = await getStableDeviceId();

        const { data, error } = await supabaseClient.rpc('get_license_devices_anon', {
            license_key_param: licenseKey,
            current_fingerprint_param: deviceFingerprint
        });

        if (error) throw error;

        if (data.success) {
            return { success: true, data: data.data || [] };
        } else {
            return { success: false, message: data.message };
        }

    } catch (error) {
        console.error('Error getting license devices:', error);
        return { success: false, message: `Error de red o servidor: ${error.message}` };
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