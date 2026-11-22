import { traceTenantRuntime } from '../diagnostics/tenantRuntimeTrace';
import { getActiveTenantDatabase, getActiveTenantRuntime, reopenAuthorizedTenantDatabase } from './tenantRuntimeRouter';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { getActiveNativeOpenOperations, subscribeNativeOpenOperations } from './indexedDbPreflight';
import {
  getActiveIndexedDbPreflightOperations,
  subscribeIndexedDbPreflightOperations
} from './indexedDbPreflightCoordinator';
import {
  DATABASE_RECOVERY_CODES,
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  getDatabaseRecoveryState,
  normalizeBrowserStorageError,
  setDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from './databaseRecoveryState';

let activePreparationCount = 0;
let failureSequence = 0;
let activityRevision = 0;
let activitySourceUnsubscribers = null;
const activityListeners = new Set();
export const DATABASE_PREPARATION_TIMEOUT_MS = 15_000;

const publishLocalDatabaseActivity = () => {
  activityRevision += 1;
  activityListeners.forEach((listener) => {
    try { listener(); } catch { /* Activity observers must not interrupt database work. */ }
  });
};

export const getLocalDatabaseActivityRevision = () => activityRevision;

export const subscribeLocalDatabaseActivity = (listener) => {
  activityListeners.add(listener);
  if (!activitySourceUnsubscribers) {
    activitySourceUnsubscribers = [
      subscribeNativeOpenOperations(publishLocalDatabaseActivity),
      subscribeIndexedDbPreflightOperations(publishLocalDatabaseActivity),
      subscribeDatabaseRecoveryState(publishLocalDatabaseActivity)
    ];
  }

  return () => {
    activityListeners.delete(listener);
    if (activityListeners.size === 0 && activitySourceUnsubscribers) {
      activitySourceUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
      activitySourceUnsubscribers = null;
    }
  };
};

const getNativeRequestState = (nativeOperations) => {
  if (nativeOperations.length === 0) return 'none';
  if (nativeOperations.length > 1) return 'multiple_active';
  return nativeOperations[0]?.state || 'none';
};

const captureRestartContext = (runtime) => {
  let actor = null;
  try {
    actor = actorRuntimeController.getState();
  } catch {
    // Context data is optional diagnostics; a missing value fails restart checks closed.
  }

  return {
    runtimeGeneration: Number.isSafeInteger(runtime?.generation) ? runtime.generation : null,
    actorGeneration: Number.isSafeInteger(actor?.generation) ? actor.generation : null,
    actorStatus: actor?.status || null
  };
};

const publishPreparationBlocked = (databaseName) => setDatabaseRecoveryState({
  status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
  errorCode: DATABASE_RECOVERY_CODES.BLOCKED,
  databaseName,
  isRetryable: true,
  message: 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo.'
});

const publishPreparationTimeout = (databaseName, ownedState) => {
  const currentState = getDatabaseRecoveryState();
  if (ownedState
    ? currentState !== ownedState || currentState.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    : currentState.status !== DATABASE_RECOVERY_STATUS.CHECKING) return;

  return setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.FAILED,
    errorCode: 'DB_TIMEOUT',
    databaseName,
    isRetryable: false,
    requiresMigration: false,
    message: 'La preparación de la base local no terminó dentro del tiempo esperado.'
  });
};

const publishPreparationFailure = (error, databaseName, {
  phase = 'unknown',
  durationMs = null,
  runtime = null,
  restartContext = null,
  ownedState = null
} = {}) => {
  const currentState = getDatabaseRecoveryState();
  if (ownedState
    ? currentState !== ownedState || ![DATABASE_RECOVERY_STATUS.READY, DATABASE_RECOVERY_STATUS.IDLE].includes(currentState.status)
    : ![DATABASE_RECOVERY_STATUS.IDLE, DATABASE_RECOVERY_STATUS.CHECKING].includes(currentState.status)) {
    return;
  }

  const browserStorageError = normalizeBrowserStorageError(error, { databaseName });
  const effectiveError = browserStorageError || error;
  const classification = classifyDatabaseError(effectiveError);
  const isOpenTimeout = classification.code === DATABASE_RECOVERY_CODES.OPEN_TIMEOUT
    || error?.name === 'DatabaseOpenTimeoutError';
  const isKnownRecovery = classification.structural && !isOpenTimeout;
  const nativeOperations = getActiveNativeOpenOperations();
  const errorType = typeof effectiveError?.name === 'string' ? effectiveError.name : 'Error';
  const isKnownDexieError = new Set([
    'DatabaseError', 'DatabaseClosedError', 'DatabaseOpenTimeoutError', 'OpenFailedError',
    'UpgradeError', 'VersionError', 'TransactionInactiveError'
  ]).has(errorType);
  const isKnownIndexedDbError = new Set([
    'AbortError', 'ConstraintError', 'DataError', 'InvalidStateError', 'NetworkError',
    'NotAllowedError', 'QuotaExceededError', 'ReadOnlyError', 'TimeoutError', 'UnknownError'
  ]).has(errorType);
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
        : 'No se pudo confirmar que la base local esté lista.'),
    failure: {
      id: ++failureSequence,
      phase,
      category: isKnownDexieError ? 'dexie' : isKnownIndexedDbError ? 'indexeddb' : 'unknown',
      errorType,
      errorCode: classification.code,
      durationMs,
      nativeRequestState: getNativeRequestState(nativeOperations),
      preflightActive: getActiveIndexedDbPreflightOperations().length > 0,
      restartContext: restartContext || captureRestartContext(runtime)
    }
  });
};

export const prepareLocalDatabase = async () => {
  // The administrative shell starts before a license/tenant is known.  It is
  // intentionally a readiness check only: opening LanzoDB1 here would turn a
  // legacy vault back into a runtime database, while requiring a tenant here
  // deadlocks the license bootstrap that is responsible for resolving one.
  activePreparationCount += 1;
  publishLocalDatabaseActivity();
  let runtime = null;
  let restartContext = null;
  let databaseName = null;
  let preparationTimeoutId = null;
  let phase = 'runtime_resolution';
  let reopen = null;
  const startTime = globalThis.performance?.now?.() ?? Date.now();
  try {
    runtime = getActiveTenantRuntime();
    restartContext = captureRestartContext(runtime);
    databaseName = runtime?.databaseName || null;
    traceTenantRuntime('prepare', 'start', runtime?.generation);
    if (!runtime) {
      setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.CHECKING });
      setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY });
      traceTenantRuntime('prepare', 'deferred');
      return { ready: true, deferredTenantRuntime: true, databaseName: null, runtime: null };
    }

    phase = 'database_resolution';
    let database;
    try {
      database = getActiveTenantDatabase();
    } catch (error) {
      if (error?.code !== 'TENANT_RUNTIME_NOT_READY') {
        setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.CHECKING, databaseName });
        throw error;
      }

      const actor = actorRuntimeController.getState();
      const isCurrent = () => {
        const currentActor = actorRuntimeController.getState();
        return currentActor.status === 'granted'
          && currentActor.generation === actor.generation
          && actor.tenant?.generation === runtime.generation
          && actor.tenant?.opaqueId === runtime.opaqueId
          && actor.tenant?.databaseName === databaseName
          && getActiveTenantRuntime()?.generation === runtime.generation;
      };
      let ownedState = getDatabaseRecoveryState();
      reopen = { isCurrent, getOwnedState: () => ownedState };
      // Keep the mounted app and its operations intact during a physical
      // reconnect. The router blocks commercial reads until validation ends.
      if (![DATABASE_RECOVERY_STATUS.READY, DATABASE_RECOVERY_STATUS.IDLE].includes(ownedState.status)) {
        traceTenantRuntime('prepare', 'rejected', runtime.generation);
        throw error;
      }

      preparationTimeoutId = setTimeout(() => {
        if (isCurrent()) ownedState = publishPreparationTimeout(databaseName, ownedState) || ownedState;
      }, DATABASE_PREPARATION_TIMEOUT_MS);

      await reopenAuthorizedTenantDatabase(runtime, isCurrent, () => {
        if (isCurrent() && getDatabaseRecoveryState() === ownedState) {
          ownedState = publishPreparationBlocked(databaseName);
        }
      });
      if (!isCurrent()) throw error;
      actorRuntimeController.assertCurrent(actor);
      if (getDatabaseRecoveryState() === ownedState) {
        setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY, databaseName });
      }
      traceTenantRuntime('prepare', 'success', runtime.generation);
      return { ready: true, databaseName, runtime };
    }

    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.CHECKING, databaseName });
    preparationTimeoutId = setTimeout(
      () => publishPreparationTimeout(databaseName),
      DATABASE_PREPARATION_TIMEOUT_MS
    );
    databaseName = database.name;
    phase = 'database_state_check';
    const databaseIsOpen = database.isOpen();
    if (!databaseIsOpen) {
      phase = 'dexie_open';
      // Dexie's open promise remains pending while an older connection blocks
      // a version upgrade. Publish that native state immediately so the gate
      // can explain the lock instead of leaving its generic checking screen.
      const blockedEvent = database.on?.('blocked');
      const onBlocked = () => publishPreparationBlocked(databaseName);
      blockedEvent?.subscribe?.(onBlocked);

      try {
        await database.open();
      } finally {
        blockedEvent?.unsubscribe?.(onBlocked);
      }
    }
    phase = 'ready_confirmation';
    traceTenantRuntime('prepare', 'success', runtime.generation);
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY, databaseName });
    return { ready: true, databaseName, runtime };
  } catch (error) {
    traceTenantRuntime('prepare', 'failed', runtime?.generation);
    const endTime = globalThis.performance?.now?.() ?? Date.now();
    if (reopen && (error?.code === 'TENANT_RUNTIME_STALE_HANDLE' || !reopen.isCurrent())) throw error;
    publishPreparationFailure(error, databaseName || runtime?.databaseName || null, {
      phase,
      durationMs: Math.max(0, endTime - startTime),
      runtime,
      restartContext,
      ownedState: reopen?.getOwnedState()
    });
    throw error;
  } finally {
    if (preparationTimeoutId !== null) clearTimeout(preparationTimeoutId);
    activePreparationCount = Math.max(0, activePreparationCount - 1);
    publishLocalDatabaseActivity();
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
    hasTimedOutNativeRequest: nativeOperations.some(({ state }) => state === 'timed_out_waiting_native_settlement'),
    migrationActive: getDatabaseRecoveryState().status === DATABASE_RECOVERY_STATUS.MIGRATING
  };
};

export const isLocalDatabasePreparationActive = () => {
  const activity = getLocalDatabaseActivitySnapshot();
  return activity.preparationActive || activity.preflightActive || activity.hasActiveNativeRequest || activity.migrationActive;
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
export const getLocalDatabaseRuntimeState = () => {
  const runtime = getActiveTenantRuntime();
  try {
    return { runtime, isOpen: Boolean(runtime && getActiveTenantDatabase().isOpen()) };
  } catch (error) {
    if (error?.code !== 'TENANT_RUNTIME_NOT_READY') throw error;
    return { runtime, isOpen: false };
  }
};
