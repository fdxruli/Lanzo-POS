// supabase-auth.js

// --- SUPABASE CLIENT INITIALIZATION ---
const supabaseUrl = 'https://lqnfkoorfaycapofnvlp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxbmZrb29yZmF5Y2Fwb2ZudmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNDYzODgsImV4cCI6MjA3MTYyMjM4OH0.uXkZfYGyE5n6lQWv9wM8iq6PGn2f4yhaEib9XiVgY7g';
// The global `supabase` object is available from the script loaded in index.html
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- LICENSE VALIDATION FUNCTION ---
// We attach it to the window object to make it globally available to app.js
window.validateLicenseWithSupabase = async function (licenseKey) {
    try {
        // Intento 1: Llamar a una función RPC 'validate_license'
        console.log("Intentando validación de licencia con RPC 'validate_license'...");
        const { data: rpcData, error: rpcError } = await supabaseClient
            .rpc('validate_license', {
                p_license_key: licenseKey
            });

        if (rpcError) {
            if (rpcError.code === '42P01') {
                console.warn("Función RPC 'validate_license' no encontrada. Intentando consulta directa a la tabla 'licenses'.");
            } else {
                throw rpcError;
            }
        } else {
            console.log('Respuesta de RPC recibida:', rpcData);
            if (typeof rpcData === 'object' && rpcData !== null && 'valid' in rpcData) {
                return rpcData;
            }
            return { valid: false, message: 'Respuesta de validación inesperada desde la función remota.' };
        }

        // Intento 2: Consulta directa a la tabla (fallback si la RPC no existe)
        console.log("Intentando consulta directa a la tabla 'licenses'...");
        const { data, error } = await supabaseClient
            .from('licenses')
            .select('*')
            .eq('license_key', licenseKey)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

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
        console.error('Error al validar la licencia con Supabase:', error);
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
