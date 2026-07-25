import { DB_NAME } from '../../config/dbConfig';
import Logger from '../Logger';
import { db, STORES } from './dexie';
import { registerCanonicalDexieExtensions } from './databaseSchema';
import {
  buildPrimaryKeyMismatchDiagnostic,
  getActiveNativeOpenOperations,
  preflightAndRepairIndexedDb
} from './indexedDbPreflight';
import {
  DATABASE_RECOVERY_CODES,
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  createDatabaseRecoveryError,
  getDatabaseRecoveryState,
  isDatabaseRecoveryPending,
  reportStructuralDatabaseErrorOnce,
  setDatabaseRecoveryState
} from './databaseRecoveryState';

const OPEN_PATCH = Symbol.for('lanzo.database.open.patch');
let preparationPromise = null;
let lastPreparationResult = null;

registerCanonicalDexieExtensions(db, STORES);

const toRecoveryDiagnostic = (error, fallback = {}) => {
  const classification = classifyDatabaseError(error);
  const embedded = error?.diagnostic || error?.cause?.diagnostic || null;
  if (embedded) return embedded;

  return {
    status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
    errorCode: classification.code || DATABASE_RECOVERY_CODES.NOT_INSPECTABLE,
    databaseName: DB_NAME,
    affectedStores: fallback.affectedStores || [],
    existingKeyPaths: fallback.existingKeyPaths || {},
    expectedKeyPaths: fallback.expectedKeyPaths || {},
    isRetryable: classification.retryable !== false,
    requiresMigration: classification.requiresMigration === true,
    message: classification.code === DATABASE_RECOVERY_CODES.BLOCKED
      ? 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo; la operación continuará cuando esa conexión se cierre.'
      : 'La base local necesita actualizarse antes de continuar. Tus datos no serán eliminados automáticamente.'
  };
};

const setMigrationProgress = (progress = {}) => {
  setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.MIGRATING,
    databaseName: DB_NAME,
    affectedStores: ['sales', 'deleted_sales'],
    existingKeyPaths: { sales: 'timestamp', deleted_sales: 'timestamp' },
    expectedKeyPaths: { sales: 'id', deleted_sales: 'id' },
    isRetryable: true,
    requiresMigration: true,
    message: 'Actualizando la base local de forma segura...',
    migration: {
      phase: progress.phase || 'preparing',
      sourceCounts: progress.sourceCounts || {},
      targetCounts: progress.targetCounts || {}
    }
  });
};

export const prepareLocalDatabase = ({ force = false } = {}) => {
  if (preparationPromise) return preparationPromise;

  if (!force && lastPreparationResult?.ready && !isDatabaseRecoveryPending()) {
    return Promise.resolve(lastPreparationResult);
  }

  if (!force && isDatabaseRecoveryPending()) {
    return Promise.reject(createDatabaseRecoveryError(getDatabaseRecoveryState()));
  }

  setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.CHECKING,
    databaseName: DB_NAME,
    isRetryable: true
  });

  preparationPromise = (async () => {
    try {
      const initial = await preflightAndRepairIndexedDb({
        databaseName: DB_NAME,
        onProgress: setMigrationProgress,
        onBlocked: (blockedError) => {
          const diagnostic = toRecoveryDiagnostic(blockedError);
          setDatabaseRecoveryState({
            ...diagnostic,
            status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
            errorCode: DATABASE_RECOVERY_CODES.BLOCKED,
            message: 'La base local está bloqueada por otra pestaña. La misma operación continuará cuando esa conexión se cierre.'
          });
        }
      });

      if (initial?.migrated) {
        setMigrationProgress({
          phase: initial.marker?.phase || 'rebuild_complete',
          sourceCounts: initial.sourceCounts || {},
          targetCounts: initial.targetCounts || {}
        });
      }

      lastPreparationResult = {
        ready: true,
        migrated: initial?.migrated === true,
        inspection: initial?.inspection || null,
        marker: initial?.marker || null,
        sourceCounts: initial?.sourceCounts || {},
        targetCounts: initial?.targetCounts || {}
      };

      setDatabaseRecoveryState({
        status: DATABASE_RECOVERY_STATUS.READY,
        databaseName: DB_NAME,
        affectedStores: initial?.migrated ? ['sales', 'deleted_sales'] : [],
        isRetryable: true,
        requiresMigration: false,
        message: initial?.migrated
          ? 'La base local se actualizó conservando los datos.'
          : null,
        migration: initial?.migrated
          ? {
              phase: initial.marker?.phase || 'rebuild_complete',
              sourceCounts: initial.sourceCounts || {},
              targetCounts: initial.targetCounts || {}
            }
          : null
      });

      return lastPreparationResult;
    } catch (error) {
      const diagnostic = toRecoveryDiagnostic(error);
      const status = diagnostic.isRetryable === false
        ? DATABASE_RECOVERY_STATUS.FAILED
        : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED;
      setDatabaseRecoveryState({ ...diagnostic, status });
      reportStructuralDatabaseErrorOnce(error, 'preflight');
      throw createDatabaseRecoveryError({ ...diagnostic, status }, error);
    } finally {
      preparationPromise = null;
    }
  })();

  return preparationPromise;
};

export const isLocalDatabasePreparationActive = () => (
  Boolean(preparationPromise) || getActiveNativeOpenOperations().length > 0
);

export const retryLocalDatabaseRecovery = async () => {
  if (preparationPromise) return preparationPromise;
  lastPreparationResult = null;
  if (db.isOpen()) db.close();
  const result = await prepareLocalDatabase({ force: true });
  await db.open();
  if (!db.isOpen() || getDatabaseRecoveryState().status !== DATABASE_RECOVERY_STATUS.READY) {
    throw createDatabaseRecoveryError({
      status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
      errorCode: DATABASE_RECOVERY_CODES.NOT_INSPECTABLE,
      databaseName: DB_NAME,
      isRetryable: true,
      requiresMigration: false,
      message: 'La base local no alcanzó un estado listo después del reintento.'
    });
  }
  return result;
};

export const ensureLocalDatabaseReady = async () => {
  await prepareLocalDatabase();
  if (!db.isOpen()) await db.open();
  return db;
};

export const markDatabasePrimaryKeyMismatch = (inspection) => {
  const diagnostic = buildPrimaryKeyMismatchDiagnostic(inspection);
  setDatabaseRecoveryState(diagnostic);
  return createDatabaseRecoveryError(diagnostic);
};

if (!db[OPEN_PATCH]) {
  const nativeDexieOpen = db.open.bind(db);
  Object.defineProperty(db, OPEN_PATCH, { value: nativeDexieOpen });

  db.open = async (...args) => {
    try {
      await prepareLocalDatabase();
      return await nativeDexieOpen(...args);
    } catch (error) {
      const classification = classifyDatabaseError(error);
      if (classification.structural) {
        const diagnostic = toRecoveryDiagnostic(error);
        setDatabaseRecoveryState({
          ...diagnostic,
          status: diagnostic.isRetryable === false
            ? DATABASE_RECOVERY_STATUS.FAILED
            : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
        });
        reportStructuralDatabaseErrorOnce(error, 'dexie-open');
      }
      throw error;
    }
  };

  db.on('blocked', () => {
    const diagnostic = {
      status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
      errorCode: DATABASE_RECOVERY_CODES.BLOCKED,
      databaseName: DB_NAME,
      affectedStores: [],
      existingKeyPaths: {},
      expectedKeyPaths: {},
      isRetryable: true,
      requiresMigration: false,
      message: 'La base local está bloqueada por otra pestaña. Cierra las demás pestañas; la operación continuará cuando se libere.'
    };
    setDatabaseRecoveryState(diagnostic);
    Logger.warn('[LocalDB/Recovery] Upgrade bloqueado por otra conexión.');
  });
}

export const getLocalDatabaseRuntimeState = () => ({
  recovery: getDatabaseRecoveryState(),
  preparation: lastPreparationResult,
  activeNativeOperations: getActiveNativeOpenOperations(),
  isOpen: db.isOpen()
});

export { db };
