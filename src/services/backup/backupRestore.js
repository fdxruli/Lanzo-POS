import Dexie from 'dexie';
import { importInto, peakImportFile } from 'dexie-export-import';
import {
  BACKUP_TABLE_NAMES,
  getBackupTableScope
} from './backupScope';

function validateBackupTables(metadata) {
  const sourceTables = metadata?.data?.tables;
  if (!Array.isArray(sourceTables)) {
    throw new Error('BACKUP_TABLE_METADATA_INVALID');
  }

  const sourceTableNames = sourceTables.map((table) => table?.name);
  const duplicateTableNames = sourceTableNames.filter(
    (tableName, index) => sourceTableNames.indexOf(tableName) !== index
  );
  if (duplicateTableNames.length > 0) {
    throw new Error(`BACKUP_DUPLICATE_TABLES:${[...new Set(duplicateTableNames)].join(',')}`);
  }

  const missingTableNames = BACKUP_TABLE_NAMES.filter(
    (tableName) => !sourceTableNames.includes(tableName)
  );
  if (missingTableNames.length > 0) {
    throw new Error(`BACKUP_REQUIRED_TABLES_MISSING:${missingTableNames.join(',')}`);
  }

  return sourceTableNames;
}

export async function restoreWhitelistedDatabase(database, exportedBlob, {
  expectedDatabaseName = database.name,
  progressCallback
} = {}) {
  const metadata = await peakImportFile(exportedBlob);
  if (metadata?.data?.databaseName !== expectedDatabaseName) {
    throw new Error('BACKUP_DATABASE_MISMATCH');
  }

  const sourceTableNames = validateBackupTables(metadata);
  const { includedTables, excludedTableNames } = getBackupTableScope(database);
  const skipTables = [...new Set([
    ...excludedTableNames,
    ...sourceTableNames.filter((tableName) => !BACKUP_TABLE_NAMES.includes(tableName))
  ])];

  await database.transaction('rw', includedTables, async () => {
    for (const table of includedTables) {
      await table.clear();
    }

    await Dexie.waitFor(
      importInto(database, exportedBlob, {
        noTransaction: true,
        skipTables,
        overwriteValues: true,
        clearTablesBeforeImport: false,
        acceptNameDiff: false,
        progressCallback
      })
    );
  });

  return metadata;
}
