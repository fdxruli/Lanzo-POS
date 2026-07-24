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

const OPEN_TIMEOUT_MS = 8_000;
const RECOVERY_MARKER_KEY = 'primary-key-recovery-v1';
const REPAIRABLE_STORES = ['sales', 'deleted_sales'];

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

const hasValidId = (value) => (
  (typeof value === 'string' && value.trim().length > 0) ||
  (typeof value === 'number' && Number.isFinite(value))
);

export const resolveLegacyRecordId = (storeName, record, sourceKey) => {
  if (hasValidId(record?.id)) return record.id;
  const prefix = storeName === 'deleted_sales' ? 'legacy-deleted-sale' : 'legacy-sale';
  return `${prefix}:${stableKey(sourceKey)}`;
};

const recoveryMessage = (code) => {
  if (code === DATABASE_RECOVERY_CODES.BLOCKED) {
    return 'La base local está abierta en otra pestaña. Cierra las demás pestañas de Lanzo y vuelve a intentarlo.';
  }
  if (code === DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH) {
    return 'Detectamos un esquema local antiguo. Lanzo preparará una migración segura conservando ventas y movimientos.';
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

const listExistingDatabases = async (factory) => {
  if (typeof factory?.databases !== 'function') return null;
  try {
    return await factory.databases();
  } catch {
    return null;
  }
};

const openNativeDatabase = ({ factory, name, version = undefined, onUpgrade = null }) => (
  new Promise((resolve, reject) => {
    let settled = false;
    let blocked = false;
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createDatabaseRecoveryError(makeDiagnostic({
        code: DATABASE_RECOVERY_CODES.OPEN_TIMEOUT,
        retryable: true
      })));
    }, OPEN_TIMEOUT_MS);

    request.onblocked = () => {
      blocked = true;
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(createDatabaseRecoveryError(makeDiagnostic({
        code: DATABASE_RECOVERY_CODES.BLOCKED,
        retryable: true
      })));
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(request.error || new Error(`No se pudo abrir ${name}.`));
    };

    request.onupgradeneeded = (event) => {
      try {
        onUpgrade?.({
          database: request.result,
          transaction: request.transaction,
          oldVersion: event.oldVersion,
          newVersion: event.newVersion
        });
      } catch (error) {
        try {
          request.transaction?.abort();
        } catch {
          // La transacción ya pudo abortarse por la excepción original.
        }
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      }
    };

    request.onsuccess = () => {
      if (settled || blocked) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(request.result);
    };
  })
);

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
  if (createdByInspection || storeNames.length === 0) classification = 'new';
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
  databaseName = DB_NAME
} = {}) => {
  if (!factory) {
    throw createDatabaseRecoveryError(makeDiagnostic({
      code: DATABASE_RECOVERY_CODES.NOT_INSPECTABLE,
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

const startBackupCopy = ({ transaction, sourceStoreName, backupStoreName, result, onDone }) => {
  const backupStore = transaction.objectStore(backupStoreName);
  const startCursor = () => {
    if (!transaction.db.objectStoreNames.contains(sourceStoreName)) {
      onDone();
      return;
    }

    const sourceStore = transaction.objectStore(sourceStoreName);
    const cursorRequest = sourceStore.openCursor();

    cursorRequest.onerror = () => transaction.abort();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        onDone();
        return;
      }

      const migratedId = resolveLegacyRecordId(sourceStoreName, cursor.value, cursor.primaryKey);
      const legacyKey = `${sourceStoreName}:${stableKey(cursor.primaryKey)}`;
      const addRequest = backupStore.add({
        legacyKey,
        sourceKey: cursor.primaryKey,
        migratedId,
        record: cursor.value
      });

      addRequest.onerror = () => transaction.abort();
      addRequest.onsuccess = () => {
        result.count += 1;
        result.sourceHash = nextHash(result.sourceHash, cursor.primaryKey);
        result.idHash = nextHash(result.idHash, migratedId);
        cursor.continue();
      };
    };
  };

  const clearRequest = backupStore.clear();
  clearRequest.onerror = () => transaction.abort();
  clearRequest.onsuccess = startCursor;
};

const runBackupPhase = async ({ factory, databaseName, targetVersion }) => {
  const sourceCounts = { sales: 0, deleted_sales: 0 };
  const sourceHashes = { sales: '', deleted_sales: '' };
  const idHashes = { sales: '', deleted_sales: '' };

  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    version: targetVersion,
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

        transaction.objectStore(RECOVERY_STORES.META).put({
          key: RECOVERY_MARKER_KEY,
          phase: 'backup_complete',
          sourceCounts,
          sourceHashes,
          idHashes,
          backupNativeVersion: targetVersion,
          updatedAt: new Date().toISOString()
        });
      };

      startBackupCopy({
        transaction,
        sourceStoreName: 'sales',
        backupStoreName: RECOVERY_STORES.SALES_BACKUP,
        result: results.sales,
        onDone: completeOne
      });
      startBackupCopy({
        transaction,
        sourceStoreName: 'deleted_sales',
        backupStoreName: RECOVERY_STORES.DELETED_SALES_BACKUP,
        result: results.deleted_sales,
        onDone: completeOne
      });
    }
  });

  database.close();
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

const startRestoreCopy = ({ transaction, backupStoreName, targetStoreName, result, onDone }) => {
  const backupStore = transaction.objectStore(backupStoreName);
  const targetStore = transaction.objectStore(targetStoreName);
  const cursorRequest = backupStore.openCursor();

  cursorRequest.onerror = () => transaction.abort();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      onDone();
      return;
    }

    const backupEntry = cursor.value;
    if (!backupEntry?.record || typeof backupEntry.record !== 'object') {
      transaction.abort();
      return;
    }

    const id = hasValidId(backupEntry.record.id)
      ? backupEntry.record.id
      : backupEntry.migratedId;
    const restoredRecord = { ...backupEntry.record, id };
    const addRequest = targetStore.add(restoredRecord);

    addRequest.onerror = () => {
      const collision = new Error(`Colisión de ID al reconstruir ${targetStoreName}.`);
      collision.name = 'ConstraintError';
      collision.code = DATABASE_RECOVERY_CODES.MIGRATION_COLLISION;
      try {
        transaction.abort();
      } catch {
        // La solicitud ya abortó la transacción.
      }
    };
    addRequest.onsuccess = () => {
      result.count += 1;
      result.idHash = nextHash(result.idHash, id);
      cursor.continue();
    };
  };
};

const runRebuildPhase = async ({ factory, databaseName, targetVersion }) => {
  const targetCounts = { sales: 0, deleted_sales: 0 };
  const targetIdHashes = { sales: '', deleted_sales: '' };

  const database = await openNativeDatabase({
    factory,
    name: databaseName,
    version: targetVersion,
    onUpgrade: ({ database: upgradingDatabase, transaction }) => {
      createRecoveryStores(upgradingDatabase);

      REPAIRABLE_STORES.forEach((storeName) => {
        if (upgradingDatabase.objectStoreNames.contains(storeName)) {
          upgradingDatabase.deleteObjectStore(storeName);
        }
        createCurrentStore(upgradingDatabase, storeName);
      });

      const results = {
        sales: { count: 0, idHash: 2166136261 },
        deleted_sales: { count: 0, idHash: 2166136261 }
      };
      let remaining = REPAIRABLE_STORES.length;

      const completeOne = () => {
        remaining -= 1;
        if (remaining > 0) return;

        REPAIRABLE_STORES.forEach((storeName) => {
          targetCounts[storeName] = results[storeName].count;
          targetIdHashes[storeName] = hashToString(results[storeName].idHash);
        });

        const markerStore = transaction.objectStore(RECOVERY_STORES.META);
        const markerRequest = markerStore.get(RECOVERY_MARKER_KEY);
        markerRequest.onerror = () => transaction.abort();
        markerRequest.onsuccess = () => {
          const marker = markerRequest.result || { key: RECOVERY_MARKER_KEY };
          const sourceCounts = marker.sourceCounts || {};
          const countMismatch = REPAIRABLE_STORES.some(
            (storeName) => Number(sourceCounts[storeName] || 0) !== targetCounts[storeName]
          );
          if (countMismatch) {
            transaction.abort();
            return;
          }

          markerStore.put({
            ...marker,
            phase: 'rebuild_complete',
            targetCounts,
            targetIdHashes,
            rebuildNativeVersion: targetVersion,
            updatedAt: new Date().toISOString()
          });
        };
      };

      startRestoreCopy({
        transaction,
        backupStoreName: RECOVERY_STORES.SALES_BACKUP,
        targetStoreName: 'sales',
        result: results.sales,
        onDone: completeOne
      });
      startRestoreCopy({
        transaction,
        backupStoreName: RECOVERY_STORES.DELETED_SALES_BACKUP,
        targetStoreName: 'deleted_sales',
        result: results.deleted_sales,
        onDone: completeOne
      });
    }
  });

  database.close();
  return { targetCounts, targetIdHashes };
};

export const readPrimaryKeyRecoveryMarker = async ({
  factory = globalThis.indexedDB,
  databaseName = DB_NAME
} = {}) => {
  const database = await openNativeDatabase({ factory, name: databaseName });
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
  inspection = null
} = {}) => {
  let currentInspection = inspection || await inspectIndexedDbStructure({ factory, databaseName });
  if (currentInspection.mismatches.length === 0) {
    return { migrated: false, inspection: currentInspection, marker: null };
  }

  if (currentInspection.nativeVersion >= CURRENT_NATIVE_DATABASE_VERSION - 1) {
    throw createDatabaseRecoveryError(makeDiagnostic({
      code: DATABASE_RECOVERY_CODES.UNSUPPORTED_VERSION,
      mismatches: currentInspection.mismatches,
      retryable: false,
      requiresMigration: true
    }));
  }

  let marker = await readPrimaryKeyRecoveryMarker({ factory, databaseName });
  let sourceCounts = marker?.sourceCounts || null;

  if (marker?.phase !== 'backup_complete' && marker?.phase !== 'rebuild_complete') {
    const backupResult = await runBackupPhase({
      factory,
      databaseName,
      targetVersion: currentInspection.nativeVersion + 1
    });
    sourceCounts = backupResult.sourceCounts;
    marker = await readPrimaryKeyRecoveryMarker({ factory, databaseName });
    currentInspection = await inspectIndexedDbStructure({ factory, databaseName });
  }

  if (marker?.phase !== 'rebuild_complete') {
    const rebuildResult = await runRebuildPhase({
      factory,
      databaseName,
      targetVersion: currentInspection.nativeVersion + 1
    });
    marker = await readPrimaryKeyRecoveryMarker({ factory, databaseName });
    currentInspection = await inspectIndexedDbStructure({ factory, databaseName });

    if (currentInspection.mismatches.length > 0) {
      throw createDatabaseRecoveryError(makeDiagnostic({
        code: DATABASE_RECOVERY_CODES.MIGRATION_FAILED,
        mismatches: currentInspection.mismatches,
        retryable: true,
        requiresMigration: true,
        migration: {
          phase: marker?.phase || 'rebuild_incomplete',
          sourceCounts: sourceCounts || {},
          targetCounts: rebuildResult.targetCounts
        }
      }));
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
  databaseName = DB_NAME
} = {}) => {
  const inspection = await inspectIndexedDbStructure({ factory, databaseName });

  if (inspection.classification !== 'primary_key_incompatible') {
    return { inspection, migrated: false, marker: null };
  }

  const migration = await migratePrimaryKeysPreservingData({
    factory,
    databaseName,
    inspection
  });

  return migration;
};

export const buildPrimaryKeyMismatchDiagnostic = (inspection) => makeDiagnostic({
  code: DATABASE_RECOVERY_CODES.PRIMARY_KEY_MISMATCH,
  databaseName: inspection?.databaseName || DB_NAME,
  mismatches: inspection?.mismatches || [],
  retryable: true,
  requiresMigration: true
});
