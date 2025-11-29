import { createClient } from "@supabase/supabase-js";
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseClient = createClient(supabaseUrl, supabaseKey);

async function getSupabaseUser() {
    const SYSTEM_USER_EMAIL = 'sistema@lanzo.local';
    const SYSTEM_USER_PASSWORD = 'LanzoDB1';

    try {
        let { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user && session.user.email === SYSTEM_USER_EMAIL) {
            return session.user;
        }

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: SYSTEM_USER_EMAIL,
            password: SYSTEM_USER_PASSWORD,
        });

        if (error) throw new Error(`Failed to sign in with system user: ${error.message}`);
        return data.user;

    } catch (error) {
        console.error('Error in getSupabaseUser:', error);
        throw new Error(`Could not log in the system user. Please check its credentials and that the email is confirmed in Supabase. Original error: ${error.message}`);
    }
}

// Configuración del Rate Limit
const RATE_LIMIT_KEY = 'lanzo_license_attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 5 * 60 * 1000; // 5 minutos en milisegundos

function checkRateLimit() {
  const storedData = localStorage.getItem(RATE_LIMIT_KEY);
  if (!storedData) return { attempts: 0, lockedUntil: null };

  const { attempts, lockedUntil } = JSON.parse(storedData);

  // Si hay un bloqueo activo y el tiempo no ha pasado
  if (lockedUntil && new Date().getTime() < lockedUntil) {
    const remainingSeconds = Math.ceil((lockedUntil - new Date().getTime()) / 1000);
    throw new Error(`Demasiados intentos. Por favor espera ${Math.ceil(remainingSeconds / 60)} minutos.`);
  }

  // Si el tiempo de bloqueo ya pasó, reseteamos
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

/**
 * Intenta analizar el User Agent para un nombre más legible.
 * @param {string} userAgent - El string de navigator.userAgent
 * @returns {string} Un nombre amigable, ej: "Chrome en Windows"
 */
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

export const activateLicense = async function (licenseKey) {
    try {
        // 1. Verificar bloqueo antes de llamar a Supabase
        checkRateLimit(); 

        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'Could not get a user session.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

        // Datos del dispositivo
        const friendlyName = getFriendlyDeviceName(navigator.userAgent);
        const deviceInfo = { userAgent: navigator.userAgent, platform: navigator.platform };

        // 2. Llamada a la API (Solo si pasó el checkRateLimit)
        const { data, error } = await supabaseClient.rpc(
            'activate_license_on_device', {
            license_key_param: licenseKey,
            user_id_param: user.id,
            device_fingerprint_param: deviceFingerprint,
            device_name_param: friendlyName,
            device_info_param: deviceInfo
        });

        if (error) throw error;

        if (data && data.success) {
            // 3. ÉXITO: Resetear contador de intentos fallidos
            resetRateLimit();
            
            // Verificación secundaria
            const { data: licenseDetails, error: verifyError } = await supabaseClient.rpc(
                'verify_device_license', {
                user_id_param: user.id,
                device_fingerprint_param: deviceFingerprint
            });
            if (verifyError) throw verifyError;
            
            return { valid: true, message: data.message, details: licenseDetails };
        } else {
            // 4. FALLO DE LICENCIA (Clave incorrecta): Registrar intento
            registerFailedAttempt();
            return { valid: false, message: data.error || 'License activation failed.' };
        }

    } catch (error) {
        // ============================================================
        // MEJORA AQUÍ: Manejo inteligente de errores
        // ============================================================
        
        // Detectamos si es nuestro error de Rate Limit
        const isRateLimit = error.message && error.message.includes('Demasiados intentos');

        if (isRateLimit) {
            // A) Si es bloqueo: No ensuciamos la consola con console.error
            console.warn(`🔒 Bloqueo activo: ${error.message}`);
        } else {
            // B) Si es otro error (Red, Supabase caído, Bug): SÍ lo registramos
            console.error('❌ Error crítico activando licencia:', error);
            
            // Opcional: Contamos errores de red como intentos fallidos también
            // para evitar spam de peticiones si alguien ataca tu API
            registerFailedAttempt();
        }

        // Devolvemos el mensaje limpio para que el Modal lo muestre al usuario
        return { valid: false, message: error.message }; 
    }
};

export const revalidateLicense = async function () {
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'No user session.' };

        let deviceFingerprint = localStorage.getItem('fp');
        if (!deviceFingerprint) {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            deviceFingerprint = result.visitorId;
            localStorage.setItem('fp', deviceFingerprint);
        }

        const { data, error } = await supabaseClient.rpc(
            'verify_device_license', {
            user_id_param: user.id,
            device_fingerprint_param: deviceFingerprint
        }
        );

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('Error during license revalidation:', error);

        const errorMsg = error.message ? error.message.toLowerCase() : '';

        if (
            errorMsg.includes('failed to fetch') ||
            errorMsg.includes('network error') ||
            errorMsg.includes('connection') ||
            !navigator.onLine
        ) {
            throw new Error('OFFLINE_MODE_TRIGGER');
        }
    
        return { valid: false, message: error.message };
    }
};

export const deactivateCurrentDevice = async function (licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) throw new Error('User session not found.');

        let deviceFingerprint = localStorage.getItem('fp');
        if (!deviceFingerprint) {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            deviceFingerprint = result.visitorId;
        }

        const { data, error } = await supabaseClient.rpc('deactivate_device', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint,
            user_id_param: user.id
        });

        if (error) throw error;
        localStorage.removeItem('fp');
        return data;

    } catch (error) {
        console.error('Error during device deactivation:', error);
        return { success: false, message: error.message };
    }
};

export const getBusinessCategories = async function () {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };
        const { data, error } = await supabaseClient.rpc('get_business_categories');
        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error('Error getting business categories:', error);
        return { success: false, message: `Client-side error: ${error.message}` };
    }
};

export const saveBusinessProfile = async function (licenseKey, profileData) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };
        const { data: license, error: licenseError } = await supabaseClient
            .from('licenses')
            .select('id')
            .eq('license_key', licenseKey)
            .single();
        if (licenseError || !license) {
            throw new Error('License not found.');
        }
        const dataToUpsert = {
            license_id: license.id,
            user_id: user.id,
            business_name: profileData.name,
            phone_number: profileData.phone,
            address: profileData.address,
            logo_url: profileData.logo,
            business_type: profileData.business_type,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabaseClient
            .from('business_profiles')
            .upsert(dataToUpsert, { onConflict: 'license_id' })
            .select()
            .single();
        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error('Error saving business profile:', error);
        return { success: false, message: `Client-side error: ${error.message}` };
    }
};

export const getBusinessProfile = async function (licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };

        if (!licenseKey) {
            return { success: false, message: 'License key is required to fetch profile.' };
        }

        const { data: license, error: licenseError } = await supabaseClient
            .from('licenses')
            .select('id')
            .eq('license_key', licenseKey)
            .single();

        if (licenseError || !license) {
            return { success: true, data: null };
        }

        const { data, error } = await supabaseClient
            .from('business_profiles')
            .select('*')
            .eq('license_id', license.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return { success: true, data: null };
            }
            throw error;
        }

        return { success: true, data };
    } catch (error) {
        console.error('Error getting business profile:', error);
        return { success: false, message: `Client-side error: ${error.message}` };
    }
};

export const getLicenseDevices = async function (licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };

        let deviceFingerprint = localStorage.getItem('fp');
        if (!deviceFingerprint) {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            deviceFingerprint = result.visitorId;
            localStorage.setItem('fp', deviceFingerprint);
        }
        
        const { data, error } = await supabaseClient.rpc('get_license_devices', {
            license_key_param: licenseKey,
            current_fingerprint_param: deviceFingerprint // <-- Pasamos el nuevo parámetro
        });

        if (error) throw error;
        return { success: true, data: data || [] };

    } catch (error) {
        console.error('Error getting license devices:', error);
        return { success: false, message: `Client-side error: ${error.message}` };
    }
};

export const deactivateDeviceById = async function (deviceId) {
    try {
        const user = await getSupabaseUser();
        if (!user) throw new Error('User session not found.');
        const { data, error } = await supabaseClient.rpc('deactivate_device_by_id', {
            device_id_param: deviceId,
            user_id_param: user.id
        });
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error during device deactivation by ID:', error);
        return { success: false, message: error.message };
    }
};

/**
 * Llama a la función SQL para crear una licencia de prueba
 * y registrar el dispositivo actual.
 */
export const createFreeTrial = async function () {
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'No se pudo obtener la sesión del usuario.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

        localStorage.setItem('fp', deviceFingerprint);

        const deviceInfo = { userAgent: navigator.userAgent, platform: navigator.platform };
        const friendlyName = getFriendlyDeviceName(navigator.userAgent); // Usamos el helper que ya existe

        const { data, error } = await supabaseClient.rpc(
            'create_free_trial_license', {
            user_id_param: user.id,
            device_fingerprint_param: deviceFingerprint,
            device_name_param: friendlyName,
            device_info_param: deviceInfo
        }
        );

        if (error) throw error;

        return data;

    } catch (error) {
        console.error('Error al crear la prueba gratuita:', error);
        return { success: false, error: `Error del cliente: ${error.message}` };
    }
};

/**
 * Sube un archivo (imagen) a Supabase Storage.
 * @param {File} file El archivo a subir (idealmente el .webp comprimido).
 * @param {'logo' | 'product'} type El tipo de imagen, para la carpeta.
 * @returns {Promise<string>} La URL pública de la imagen subida.
 */
export const uploadFile = async function (file, type = 'product') {
    if (!file) throw new Error("No se proporcionó ningún archivo.");

    try {
        const user = await getSupabaseUser();
        if (!user) throw new Error("No se pudo obtener la sesión del usuario.");

        const fileExt = file.name.split('.').pop();
        const fileName = `${type}-${user.id}-${Date.now()}.${fileExt}`;
        const filePath = `${user.id}/${fileName}`; // Ej: 'user-id-123/product-user-id-123-456789.webp'

        let { error: uploadError } = await supabaseClient
            .storage
            .from('images')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            throw uploadError;
        }

        const { data } = supabaseClient
            .storage
            .from('images')
            .getPublicUrl(filePath);

        if (!data || !data.publicUrl) {
            throw new Error("No se pudo obtener la URL pública después de la subida.");
        }

        console.log('Imagen subida exitosamente:', data.publicUrl);
        return data.publicUrl;

    } catch (error) {
        console.error('Error al subir el archivo:', error);
        return null;
    }
};

/**
 * Suscribe la app a cambios en la licencia y el dispositivo en tiempo real.
 * @param {string} licenseKey - La clave de licencia actual.
 * @param {function} onLicenseChange - Callback cuando cambia la tabla 'licenses'.
 * @param {function} onDeviceChange - Callback cuando cambia la tabla 'license_devices'.
 * @returns {object} La suscripción para poder desuscribirse luego.
 */
export const subscribeToSecurityChanges = async function (licenseKey, onLicenseChange, onDeviceChange) {
    if (!licenseKey) return null;

    const fp = await FingerprintJS.load();
    const result = await fp.get();
    const currentFingerprint = result.visitorId;

    console.log("🔌 Conectando a Realtime Security para:", licenseKey);

    const channel = supabaseClient.channel('security-monitoring')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'licenses',
                filter: `license_key=eq.${licenseKey}`
            },
            (payload) => {
                console.log('⚠️ Cambio crítico en Licencia detectado:', payload);
                onLicenseChange(payload.new);
            }
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'license_devices',
                filter: `device_fingerprint=eq.${currentFingerprint}`
            },
            (payload) => {
                console.log('⚠️ Cambio crítico en Dispositivo detectado:', payload);
                onDeviceChange(payload.new || null, payload.eventType);
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Escuchando cambios de seguridad en tiempo real.');
            }
        });

    return channel;
};

export const removeRealtimeChannel = async (channel) => {
    if (channel) await supabaseClient.removeChannel(channel);
};