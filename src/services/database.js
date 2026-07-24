/*
 * ------------------------------------------------------------------
 * DATABASE ADAPTER (BRIDGE)
 * ------------------------------------------------------------------
 * Este archivo mantiene compatibilidad con los imports históricos y garantiza
 * que el registro canónico, el preflight y la recuperación se instalen antes
 * de que cualquier consumidor intente abrir Dexie.
 */

import './db/databaseRuntime';

export * from './db';
export {
  ensureLocalDatabaseReady,
  getLocalDatabaseRuntimeState,
  prepareLocalDatabase,
  retryLocalDatabaseRecovery
} from './db/databaseRuntime';
export {
  DATABASE_RECOVERY_CODES,
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  getDatabaseRecoveryState,
  isDatabaseRecoveryPending,
  isStructuralDatabaseError,
  subscribeDatabaseRecoveryState
} from './db/databaseRecoveryState';
