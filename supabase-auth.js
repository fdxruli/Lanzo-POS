// supabase-auth.js

// --- SUPABASE CLIENT INITIALIZATION ---
const supabaseUrl = 'https://lqnfkoorfaycapofnvlp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxbmZrb29yZmF5Y2Fwb2ZudmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNDYzODgsImV4cCI6MjA3MTYyMjM4OH0.uXkZfYGyE5n6lQWv9wM8iq6PGn2f4yhaEib9XiVgY7g';
// The global `supabase` object is available from the script loaded in index.html
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- LICENSE VALIDATION FUNCTION ---
// We attach it to the window object to make it globally available to app.js
window.validateLicenseWithSupabase = async function(licenseKey) {
    try {
        // Intento 1: Llamar a una función RPC 'validate_license'
        console.log("Intentando validación de licencia con RPC 'validate_license'...");
        const { data: rpcData, error: rpcError } = await supabaseClient
            .rpc('validate_license', {
                license_key: licenseKey // Reverted to use 'license_key' as hinted by the server
            });

        // If the RPC call is successful and returns a valid-looking object, we use its result.
        if (!rpcError && typeof rpcData === 'object' && rpcData !== null && 'valid' in rpcData) {
            console.log('Respuesta de RPC recibida y procesada:', rpcData);
            return rpcData;
        }

        // If the RPC call failed for any reason (e.g., ambiguity error, not found) or returned
        // unexpected data, we log the issue and proceed to the more reliable fallback method.
        if (rpcError) {
            console.warn(`La llamada RPC falló (error: ${rpcError.message}). Se intentará el método de consulta directa como fallback.`);
        }

        // Intento 2: Consulta directa a la tabla (fallback)
        console.log("Intentando consulta directa a la tabla 'licenses'...");
        const { data, error } = await supabaseClient
            .from('licenses')
            .select('*')
            .eq('license_key', licenseKey)
            .single();

        // If the direct query returns an error (and it's not the "0 rows found" error), throw it.
        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        // If the direct query found no data, the license is not valid.
        if (!data) {
            return { valid: false, message: 'Licencia no encontrada.' };
        }
        
        const license = data;
        const now = new Date();
        const expiresAt = new Date(license.expires_at);

        if (license.status === 'active' && expiresAt > now) {
            return {
                valid: true,
                key: license.license_key,
                type: license.license_type,
                maxDevices: license.max_devices,
                expiresAt: license.expires_at,
                productName: license.product_name,
                version: license.version,
                features: license.features
            };
        } else {
            return {
                valid: false,
                message: license.status !== 'active' ? `Licencia ${license.status}.` : 'Licencia expirada.'
            };
        }

    } catch (error) {
        console.error('Error final al validar la licencia con Supabase:', error);
        let userMessage = 'Error al conectar con el servidor de licencias. Intente nuevamente.';
        if (error.message.includes('fetch') || error.message.includes('network')) {
            userMessage = 'No se pudo conectar al servidor. Verifique su conexión a internet.';
        } else if (error.message.includes('JWT')) {
            userMessage = 'La clave de API no es válida. Contacte al soporte.';
        } else if (error.code === 'PGRST000' || error.code === '42P01') {
             userMessage = 'Error de configuración del servidor. No se puede acceder a los datos de licencia.';
        }
        return { valid: false, message: userMessage };
    }
};
