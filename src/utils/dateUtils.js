/**
 * Utilidades de fecha estrictas para manejo determinista de fechas calendario.
 * 
 * FASE 2: Fechas Estrictas, UTC y Determinismo
 * El uso de new Date() como fallback encubre errores de entrada de datos y las 
 * conversiones ISO nativas en el navegador alteran las fechas de caducidad debido 
 * a los offsets de zona horaria local.
 * 
 * FASE 4: Sistema Temporal Determinista
 * - Timestamps unificados para operaciones transaccionales
 * - Parseo estricto de fechas para FEFO
 * - UTC estricto sin conversiones de zona horaria
 *
 * FASE CAD.1: Bloqueo real de caducidad por lote
 * - Comparación por día calendario, no por hora exacta
 * - Un lote que caduca hoy sigue siendo vendible hoy
 */

/**
 * Genera un timestamp ISO UTC que servirá como "momento oficial" de una operación.
 * Todas las entidades modificadas en la misma operación deben usar este timestamp.
 * 
 * @returns {string} Timestamp ISO UTC
 */
export const getOperationTimestamp = () => new Date().toISOString();

/**
 * Wrapper para operaciones transaccionales que inyecta timestamp unificado.
 * 
 * @param {Function} operationFn - Función que recibe el timestamp unificado
 * @returns {Promise<any>} Resultado de la operación
 */
export const withUnifiedTimestamp = async (operationFn) => {
    const timestamp = getOperationTimestamp();
    return await operationFn(timestamp);
};

/**
 * Parsea una fecha de input tipo YYYY-MM-DD a ISO string UTC a las 00:00:00.
 * Trata la fecha como "Fecha Calendario Absoluta" sin conversiones de zona horaria.
 * 
 * @param {string} dateString - Fecha en formato YYYY-MM-DD
 * @returns {string|null} Fecha en formato ISO UTC o null si no hay fecha
 * @throws {Error} Si el formato de fecha es inválido
 */
export const parseStrictCalendarDate = (dateString) => {
    if (!dateString) return null;
    
    const parts = dateString.split('-');
    if (parts.length !== 3) {
        throw new Error('Formato de fecha inválido. Se requiere YYYY-MM-DD');
    }
    
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    
    if (!year || !month || !day) {
        throw new Error('Formato de fecha inválido. Se requiere YYYY-MM-DD');
    }
    if (year < 1900 || year > 2100) {
        throw new Error(`Año inválido: ${year}`);
    }
    if (month < 1 || month > 12) {
        throw new Error(`Mes inválido: ${month}`);
    }
    if (day < 1 || day > 31) {
        throw new Error(`Día inválido: ${day}`);
    }
    
    const utcTimestamp = Date.UTC(year, month - 1, day, 0, 0, 0);
    const date = new Date(utcTimestamp);
    
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Fecha inválida: ${dateString}`);
    }
    
    return date.toISOString();
};

/**
 * Parseo estricto de fechas para estrategia FEFO (First Expired First Out).
 * Valida el formato antes de ordenar y normaliza a UTC midnight.
 * 
 * @param {string|Date|null} value - Valor a parsear (ISO string, YYYY-MM-DD, o Date)
 * @returns {Date|null} Objeto Date en UTC o null si es inválido
 */
export const parseDateStrict = (value) => {
    if (!value) return null;
    
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value;
    }
    
    try {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const isoString = parseStrictCalendarDate(value);
            return new Date(isoString);
        }
        
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            console.warn(`[DATE STRICT] Fecha inválida detectada: ${value}`);
            return null;
        }
        
        const isMidnightUTC = date.getUTCHours() === 0 && 
                              date.getUTCMinutes() === 0 && 
                              date.getUTCSeconds() === 0 &&
                              date.getUTCMilliseconds() === 0;
        
        if (!isMidnightUTC) {
            console.warn(`[DATE STRICT] Fecha con componente de tiempo detectada: ${value}. ` +
                        'Esperado: fecha calendario pura (YYYY-MM-DD).');
        }
        
        return date;
    } catch (error) {
        console.warn(`[DATE STRICT] Error parseando fecha "${value}":`, error.message);
        return null;
    }
};

/**
 * Extrae la fecha calendario (YYYY-MM-DD) de un ISO string UTC.
 * Útil para mostrar fechas en inputs de tipo date.
 * 
 * @param {string} isoString - Fecha en formato ISO
 * @returns {string|null} Fecha en formato YYYY-MM-DD o null
 */
export const extractCalendarDate = (isoString) => {
    if (!isoString) return null;
    
    try {
        if (typeof isoString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
            return isoString;
        }

        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return null;
        
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    } catch {
        return null;
    }
};

/**
 * Compara dos fechas calendario (solo año, mes, día).
 * Ignora la hora y la zona horaria.
 * 
 * @param {string} dateA - Primera fecha en formato ISO
 * @param {string} dateB - Segunda fecha en formato ISO
 * @returns {number} -1 si A < B, 0 si A === B, 1 si A > B
 */
export const compareCalendarDates = (dateA, dateB) => {
    if (!dateA && !dateB) return 0;
    if (!dateA) return -1;
    if (!dateB) return 1;
    
    const calA = extractCalendarDate(dateA);
    const calB = extractCalendarDate(dateB);
    
    if (calA === calB) return 0;
    return calA < calB ? -1 : 1;
};

/**
 * Calcula la diferencia en días entre dos fechas calendario.
 * 
 * @param {string} startDate - Fecha inicial en formato ISO
 * @param {string} endDate - Fecha final en formato ISO
 * @returns {number} Número de días de diferencia (puede ser negativo)
 */
export const daysBetween = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
        
        const diffMs = endUTC - startUTC;
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    } catch {
        return 0;
    }
};

/**
 * Verifica si una fecha calendario está vencida respecto a hoy.
 * 
 * @param {string} expiryDate - Fecha de vencimiento en formato ISO
 * @returns {boolean} true si la fecha ya venció
 */
export const isExpired = (expiryDate) => {
    if (!expiryDate) return false;
    
    const today = new Date();
    const todayISO = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
    )).toISOString();
    
    return compareCalendarDates(expiryDate, todayISO) < 0;
};

const toLocalCalendarDate = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const resolveBatchExpiryDate = (batchOrDate) => {
    if (!batchOrDate) return null;
    if (typeof batchOrDate === 'string' || batchOrDate instanceof Date) return batchOrDate;
    return batchOrDate.expiryDate ?? batchOrDate.expiry_date ?? null;
};

/**
 * Devuelve el estado de caducidad de un lote con comparación de día calendario.
 * Un lote que vence hoy no está vencido hasta mañana.
 *
 * @param {Object|string|Date|null} batchOrDate Lote o fecha de caducidad
 * @param {Date|string} now Fecha de referencia
 * @returns {'missing'|'valid'|'expires_today'|'expired'|'invalid'}
 */
export const getBatchExpiryStatus = (batchOrDate, now = new Date()) => {
    const expiryValue = resolveBatchExpiryDate(batchOrDate);
    if (!expiryValue) return 'missing';

    const expiryCalendarDate = extractCalendarDate(expiryValue);
    const todayCalendarDate = toLocalCalendarDate(now);

    if (!expiryCalendarDate || !todayCalendarDate) return 'invalid';
    if (expiryCalendarDate < todayCalendarDate) return 'expired';
    if (expiryCalendarDate === todayCalendarDate) return 'expires_today';
    return 'valid';
};

/**
 * Regla de negocio CAD.1: solo bloquea ventas cuando el producto está en STRICT
 * y el lote tiene expiryDate anterior al día actual.
 *
 * @param {Object} batch Lote local/cloud normalizado
 * @param {Object} product Producto padre
 * @param {Date|string} now Fecha de referencia
 * @returns {boolean}
 */
export const isBatchExpiredForSale = (batch, product, now = new Date()) => {
    const expirationMode = product?.expirationMode || product?.expiration_mode || 'NONE';
    if (!['STRICT', 'SHELF_LIFE'].includes(expirationMode)) return false;
    return getBatchExpiryStatus(batch, now) === 'expired';
};

/**
 * Agrega días a una fecha calendario.
 * 
 * @param {string} dateString - Fecha base en formato ISO
 * @param {number} days - Días a agregar (puede ser negativo)
 * @returns {string|null} Nueva fecha en formato ISO
 */
export const addDays = (dateString, days) => {
    if (!dateString) return null;
    
    try {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return null;
        
        const newTimestamp = date.getTime() + (days * 24 * 60 * 60 * 1000);
        return new Date(newTimestamp).toISOString();
    } catch {
        return null;
    }
};
