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

// --- BUSINESS PROFILE MANAGEMENT ---

/**
 * Saves or updates the business profile linked to a license.
 * @param {string} licenseKey - The user's license key.
 * @param {object} profileData - The business profile data.
 * @returns {Promise<object>} The result of the operation.
 */
window.saveBusinessProfile = async function(licenseKey, profileData) {
    try {
        const user = await getSupabaseUser();
        if (!user) return { success: false, message: 'Could not get a user session.' };

        // First, get the license ID from the license key
        const { data: license, error: licenseError } = await supabaseClient
            .from('licenses')
            .select('id')
            .eq('license_key', licenseKey)
            .single();

        if (licenseError || !license) {
            throw new Error('License not found.');
        }

        // Prepare the data to be saved, linking it to the user and license
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

        // Use upsert to either create a new profile or update an existing one
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

/**
 * Retrieves the business profile for a given user.
 * @returns {Promise<object>} The business profile data.
 */
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
            if (error.code === 'PGRST116') { // Code for "Not a single row"
                return { success: true, data: null }; // No profile found is not an error
            }
            throw error;
        }

        return { success: true, data };

    } catch (error) {
        console.error('Error getting business profile:', error);
        return { success: false, message: `Client-side error: ${error.message}` };
    }
};