// --- SUPABASE CLIENT INITIALIZATION ---
const supabaseUrl = 'https://jkuceingecbynyvntcxe.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdWNlaW5nZWNieW55dm50Y3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMzcwMTMsImV4cCI6MjA3MTcxMzAxM30.UH5hoF12NyVzyENpySmK4i1pfELpRWgjAzBIhZaSals';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- USER MANAGEMENT ---
// Signs in using the single, hardcoded system user.
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

// --- LICENSE ACTIVATION & VALIDATION ---
window.activateLicense = async function(licenseKey) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'Could not get a user session.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

        const deviceInfo = { userAgent: navigator.userAgent, platform: navigator.platform };

        const { data, error } = await supabaseClient.rpc(
            'activate_license_on_device', {
                license_key_param: licenseKey,
                user_id_param: user.id,
                device_fingerprint_param: deviceFingerprint,
                device_name_param: `${navigator.platform} (${navigator.language})`,
                device_info_param: deviceInfo
            }
        );

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
    try {
        const user = await getSupabaseUser();
        if (!user) return { valid: false, message: 'No user session.' };

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

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
    try {
        const user = await getSupabaseUser();
        if (!user) throw new Error('User session not found.');

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;

        const { data, error } = await supabaseClient.rpc('deactivate_device', {
            license_key_param: licenseKey,
            device_fingerprint_param: deviceFingerprint,
            user_id_param: user.id
        });

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('Error during device deactivation:', error);
        return { success: false, message: error.message };
    }
};