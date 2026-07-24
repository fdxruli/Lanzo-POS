import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '../../../config/dbConfig';
import { RECOVERY_STORES } from '../databaseSchema';
import {
  inspectIndexedDbStructure,
  preflightAndRepairIndexedDb,
  readPrimaryKeyRecoveryMarker
} from '../indexedDbPreflight';

const deleteDatabase = (name = DB_NAME) => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
});

const createLegacyDatabase = ({ sales = [], deletedSales = [] } = {}) => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 110);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    const database = request.result;
    const salesStore = database.createObjectStore('sales', { keyPath: 'timestamp' });
    salesStore.createIndex('customerId', 'customerId');
    const deletedStore = database.createObjectStore('deleted_sales', { keyPath: 'timestamp' });
    database.createObjectStore('menu', { keyPath: 'id' });
    database.createObjectStore('customers', { keyPath: 'id' });
    database.createObjectStore('cajas', { keyPath: 'id' });
    database.createObjectStore('movimientos_caja', { keyPath: 'id' });

    sales.forEach((record) => salesStore.add(record));
    deletedSales.forEach((record) => deletedStore.add(record));
  };
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});

const readAll = (storeName) => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(storeName, 'readonly');
    const getAllRequest = transaction.objectStore(storeName).getAll();
    getAllRequest.onsuccess = () => resolve(getAllRequest.result);
    getAllRequest.onerror = () => reject(getAllRequest.error);
    transaction.oncomplete = () => database.close();
  };
});

afterEach(async () => {
  await deleteDatabase();
});

describe('IndexedDB primary-key preserving recovery', () => {
  it('classifies a missing database as new without deleting anything', async () => {
    const inspection = await inspectIndexedDbStructure();
    expect(inspection.classification).toBe('new');
    expect(inspection.mismatches).toEqual([]);
  });

  it('migrates an empty legacy database and keeps backup stores', async () => {
    await createLegacyDatabase();

    const before = await inspectIndexedDbStructure();
    expect(before.classification).toBe('primary_key_incompatible');
    expect(before.stores.sales.keyPath).toBe('timestamp');
    expect(before.stores.deleted_sales.keyPath).toBe('timestamp');

    const result = await preflightAndRepairIndexedDb();
    const after = await inspectIndexedDbStructure();
    const marker = await readPrimaryKeyRecoveryMarker();

    expect(result.migrated).toBe(true);
    expect(after.stores.sales.keyPath).toBe('id');
    expect(after.stores.deleted_sales.keyPath).toBe('id');
    expect(after.stores[RECOVERY_STORES.SALES_BACKUP]).toBeDefined();
    expect(after.stores[RECOVERY_STORES.DELETED_SALES_BACKUP]).toBeDefined();
    expect(marker.phase).toBe('rebuild_complete');
    expect(marker.sourceCounts).toEqual({ sales: 0, deleted_sales: 0 });
    expect(marker.targetCounts).toEqual({ sales: 0, deleted_sales: 0 });
  });

  it('preserves ids, assigns deterministic ids and keeps financial fields', async () => {
    await createLegacyDatabase({
      sales: [
        {
          id: 'sale-existing',
          timestamp: '2022-10-15T20:00:00.000Z',
          total: 185,
          customerId: 'customer-1',
          status: 'completed',
          optionalNote: null
        },
        {
          timestamp: '2022-10-16T20:00:00.000Z',
          total: 75,
          customerId: 'customer-2',
          status: 'credit'
        }
      ],
      deletedSales: [
        {
          id: 'deleted-existing',
          timestamp: '2022-10-10T20:00:00.000Z',
          total: 80,
          customerId: 'customer-3'
        },
        {
          timestamp: '2022-10-11T20:00:00.000Z',
          total: 95,
          customerId: 'customer-4'
        }
      ]
    });

    const result = await preflightAndRepairIndexedDb();
    const sales = await readAll('sales');
    const deletedSales = await readAll('deleted_sales');
    const salesBackup = await readAll(RECOVERY_STORES.SALES_BACKUP);
    const deletedBackup = await readAll(RECOVERY_STORES.DELETED_SALES_BACKUP);

    expect(result.sourceCounts).toEqual({ sales: 2, deleted_sales: 2 });
    expect(result.targetCounts).toEqual({ sales: 2, deleted_sales: 2 });
    expect(sales).toHaveLength(2);
    expect(deletedSales).toHaveLength(2);
    expect(salesBackup).toHaveLength(2);
    expect(deletedBackup).toHaveLength(2);

    expect(sales.find((record) => record.timestamp === '2022-10-15T20:00:00.000Z')).toMatchObject({
      id: 'sale-existing',
      total: 185,
      customerId: 'customer-1',
      status: 'completed',
      optionalNote: null
    });
    expect(sales.find((record) => record.timestamp === '2022-10-16T20:00:00.000Z')).toMatchObject({
      id: 'legacy-sale:2022-10-16T20:00:00.000Z',
      total: 75,
      customerId: 'customer-2',
      status: 'credit'
    });
    expect(deletedSales.find((record) => record.timestamp === '2022-10-11T20:00:00.000Z')).toMatchObject({
      id: 'legacy-deleted-sale:2022-10-11T20:00:00.000Z',
      total: 95,
      customerId: 'customer-4'
    });
  });

  it('is idempotent after a successful reconstruction', async () => {
    await createLegacyDatabase({
      sales: [{ timestamp: '2024-01-01T00:00:00.000Z', total: 100 }],
      deletedSales: [{ timestamp: '2024-01-02T00:00:00.000Z', total: 50 }]
    });

    const first = await preflightAndRepairIndexedDb();
    const second = await preflightAndRepairIndexedDb();
    const sales = await readAll('sales');
    const deletedSales = await readAll('deleted_sales');

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(sales).toHaveLength(1);
    expect(deletedSales).toHaveLength(1);
    expect(new Set(sales.map((record) => record.id)).size).toBe(1);
    expect(new Set(deletedSales.map((record) => record.id)).size).toBe(1);
  });
});
