import { DB_NAME } from '../../config/dbConfig';
import {
  CURRENT_NATIVE_DATABASE_VERSION,
  EXPECTED_PRIMARY_KEYS,
  NATIVE_CURRENT_STORE_DEFINITIONS,
  RECOVERY_STORES
} from './databaseSchema';
import {
  DATABASE_RECOVERY_CODES,
  createDatabaseRecoveryError
} from './databaseRecoveryState';

export const OPEN_TIMEOUT_MS = 8_000;
const RECOVERY_MARKER_KEY = 'primary-key-recovery-v1';
const REPAIRABLE_STORES = ['sales', 'deleted_sales'];
const activeNativeOpenOperations = new Map();
const nativeOperationListeners = new Set();
let activeNativeOpenOperationsSnapshot = Object.freeze([]);

const refreshNativeOpenOperationsSnapshot = () => {
  activeNativeOpenOperationsSnapshot = Object.freeze(Array.from(
    activeNativeOpenOperations.entries(),
    ([key, operation]) => Object.freeze({ key, state: operation.state })
  ));
  nativeOperationListeners.forEach((listener) => listener());
};

const setNativeOpenOperationState = (operation, state) => {
  if (operation.state === state) return;
  operation.state = state;
  refreshNativeOpenOperationsSnapshot();
};

const removeNativeOpenOperation = (operationKey, operation) => {
  if (activeNativeOpenOperations.get(operationKey) !== operation) return;
  activeNativeOpenOperations.delete(operationKey);
  refreshNativeOpenOperationsSnapshot();
};

const asArray = (value) => Array.from(value || []);

const stableKey = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, value[key]])
      )
    );
  }
  return String(value);
};

const nextHash = (current, value) => {
  let hash = current >>> 0;
  const input = stableKey(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const hashToString = (hash) => (hash >>> 0).toString(16).padStart(8, '0');
const stableHash = (value) => hashToString(nextHash(2166136261, value));

const hasValidId = (value) => (
  (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value))
);

const canonicalId = (value) => `${typeof value}:${stableKey(value)}`;

const recoveryMessage = (code) => {
  if (code === DATABASE_RECOVERY_CODES.BLOCKED) {
    return 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo; la operación continuará cuando esa conexión se cierre.';
  }
  if (code === DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH) {
    return 'Detectamos un esquema local antiguo. Lanzo preparará una migración segura conservando ventas y movimientos.';
  }
  if (code === DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION) {
    return 'La base local fue creada por una versión más reciente de Lanzo y no puede degradarse automáticamente.';
  }
  if (code === DATABASE_RECOVERY_CODES.MIGRATION_COLLISION) {
    return 'La migración detectó una colisión de identificadores y se abortó sin sobrescribir registros.';
  }
  return 'La base local necesita actualizarse antes de continuar. Tus datos no serán eliminados automáticamente.';
};

const makeDiagnostic = ({
  code,
  status = 'recovery_required',
  databaseName = DB_NAME,
  mismatches = [],
  retryable = true,
  requiresMigration = false,
  migration = null
}) => ({
  status,
  errorCode: code,
  databaseName,
  affectedStores: mismatches.map((item) => item.store),
  existingKeyPaths: Object.fromEntries(
    mismatches.map((item) => [item.store, item.existingKeyPath ?? null])
  ),
  expectedKeyPaths: Object.fromEntries(
    mismatches.map((item) => [item.store, item.expectedKeyPath ?? null])
  ),
  mismatches,
  isRetryable: retryable,
  requiresMigration,
  message: recoveryMessage(code),
  migration
});

const createMigrationError = ({
  code = DATABASE_RECOVERY_CODES.MIGRATION_FAILED,
  databaseName = DB_NAME,
  mismatches = [],
  migration = null,
  cause = null
}) => createDatabaseRecoveryError(makeDiagnostic({
  code,
  databaseName,
  mismatches,
  retryable: code !== DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
  requiresMigration: true,
  migration
}), cause);

const abortWithStructuredError = (transaction, error) => {
  if (transaction) transaction.__lanzoRecoveryError = error;
  try {
    transaction?.abort();
  } catch {
    // La transacción pudo haberse abortado antes por la solicitud que falló.
  }
};

const listExistingDatabases = async (factory) => {
  if (typeof factory?.databases !== 'function') return null;
  try {
    return await factory.databases();
  } catch {
    return null;
  }
};

const nativeOperationKey = (name, version) => `${name}:${version ?? 'current'}`;

export const openNativeDatabase = ({
  factory,
  name,
  version = undefined,
  onUpgrade = null,
  onBlocked = null,
  openTimeoutMs = OPEN_TIMEOUT_MS
}) => {
  const operationKey = nativeOperationKey(name, version);
  const existingOperation = activeNativeOpenOperations.get(operationKey);
  if (existingOperation) return existingOperation.promise;

  const operation = {
    state: 'opening',
    request: null,
    transaction: null,
    timeoutId: null,
    publicSettled: false,
    blockedNotified: false,
    promise: null
  };

  operation.promise = new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    operation.request = request;

    const clearOpenTimeout = () => {
      if (operation.timeoutId !== null) clearTimeout(operation.timeoutId);
      operation.timeoutId = null;
    };

    const finishOperation = (state) => {
      setNativeOpenOperationState(operation, state);
      clearOpenTimeout();
      removeNativeOpenOperation(operationKey, operation);
    };

    const rejectPublic = (error, finalState = 'failed') => {
      if (!operation.publicSettled) {
        operation.publicSettled = true;
        reject(error);
      }
      finishOperation(finalState);
    };

    operation.timeoutId = setTimeout(() => {
      if (operation.state !== 'opening' || operation.publicSettled) return;
      setNativeOpenOperationState(operation, 'timed_out_waiting_native_settlement');
      operation.publicSettled = true;
      reject(createDatabaseRecoveryError(makeDiagnostic({
        code: DATABASE_RECOVERY_CODES.OPEN_TIMEOUT,
        databaseName: name,
        retryable: true
      })));
      // IndexedDB no permite cancelar una solicitud open que aún no tiene
      // transacción. Conservamos la operación en el mapa hasta que termine de
      // verdad para impedir aperturas paralelas durante los reintentos.
    }, openTimeoutMs);

    request.onblocked = () => {
      if (operation.state === 'succeeded' || operation.state === 'failed' || operation.state === 'aborted') return;
      // El timeout solo liquida la promesa pública. La solicitud nativa sigue
      // viva y puede emitir onblocked después; ese evento tardío no debe
      // reemplazar el diagnóstico DB_OPEN_TIMEOUT ni volver a notificar la UI.
      if (operation.publicSettled) return;
      setNativeOpenOperationState(operation, 'blocked');
      clearOpenTimeout();
      if (!operation.blockedNotified) {
        operation.blockedNotified = true;
        const blockedError = createDatabaseRecoveryError(makeDiagnostic({
          code: DATABASE_RECOVERY_CODES.BLOCKED,
          databaseName: name,
          retryable: true
        }));
        onBlocked?.(blockedError);
      }
      // No se rechaza: la misma solicitud continúa cuando la conexión
      // bloqueante se cierre. Así no se duplica backup/rebuild.
    };

    request.onerror = () => {
      const structuredError = operation.transaction?.__lanzoRecoveryError;
      const error = structuredError || request.error || new Error(`No se pudo abrir ${name}.`);
      rejectPublic(error, operation.transaction?.error?.name === 'AbortError' ? 'aborted' : 'failed');
    };

    request.onupgradeneeded = (event) => {
      setNativeOpenOperationState(operation, 'upgrading');
      clearOpenTimeout();
      operation.transaction = request.transaction;
      try {
        onUpgrade?.({
          database: request.result,
          transaction: request.transaction,
          oldVersion: event.oldVersion,
          newVersion: event.newVersion
        });
      } catch (error) {
        abortWithStructuredError(request.transaction, error);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      if (operation.publicSettled) {
        database.close();
        finishOperation('succeeded');
        return;
      }
      operation.publicSettled = true;
      finishOperation('succeeded');
      resolve(database);
    };
  });

  activeNativeOpenOperations.set(operationKey, operation);
  refreshNativeOpenOperationsSnapshot();
  return operation.promise;
};

export const getActiveNativeOpenOperations = () => activeNativeOpenOperationsSnapshot;

export const subscribeNativeOpenOperations = (listener) => {
  nativeOperationListeners.add(listener);
  return () => nativeOperationListeners.delete(listener);
};

export const resetIndexedDbPreflightForTests = () => {
  activeNativeOpenOperations.forEach((operation) => {
    if (operation.timeoutId !== null) clearTimeout(operation.timeoutId);
    try {
      operation.transaction?.abort();
    } catch {
      // Best effort exclusivo para aislamiento de pruebas.
    }
  });
  if (activeNativeOpenOperations.size > 0) {
    activeNativeOpenOperations.clear();
    refreshNativeOpenOperationsSnapshot();
  }
};

const inspectOpenDatabase = (database, { createdByInspection = false } = {}) => {
  const stores = {};
  const storeNames = asArray(database.objectStoreNames);

  if (storeNames.length > 0) {
    const transaction = database.transaction(storeNames, 'readonly');
    storeNames.forEach((storeName) => {
      const objectStore = transaction.objectStore(storeName);
      stores[storeName] = {
        storeName,
        keyPath: objectStore.keyPath ?? null,
        autoIncrement: objectStore.autoIncrement === true,
        indexNames: asArray(objectStore.indexNames)
      };
    });
  }

  const mismatches = REPAIRABLE_STORES
    .filter((storeName) => stores[storeName])
    .filter((storeName) => stores[storeName].keyPath !== EXPECTED_PRIMARY_KEYS[storeName])
    .map((storeName) => ({
      store: storeName,
      existingKeyPath: stores[storeName].keyPath,
      expectedKeyPath: EXPECTED_PRIMARY_KEYS[storeName]
    }));

  let classification = 'compatible';
  if (database.version > CURRENT_NATIVE_DATABASE_VERSION) classification = 'unsupported_newer';
  else if (createdByInspection || storeNames.length === 0) classification = 'new';
  else if (mismatches.length > 0) classification = 'primary_key_incompatible';
  else if (database.version < CURRENT_NATIVE_DATABASE_VERSION) classification = 'compatible_outdated';

  return {
    databaseName: database.name,
    nativeVersion: database.version,
    classification,
    createdByInspection,
    stores,
    mismatches
  };
};

export const inspectIndexedDbStructure = async ({
  factory = globalThis.indexedDB,
  databaseName = DB_NAME,
  onBlocked = null,
  openTimeoutMs = OPEN_TIMEOUT_MS
} = {}) => {
  if (!factory) {
    throw createDatabaseRecoveryError(makeDiagnostic({
      code: DATABASE_RECOVERY_CODES.NOT_INSPECTABLE,
      databaseName,
      retryable: false
    }));
  }

  const knownDatabases = await listExistingDatabases(factory);
  const knownEntry = knownDatabases?.find((entry) => entry?.name === databaseName);
  const definitelyMissing = Array.isArray(knownDatabases) && !knownEntry;
  let createdByInspection = false;

  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    onBlocked,
    openTimeoutMs,
    onUpgrade: ({ oldVersion }) => {
      createdByInspection = oldVersion === 0 && definitelyMissing !== false;
    }
  });

  try {
    database.onversionchange = () => database.close();
    return inspectOpenDatabase(database, {
      createdByInspection: definitelyMissing || createdByInspection
    });
  } finally {
    database.close();
  }
};

const createRecoveryStores = (database) => {
  if (!database.objectStoreNames.contains(RECOVERY_STORES.SALES_BACKUP)) {
    database.createObjectStore(RECOVERY_STORES.SALES_BACKUP, { keyPath: 'legacyKey' })
      .createIndex('sourceKey', 'sourceKey');
  }
  if (!database.objectStoreNames.contains(RECOVERY_STORES.DELETED_SALES_BACKUP)) {
    database.createObjectStore(RECOVERY_STORES.DELETED_SALES_BACKUP, { keyPath: 'legacyKey' })
      .createIndex('sourceKey', 'sourceKey');
  }
  if (!database.objectStoreNames.contains(RECOVERY_STORES.META)) {
    database.createObjectStore(RECOVERY_STORES.META, { keyPath: 'key' });
  }
};

const allocateMigratedId = ({ storeName, record, sourceKey, usedIds }) => {
  const originalId = hasValidId(record?.id) ? record.id : null;
  const originalCanonical = originalId === null ? null : canonicalId(originalId);

  if (originalId !== null && !usedIds.has(originalCanonical)) {
    usedIds.add(originalCanonical);
    return {
      originalId,
      migratedId: originalId,
      idRemapped: false,
      remapReason: null
    };
  }

  const missingPrefix = storeName === 'deleted_sales'
    ? 'legacy-deleted-sale'
    : 'legacy-sale';
  const reason = originalId === null ? 'missing_id' : 'duplicate_id';
  const baseCandidate = originalId === null
    ? `${missingPrefix}:${stableKey(sourceKey)}`
    : `${String(originalId)}:legacy:${stableHash([storeName, sourceKey])}`;

  let migratedId = baseCandidate;
  let remapReason = reason;
  let attempt = 0;
  while (usedIds.has(canonicalId(migratedId))) {
    attempt += 1;
    remapReason = 'secondary_collision';
    migratedId = `${baseCandidate}:secondary:${attempt}:${stableHash([
      storeName,
      sourceKey,
      originalId,
      attempt
    ])}`;
  }

  usedIds.add(canonicalId(migratedId));
  return {
    originalId,
    migratedId,
    idRemapped: true,
    remapReason
  };
};

export const resolveLegacyRecordId = (storeName, record, sourceKey, usedIds = new Set()) => (
  allocateMigratedId({ storeName, record, sourceKey, usedIds }).migratedId
);

const startBackupCopy = ({
  transaction,
  sourceStoreName,
  backupStoreName,
  result,
  onDone,
  databaseName
}) => {
  const backupStore = transaction.objectStore(backupStoreName);
  const usedIds = new Set();

  const startCursor = () => {
    if (!transaction.db.objectStoreNames.contains(sourceStoreName)) {
      onDone();
      return;
    }

    const sourceStore = transaction.objectStore(sourceStoreName);
    const cursorRequest = sourceStore.openCursor();
    cursorRequest.onerror = () => abortWithStructuredError(
      transaction,
      createMigrationError({ databaseName, cause: cursorRequest.error })
    );
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        onDone();
        return;
      }

      const idResolution = allocateMigratedId({
        storeName: sourceStoreName,
        record: cursor.value,
        sourceKey: cursor.primaryKey,
        usedIds
      });
      const legacyKey = `${sourceStoreName}:${stableKey(cursor.primaryKey)}`;
      const backupEntry = {
        legacyKey,
        sourceKey: cursor.primaryKey,
        originalId: idResolution.originalId,
        migratedId: idResolution.migratedId,
        idRemapped: idResolution.idRemapped,
        remapReason: idResolution.remapReason,
        record: cursor.value
      };
      const addRequest = backupStore.add(backupEntry);

      addRequest.onerror = () => abortWithStructuredError(
        transaction,
        createMigrationError({
          code: DATABASE_RECOVERY_CODES.MIGRATION_COLLISION,
          databaseName,
          cause: addRequest.error
        })
      );
      addRequest.onsuccess = () => {
        result.count += 1;
        result.sourceHash = nextHash(result.sourceHash, cursor.primaryKey);
        result.idHash = nextHash(result.idHash, idResolution.migratedId);
        cursor.continue();
      };
    };
  };

  const clearRequest = backupStore.clear();
  clearRequest.onerror = () => abortWithStructuredError(
    transaction,
    createMigrationError({ databaseName, cause: clearRequest.error })
  );
  clearRequest.onsuccess = startCursor;
};

const runBackupPhase = async ({
  factory,
  databaseName,
  targetVersion,
  onBlocked,
  onProgress,
  openTimeoutMs
}) => {
  const sourceCounts = { sales: 0, deleted_sales: 0 };
  const sourceHashes = { sales: '', deleted_sales: '' };
  const idHashes = { sales: '', deleted_sales: '' };
  onProgress?.({ phase: 'backup_starting', sourceCounts, targetCounts: {} });

  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    version: targetVersion,
    onBlocked,
    openTimeoutMs,
    onUpgrade: ({ database: upgradingDatabase, transaction }) => {
      createRecoveryStores(upgradingDatabase);
      const results = {
        sales: { count: 0, sourceHash: 2166136261, idHash: 2166136261 },
        deleted_sales: { count: 0, sourceHash: 2166136261, idHash: 2166136261 }
      };
      let remaining = REPAIRABLE_STORES.length;

      const completeOne = () => {
        remaining -= 1;
        if (remaining > 0) return;

        REPAIRABLE_STORES.forEach((storeName) => {
          sourceCounts[storeName] = results[storeName].count;
          sourceHashes[storeName] = hashToString(results[storeName].sourceHash);
          idHashes[storeName] = hashToString(results[storeName].idHash);
        });

        const markerRequest = transaction.objectStore(RECOVERY_STORES.META).put({
          key: RECOVERY_MARKER_KEY,
          phase: 'backup_complete',
          sourceCounts,
          sourceHashes,
          idHashes,
          backupNativeVersion: targetVersion,
          updatedAt: new Date().toISOString()
        });
        markerRequest.onerror = () => abortWithStructuredError(
          transaction,
          createMigrationError({ databaseName, cause: markerRequest.error })
        );
      };

      REPAIRABLE_STORES.forEach((storeName) => {
        startBackupCopy({
          transaction,
          sourceStoreName: storeName,
          backupStoreName: storeName === 'sales'
            ? RECOVERY_STORES.SALES_BACKUP
            : RECOVERY_STORES.DELETED_SALES_BACKUP,
          result: results[storeName],
          onDone: completeOne,
          databaseName
        });
      });
    }
  });

  database.close();
  onProgress?.({ phase: 'backup_complete', sourceCounts, targetCounts: {} });
  return { sourceCounts, sourceHashes, idHashes };
};

const createCurrentStore = (database, storeName) => {
  const definition = NATIVE_CURRENT_STORE_DEFINITIONS[storeName];
  const store = database.createObjectStore(storeName, {
    keyPath: definition.keyPath,
    autoIncrement: definition.autoIncrement
  });
  definition.indexes.forEach((item) => {
    store.createIndex(item.name, item.keyPath, {
      unique: item.unique,
      multiEntry: item.multiEntry
    });
  });
  return store;
};

const startRestoreCopy = ({
  transaction,
  backupStoreName,
  targetStoreName,
  result,
  onDone,
  databaseName
}) => {
  const backupStore = transaction.objectStore(backupStoreName);
  const targetStore = transaction.objectStore(targetStoreName);
  const cursorRequest = backupStore.openCursor();

  cursorRequest.onerror = () => abortWithStructuredError(
    transaction,
    createMigrationError({ databaseName, cause: cursorRequest.error })
  );
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      onDone();
      return;
    }

    const backupEntry = cursor.value;
    if (!backupEntry?.record || typeof backupEntry.record !== 'object' || !hasValidId(backupEntry.migratedId)) {
      abortWithStructuredError(transaction, createMigrationError({
        databaseName,
        migration: { phase: 'restore_invalid_backup_entry' }
      }));
      return;
    }

    const restoredRecord = { ...backupEntry.record, id: backupEntry.migratedId };
    const addRequest = targetStore.add(restoredRecord);
    addRequest.onerror = () => abortWithStructuredError(
      transaction,
      createMigrationError({
        code: DATABASE_RECOVERY_CODES.MIGRATION_COLLISION,
        databaseName,
        cause: addRequest.error,
        migration: { phase: 'restore_collision' }
      })
    );
    addRequest.onsuccess = () => {
      result.count += 1;
      result.sourceHash = nextHash(result.sourceHash, backupEntry.sourceKey);
      result.idHash = nextHash(result.idHash, backupEntry.migratedId);
      cursor.continue();
    };
  };
};

const runRebuildPhase = async ({
  factory,
  databaseName,
  targetVersion,
  onBlocked,
  onProgress,
  openTimeoutMs
}) => {
  const targetCounts = { sales: 0, deleted_sales: 0 };
  const targetSourceHashes = { sales: '', deleted_sales: '' };
  const targetIdHashes = { sales: '', deleted_sales: '' };
  onProgress?.({ phase: 'rebuild_starting', sourceCounts: {}, targetCounts });

  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    version: targetVersion,
    onBlocked,
    openTimeoutMs,
    onUpgrade: ({ database: upgradingDatabase, transaction }) => {
      createRecoveryStores(upgradingDatabase);
      REPAIRABLE_STORES.forEach((storeName) => {
        if (upgradingDatabase.objectStoreNames.contains(storeName)) {
          upgradingDatabase.deleteObjectStore(storeName);
        }
        createCurrentStore(upgradingDatabase, storeName);
      });

      const results = {
        sales: { count: 0, sourceHash: 2166136261, idHash: 2166136261 },
        deleted_sales: { count: 0, sourceHash: 2166136261, idHash: 2166136261 }
      };
      let remaining = REPAIRABLE_STORES.length;

      const completeOne = () => {
        remaining -= 1;
        if (remaining > 0) return;

        REPAIRABLE_STORES.forEach((storeName) => {
          targetCounts[storeName] = results[storeName].count;
          targetSourceHashes[storeName] = hashToString(results[storeName].sourceHash);
          targetIdHashes[storeName] = hashToString(results[storeName].idHash);
        });

        const markerStore = transaction.objectStore(RECOVERY_STORES.META);
        const markerRequest = markerStore.get(RECOVERY_MARKER_KEY);
        markerRequest.onerror = () => abortWithStructuredError(
          transaction,
          createMigrationError({ databaseName, cause: markerRequest.error })
        );
        markerRequest.onsuccess = () => {
          const marker = markerRequest.result;
          const mismatch = !marker || REPAIRABLE_STORES.some((storeName) => (
            Number(marker.sourceCounts?.[storeName] || 0) !== targetCounts[storeName]
            || marker.sourceHashes?.[storeName] !== targetSourceHashes[storeName]
            || marker.idHashes?.[storeName] !== targetIdHashes[storeName]
          ));

          if (mismatch) {
            abortWithStructuredError(transaction, createMigrationError({
              databaseName,
              migration: {
                phase: 'validation_failed',
                sourceCounts: marker?.sourceCounts || {},
                targetCounts
              }
            }));
            return;
          }

          const finalMarkerRequest = markerStore.put({
            ...marker,
            phase: 'rebuild_complete',
            targetCounts,
            targetSourceHashes,
            targetIdHashes,
            rebuildNativeVersion: targetVersion,
            updatedAt: new Date().toISOString()
          });
          finalMarkerRequest.onerror = () => abortWithStructuredError(
            transaction,
            createMigrationError({ databaseName, cause: finalMarkerRequest.error })
          );
        };
      };

      REPAIRABLE_STORES.forEach((storeName) => {
        startRestoreCopy({
          transaction,
          backupStoreName: storeName === 'sales'
            ? RECOVERY_STORES.SALES_BACKUP
            : RECOVERY_STORES.DELETED_SALES_BACKUP,
          targetStoreName: storeName,
          result: results[storeName],
          onDone: completeOne,
          databaseName
        });
      });
    }
  });

  database.close();
  onProgress?.({ phase: 'rebuild_complete', sourceCounts: {}, targetCounts });
  return { targetCounts, targetSourceHashes, targetIdHashes };
};

export const readPrimaryKeyRecoveryMarker = async ({
  factory = globalThis.indexedDB,
  databaseName = DB_NAME,
  onBlocked = null,
  openTimeoutMs = OPEN_TIMEOUT_MS
} = {}) => {
  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    onBlocked,
    openTimeoutMs
  });
  try {
    if (!database.objectStoreNames.contains(RECOVERY_STORES.META)) return null;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(RECOVERY_STORES.META, 'readonly');
      const request = transaction.objectStore(RECOVERY_STORES.META).get(RECOVERY_MARKER_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

export const migratePrimaryKeysPreservingData = async ({
  factory = globalThis.indexedDB,
  databaseName = DB_NAME,
  inspection = null,
  onBlocked = null,
  onProgress = null,
  openTimeoutMs = OPEN_TIMEOUT_MS
} = {}) => {
  let currentInspection = inspection || await inspectIndexedDbStructure({
    factory,
    databaseName,
    onBlocked,
    openTimeoutMs
  });

  if (currentInspection.classification === 'unsupported_newer') {
    throw createMigrationError({
      code: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      databaseName,
      mismatches: currentInspection.mismatches
    });
  }
  if (currentInspection.mismatches.length === 0) {
    return { migrated: false, inspection: currentInspection, marker: null };
  }
  if (currentInspection.nativeVersion >= CURRENT_NATIVE_DATABASE_VERSION - 1) {
    throw createMigrationError({
      code: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      databaseName,
      mismatches: currentInspection.mismatches
    });
  }

  let marker = await readPrimaryKeyRecoveryMarker({
    factory,
    databaseName,
    onBlocked,
    openTimeoutMs
  });
  let sourceCounts = marker?.sourceCounts || null;

  if (marker?.phase !== 'backup_complete' && marker?.phase !== 'rebuild_complete') {
    const backupResult = await runBackupPhase({
      factory,
      databaseName,
      targetVersion: currentInspection.nativeVersion + 1,
      onBlocked,
      onProgress,
      openTimeoutMs
    });
    sourceCounts = backupResult.sourceCounts;
    marker = await readPrimaryKeyRecoveryMarker({ factory, databaseName, onBlocked, openTimeoutMs });
    currentInspection = await inspectIndexedDbStructure({ factory, databaseName, onBlocked, openTimeoutMs });
  }

  if (marker?.phase !== 'rebuild_complete') {
    const rebuildResult = await runRebuildPhase({
      factory,
      databaseName,
      targetVersion: currentInspection.nativeVersion + 1,
      onBlocked,
      onProgress,
      openTimeoutMs
    });
    marker = await readPrimaryKeyRecoveryMarker({ factory, databaseName, onBlocked, openTimeoutMs });
    currentInspection = await inspectIndexedDbStructure({ factory, databaseName, onBlocked, openTimeoutMs });

    if (currentInspection.mismatches.length > 0 || marker?.phase !== 'rebuild_complete') {
      throw createMigrationError({
        databaseName,
        mismatches: currentInspection.mismatches,
        migration: {
          phase: marker?.phase || 'rebuild_incomplete',
          sourceCounts: sourceCounts || {},
          targetCounts: rebuildResult.targetCounts
        }
      });
    }
  }

  return {
    migrated: true,
    inspection: currentInspection,
    marker,
    sourceCounts: marker?.sourceCounts || sourceCounts || {},
    targetCounts: marker?.targetCounts || {}
  };
};

export const preflightAndRepairIndexedDb = async ({
  factory = globalThis.indexedDB,
  databaseName = DB_NAME,
  onBlocked = null,
  onProgress = null,
  openTimeoutMs = OPEN_TIMEOUT_MS
} = {}) => {
  const inspection = await inspectIndexedDbStructure({
    factory,
    databaseName,
    onBlocked,
    openTimeoutMs
  });

  if (inspection.classification === 'unsupported_newer') {
    throw createDatabaseRecoveryError(makeDiagnostic({
      code: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      databaseName,
      retryable: false,
      requiresMigration: false
    }));
  }
  if (inspection.classification !== 'primary_key_incompatible') {
    return { inspection, migrated: false, marker: null };
  }

  return migratePrimaryKeysPreservingData({
    factory,
    databaseName,
    inspection,
    onBlocked,
    onProgress,
    openTimeoutMs
  });
};

export const buildPrimaryKeyMismatchDiagnostic = (inspection) => makeDiagnostic({
  code: DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH,
  databaseName: inspection?.databaseName || DB_NAME,
  mismatches: inspection?.mismatches || [],
  retryable: true,
  requiresMigration: true
});
