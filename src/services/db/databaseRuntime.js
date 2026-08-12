import { getActiveTenantDatabase, getActiveTenantRuntime } from './tenantRuntimeRouter';
import { getActiveNativeOpenOperations } from './indexedDbPreflight';
import { getActiveIndexedDbPreflightOperations } from './indexedDbPreflightCoordinator';

export const prepareLocalDatabase = async () => {
  const database = getActiveTenantDatabase();
  if (!database.isOpen()) await database.open();
  return { ready: true, databaseName: database.name, runtime: getActiveTenantRuntime() };
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
