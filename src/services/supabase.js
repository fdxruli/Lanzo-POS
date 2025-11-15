// src/services/supabase.js

// --- SUPABASE CLIENT INITIALIZATION ---
const supabaseUrl = 'https://jkuceingecbynyvntcxe.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdWNlaW5nZWNieW55dm50Y3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMzcwMTMsImV4cCI6MjA3MTcxMzAxM30.UH5hoF12NyVzyENpySmK4i1pfELpRWgjAzBIhZaSals';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- USER MANAGEMENT ---
// (Esta función no cambia)
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

// --- (¡NUEVO!) HELPER DE NOMBRES AMIGABLES ---
/**
 * Intenta analizar el User Agent para un nombre más legible.
 * @param {string} userAgent - El string de navigator.userAgent
 * @returns {string} Un nombre amigable, ej: "Chrome en Windows"
 */
function getFriendlyDeviceName(userAgent) {
    let os = 'Dispositivo';
    let browser = 'Navegador';
    const ua = userAgent.toLowerCase();

    // Detectar OS
    if (ua.includes('win')) os = 'Windows';
    else if (ua.includes('mac')) os = 'Mac';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('iphone')) os = 'iPhone';
    else if (ua.includes('ipad')) os = 'iPad';

    // Detectar Navegador
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('opr/')) browser = 'Opera';
    else if (ua.includes('chrome') && !ua.includes('chromium')) browser = 'Chrome';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')) browser = 'Safari';

    return `${browser} en ${os}`;
}


// --- LICENSE ACTIVATION & VALIDATION ---
window.activateLicense = async function(licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'Could not get a user session.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

        localStorage.setItem('fp', deviceFingerprint);

        const deviceInfo = { userAgent: navigator.userAgent, platform: navigator.platform };
        
        // --- ¡CAMBIO AQUÍ! ---
        // Usamos el nuevo helper para el nombre
        const friendlyName = getFriendlyDeviceName(navigator.userAgent);

        const { data, error } = await supabaseClient.rpc(
            'activate_license_on_device', {
                license_key_param: licenseKey,
                user_id_param: user.id,
                device_fingerprint_param: deviceFingerprint,
                device_name_param: friendlyName, // <-- Nombre amigable
                device_info_param: deviceInfo
            }
        );
        // --- FIN DEL CAMBIO ---

        if (error) throw error;

        if (data && data.success) {
            const { data: licenseDetails, error: verifyError } = await supabaseClient.rpc(
                'verify_device_license', {
                    user_id_param: user.id,
                    device_fingerprint_param: deviceFingerprint
                }
            );
            if (verifyError) throw verifyError;
            return { valid: true, message: data.message, details: licenseDetails };
        } else {
            return { valid: false, message: data.error || 'License activation failed.' };
        }
    } catch (error) {
        console.error('Error during license activation:', error);
        return { valid: false, message: `Client-side error: ${error.message}` };
    }
};

window.revalidateLicense = async function() {
    // (Esta función no cambia)
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
        return { valid: false, message: error.message };
    }
};

window.deactivateCurrentDevice = async function(licenseKey) {
    // (Esta función no cambia)
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

// --- BUSINESS PROFILE MANAGEMENT ---
// (Estas funciones no cambian)

window.getBusinessCategories = async function() {
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

window.saveBusinessProfile = async function(licenseKey, profileData) {
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

window.getBusinessProfile = async function() {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };
        const { data, error } = await supabaseClient
            .from('business_profiles')
            .select('*')
            .eq('user_id', user.id)
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

// --- (¡MODIFICADO!) DEVICE SELF-MANAGEMENT ---

window.getLicenseDevices = async function(licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };

        // --- ¡CAMBIO AQUÍ! ---
        // Obtenemos la huella actual para pasarla a la función SQL
        let deviceFingerprint = localStorage.getItem('fp');
        if (!deviceFingerprint) {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            deviceFingerprint = result.visitorId;
            localStorage.setItem('fp', deviceFingerprint);
        }
        // --- FIN DEL CAMBIO ---

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

window.deactivateDeviceById = async function(deviceId) {
    // (Esta función no cambia)
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
window.createFreeTrial = async function() {
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'No se pudo obtener la sesión del usuario.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;
        
        // (Guardamos la huella para futuras revalidaciones)
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
        
        // La función SQL devuelve {success: true/false, details: {...}, error: "..."}
        return data; 

    } catch (error) {
        console.error('Error al crear la prueba gratuita:', error);
        return { success: false, error: `Error del cliente: ${error.message}` };
    }
};