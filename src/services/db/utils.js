import Dexie from 'dexie';
import Logger from '../Logger';

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
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN: 'UNKNOWN'
};

export const STOCK_DECIMALS = 4;

export const normalizeStock = (value) => {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Number(Math.round(num + 'e' + STOCK_DECIMALS) + 'e-' + STOCK_DECIMALS);
};

export const getCommittedStock = (record) => normalizeStock(record?.committedStock || 0);

export const getAvailableStock = (record) => {
  const physicalStock = normalizeStock(record?.stock || 0);
  const committedStock = getCommittedStock(record);
  return normalizeStock(Math.max(0, physicalStock - committedStock));
};

export function handleDexieError(error, context = '') {
  let errorCode = DB_ERROR_CODES.UNKNOWN;
  let userMessage = 'Ocurrio un error inesperado en la base de datos.';
  let actionable = null;
  let field = null;

  const errName = error.name || '';
  const errMsg = error.message || '';

  if (error instanceof Dexie.QuotaExceededError || errName === 'QuotaExceededError') {
    errorCode = DB_ERROR_CODES.QUOTA_EXCEEDED;
    userMessage = 'Espacio lleno. Libera espacio o realiza un respaldo.';
    actionable = 'SUGGEST_BACKUP';
  } else if (error instanceof Dexie.VersionError || errName === 'VersionError') {
    errorCode = DB_ERROR_CODES.VERSION_ERROR;
    userMessage = 'Base de datos desactualizada. Recarga la pagina.';
    actionable = 'SUGGEST_RELOAD';
  } else if (error instanceof Dexie.ConstraintError || errName === 'ConstraintError') {
    errorCode = DB_ERROR_CODES.CONSTRAINT_VIOLATION;

    const isCustomerSave = context === 'Save customers';
    if (isCustomerSave) {
      userMessage = 'El telefono ya esta registrado para otro cliente.';
      actionable = 'CHECK_FORM';
      field = 'phone';
    } else {
      userMessage = 'Duplicado: Ya existe un registro con este ID o codigo.';
      actionable = 'SUGGEST_EDIT';
    }
  } else if (error instanceof Dexie.TransactionInactiveError || errName === 'TransactionInactiveError') {
    errorCode = DB_ERROR_CODES.TRANSACTION_INACTIVE;
    userMessage = 'La operacion se cancelo o expiro. Intenta de nuevo.';
  } else if (errMsg.includes('TIMEOUT')) {
    errorCode = DB_ERROR_CODES.TIMEOUT;
    userMessage = 'La operacion tardo demasiado.';
  }

  Logger.error(`[DB_ERROR:${errorCode}] ${context}`, {
    originalError: error,
    message: errMsg,
    stack: error.stack
  });

  return new DatabaseError(errorCode, userMessage, {
    context,
    originalError: errMsg,
    actionable,
    ...(field ? { field } : {})
  });
}

export function validateOrThrow(schema, data, context = 'Validation') {
  if (!schema) return data;

  try {
    return schema.parse(data);
  } catch (error) {
    if (error.name === 'ZodError') {
      Logger.warn(`Validacion fallida (${context}):`, error);

      let message = 'Datos invalidos';
      const issues = error.errors || error.issues;

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
    throw error;
  }
}
