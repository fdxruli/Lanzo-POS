import Dexie from 'dexie';
import { importInto, peakImportFile } from 'dexie-export-import';
import { createBackupCashIdentitySanitizer } from './backupCashIdentity';
import {
  BACKUP_TABLE_NAMES,
  getBackupTableScope
} from './backupScope';

export const LEGACY_BACKUP_TABLE_NAMES = Object.freeze([
  'menu',
  'sales',
  'customers'
]);

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

  // Clear only whitelisted tables present in the file. A v1 file is partial;
  // tables absent from it are skipped and retain their current contents.
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
      restoredRows[tableName] = await stagingDatabase.table(tableName).toArray();
    }
  } finally {
    stagingDatabase.close();
    await Dexie.delete(stagingName);
  }

  await database.transaction('rw', database.tables, async () => {
    for (const tableName of safeSourceNames) {
      await database.table(tableName).clear();
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
