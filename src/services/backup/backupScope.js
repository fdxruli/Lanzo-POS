export const BACKUP_TABLE_NAMES = Object.freeze([
  'menu',
  'categories',
  'ingredients',
  'product_batches',
  'images',
  'customers',
  'sales',
  'customer_ledger',
  'layaways',
  'cajas',
  'movimientos_caja',
  'waste_logs',
  'inventory_events',
  'deleted_menu',
  'deleted_customers',
  'deleted_sales',
  'deleted_categories',
  'sequences'
]);

// These tables are inspected while the same read transaction is open, but are
// never written to a backup. They contain replay queues, credentials, or
// financial requests whose receipt may still be uncertain.
export const BACKUP_MONITORED_TABLE_NAMES = Object.freeze([
  'sync_outbox',
  'sync_conflicts',
  'financial_intents',
  'transaction_log'
]);

export const BACKUP_DATA_CATEGORIES = Object.freeze({
  catalog: Object.freeze(['menu', 'categories', 'ingredients', 'images']),
  inventory: Object.freeze(['product_batches', 'waste_logs', 'inventory_events']),
  customers: Object.freeze(['customers', 'customer_ledger']),
  sales: Object.freeze(['sales', 'deleted_sales']),
  layaways: Object.freeze(['layaways']),
  cash: Object.freeze(['cajas', 'movimientos_caja']),
  deletedRecords: Object.freeze(['deleted_menu', 'deleted_customers', 'deleted_categories']),
  sequences: Object.freeze(['sequences'])
});

export const getBackupTableScope = (database, { allowMissing = false } = {}) => {
  const tablesByName = new Map(database.tables.map((table) => [table.name, table]));
  const missingTableNames = BACKUP_TABLE_NAMES.filter((tableName) => !tablesByName.has(tableName));

  if (!allowMissing && missingTableNames.length > 0) {
    throw new Error(`BACKUP_REQUIRED_TABLES_MISSING:${missingTableNames.join(',')}`);
  }

  const includedNames = BACKUP_TABLE_NAMES.filter((tableName) => tablesByName.has(tableName));
  const excludedTableNames = database.tables
    .map((table) => table.name)
    .filter((tableName) => !includedNames.includes(tableName));

  return {
    includedTables: includedNames.map((tableName) => tablesByName.get(tableName)),
    includedTableNames: includedNames,
    missingTableNames,
    monitoredTables: BACKUP_MONITORED_TABLE_NAMES
      .filter((tableName) => tablesByName.has(tableName))
      .map((tableName) => tablesByName.get(tableName)),
    excludedTableNames
  };
};
