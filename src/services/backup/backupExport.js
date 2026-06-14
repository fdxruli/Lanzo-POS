import { exportDB } from 'dexie-export-import';
import { getBackupTableScope } from './backupScope';

export async function exportWhitelistedDatabase(database, options = {}) {
  const { includedTables, excludedTableNames } = getBackupTableScope(database);

  return database.transaction('r', includedTables, () => (
    exportDB(database, {
      ...options,
      noTransaction: true,
      skipTables: excludedTableNames
    })
  ));
}
