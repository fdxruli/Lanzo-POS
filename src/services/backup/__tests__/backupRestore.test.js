/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { exportDB } from 'dexie-export-import';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreWhitelistedDatabase } from '../backupRestore';

const databaseNames = new Set();

function createDatabase(name, stores) {
  databaseNames.add(name);
  const database = new Dexie(name);
  database.version(1).stores(stores);
  return database;
}

async function createExport(name, stores, recordsByTable) {
  const database = createDatabase(name, stores);
  await database.open();

  for (const [tableName, records] of Object.entries(recordsByTable)) {
    await database.table(tableName).bulkAdd(records);
  }

  const blob = await exportDB(database, {
    prettyJson: false,
    numRowsPerChunk: 10
  });
  database.close();
  await Dexie.delete(name);
  return blob;
}

afterEach(async () => {
  for (const name of databaseNames) {
    await Dexie.delete(name);
  }
  databaseNames.clear();
});

describe('restoreWhitelistedDatabase', () => {
  it('restaura solo la whitelist y conserva intacta la identidad local', async () => {
    const name = `backup-restore-${crypto.randomUUID()}`;
    const stores = {
      menu: 'id',
      sales: 'id',
      customers: 'id',
      company: 'id',
      license_tokens: 'id',
      cajas: 'id'
    };
    const backup = await createExport(name, stores, {
      menu: [{ id: 'product-backup', name: 'Producto del respaldo' }],
      sales: [{ id: 'sale-backup', total: 150 }],
      customers: [{ id: 'customer-backup', name: 'Cliente del respaldo' }],
      company: [{ id: 'company', name: 'Negocio del dispositivo origen' }],
      license_tokens: [{ id: 'license', token: 'TOKEN_ORIGEN' }],
      cajas: [{ id: 'cash-register', estado: 'abierta' }]
    });

    const target = createDatabase(name, stores);
    await target.open();
    await Promise.all([
      target.table('menu').add({ id: 'product-local', name: 'Producto local' }),
      target.table('sales').add({ id: 'sale-local', total: 10 }),
      target.table('customers').add({ id: 'customer-local', name: 'Cliente local' }),
      target.table('company').add({ id: 'company', name: 'Negocio destino' }),
      target.table('license_tokens').add({ id: 'license', token: 'TOKEN_DESTINO' }),
      target.table('cajas').add({ id: 'cash-register', estado: 'cerrada' })
    ]);

    await restoreWhitelistedDatabase(target, backup);

    expect(await target.table('menu').toArray()).toEqual([
      { id: 'product-backup', name: 'Producto del respaldo' }
    ]);
    expect(await target.table('sales').toArray()).toEqual([
      { id: 'sale-backup', total: 150 }
    ]);
    expect(await target.table('customers').toArray()).toEqual([
      { id: 'customer-backup', name: 'Cliente del respaldo' }
    ]);
    expect(await target.table('company').toArray()).toEqual([
      { id: 'company', name: 'Negocio destino' }
    ]);
    expect(await target.table('license_tokens').toArray()).toEqual([
      { id: 'license', token: 'TOKEN_DESTINO' }
    ]);
    expect(await target.table('cajas').toArray()).toEqual([
      { id: 'cash-register', estado: 'cerrada' }
    ]);

    target.close();
  });

  it('valida las tablas obligatorias antes de limpiar datos locales', async () => {
    const name = `backup-restore-missing-${crypto.randomUUID()}`;
    const backup = await createExport(name, {
      menu: 'id',
      sales: 'id',
      company: 'id'
    }, {
      menu: [{ id: 'product-backup' }],
      sales: [{ id: 'sale-backup' }],
      company: [{ id: 'company', name: 'Origen' }]
    });

    const target = createDatabase(name, {
      menu: 'id',
      sales: 'id',
      customers: 'id',
      company: 'id'
    });
    await target.open();
    await target.table('menu').add({ id: 'product-local' });
    await target.table('customers').add({ id: 'customer-local' });

    await expect(restoreWhitelistedDatabase(target, backup))
      .rejects.toThrow('BACKUP_REQUIRED_TABLES_MISSING:customers');

    expect(await target.table('menu').toArray()).toEqual([{ id: 'product-local' }]);
    expect(await target.table('customers').toArray()).toEqual([{ id: 'customer-local' }]);

    target.close();
  });

  it('revierte los clear si una insercion falla dentro de la transaccion', async () => {
    const name = `backup-restore-rollback-${crypto.randomUUID()}`;
    const backup = await createExport(name, {
      menu: 'id',
      sales: 'id',
      customers: 'id',
      company: 'id'
    }, {
      menu: [{ id: 'product-backup' }],
      sales: [
        { id: 'sale-backup-1', timestamp: 'duplicate-timestamp' },
        { id: 'sale-backup-2', timestamp: 'duplicate-timestamp' }
      ],
      customers: [{ id: 'customer-backup' }],
      company: [{ id: 'company', name: 'Origen' }]
    });

    const target = createDatabase(name, {
      menu: 'id',
      sales: 'id,&timestamp',
      customers: 'id',
      company: 'id'
    });
    await target.open();
    await Promise.all([
      target.table('menu').add({ id: 'product-local' }),
      target.table('sales').add({ id: 'sale-local', timestamp: 'local-timestamp' }),
      target.table('customers').add({ id: 'customer-local' }),
      target.table('company').add({ id: 'company', name: 'Negocio destino' })
    ]);

    await expect(restoreWhitelistedDatabase(target, backup)).rejects.toThrow();

    expect(await target.table('menu').toArray()).toEqual([{ id: 'product-local' }]);
    expect(await target.table('sales').toArray()).toEqual([
      { id: 'sale-local', timestamp: 'local-timestamp' }
    ]);
    expect(await target.table('customers').toArray()).toEqual([{ id: 'customer-local' }]);
    expect(await target.table('company').toArray()).toEqual([
      { id: 'company', name: 'Negocio destino' }
    ]);

    target.close();
  });
});
