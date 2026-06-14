export const BACKUP_TABLE_NAMES = Object.freeze([
  'menu',
  'sales',
  'customers'
]);

export function getBackupTableScope(database) {
  const tablesByName = new Map(database.tables.map((table) => [table.name, table]));
  const missingTableNames = BACKUP_TABLE_NAMES.filter((tableName) => !tablesByName.has(tableName));

  if (missingTableNames.length > 0) {
    throw new Error(`BACKUP_REQUIRED_TABLES_MISSING:${missingTableNames.join(',')}`);
  }

  return {
    includedTables: BACKUP_TABLE_NAMES.map((tableName) => tablesByName.get(tableName)),
    excludedTableNames: database.tables
      .map((table) => table.name)
      .filter((tableName) => !BACKUP_TABLE_NAMES.includes(tableName))
  };
}
