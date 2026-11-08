/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { exportDB } from 'dexie-export-import';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_TABLE_NAMES } from '../backupScope';
import { restoreWhitelistedDatabase } from '../backupRestore';

const openLegacyArchive = async (databaseName) => {
  const source = new Dexie(databaseName);
  source.version(1).stores({ menu: 'id', sales: 'id', customers: 'id' });
  await source.open();
  await source.table('menu').add({ id: 'product-source', name: 'Producto del archivo' });
  await source.table('sales').add({ id: 'sale-source', total: 125.5 });
  await source.table('customers').add({ id: 'customer-source', name: 'Cliente del archivo' });
  const archive = await exportDB(source, { prettyJson: false, numRowsPerChunk: 10 });
  source.close();
  await Dexie.delete(databaseName);
  return archive;
};

const openCurrentArchive = async (databaseName) => {
  const source = new Dexie(databaseName);
  source.version(1).stores(Object.fromEntries(BACKUP_TABLE_NAMES.map((name) => [name, 'id'])));
  await source.open();
  await Promise.all([
    source.table('cajas').add({
      id: 'cash-open', estado: 'abierta', localStationKey: 'local:device:origin-station-secret',
      deviceId: 'RAW_DEVICE_ID_SECRET', deviceFingerprint: 'RAW_FINGERPRINT_SECRET'
    }),
    source.table('movimientos_caja').add({
      id: 'movement-open', cash_session_id: 'cash-open', caja_id: 'cash-open',
      localStationKey: 'local:device:origin-station-secret',
      deviceId: 'RAW_DEVICE_ID_SECRET', deviceFingerprint: 'RAW_FINGERPRINT_SECRET'
    }),
    source.table('sequences').add({ id: 'sale_folio', value: 12 }),
    source.table('sequences').add({ id: 'receipt_folio', value: 44 })
  ]);
  const archive = await exportDB(source, { prettyJson: false, numRowsPerChunk: 10 });
  source.close();
  await Dexie.delete(databaseName);
  return archive;
};

const openDestination = async (databaseName) => {
  const destination = new Dexie(databaseName);
  destination.version(3).stores({
    ...Object.fromEntries(BACKUP_TABLE_NAMES.map((name) => [name, 'id'])),
    sync_outbox: 'id, status',
    sync_conflicts: 'id, status',
    financial_intents: 'id, status, projectionStatus',
    transaction_log: 'id, status'
  });
  await destination.open();
  return destination;
};

describe('backupRestore', () => {
  const databases = new Set();
  afterEach(async () => {
    await Promise.all([...databases].map(async (databaseName) => Dexie.delete(databaseName)));
    databases.clear();
  });

  it('restores a V1 archive as partial and keeps tables absent from the file', async () => {
    const databaseName = `backup-restore-v1-${crypto.randomUUID()}`;
    databases.add(databaseName);
    const archive = await openLegacyArchive(databaseName);
    const destination = await openDestination(databaseName);
    await Promise.all([
      destination.table('menu').add({ id: 'product-old', name: 'Debe reemplazarse' }),
      destination.table('sales').add({ id: 'sale-old', total: 10 }),
      destination.table('customers').add({ id: 'customer-old', name: 'Debe reemplazarse' }),
      destination.table('categories').add({ id: 'category-existing', name: 'Se conserva' })
    ]);

    const restored = await restoreWhitelistedDatabase(destination, archive, {
      expectedDatabaseName: databaseName,
      formatVersion: 1
    });

    expect(restored.partial).toBe(true);
    expect(await destination.table('menu').toArray()).toEqual([
      { id: 'product-source', name: 'Producto del archivo' }
    ]);
    expect(await destination.table('sales').toArray()).toEqual([
      { id: 'sale-source', total: 125.5 }
    ]);
    expect(await destination.table('categories').get('category-existing')).toMatchObject({ name: 'Se conserva' });
    destination.close();
  });

  it('keeps an open cash session isolated from the new device identity', async () => {
    const databaseName = `backup-restore-cash-${crypto.randomUUID()}`;
    databases.add(databaseName);
    const archive = await openCurrentArchive(databaseName);
    const destination = await openDestination(databaseName);

    const restored = await restoreWhitelistedDatabase(destination, archive, {
      expectedDatabaseName: databaseName,
      formatVersion: 2
    });
    const session = await destination.table('cajas').get('cash-open');
    const movement = await destination.table('movimientos_caja').get('movement-open');

    expect(restored.partial).toBe(false);
    expect(session).toMatchObject({ estado: 'abierta', cashIdentityState: 'local' });
    expect(session.localStationKey).toMatch(/^local:device:backup-/);
    expect(session.localStationKey).not.toContain('origin-station-secret');
    expect(session).not.toHaveProperty('deviceId');
    expect(session).not.toHaveProperty('deviceFingerprint');
    expect(movement.localStationKey).toBe(session.localStationKey);
    expect(movement.cash_session_id).toBe(session.id);
    expect(movement).not.toHaveProperty('deviceId');
    expect(movement).not.toHaveProperty('deviceFingerprint');
    destination.close();
  });

  it('rejects restore with pending sync and financial operations without changing destination rows', async () => {
    const databaseName = `backup-restore-pending-${crypto.randomUUID()}`;
    databases.add(databaseName);
    const archive = await openLegacyArchive(databaseName);
    const destination = await openDestination(databaseName);
    await Promise.all([
      destination.table('menu').add({ id: 'product-old', name: 'Negocio actual' }),
      destination.table('sync_outbox').add({ id: 'outbox-pending', status: 'pending' }),
      destination.table('financial_intents').add({ id: 'intent-pending', status: 'PENDING_RECEIPT' })
    ]);

    await expect(restoreWhitelistedDatabase(destination, archive, {
      expectedDatabaseName: databaseName,
      formatVersion: 1
    })).rejects.toThrow('BACKUP_RESTORE_PENDING_OPERATIONS');

    expect(await destination.table('menu').toArray()).toEqual([{ id: 'product-old', name: 'Negocio actual' }]);
    expect(await destination.table('sales').count()).toBe(0);
    expect(await destination.table('sync_outbox').toArray()).toEqual([{ id: 'outbox-pending', status: 'pending' }]);
    expect(await destination.table('financial_intents').toArray()).toEqual([{ id: 'intent-pending', status: 'PENDING_RECEIPT' }]);
    destination.close();
  });

  it('restores only sale_folio and leaves other destination sequences untouched', async () => {
    const databaseName = `backup-restore-sequences-${crypto.randomUUID()}`;
    databases.add(databaseName);
    const archive = await openCurrentArchive(databaseName);
    const destination = await openDestination(databaseName);
    await destination.table('sequences').bulkPut([
      { id: 'sale_folio', value: 3 },
      { id: 'receipt_folio', value: 9 }
    ]);

    await restoreWhitelistedDatabase(destination, archive, {
      expectedDatabaseName: databaseName,
      formatVersion: 2
    });

    expect(await destination.table('sequences').get('sale_folio')).toEqual({ id: 'sale_folio', value: 12 });
    expect(await destination.table('sequences').get('receipt_folio')).toEqual({ id: 'receipt_folio', value: 9 });
    destination.close();
  });

  it('rolls back cleared tables if a later table write fails', async () => {
    const databaseName = `backup-restore-rollback-${crypto.randomUUID()}`;
    databases.add(databaseName);
    const archive = await openLegacyArchive(databaseName);
    const destination = await openDestination(databaseName);
    await Promise.all([
      destination.table('menu').add({ id: 'product-old', name: 'Producto actual' }),
      destination.table('sales').add({ id: 'sale-old', total: 10 }),
      destination.table('customers').add({ id: 'customer-old', name: 'Cliente actual' })
    ]);
    const originalTable = destination.table.bind(destination);
    const salesTable = originalTable('sales');
    const failingSalesTable = new Proxy(salesTable, {
      get(target, property) {
        if (property === 'bulkPut') return async () => { throw new Error('simulated write failure'); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const tableSpy = vi.spyOn(destination, 'table').mockImplementation((name) => (
      name === 'sales' ? failingSalesTable : originalTable(name)
    ));

    try {
      await expect(restoreWhitelistedDatabase(destination, archive, {
        expectedDatabaseName: databaseName,
        formatVersion: 1
      })).rejects.toThrow();
    } finally {
      tableSpy.mockRestore();
    }

    expect(await destination.table('menu').get('product-old')).toMatchObject({ name: 'Producto actual' });
    expect(await destination.table('sales').get('sale-old')).toMatchObject({ total: 10 });
    expect(await destination.table('customers').get('customer-old')).toMatchObject({ name: 'Cliente actual' });
    destination.close();
  });
});
