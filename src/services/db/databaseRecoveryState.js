import Logger from '../Logger';

export const DATABASE_RECOVERY_STATUS = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  MIGRATING: 'migrating',
  READY: 'ready',
  RECOVERY_REQUIRED: 'recovery_required',
  FAILED: 'failed'
});

export const DATABASE_RECOVERY_CODES = Object.freeze({
  PRIMARY_KEY_MISMATCH: 'DB_PRIMARY_KEY_MISMATCH',
  BLOCKED: 'DB_BLOCKED',
  OPEN_TIMEOUT: 'DB_OPEN_TIMEOUT',
  CLOSED_AFTER_STRUCTURAL_ERROR: 'DB_CLOSED_AFTER_STRUCTURAL_ERROR',
  UNSUPPORTED_VERSION: 'DB_UNSUPPORTED_NATIVE_VERSION',
  NOT_INSPECTABLE: 'DB_NOT_INSPECTABLE',
  MIGRATION_COLLISION: 'DB_MIGRATION_ID_COLLISION',
  MIGRATION_FAILED: 'DB_MIGRATION_FAILED'
});

const listeners = new Set();
const loggedFingerprints = new Set();

let state = Object.freeze({
  status: DATABASE_RECOVERY_STATUS.IDLE,
  errorCode: null,
  databaseName: null,
  affectedStores: [],
  existingKeyPaths: {},
  expectedKeyPaths: {},
  isRetryable: true,
  requiresMigration: false,
  message: null,
  migration: null
});

const sanitizeDiagnostic = (next = {}) => {
  const affectedStores = Array.isArray(next.affectedStores)
    ? [...new Set(next.affectedStores.filter((value) => typeof value === 'string'))]
    : [];

  const pickKeyPaths = (value) => Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([store]) => affectedStores.includes(store))
      .map(([store, keyPath]) => [store, keyPath ?? null])
  );

  return {
    status: next.status || DATABASE_RECOVERY_STATUS.IDLE,
    errorCode: typeof next.errorCode === 'string' ? next.errorCode : null,
    databaseName: typeof next.databaseName === 'string' ? next.databaseName : null,
    affectedStores,
    existingKeyPaths: pickKeyPaths(next.existingKeyPaths),
    expectedKeyPaths: pickKeyPaths(next.expectedKeyPaths),
    isRetryable: next.isRetryable !== false,
    requiresMigration: next.requiresMigration === true,
    message: typeof next.message === 'string' ? next.message : null,
    migration: next.migration && typeof next.migration === 'object'
      ? {
          phase: next.migration.phase || null,
          sourceCounts: { ...(next.migration.sourceCounts || {}) },
          targetCounts: { ...(next.migration.targetCounts || {}) }
        }
      : null
  };
};

export const getDatabaseRecoveryState = () => state;

export const setDatabaseRecoveryState = (next) => {
  state = Object.freeze(sanitizeDiagnostic(next));
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      Logger.warn('[LocalDB/Recovery] Listener falló:', error?.message || error);
    }
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lanzo:database-recovery-state', { detail: state }));
  }

  return state;
};

export const subscribeDatabaseRecoveryState = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const clearDatabaseRecoveryState = () => setDatabaseRecoveryState({
  status: DATABASE_RECOVERY_STATUS.IDLE
});

const walkErrorChain = (error) => {
  const chain = [];
  const visited = new Set();
  let current = error;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = current.inner || current.cause || current.originalError || null;
  }

  return chain;
};

export const classifyDatabaseError = (error) => {
  const chain = walkErrorChain(error);
  const names = chain.map((item) => String(item?.name || '')).join(' ');
  const messages = chain.map((item) => String(item?.message || '')).join(' ');
  const explicitCode = chain.find((item) => typeof item?.code === 'string')?.code || null;

  if (explicitCode === DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH) {
    return { structural: true, code: explicitCode, retryable: true, requiresMigration: true };
  }

  if (explicitCode === DATABASE_RECOVERY_CODES.BLOCKED || /BlockedError|DatabaseBlocked/i.test(names + messages)) {
    return { structural: true, code: DATABASE_RECOVERY_CODES.BLOCKED, retryable: true, requiresMigration: false };
  }

  if (/UpgradeError/i.test(names) || /changing primary key|primary key/i.test(messages)) {
    return {
      structural: true,
      code: DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH,
      retryable: true,
      requiresMigration: true
    };
  }

  if (/DatabaseClosedError/i.test(names) && /UpgradeError|changing primary key/i.test(messages)) {
    return {
      structural: true,
      code: DATABASE_RECOVERY_CODES.CLOSED_AFTER_STRUCTURAL_ERROR,
      retryable: true,
      requiresMigration: true
    };
  }

  if (/DatabaseOpenTimeoutError/i.test(names) || explicitCode === DATABASE_RECOVERY_CODES.OPEN_TIMEOUT) {
    return { structural: true, code: DATABASE_RECOVERY_CODES.OPEN_TIMEOUT, retryable: true, requiresMigration: false };
  }

  if (explicitCode && Object.values(DATABASE_RECOVERY_CODES).includes(explicitCode)) {
    return {
      structural: true,
      code: explicitCode,
      retryable: explicitCode !== DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      requiresMigration: explicitCode === DATABASE_RECOVERY_CODES.MIGRATION_FAILED
    };
  }

  return { structural: false, code: explicitCode, retryable: true, requiresMigration: false };
};

export const isStructuralDatabaseError = (error) => classifyDatabaseError(error).structural;

export const createDatabaseRecoveryError = (diagnostic, cause = null) => {
  const error = new Error(
    diagnostic?.message || 'La base local necesita recuperación antes de continuar.',
    cause ? { cause } : undefined
  );
  error.name = diagnostic?.errorCode === DATABASE_RECOVERY_CODES.BLOCKED
    ? 'DatabaseBlockedError'
    : 'LocalDatabaseRecoveryError';
  error.code = diagnostic?.errorCode || DATABASE_RECOVERY_CODES.NOT_INSPECTABLE;
  error.diagnostic = sanitizeDiagnostic(diagnostic);
  error.inner = cause || null;
  return error;
};

export const reportStructuralDatabaseErrorOnce = (error, context = 'unknown') => {
  const classification = classifyDatabaseError(error);
  if (!classification.structural) return false;

  const fingerprint = `${classification.code}:${context}`;
  if (loggedFingerprints.has(fingerprint)) return true;
  loggedFingerprints.add(fingerprint);

  Logger.error('[LocalDB/Recovery] Error estructural detectado', {
    code: classification.code,
    context
  });
  return true;
};

export const isDatabaseRecoveryPending = () => (
  state.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED ||
  state.status === DATABASE_RECOVERY_STATUS.FAILED ||
  state.status === DATABASE_RECOVERY_STATUS.MIGRATING
);
