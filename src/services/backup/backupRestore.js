import Dexie from 'dexie';
import { importInto, peakImportFile } from 'dexie-export-import';
import { createBackupCashIdentitySanitizer } from './backupCashIdentity';
import {
  BACKUP_TABLE_NAMES,
  BACKUP_MONITORED_TABLE_NAMES,
  getBackupTableScope
} from './backupScope';

export const LEGACY_BACKUP_TABLE_NAMES = Object.freeze([
  'menu',
  'sales',
  'customers'
]);

const isPendingRestoreOperation = (tableName, row) => {
  const status = String(row?.status || '').toLowerCase();
  if (tableName === 'sync_outbox') return !['synced', 'completed', 'done'].includes(status);
  if (tableName === 'sync_conflicts') return ['pending', 'open', 'unresolved'].includes(status);
  if (tableName === 'financial_intents') {
    return String(row?.status || '').toUpperCase() !== 'COMPLETED'
      || ['PENDING', 'FAILED'].includes(String(row?.projectionStatus || '').toUpperCase());
  }
  if (tableName === 'transaction_log') {
    return !['committed', 'completed', 'done', 'success', 'succeeded'].includes(status);
  }
  return false;
};

export const countPendingRestoreOperations = (rowsByTable = {}) => Object.fromEntries(
  BACKUP_MONITORED_TABLE_NAMES.map((tableName) => [
    tableName,
    (rowsByTable[tableName] || []).filter((row) => isPendingRestoreOperation(tableName, row)).length
  ])
);

const readPendingOperationRows = async (database) => {
  const rowsByTable = {};
  for (const tableName of BACKUP_MONITORED_TABLE_NAMES) {
    if (database.tables.some((table) => table.name === tableName)) {
      rowsByTable[tableName] = await database.table(tableName).toArray();
    }
  }
  return rowsByTable;
};

const validateSourceTables = (metadata, formatVersion) => {
  const sourceTables = metadata?.data?.tables;
  if (!Array.isArray(sourceTables)) throw new Error('BACKUP_TABLE_METADATA_INVALID');

  const sourceTableNames = sourceTables.map((table) => table?.name);
  const duplicateTableNames = sourceTableNames.filter(
    (tableName, index) => sourceTableNames.indexOf(tableName) !== index
  );
  if (duplicateTableNames.length > 0) {
    throw new Error(`BACKUP_DUPLICATE_TABLES:${[...new Set(duplicateTableNames)].join(',')}`);
  }

  const allowedTableNames = formatVersion === 1
    ? LEGACY_BACKUP_TABLE_NAMES
    : BACKUP_TABLE_NAMES;
  const safeSourceNames = sourceTableNames.filter((name) => allowedTableNames.includes(name));
  if (safeSourceNames.length === 0) throw new Error('BACKUP_NO_RECOVERABLE_TABLES');

  if (formatVersion !== 1) {
    const missingTableNames = BACKUP_TABLE_NAMES.filter((name) => !sourceTableNames.includes(name));
    if (missingTableNames.length > 0) {
      throw new Error(`BACKUP_REQUIRED_TABLES_MISSING:${missingTableNames.join(',')}`);
    }
  }

  return { sourceTableNames, safeSourceNames };
};

export async function inspectBackupArchive(exportedBlob, { formatVersion = 2 } = {}) {
  const metadata = await peakImportFile(exportedBlob);
  const { sourceTableNames, safeSourceNames } = validateSourceTables(metadata, formatVersion);
  return {
    metadata,
    sourceTableNames,
    safeSourceNames,
    tableCounts: Object.fromEntries((metadata.data.tables || [])
      .filter((table) => safeSourceNames.includes(table.name))
      .map((table) => [table.name, Number(table.rowCount) || 0]))
  };
}

export async function restoreWhitelistedDatabase(database, exportedBlob, {
  expectedDatabaseName = database.name,
  formatVersion = 2,
  progressCallback
} = {}) {
  const { metadata, safeSourceNames } = await inspectBackupArchive(exportedBlob, { formatVersion });
  if (metadata?.data?.databaseName !== expectedDatabaseName) {
    throw new Error('BACKUP_DATABASE_MISMATCH');
  }

  const { includedTableNames } = getBackupTableScope(database, { allowMissing: true });
  const unavailableTables = safeSourceNames.filter((tableName) => !includedTableNames.includes(tableName));
  if (unavailableTables.length > 0) {
    throw new Error(`BACKUP_TARGET_TABLES_MISSING:${unavailableTables.join(',')}`);
  }

  // Replace only whitelisted tables present in the file. V1 is partial and
  // sequences is restricted to sale_folio, so all other destination sequence
  // entries must retain their current values.
  const skipTables = database.tables
    .map((table) => table.name)
    .filter((tableName) => !safeSourceNames.includes(tableName));

  // Parse the archive into an isolated database first. dexie-export-import
  // clears destination tables before its own write transaction, so using it
  // directly against the tenant database could leave a partial restore if a
  // later table write fails.
  const stagingName = `${expectedDatabaseName}_backup_stage_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const stagingDatabase = new Dexie(stagingName);
  stagingDatabase.version(database.verno || 1).stores(Object.fromEntries(
    database.tables.map((table) => [
      table.name,
      [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(',')
    ])
  ));
  const restoredRows = {};
  const sanitizeCashIdentity = createBackupCashIdentitySanitizer();
  try {
    await stagingDatabase.open();
    await importInto(stagingDatabase, exportedBlob, {
      skipTables,
      overwriteValues: true,
      clearTablesBeforeImport: true,
      acceptNameDiff: true,
      acceptVersionDiff: true,
      progressCallback,
      filter: (tableName) => safeSourceNames.includes(tableName),
      transform: sanitizeCashIdentity
    });
    for (const tableName of safeSourceNames) {
      const rows = await stagingDatabase.table(tableName).toArray();
      restoredRows[tableName] = tableName === 'sequences'
        ? rows.filter((row) => row?.id === 'sale_folio')
        : rows;
    }
  } finally {
    stagingDatabase.close();
    await Dexie.delete(stagingName);
  }

  await database.transaction('rw', database.tables, async () => {
    const pendingOperationCounts = countPendingRestoreOperations(await readPendingOperationRows(database));
    if (Object.values(pendingOperationCounts).some((count) => count > 0)) {
      throw new Error('BACKUP_RESTORE_PENDING_OPERATIONS');
    }

    for (const tableName of safeSourceNames) {
      if (tableName === 'sequences') {
        await database.table(tableName).delete('sale_folio');
      } else {
        await database.table(tableName).clear();
      }
      if (restoredRows[tableName].length > 0) {
        await database.table(tableName).bulkPut(restoredRows[tableName]);
      }
    }
  });

  return {
    ...metadata,
    restoredTables: [...safeSourceNames],
    partial: formatVersion === 1 || safeSourceNames.length !== BACKUP_TABLE_NAMES.length
  };
}
