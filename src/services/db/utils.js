import Dexie from 'dexie';
import Logger from '../Logger'; 
// Asegúrate de que la ruta a Logger sea correcta (../../services/Logger si estamos en services/db)
// Asumo que Logger.js está en src/services/Logger.js, así que desde src/services/db/utils.js sería:
// import Logger from '../Logger'; 

// ============================================================
// CLASES DE ERROR (Compatibilidad con tu sistema actual)
// ============================================================

export class DatabaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export const DB_ERROR_CODES = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_STATE: 'INVALID_STATE',
  NOT_FOUND: 'NOT_FOUND',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  TRANSACTION_INACTIVE: 'TRANSACTION_INACTIVE',
  VERSION_ERROR: 'VERSION_ERROR',
  BLOCKED: 'BLOCKED',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR', // Agregado explícitamente
  UNKNOWN: 'UNKNOWN'
};

// ============================================================
// MANEJO DE ERRORES DEXIE
// ============================================================

/**
 * Convierte errores nativos de Dexie/IndexedDB en DatabaseError controlados.
 */
export function handleDexieError(error, context = '') {
  let errorCode = DB_ERROR_CODES.UNKNOWN;
  let userMessage = 'Ocurrió un error inesperado en la base de datos.';
  let actionable = null;

  const errName = error.name || '';
  const errMsg = error.message || '';

  // Mapeo de errores específicos de Dexie
  if (error instanceof Dexie.QuotaExceededError || errName === 'QuotaExceededError') {
    errorCode = DB_ERROR_CODES.QUOTA_EXCEEDED;
    userMessage = '💾 Espacio lleno. Libera espacio o realiza un respaldo.';
    actionable = 'SUGGEST_BACKUP';
  } 
  else if (error instanceof Dexie.VersionError || errName === 'VersionError') {
    errorCode = DB_ERROR_CODES.VERSION_ERROR;
    userMessage = '⚠️ Base de datos desactualizada. Recarga la página.';
    actionable = 'SUGGEST_RELOAD';
  }
  else if (error instanceof Dexie.ConstraintError || errName === 'ConstraintError') {
    errorCode = DB_ERROR_CODES.CONSTRAINT_VIOLATION;
    userMessage = '⚠️ Duplicado: Ya existe un registro con este ID o Código.';
    actionable = 'SUGGEST_EDIT';
  }
  else if (error instanceof Dexie.TransactionInactiveError || errName === 'TransactionInactiveError') {
    errorCode = DB_ERROR_CODES.TRANSACTION_INACTIVE;
    userMessage = '⚠️ La operación se canceló o expiró. Intenta de nuevo.';
  }
  else if (errMsg.includes('TIMEOUT')) {
    errorCode = DB_ERROR_CODES.TIMEOUT;
    userMessage = '⏱️ La operación tardó demasiado.';
  }

  // Log técnico
  Logger.error(`[DB_ERROR:${errorCode}] ${context}`, {
    originalError: error,
    message: errMsg,
    stack: error.stack
  });

  return new DatabaseError(errorCode, userMessage, {
    context,
    originalError: errMsg,
    actionable
  });
}

// ============================================================
// VALIDACIÓN ZOD GENERICA
// ============================================================

/**
 * Valida datos usando un esquema Zod.
 * Si falla, lanza un DatabaseError con formato amigable.
 * Si pasa, retorna los datos parseados (limpios/transformados).
 * * @param {object} schema - Esquema Zod
 * @param {any} data - Datos a validar
 * @param {string} context - Contexto para el log (ej: "Product Save")
 */
export function validateOrThrow(schema, data, context = 'Validation') {
  if (!schema) return data; // Si no hay esquema, pasamos los datos tal cual (bypass)

  try {
    return schema.parse(data);
  } catch (error) {
    if (error.name === 'ZodError') {
      Logger.warn(`⚠️ Validación fallida (${context}):`, error);

      let message = "Datos inválidos";
      const issues = error.errors || error.issues;

      // Extracción inteligente del mensaje de error (Tu lógica original mejorada)
      if (issues && issues.length > 0) {
        const first = issues[0];
        const path = first.path.length > 0 ? first.path.join(' > ') : 'Campo';
        message = `${path}: ${first.message}`;
      } else {
        message = error.message;
      }

      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_ERROR, message, {
        originalError: error,
        actionable: 'CHECK_FORM'
      });
    }
    throw error; // Re-lanzar si no es ZodError
  }
}