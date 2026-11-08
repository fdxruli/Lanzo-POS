import { exportDB } from 'dexie-export-import';
import { createBackupCashIdentitySanitizer } from './backupCashIdentity';
import { getBackupTableScope } from './backupScope';

export async function exportWhitelistedDatabase(database, options = {}) {
  const {
    includeManifest = false,
    ...exportOptions
  } = options;
  const {
    includedTables,
    includedTableNames,
    monitoredTables,
    excludedTableNames
  } = getBackupTableScope(database);
  const snapshotTables = [...includedTables, ...monitoredTables];
  const sanitizeCashIdentity = createBackupCashIdentitySanitizer();

  return database.transaction('r', snapshotTables, async () => {
    const tableCounts = Object.fromEntries(await Promise.all(includedTables.map(async (table) => (
      [table.name, table.name === 'sequences'
        ? await table.where('id').equals('sale_folio').count()
        : await table.count()]
    ))));
    const monitoredCounts = Object.fromEntries(await Promise.all(monitoredTables.map(async (table) => (
      [table.name, await table.count()]
    ))));
    const pendingCounts = Object.fromEntries(await Promise.all(monitoredTables.map(async (table) => {
      const pendingCount = await table.toCollection().filter((row) => {
        const status = String(row?.status || '').toLowerCase();
        if (table.name === 'sync_outbox') return !['synced', 'completed', 'done'].includes(status);
        if (table.name === 'sync_conflicts') return ['pending', 'open', 'unresolved'].includes(status);
        if (table.name === 'financial_intents') {
          return String(row?.status || '').toUpperCase() !== 'COMPLETED'
            || ['PENDING', 'FAILED'].includes(String(row?.projectionStatus || '').toUpperCase());
        }
        if (table.name === 'transaction_log') {
          return !['committed', 'completed', 'done', 'success', 'succeeded'].includes(status);
        }
        return false;
      }).count();
      return [table.name, pendingCount];
    })));
    const cajaTable = includedTables.find((table) => table.name === 'cajas');
    const openCashSessionCount = cajaTable
      ? await cajaTable.toCollection().filter((session) => (
        session?.estado === 'abierta' || String(session?.status || '').toLowerCase() === 'open'
      )).count()
      : 0;
    const customFilter = exportOptions.filter;
    const customTransform = exportOptions.transform;
    const backup = await exportDB(database, {
      ...exportOptions,
      noTransaction: true,
      skipTables: excludedTableNames,
      filter: (tableName, value, key) => (
        (tableName !== 'sequences' || value?.id === 'sale_folio')
        && (!customFilter || customFilter(tableName, value, key))
      ),
      transform: (tableName, value, key) => {
        const sanitized = sanitizeCashIdentity(tableName, value, key);
        return customTransform
          ? customTransform(tableName, sanitized.value, sanitized.key)
          : sanitized;
      }
    });

    if (!includeManifest) return backup;
    return {
      blob: backup,
      tableCounts,
      monitoredCounts,
      pendingCounts,
      openCashSessionCount,
      includedTableNames
    };
  });
}
