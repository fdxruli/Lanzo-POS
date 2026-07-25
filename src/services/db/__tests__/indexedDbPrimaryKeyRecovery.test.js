import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME } from '../../../config/dbConfig';
import { RECOVERY_STORES } from '../databaseSchema';
import {
  getActiveNativeOpenOperations,
  inspectIndexedDbStructure,
  openNativeDatabase,
  preflightAndRepairIndexedDb,
  readPrimaryKeyRecoveryMarker,
  resetIndexedDbPreflightForTests
} from '../indexedDbPreflight';

const deleteDatabase = (name = DB_NAME) => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
});

const createLegacyDatabase = ({ sales = [], deletedSales = [], keepOpen = false } = {}) => (
  new Promise((resolve, reject) => {
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
      if (keepOpen) resolve(request.result);
      else {
        request.result.close();
        resolve(null);
      }
    };
  })
);

const createNewerDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 310);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => request.result.createObjectStore('sales', { keyPath: 'id' });
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});

const createCompatibleIncompleteDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 120);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('sales', { keyPath: 'id' });
    request.result.createObjectStore('deleted_sales', { keyPath: 'id' });
  };
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});

const createBackupCompleteDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 111);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    const database = request.result;
    const transaction = request.transaction;
    database.createObjectStore('sales', { keyPath: 'timestamp' });
    database.createObjectStore('deleted_sales', { keyPath: 'timestamp' });
    const salesBackup = database.createObjectStore(RECOVERY_STORES.SALES_BACKUP, { keyPath: 'legacyKey' });
    salesBackup.createIndex('sourceKey', 'sourceKey');
    const deletedBackup = database.createObjectStore(RECOVERY_STORES.DELETED_SALES_BACKUP, { keyPath: 'legacyKey' });
    deletedBackup.createIndex('sourceKey', 'sourceKey');
    const meta = database.createObjectStore(RECOVERY_STORES.META, { keyPath: 'key' });

    salesBackup.add({
      legacyKey: 'sales:2024-01-01T00:00:00.000Z',
      sourceKey: '2024-01-01T00:00:00.000Z',
      originalId: 'duplicate',
      migratedId: 'duplicate',
      idRemapped: false,
      remapReason: null,
      record: { id: 'duplicate', timestamp: '2024-01-01T00:00:00.000Z', total: 100 }
    });
    salesBackup.add({
      legacyKey: 'sales:2024-01-02T00:00:00.000Z',
      sourceKey: '2024-01-02T00:00:00.000Z',
      originalId: 'duplicate',
      migratedId: 'duplicate:legacy:fixed',
      idRemapped: true,
      remapReason: 'duplicate_id',
      record: { id: 'duplicate', timestamp: '2024-01-02T00:00:00.000Z', total: 200 }
    });

    // Hashes FNV-1a esperados por el algoritmo de producción.
    const stableHash = (values) => {
      let hash = 2166136261;
      values.forEach((value) => {
        const input = String(value);
        for (let index = 0; index < input.length; index += 1) {
          hash ^= input.charCodeAt(index);
          hash = Math.imul(hash, 16777619) >>> 0;
        }
      });
      return (hash >>> 0).toString(16).padStart(8, '0');
    };

    meta.put({
      key: 'primary-key-recovery-v1',
      phase: 'backup_complete',
      sourceCounts: { sales: 2, deleted_sales: 0 },
      sourceHashes: {
        sales: stableHash(['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']),
        deleted_sales: stableHash([])
      },
      idHashes: {
        sales: stableHash(['duplicate', 'duplicate:legacy:fixed']),
        deleted_sales: stableHash([])
      },
      backupNativeVersion: 111
    });

    transaction.objectStore('sales');
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

const waitUntil = async (predicate, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Condition timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const sampleRecords = () => ({
  sales: [
    {
      id: 'duplicate-sale',
      timestamp: '2022-10-15T20:00:00.000Z',
      total: 185,
      customerId: 'customer-1',
      status: 'completed',
      optionalNote: null
    },
    {
      id: 'duplicate-sale',
      timestamp: '2022-10-16T20:00:00.000Z',
      total: 75,
      customerId: 'customer-2',
      status: 'credit'
    },
    {
      id: '',
      timestamp: '2022-10-17T20:00:00.000Z',
      total: 50,
      customerId: 'customer-3'
    },
    {
      id: 42,
      timestamp: '2022-10-18T20:00:00.000Z',
      total: 25,
      customerId: 'customer-4'
    }
  ],
  deletedSales: [
    { id: 'deleted-duplicate', timestamp: '2022-10-10T20:00:00.000Z', total: 80 },
    { id: 'deleted-duplicate', timestamp: '2022-10-11T20:00:00.000Z', total: 95 },
    { timestamp: '2022-10-12T20:00:00.000Z', total: 60 }
  ]
});

afterEach(async () => {
  resetIndexedDbPreflightForTests();
  await deleteDatabase().catch(() => {});
});

describe('IndexedDB primary-key preserving recovery', () => {
  it('classifies a missing database as new without deleting anything', async () => {
    const inspection = await inspectIndexedDbStructure();
    expect(inspection.classification).toBe('new');
    expect(inspection.mismatches).toEqual([]);
  });

  it('migrates an empty legacy database and keeps backup stores', async () => {
    await createLegacyDatabase();
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

  it('preserves duplicate, missing, empty and numeric ids without losing rows', async () => {
    const source = sampleRecords();
    await createLegacyDatabase(source);

    const result = await preflightAndRepairIndexedDb();
    const sales = await readAll('sales');
    const deletedSales = await readAll('deleted_sales');
    const salesBackup = await readAll(RECOVERY_STORES.SALES_BACKUP);
    const deletedBackup = await readAll(RECOVERY_STORES.DELETED_SALES_BACKUP);

    expect(result.sourceCounts).toEqual({ sales: 4, deleted_sales: 3 });
    expect(result.targetCounts).toEqual({ sales: 4, deleted_sales: 3 });
    expect(sales).toHaveLength(4);
    expect(deletedSales).toHaveLength(3);
    expect(new Set(sales.map((record) => `${typeof record.id}:${record.id}`)).size).toBe(4);
    expect(new Set(deletedSales.map((record) => `${typeof record.id}:${record.id}`)).size).toBe(3);
    expect(sales.find((record) => record.timestamp === '2022-10-15T20:00:00.000Z')).toMatchObject({
      id: 'duplicate-sale',
      total: 185,
      customerId: 'customer-1',
      status: 'completed',
      optionalNote: null
    });
    expect(sales.find((record) => record.timestamp === '2022-10-16T20:00:00.000Z').id)
      .toMatch(/^duplicate-sale:legacy:/);
    expect(sales.find((record) => record.timestamp === '2022-10-17T20:00:00.000Z').id)
      .toBe('legacy-sale:2022-10-17T20:00:00.000Z');
    expect(sales.find((record) => record.timestamp === '2022-10-18T20:00:00.000Z').id).toBe(42);
    expect(salesBackup).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalId: 'duplicate-sale', idRemapped: false, remapReason: null }),
      expect.objectContaining({ originalId: 'duplicate-sale', idRemapped: true, remapReason: 'duplicate_id' }),
      expect.objectContaining({ originalId: null, idRemapped: true, remapReason: 'missing_id' })
    ]));
    expect(deletedBackup.filter((entry) => entry.originalId === 'deleted-duplicate'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ idRemapped: false }),
        expect.objectContaining({ idRemapped: true, remapReason: 'duplicate_id' })
      ]));
  });

  it('generates exactly the same deterministic ids across repeated executions', async () => {
    const source = sampleRecords();
    await createLegacyDatabase(source);
    await preflightAndRepairIndexedDb();
    const firstIds = (await readAll('sales')).map((record) => record.id);

    await deleteDatabase();
    await createLegacyDatabase(source);
    await preflightAndRepairIndexedDb();
    const secondIds = (await readAll('sales')).map((record) => record.id);

    expect(secondIds).toEqual(firstIds);
  });

  it('resumes from backup_complete using the stored migratedId decisions', async () => {
    await createBackupCompleteDatabase();

    const result = await preflightAndRepairIndexedDb();
    const sales = await readAll('sales');

    expect(result.migrated).toBe(true);
    expect(sales.map((record) => record.id)).toEqual([
      'duplicate',
      'duplicate:legacy:fixed'
    ]);
    expect(sales.map((record) => record.total)).toEqual([100, 200]);
  });

  it('does not produce a false open timeout during a slow migration', async () => {
    const sales = Array.from({ length: 500 }, (_, index) => ({
      id: index % 2 === 0 ? 'shared' : undefined,
      timestamp: `2025-01-${String(Math.floor(index / 24) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      total: index + 1
    }));
    await createLegacyDatabase({ sales });

    const result = await preflightAndRepairIndexedDb({ openTimeoutMs: 1 });
    const migrated = await readAll('sales');

    expect(result.migrated).toBe(true);
    expect(migrated).toHaveLength(500);
    expect(new Set(migrated.map((record) => record.id)).size).toBe(500);
  });

  it('keeps one blocked native request and continues after the other connection closes', async () => {
    const blockingConnection = await createLegacyDatabase({
      sales: [{ id: 'sale-1', timestamp: '2024-01-01T00:00:00.000Z', total: 100 }],
      keepOpen: true
    });
    const onBlocked = vi.fn();

    const migration = preflightAndRepairIndexedDb({ onBlocked });
    await waitUntil(() => onBlocked.mock.calls.length === 1);

    expect(getActiveNativeOpenOperations().filter((operation) => operation.state === 'blocked')).toHaveLength(1);
    blockingConnection.close();

    const result = await migration;
    expect(result.migrated).toBe(true);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(getActiveNativeOpenOperations()).toEqual([]);
  });

  it('deduplicates retries while the same upgrade request remains blocked', async () => {
    const blockingConnection = await createLegacyDatabase({
      sales: [{ timestamp: '2024-02-01T00:00:00.000Z', total: 10 }],
      keepOpen: true
    });
    const onBlocked = vi.fn();

    const first = preflightAndRepairIndexedDb({ onBlocked });
    await waitUntil(() => onBlocked.mock.calls.length === 1);
    const second = preflightAndRepairIndexedDb({ onBlocked });

    expect(getActiveNativeOpenOperations().filter((operation) => operation.state === 'blocked')).toHaveLength(1);
    blockingConnection.close();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.migrated || secondResult.migrated).toBe(true);
    expect(await readAll('sales')).toHaveLength(1);
  });

  it('times out an opening request that truly never responds without starting another request', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };

    const first = openNativeDatabase({ factory, name: 'HungDB', openTimeoutMs: 5 });
    await expect(first).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    const second = openNativeDatabase({ factory, name: 'HungDB', openTimeoutMs: 5 });

    expect(second).toBe(first);
    await expect(second).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    expect(factory.open).toHaveBeenCalledTimes(1);
  });

  it('rejects a newer native version without downgrade or deletion', async () => {
    await createNewerDatabase();

    await expect(preflightAndRepairIndexedDb()).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION'
    });
    const inspection = await inspectIndexedDbStructure();
    expect(inspection.nativeVersion).toBe(310);
    expect(inspection.stores.sales).toBeDefined();
  });

  it('allows a compatible incomplete schema to continue through normal Dexie upgrade', async () => {
    await createCompatibleIncompleteDatabase();

    const result = await preflightAndRepairIndexedDb();

    expect(result.migrated).toBe(false);
    expect(result.inspection.classification).toBe('compatible_outdated');
    expect(result.inspection.mismatches).toEqual([]);
  });

  it('is idempotent after a successful reconstruction', async () => {
    await createLegacyDatabase({
      sales: [{ timestamp: '2024-01-01T00:00:00.000Z', total: 100 }],
      deletedSales: [{ timestamp: '2024-01-02T00:00:00.000Z', total: 50 }]
    });

    const first = await preflightAndRepairIndexedDb();
    const second = await preflightAndRepairIndexedDb();

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(await readAll('sales')).toHaveLength(1);
    expect(await readAll('deleted_sales')).toHaveLength(1);
  });
});
