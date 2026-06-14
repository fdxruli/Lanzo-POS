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
  it('incluye exclusivamente productos, ventas y clientes del esquema fisico', () => {
    const database = {
      tables: [
        table('company'),
        table('menu'),
        table('sales'),
        table('customers'),
        table('theme'),
        table('cajas'),
        table('sync_cache')
      ]
    };

    const scope = getBackupTableScope(database);

    expect(scope.includedTables.map(({ name }) => name)).toEqual(BACKUP_TABLE_NAMES);
    expect(scope.excludedTableNames).toEqual([
      'company',
      'theme',
      'cajas',
      'sync_cache'
    ]);
  });

  it('falla antes de exportar si falta una tabla obligatoria', () => {
    const database = {
      tables: [
        table('menu'),
        table('sales'),
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
      menu: 'id',
      sales: 'id',
      customers: 'id',
      company: 'id',
      license_tokens: 'id'
    });

    try {
      await database.open();
      await Promise.all([
        database.table('menu').add({ id: 'product-1', name: 'Producto permitido' }),
        database.table('sales').add({ id: 'sale-1', total: 100 }),
        database.table('customers').add({ id: 'customer-1', name: 'Cliente permitido' }),
        database.table('company').add({ id: 'company-1', name: 'LOCAL_SECRETO' }),
        database.table('license_tokens').add({ id: 'token-1', token: 'TOKEN_SECRETO' })
      ]);

      const blob = await exportWhitelistedDatabase(database, {
        prettyJson: false,
        numRowsPerChunk: 10
      });
      const json = JSON.parse(await blob.text());
      const serialized = JSON.stringify(json);

      expect(json.data.tables.map(({ name }) => name)).toEqual(BACKUP_TABLE_NAMES);
      expect(json.data.data.map(({ tableName }) => tableName)).toEqual(BACKUP_TABLE_NAMES);
      expect(serialized).not.toContain('company');
      expect(serialized).not.toContain('license_tokens');
      expect(serialized).not.toContain('LOCAL_SECRETO');
      expect(serialized).not.toContain('TOKEN_SECRETO');
    } finally {
      database.close();
      await Dexie.delete(database.name);
    }
  });
});
