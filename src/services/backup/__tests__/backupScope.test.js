/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { exportWhitelistedDatabase } from '../backupExport';
import {
  BACKUP_TABLE_NAMES,
  getBackupTableScope
} from '../backupScope';

function table(name) {
  return { name };
}

describe('backupScope', () => {
  it('incluye las tablas comerciales aprobadas y monitorea operaciones pendientes', () => {
    const database = {
      tables: [
        ...BACKUP_TABLE_NAMES.map(table),
        table('company'),
        table('theme'),
        table('sync_cache'),
        table('sync_outbox'),
        table('sync_conflicts'),
        table('financial_intents'),
        table('transaction_log'),
        table('global_stats')
      ]
    };

    const scope = getBackupTableScope(database);

    expect(scope.includedTables.map(({ name }) => name)).toEqual(BACKUP_TABLE_NAMES);
    expect(scope.monitoredTables.map(({ name }) => name)).toEqual([
      'sync_outbox', 'sync_conflicts', 'financial_intents', 'transaction_log'
    ]);
    expect(scope.excludedTableNames).toEqual([
      'company',
      'theme', 'sync_cache', 'sync_outbox', 'sync_conflicts',
      'financial_intents', 'transaction_log', 'global_stats'
    ]);
  });

  it('falla antes de exportar si falta una tabla obligatoria', () => {
    const database = {
      tables: [
        ...BACKUP_TABLE_NAMES.filter((name) => name !== 'customers').map(table),
        table('company')
      ]
    };

    expect(() => getBackupTableScope(database))
      .toThrow('BACKUP_REQUIRED_TABLES_MISSING:customers');
  });

  it('excluye por defecto cualquier tabla agregada en el futuro', () => {
    const database = {
      tables: [
        ...BACKUP_TABLE_NAMES.map(table),
        table('license_tokens'),
        table('business_settings')
      ]
    };

    expect(getBackupTableScope(database).excludedTableNames).toEqual([
      'license_tokens',
      'business_settings'
    ]);
  });

  it('no serializa esquema ni registros fuera de la whitelist', async () => {
    const database = new Dexie(`backup-scope-${crypto.randomUUID()}`);
    database.version(1).stores({
      ...Object.fromEntries(BACKUP_TABLE_NAMES.map((name) => [name, 'id'])),
      company: 'id',
      license_tokens: 'id',
      sync_outbox: 'id',
      sync_conflicts: 'id',
      financial_intents: 'id',
      transaction_log: 'id'
    });

    try {
      await database.open();
      await Promise.all([
        database.table('menu').add({ id: 'product-1', name: 'Producto permitido' }),
        database.table('sales').add({ id: 'sale-1', total: 100 }),
        database.table('customers').add({ id: 'customer-1', name: 'Cliente permitido' }),
        database.table('cajas').add({
          id: 'cash-1', estado: 'abierta', localStationKey: 'local:device:origin-station-secret',
          deviceId: 'RAW_DEVICE_ID_SECRET', deviceFingerprint: 'RAW_FINGERPRINT_SECRET'
        }),
        database.table('movimientos_caja').add({
          id: 'movement-1', cash_session_id: 'cash-1', localStationKey: 'local:device:origin-station-secret',
          deviceId: 'RAW_DEVICE_ID_SECRET', deviceFingerprint: 'RAW_FINGERPRINT_SECRET'
        }),
        database.table('company').add({ id: 'company-1', name: 'LOCAL_SECRETO' }),
        database.table('license_tokens').add({ id: 'token-1', token: 'TOKEN_SECRETO' }),
        database.table('sync_outbox').add({ id: 'outbox-1', status: 'pending', token: 'OUTBOX_SECRETO' }),
        database.table('sync_conflicts').add({ id: 'conflict-1', status: 'unresolved' }),
        database.table('financial_intents').add({ id: 'intent-1', status: 'PENDING_RECEIPT' }),
        database.table('transaction_log').add({ id: 'tx-1', status: 'committed' })
      ]);

      const snapshot = await exportWhitelistedDatabase(database, {
        prettyJson: false,
        numRowsPerChunk: 10,
        includeManifest: true
      });
      const json = JSON.parse(await snapshot.blob.text());
      const serialized = JSON.stringify(json);

      expect(json.data.tables.map(({ name }) => name)).toEqual(BACKUP_TABLE_NAMES);
      expect(json.data.data.map(({ tableName }) => tableName)).toEqual(BACKUP_TABLE_NAMES);
      expect(serialized).not.toContain('company');
      expect(serialized).not.toContain('license_tokens');
      expect(serialized).not.toContain('LOCAL_SECRETO');
      expect(serialized).not.toContain('TOKEN_SECRETO');
      expect(serialized).not.toContain('OUTBOX_SECRETO');
      expect(serialized).not.toContain('RAW_DEVICE_ID_SECRET');
      expect(serialized).not.toContain('RAW_FINGERPRINT_SECRET');
      expect(serialized).not.toContain('origin-station-secret');
      expect(serialized.match(/local:device:backup-/g)).toHaveLength(2);
      expect(snapshot.pendingCounts).toMatchObject({
        sync_outbox: 1,
        sync_conflicts: 1,
        financial_intents: 1,
        transaction_log: 0
      });
      expect(snapshot.openCashSessionCount).toBe(1);
      expect(snapshot.tableCounts.menu).toBe(1);
    } finally {
      database.close();
      await Dexie.delete(database.name);
    }
  });
});
