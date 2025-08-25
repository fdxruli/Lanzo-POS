// supabase-auth.js

// --- SUPABASE CLIENT INITIALIZATION ---
const supabaseUrl = 'https://lqnfkoorfaycapofnvlp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxbmZrb29yZmF5Y2Fwb2ZudmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNDYzODgsImV4cCI6MjA3MTYyMjM4OH0.uXkZfYGyE5n6lQWv9wM8iq6PGn2f4yhaEib9XiVgY7g';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- LICENSE VALIDATION FUNCTION ---
// We attach it to the window object to make it globally available to app.js
window.validateLicenseWithSupabase = async function(licenseKey) {
    try {
        // 1. Initialize FingerprintJS and get the device fingerprint
        console.log('Generating device fingerprint...');
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceFingerprint = result.visitorId;
        console.log('Device fingerprint:', deviceFingerprint);

        // 2. Call the correct RPC function with the correct parameters
        console.log('Calling RPC function: check_license_device_availability');
        const { data, error } = await supabaseClient.rpc(
            'check_license_device_availability', {
                license_key_param: licenseKey,
                device_fingerprint_param: deviceFingerprint
            }
        );

        if (error) {
            // If there's an error calling the RPC function, throw it.
            throw error;
        }

        console.log('Response from RPC:', data);

        // 3. Process the response from the RPC function
        // The SQL function returns a JSONB object with 'available' and 'error' fields.
        if (data && data.available) {
            // License is available for this device. Return a 'valid' object
            // so that app.js can handle it. We can pass through the extra info.
            return {
                valid: true,
                message: 'License is valid and available.',
                details: data // Pass along details like 'already_registered', 'remaining_slots'
            };
        } else {
            // License is not available. Return 'valid: false' and the error from the function.
            return {
                valid: false,
                message: data.error || 'License not available for this device.'
            };
        }

    } catch (error) {
        console.error('Error during license validation process:', error);
        return {
            valid: false,
            message: `Client-side error: ${error.message}`
        };
    }
};
