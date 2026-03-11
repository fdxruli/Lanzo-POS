// src/services/supabase.js
import { createClient } from "@supabase/supabase-js";
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { safeLocalStorageSet, checkInternetConnection } from './utils';
import { loadData, saveData, STORES } from './database';
import Logger from "./Logger";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseClient = createClient(supabaseUrl, supabaseKey);

async function getSecureCredentials() {
    try {
        const record = await loadData(STORES.SYNC_CACHE, 'device_security_token');
        return record ? record.value : null;
    } catch (e) {
        return null;
    }
}

async function setSecureCredentials(newToken) {
    try {
        await saveData(STORES.SYNC_CACHE, {
            key: 'device_security_token',
            value: newToken
        });
    } catch (e) {
        Logger.warn("No se pudo guardar el token de seguridad:", e);
    }
}

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

export async function getStableDeviceId() {
    const STORAGE_KEY = 'lanzo_device_id';

    // A. Intentar leer de LocalStorage (Memoria rápida)
    const lsId = localStorage.getItem(STORAGE_KEY);

    // B. Intentar leer de IndexedDB (Memoria persistente)
    let dbId = null;
    try {
        // Buscamos en la caché de sincronización
        const record = await loadData(STORES.SYNC_CACHE, STORAGE_KEY);
        // Asumimos que guardaremos el ID en la propiedad 'value'
        if (record && record.value) {
            dbId = record.value;
        }
    } catch (e) {
        Logger.warn("⚠️ No se pudo leer identidad de BD (posiblemente primer uso):", e);
    }

    // --- LÓGICA DE RECONCILIACIÓN ---

    // CASO 1: Coincidencia perfecta o recuperación cruzada
    if (dbId && lsId) {
        if (dbId !== lsId) {
            Logger.warn("⚠️ Conflicto de identidad detectado. IndexedDB tiene prioridad.");
            // IDB es más difícil de borrar, así que confiamos en él y reparamos LocalStorage
            safeLocalStorageSet(STORAGE_KEY, dbId);
            return dbId;
        }
        return dbId; // Todo correcto
    }

    // CASO 2: Usuario borró cookies (localStorage vacío) pero BD sigue viva
    if (dbId && !lsId) {
        Logger.log("♻️ Identidad recuperada desde IndexedDB.");
        safeLocalStorageSet(STORAGE_KEY, dbId);
        return dbId;
    }

    // CASO 3: BD vacía o corrupta, pero LocalStorage vivo (Raro, pero posible)
    if (lsId && !dbId) {
        Logger.log("💾 Respaldando identidad existente en IndexedDB...");
        try {
            await saveData(STORES.SYNC_CACHE, { key: STORAGE_KEY, value: lsId });
        } catch (e) { Logger.warn("Fallo respaldo ID:", e); }
        return lsId;
    }

    // CASO 4: Dispositivo totalmente nuevo (Generación)
    try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const newId = result.visitorId;

        // Guardamos en AMBOS lugares
        safeLocalStorageSet(STORAGE_KEY, newId);

        try {
            await saveData(STORES.SYNC_CACHE, { key: STORAGE_KEY, value: newId });
        } catch (e) {
            Logger.warn("⚠️ No se pudo persistir el ID nuevo en DB:", e);
        }

        return newId;
    } catch (error) {
        Logger.error("Error crítico generando fingerprint, usando fallback UUID", error);
        const fallbackId = `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        safeLocalStorageSet(STORAGE_KEY, fallbackId);
        return fallbackId;
    }
}

async function getUntamperedTime() {
    const now = Date.now();
    let lastSeen = null;
    try {
        const record = await loadData(STORES.SYNC_CACHE, 'security_monotonic_clock');
        if (record && record.value) lastSeen = record.value;
    } catch (e) {
        Logger.warn("No se pudo leer el reloj de seguridad.");
    }

    if (lastSeen && now < lastSeen) {
        const diff = lastSeen - now;
        const MAX_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 24 horas

        if (diff > MAX_TOLERANCE_MS) {
            throw new Error("TIME_TAMPERING_DETECTED");
        }

        // Es un retroceso menor (NTP o ajuste manual pequeño).
        // No arrojamos error, pero retornamos el tiempo futuro que ya teníamos registrado.
        // Esto impide que el usuario "gane" tiempo retrocediendo el reloj dentro de la tolerancia.
        return lastSeen;
    }

    // Actualizamos el reloj al tiempo más reciente
    try {
        await saveData(STORES.SYNC_CACHE, { key: 'security_monotonic_clock', value: now });
    } catch (e) { }

    return now;
}

// Configuración del Rate Limit
const RATE_LIMIT_KEY = 'lanzo_license_attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 5 * 60 * 1000;

async function checkRateLimit() {
    let storedData = null;
    try {
        const record = await loadData(STORES.SYNC_CACHE, RATE_LIMIT_KEY);
        if (record && record.value) storedData = record.value;
    } catch (e) { }

    if (!storedData) return { attempts: 0, lockedUntil: null };

    const { attempts, lockedUntil } = storedData;
    const now = Date.now();

    if (lockedUntil && now < lockedUntil) {
        const remainingSeconds = Math.ceil((lockedUntil - now) / 1000);
        throw new Error(`Demasiados intentos. Por favor espera ${Math.ceil(remainingSeconds / 60)} minutos.`);
    }

    if (lockedUntil && now > lockedUntil) {
        await resetRateLimit();
        return { attempts: 0, lockedUntil: null };
    }
    return { attempts, lockedUntil };
}

async function registerFailedAttempt() {
    try {
        const { attempts } = await checkRateLimit();
        const newAttempts = attempts + 1;
        const newData = { attempts: newAttempts, lockedUntil: null };
        if (newAttempts >= MAX_ATTEMPTS) {
            newData.lockedUntil = Date.now() + LOCKOUT_TIME;
        }
        await saveData(STORES.SYNC_CACHE, { key: RATE_LIMIT_KEY, value: newData });
    } catch (e) {
        Logger.warn("Error guardando rate limit", e);
    }
}

async function resetRateLimit() {
    try {
        // En lugar de removeItem, sobreescribimos con nulo o borramos si tienes deleteData
        await saveData(STORES.SYNC_CACHE, { key: RATE_LIMIT_KEY, value: null });
    } catch (e) { }
}

// --- Funciones Principales ---

export const activateLicense = async function (licenseKey) {
    try {
        // 1. Verificación Estricta de Red
        // A diferencia de revalidar, ACTIVAR requiere internet obligatoriamente.
        // No gastamos intentos de rate limit si ni siquiera hay red.
        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            return {
                valid: false,
                message: "No tienes conexión a internet. La activación requiere estar en línea."
            };
        }

        await checkRateLimit();

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

        // Si es error técnico de Supabase (500, etc)
        if (error) throw error;

        if (data && data.success) {
            resetRateLimit();
            safeLocalStorageSet('fp', deviceFingerprint);

            // --- AGREGAR ESTO URGENTEMENTE ---
            // Si tu RPC de activación devuelve el token, guárdalo YA.
            // Si el token viene en data.device_security_token o data.details.token:
            const initialToken = data.device_security_token || (data.details && data.details.token);

            if (initialToken) {
                await setSecureCredentials(initialToken);
            } else {
                Logger.warn("⚠️ Advertencia: El servidor no devolvió un token inicial tras activar.");
            }
            // ---------------------------------

            return { valid: true, message: data.message, details: data.details };
        } else {
            // El servidor respondió, pero rechazó la activación (ej. licencia tope alcanzado)
            await registerFailedAttempt();
            return { valid: false, message: data.error || 'Error de activación.' };
        }

    } catch (error) {
        const isRateLimit = typeof error?.message === 'string' && error.message.includes('Demasiados intentos');

        if (!isRateLimit) {
            // Usamos el Logger para no ensuciar consola en producción
            Logger.error('❌ Error activando licencia:', error);

            // Solo registramos intento fallido si fue un error lógico o de servidor,
            // no si fue un error de validación local o desconexión.
            await registerFailedAttempt();
        }

        return { valid: false, message: error.message };
    }
};

export const revalidateLicense = async function (licenseKeyProp) {
    const timeoutMs = 8000;
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('VALIDATION_TIMEOUT')), timeoutMs);
    });

    try {
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

        const isOnline = await checkInternetConnection();
        if (!isOnline) {
            throw new Error("OFFLINE_PRECHECK");
        }

        const deviceFingerprint = await getStableDeviceId();

        // 🟢 NUEVO 1: Recuperamos el token secreto de IndexedDB antes de llamar al servidor
        const securityToken = await getSecureCredentials();

        // 🟢 NUEVO 2: Cambiamos el nombre de la función y los parámetros
        // Nota: Los parámetros ahora deben coincidir con tu SQL (p_license_key, etc.)
        const validationPromise = supabaseClient.rpc('verify_device_license_unified', {
            p_license_key: licenseKey,           // Antes: license_key_param
            p_device_fingerprint: deviceFingerprint, // Antes: device_fingerprint_param
            p_security_token: securityToken || null  // ¡El nuevo ingrediente secreto!
        });

        const { data, error } = await Promise.race([validationPromise, timeoutPromise]);
        clearTimeout(timeoutId);

        if (error) {
            const isTechnicalError =
                error.code === 'PGRST301' ||
                error.message?.includes('fetch') ||
                error.message?.includes('network');

            if (isTechnicalError) {
                throw new Error('NETWORK_ERROR');
            }
            throw error;
        }

        // 🟢 NUEVO 3: Si el servidor nos da un nuevo token, lo guardamos inmediatamente (Rotación)
        if (data && data.valid) {
            // Rotación del token
            if (data.new_security_token) {
                await setSecureCredentials(data.new_security_token);
            }

            const currentRealTime = Date.now();

            // Guardar el estado validado en IndexedDB de forma exclusiva
            await saveData(STORES.SYNC_CACHE, {
                key: 'last_valid_license_state',
                value: {
                    payload: data,
                    timestamp: currentRealTime
                }
            });

            // CORRECCIÓN CRÍTICA: "Sanar" el reloj monotónico.
            // Si validamos online con éxito, asumimos que el reloj actual es la nueva verdad.
            // Esto rescata al dispositivo de la trampa del "salto al futuro".
            try {
                await saveData(STORES.SYNC_CACHE, {
                    key: 'security_monotonic_clock',
                    value: currentRealTime
                });
            } catch (e) {
                Logger.warn("Fallo al sanar el reloj monotónico", e);
            }
        }

        if (!data.valid && data.reason !== 'offline_grace') {
            Logger.warn("⛔ Servidor confirmó: Licencia inválida:", data.reason);
            // Si el servidor invalida, destruimos el caché offline local
            await loadData(STORES.SYNC_CACHE, 'last_valid_license_state').then(async (record) => {
                if (record) {
                    // Implementa un borrado si tienes la función deleteData, 
                    // o sobrescribe con un objeto inválido
                    await saveData(STORES.SYNC_CACHE, { key: 'last_valid_license_state', value: null });
                }
            });
        }

        return data;

    } catch (error) {
        // ... (Todo el bloque catch se queda IGUAL para mantener el modo offline) ...
        clearTimeout(timeoutId);
        Logger.warn('⚠️ Error validando licencia:', error.message);

        const isNetworkError =
            error.message === 'VALIDATION_TIMEOUT' ||
            error.message === 'OFFLINE_PRECHECK' ||
            error.message === 'NETWORK_ERROR' ||
            error.message?.includes('fetch');

        if (isNetworkError) {
            Logger.log('☁️ Modo offline activado por problema de conexión');

            // 1. Verificar que existe el token de seguridad del dispositivo
            const securityToken = await getSecureCredentials();

            // 2. Recuperar el último estado validado
            let storedState = null;
            try {
                const record = await loadData(STORES.SYNC_CACHE, 'last_valid_license_state');
                if (record && record.value) storedState = record.value;
            } catch (e) { }

            if (!securityToken || !storedState || !storedState.payload) {
                return {
                    valid: false,
                    reason: 'no_secure_context',
                    details: 'Requiere conexión a internet para validación inicial.'
                };
            }

            // 3. Evaluar el tiempo transcurrido con el reloj antimanipulación
            let now;
            try {
                now = await getUntamperedTime();
            } catch (error) {
                if (error.message === "TIME_TAMPERING_DETECTED") {
                    // Bloqueo fulminante: Si detectamos trampa, destruimos la sesión offline
                    //await saveData(STORES.SYNC_CACHE, { key: 'last_valid_license_state', value: null });
                    return {
                        valid: false,
                        reason: 'time_tampering_detected',
                        details: 'Inconsistencia severa de reloj detectada. Ajusta tu dispositivo a la fecha y hora correctas, y conéctate a internet para restaurar el sistema.'
                    };
                }
                now = Date.now(); // Fallback si falla IndexedDB
            }

            const MAX_OFFLINE_MS = 72 * 60 * 60 * 1000;
            const timeOffline = now - storedState.timestamp;

            // También validamos si de alguna forma storedState.timestamp está en el futuro (otra trampa)
            if (!storedState.timestamp || isNaN(timeOffline) || timeOffline < 0 || timeOffline > MAX_OFFLINE_MS) {
                return {
                    valid: false,
                    reason: 'offline_grace_expired',
                    details: 'El periodo de gracia offline es inválido o ha expirado. Conéctate a internet.'
                };
            }

            // Conceder acceso offline temporal
            return {
                ...storedState.payload,
                valid: true,
                reason: 'offline_grace',
                is_fallback: true,
                last_check_failed: new Date().toISOString(),
                hours_remaining: Math.floor((MAX_OFFLINE_MS - timeOffline) / (1000 * 60 * 60))
            };
        }

        return {
            valid: false,
            reason: 'server_rejected',
            details: error?.message || String(error) || 'Error desconocido del servidor'
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
        Logger.error('Error guardando perfil:', error);
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
        Logger.error('Error obteniendo perfil:', error);
        return { success: false, message: error.message };
    }
};

export const uploadFile = async function (file, type = 'product') {
    if (!file) return null;

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;
        const filePath = `public_uploads/${fileName}`;

        const { error: uploadError } = await supabaseClient
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
        Logger.error('Error subiendo archivo:', error);
        return null;
    }
};

export const deactivateCurrentDevice = async (licenseKey) => {
    try {
        // A. Obtenemos la huella digital actual
        const fingerprint = await getStableDeviceId();

        // B. Buscamos en el servidor cuál es el ID de ESTE dispositivo
        // Reutilizamos la RPC que ya usas para listar dispositivos
        const { data: result, error: fetchError } = await supabaseClient.rpc('get_license_devices_anon', {
            license_key_param: licenseKey,
            current_fingerprint_param: fingerprint
        });

        if (fetchError || !result?.success) {
            Logger.warn("No se pudo obtener lista de dispositivos para logout:", fetchError);
            return { success: true }; // Fallamos "suavemente" para permitir salir localmente
        }

        // Buscamos el dispositivo que coincida con nuestra huella y esté marcado como actual
        const myDevice = result.data.find(d => d.is_current_device || d.fingerprint === fingerprint);

        if (myDevice) {
            Logger.log(`🔒 Cerrando sesión en servidor para dispositivo: ${myDevice.device_name}`);

            // C. Llamamos a la RPC de desactivación
            const { error: deactivateError } = await supabaseClient.rpc('deactivate_device_anon', {
                device_id_param: myDevice.device_id,
                license_key_param: licenseKey,
                requester_fingerprint_param: fingerprint
            });

            if (deactivateError) throw deactivateError;

            return { success: true };
        } else {
            Logger.warn("Dispositivo no encontrado en la lista remota, cerrando localmente.");
            return { success: true };
        }

    } catch (error) {
        Logger.error('Error en deactivateCurrentDevice:', error);
        // Retornamos true para no atrapar al usuario en un bucle si falla el internet
        return { success: true, error: error.message };
    }
};

export const createFreeTrial = async function () {
    try {
        await checkRateLimit();

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
            safeLocalStorageSet('fp', deviceFingerprint);
            const licenseData = data.details || data;
            return { success: true, details: licenseData };
        } else {
            await registerFailedAttempt();
            return { success: false, error: data.error || 'No se pudo crear la licencia.' };
        }

    } catch (error) {
        const isRateLimit = typeof error?.message === 'string' && error.message.includes('Demasiados intentos');
        if (!isRateLimit) {
            Logger.error('❌ Error creando trial:', error);
            await registerFailedAttempt();
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
        Logger.error('Error deactivating device:', error);
        return { success: false, message: error.message };
    }
};

export const subscribeToSecurityChanges = async () => {
    return null;
};

export const removeRealtimeChannel = async (channel) => {
    if (channel) await supabaseClient.removeChannel(channel);
};

/**
 * Descarga el contenido HTML de los términos activos desde Supabase.
 * @param {string} type - Tipo de documento ('terms_of_use' o 'privacy_policy')
 */
export const fetchLegalTerms = async (type = 'terms_of_use') => {
    try {
        const { data, error } = await supabaseClient
            .rpc('get_active_legal_terms', { doc_type_param: type });

        if (error) throw error;

        // La RPC devuelve una tabla, tomamos el primer resultado (si existe)
        return data && data.length > 0 ? data[0] : null;

    } catch (error) {
        Logger.error('Error obteniendo términos legales:', error);
        return null;
    }
};

/**
 * Registra que una licencia específica aceptó una versión específica de los términos.
 * @param {string} licenseKey - La licencia que acepta.
 * @param {string} termId - El ID de la versión de términos aceptada.
 */
export const acceptLegalTerms = async (licenseKey, termId) => {
    try {
        const deviceFingerprint = await getStableDeviceId();

        // Metadata opcional (navegador, plataforma)
        const metadata = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language
        };

        const { data, error } = await supabaseClient.rpc('register_term_acceptance', {
            p_license_key: licenseKey,
            p_term_id: termId,
            p_device_fingerprint: deviceFingerprint,
            p_metadata: metadata
        });

        if (error) throw error;
        return data; // { success: true }

    } catch (error) {
        Logger.error('Error registrando aceptación de términos:', error);
        return { success: false, error: error.message };
    }
};