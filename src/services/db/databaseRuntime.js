import { getActiveTenantDatabase, getActiveTenantRuntime } from './tenantRuntimeRouter';
import { getActiveNativeOpenOperations } from './indexedDbPreflight';
import { getActiveIndexedDbPreflightOperations } from './indexedDbPreflightCoordinator';
import { DATABASE_RECOVERY_STATUS, setDatabaseRecoveryState } from './databaseRecoveryState';

export const prepareLocalDatabase = async () => {
  // The administrative shell starts before a license/tenant is known.  It is
  // intentionally a readiness check only: opening LanzoDB1 here would turn a
  // legacy vault back into a runtime database, while requiring a tenant here
  // deadlocks the license bootstrap that is responsible for resolving one.
  const runtime = getActiveTenantRuntime();
  setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.CHECKING,
    databaseName: runtime?.databaseName || null
  });

  if (!runtime) {
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY });
    return { ready: true, deferredTenantRuntime: true, databaseName: null, runtime: null };
  }

  const database = getActiveTenantDatabase();
  if (!database.isOpen()) await database.open();
  setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY, databaseName: database.name });
  return { ready: true, databaseName: database.name, runtime };
};
export const ensureLocalDatabaseReady = prepareLocalDatabase;

export const getLocalDatabaseActivitySnapshot = () => {
  const nativeOperations = getActiveNativeOpenOperations();
  const preflightOperations = getActiveIndexedDbPreflightOperations();
  return {
    preparationActive: false,
    preflightActive: preflightOperations.length > 0,
    nativeOperations,
    hasActiveNativeRequest: nativeOperations.length > 0,
    hasTimedOutNativeRequest: nativeOperations.some(({ state }) => state === 'timed_out_waiting_native_settlement')
  };
};

export const isLocalDatabasePreparationActive = () => getLocalDatabaseActivitySnapshot().hasActiveNativeRequest;
export const retryLocalDatabaseRecovery = async () => {
  const activity = getLocalDatabaseActivitySnapshot();
  if (activity.hasActiveNativeRequest) {
    const error = new Error('La solicitud nativa de IndexedDB sigue activa.');
    error.code = 'DB_OPEN_TIMEOUT';
    throw error;
  }
  return prepareLocalDatabase();
};
export const getLocalDatabaseRuntimeState = () => ({ runtime: getActiveTenantRuntime(), isOpen: Boolean(getActiveTenantRuntime()) });
