import { getActiveTenantDatabase, getActiveTenantRuntime } from './tenantRuntimeRouter';
import { getActiveNativeOpenOperations } from './indexedDbPreflight';
import { getActiveIndexedDbPreflightOperations } from './indexedDbPreflightCoordinator';
import {
  DATABASE_RECOVERY_CODES,
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  getDatabaseRecoveryState,
  normalizeBrowserStorageError,
  setDatabaseRecoveryState
} from './databaseRecoveryState';

let activePreparationCount = 0;
export const DATABASE_PREPARATION_TIMEOUT_MS = 15_000;

const publishPreparationTimeout = (databaseName) => {
  const currentState = getDatabaseRecoveryState();
  if (currentState.status !== DATABASE_RECOVERY_STATUS.CHECKING) return;

  setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.FAILED,
    errorCode: 'DB_TIMEOUT',
    databaseName,
    isRetryable: false,
    requiresMigration: false,
    message: 'La preparación de la base local no terminó dentro del tiempo esperado.'
  });
};

const publishPreparationFailure = (error, databaseName) => {
  const currentState = getDatabaseRecoveryState();
  if (![DATABASE_RECOVERY_STATUS.IDLE, DATABASE_RECOVERY_STATUS.CHECKING].includes(currentState.status)) {
    return;
  }

  const browserStorageError = normalizeBrowserStorageError(error, { databaseName });
  const effectiveError = browserStorageError || error;
  const classification = classifyDatabaseError(effectiveError);
  const isOpenTimeout = classification.code === DATABASE_RECOVERY_CODES.OPEN_TIMEOUT
    || error?.name === 'DatabaseOpenTimeoutError';
  const isKnownRecovery = classification.structural && !isOpenTimeout;
  const errorCode = browserStorageError?.code
    || (isOpenTimeout
      ? 'DB_TIMEOUT'
      : isKnownRecovery
        ? classification.code
        : 'DB_OPERATION_FAILED');

  setDatabaseRecoveryState({
    status: browserStorageError
      ? DATABASE_RECOVERY_STATUS.FAILED
      : isKnownRecovery && classification.retryable !== false
        ? DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
        : DATABASE_RECOVERY_STATUS.FAILED,
    errorCode,
    databaseName,
    isRetryable: browserStorageError !== null
      ? true
      : isKnownRecovery && classification.retryable !== false,
    requiresMigration: isKnownRecovery && classification.requiresMigration === true,
    message: browserStorageError?.message || (isOpenTimeout
      ? 'La apertura del almacenamiento local no terminó dentro del tiempo esperado.'
      : isKnownRecovery
        ? effectiveError?.message || null
        : 'No se pudo confirmar que la base local esté lista.')
  });
};

export const prepareLocalDatabase = async () => {
  // The administrative shell starts before a license/tenant is known.  It is
  // intentionally a readiness check only: opening LanzoDB1 here would turn a
  // legacy vault back into a runtime database, while requiring a tenant here
  // deadlocks the license bootstrap that is responsible for resolving one.
  activePreparationCount += 1;
  let runtime = null;
  let databaseName = null;
  let preparationTimeoutId = null;
  try {
    runtime = getActiveTenantRuntime();
    databaseName = runtime?.databaseName || null;
    setDatabaseRecoveryState({
      status: DATABASE_RECOVERY_STATUS.CHECKING,
      databaseName
    });

    if (!runtime) {
      setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY });
      return { ready: true, deferredTenantRuntime: true, databaseName: null, runtime: null };
    }

    preparationTimeoutId = setTimeout(
      () => publishPreparationTimeout(databaseName),
      DATABASE_PREPARATION_TIMEOUT_MS
    );

    const database = getActiveTenantDatabase();
    databaseName = database.name;
    if (!database.isOpen()) {
      // Dexie's open promise remains pending while an older connection blocks
      // a version upgrade. Publish that native state immediately so the gate
      // can explain the lock instead of leaving its generic checking screen.
      const blockedEvent = database.on?.('blocked');
      const onBlocked = () => setDatabaseRecoveryState({
        status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: DATABASE_RECOVERY_CODES.BLOCKED,
        databaseName,
        isRetryable: true,
        message: 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo.'
      });
      blockedEvent?.subscribe?.(onBlocked);

      try {
        await database.open();
      } finally {
        blockedEvent?.unsubscribe?.(onBlocked);
      }
    }
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY, databaseName });
    return { ready: true, databaseName, runtime };
  } catch (error) {
    publishPreparationFailure(error, databaseName || runtime?.databaseName || null);
    throw error;
  } finally {
    if (preparationTimeoutId !== null) clearTimeout(preparationTimeoutId);
    activePreparationCount = Math.max(0, activePreparationCount - 1);
    const currentState = getDatabaseRecoveryState();
    if (
      activePreparationCount === 0
      && [DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED, DATABASE_RECOVERY_STATUS.FAILED].includes(currentState.status)
    ) {
      // Notify the gate after the in-flight marker clears so a safe action can
      // become available once the failed request has actually settled.
      setDatabaseRecoveryState(currentState);
    }
  }
};
export const ensureLocalDatabaseReady = prepareLocalDatabase;

export const getLocalDatabaseActivitySnapshot = () => {
  const nativeOperations = getActiveNativeOpenOperations();
  const preflightOperations = getActiveIndexedDbPreflightOperations();
  return {
    preparationActive: activePreparationCount > 0,
    preflightActive: preflightOperations.length > 0,
    nativeOperations,
    hasActiveNativeRequest: nativeOperations.length > 0,
    hasTimedOutNativeRequest: nativeOperations.some(({ state }) => state === 'timed_out_waiting_native_settlement')
  };
};

export const isLocalDatabasePreparationActive = () => {
  const activity = getLocalDatabaseActivitySnapshot();
  return activity.preparationActive || activity.preflightActive || activity.hasActiveNativeRequest;
};
export const retryLocalDatabaseRecovery = async () => {
  const activity = getLocalDatabaseActivitySnapshot();
  if (activity.preparationActive || activity.preflightActive || activity.hasActiveNativeRequest) {
    const error = new Error('La solicitud nativa de IndexedDB sigue activa.');
    error.code = 'DB_OPEN_TIMEOUT';
    throw error;
  }
  if (getDatabaseRecoveryState().errorCode === DATABASE_RECOVERY_CODES.BLOCKED) {
    const error = new Error('La base local sigue bloqueada por otra conexión.');
    error.code = DATABASE_RECOVERY_CODES.BLOCKED;
    throw error;
  }
  return prepareLocalDatabase();
};
export const getLocalDatabaseRuntimeState = () => ({ runtime: getActiveTenantRuntime(), isOpen: Boolean(getActiveTenantRuntime()) });
