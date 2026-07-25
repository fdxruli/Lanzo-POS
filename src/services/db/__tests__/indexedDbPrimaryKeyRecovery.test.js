import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME } from '../../../config/dbConfig';
import { RECOVERY_STORES } from '../databaseSchema';
import {
  getActiveNativeOpenOperations,
  inspectIndexedDbStructure,
  openNativeDatabase,
  readPrimaryKeyRecoveryMarker,
  resetIndexedDbPreflightForTests,
  subscribeNativeOpenOperations
} from '../indexedDbPreflight';
import {
  getActiveIndexedDbPreflightOperations,
  preflightAndRepairIndexedDb,
  resetIndexedDbPreflightCoordinatorForTests
} from '../indexedDbPreflightCoordinator';

const deleteDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = resolve;
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Delete blocked'));
});

const openDatabase = (version, upgrade, keepOpen = false) => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, version);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => upgrade(request.result, request.transaction);
  request.onsuccess = () => {
    if (keepOpen) resolve(request.result);
    else {
      request.result.close();
      resolve(null);
    }
  };
});

const createLegacyDatabase = ({ sales = [], deletedSales = [], keepOpen = false } = {}) => (
  openDatabase(110, (database) => {
    const salesStore = database.createObjectStore('sales', { keyPath: 'timestamp' });
    const deletedStore = database.createObjectStore('deleted_sales', { keyPath: 'timestamp' });
    database.createObjectStore('menu', { keyPath: 'id' });
    database.createObjectStore('customers', { keyPath: 'id' });
    database.createObjectStore('cajas', { keyPath: 'id' });
    database.createObjectStore('movimientos_caja', { keyPath: 'id' });
    sales.forEach((record) => salesStore.add(record));
    deletedSales.forEach((record) => deletedStore.add(record));
  }, keepOpen)
);

const readAll = (storeName) => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(storeName, 'readonly');
    const readRequest = transaction.objectStore(storeName).getAll();
    readRequest.onsuccess = () => resolve(readRequest.result);
    readRequest.onerror = () => reject(readRequest.error);
    transaction.oncomplete = () => database.close();
  };
});

const waitUntil = async (predicate) => {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const hashValues = (values) => {
  let hash = 2166136261;
  values.forEach((value) => {
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  });
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createBackupCompleteDatabase = () => openDatabase(111, (database) => {
  database.createObjectStore('sales', { keyPath: 'timestamp' });
  database.createObjectStore('deleted_sales', { keyPath: 'timestamp' });
  const salesBackup = database.createObjectStore(
    RECOVERY_STORES.SALES_BACKUP,
    { keyPath: 'legacyKey' }
  );
  const deletedBackup = database.createObjectStore(
    RECOVERY_STORES.DELETED_SALES_BACKUP,
    { keyPath: 'legacyKey' }
  );
  salesBackup.createIndex('sourceKey', 'sourceKey');
  deletedBackup.createIndex('sourceKey', 'sourceKey');
  const meta = database.createObjectStore(RECOVERY_STORES.META, { keyPath: 'key' });
  const sourceKeys = ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'];
  const migratedIds = ['duplicate', 'duplicate:legacy:fixed'];

  sourceKeys.forEach((sourceKey, index) => salesBackup.add({
    legacyKey: `sales:${sourceKey}`,
    sourceKey,
    originalId: 'duplicate',
    migratedId: migratedIds[index],
    idRemapped: index > 0,
    remapReason: index > 0 ? 'duplicate_id' : null,
    record: { id: 'duplicate', timestamp: sourceKey, total: (index + 1) * 100 }
  }));

  meta.put({
    key: 'primary-key-recovery-v1',
    phase: 'backup_complete',
    sourceCounts: { sales: 2, deleted_sales: 0 },
    sourceHashes: { sales: hashValues(sourceKeys), deleted_sales: hashValues([]) },
    idHashes: { sales: hashValues(migratedIds), deleted_sales: hashValues([]) },
    backupNativeVersion: 111
  });
});

const sampleRecords = () => ({
  sales: [
    { id: 'duplicate', timestamp: '2022-10-15T20:00:00.000Z', total: 185, customerId: 'c1', status: 'completed' },
    { id: 'duplicate', timestamp: '2022-10-16T20:00:00.000Z', total: 75, customerId: 'c2', status: 'credit' },
    { id: '', timestamp: '2022-10-17T20:00:00.000Z', total: 50, customerId: 'c3' },
    { id: 42, timestamp: '2022-10-18T20:00:00.000Z', total: 25, customerId: 'c4' }
  ],
  deletedSales: [
    { id: 'deleted-duplicate', timestamp: '2022-10-10T20:00:00.000Z', total: 80 },
    { id: 'deleted-duplicate', timestamp: '2022-10-11T20:00:00.000Z', total: 95 },
    { timestamp: '2022-10-12T20:00:00.000Z', total: 60 }
  ]
});

afterEach(async () => {
  resetIndexedDbPreflightCoordinatorForTests();
  resetIndexedDbPreflightForTests();
  await deleteDatabase().catch(() => {});
});

describe('IndexedDB primary-key preserving recovery', () => {
  it('classifies a missing database as new', async () => {
    expect(await inspectIndexedDbStructure()).toMatchObject({ classification: 'new', mismatches: [] });
  });

  it('migrates an empty legacy database and keeps backups', async () => {
    await createLegacyDatabase();
    const result = await preflightAndRepairIndexedDb();
    const inspection = await inspectIndexedDbStructure();
    const marker = await readPrimaryKeyRecoveryMarker();

    expect(result.migrated).toBe(true);
    expect(inspection.stores.sales.keyPath).toBe('id');
    expect(inspection.stores.deleted_sales.keyPath).toBe('id');
    expect(inspection.stores[RECOVERY_STORES.SALES_BACKUP]).toBeDefined();
    expect(marker).toMatchObject({
      phase: 'rebuild_complete',
      sourceCounts: { sales: 0, deleted_sales: 0 },
      targetCounts: { sales: 0, deleted_sales: 0 }
    });
  });

  it('preserves duplicate, missing, empty and numeric ids without losing rows', async () => {
    await createLegacyDatabase(sampleRecords());
    const result = await preflightAndRepairIndexedDb();
    const sales = await readAll('sales');
    const deletedSales = await readAll('deleted_sales');
    const backup = await readAll(RECOVERY_STORES.SALES_BACKUP);

    expect(result.sourceCounts).toEqual({ sales: 4, deleted_sales: 3 });
    expect(result.targetCounts).toEqual({ sales: 4, deleted_sales: 3 });
    expect(sales).toHaveLength(4);
    expect(deletedSales).toHaveLength(3);
    expect(new Set(sales.map(({ id }) => `${typeof id}:${id}`)).size).toBe(4);
    expect(new Set(deletedSales.map(({ id }) => `${typeof id}:${id}`)).size).toBe(3);
    expect(sales.find(({ timestamp }) => timestamp.includes('10-16')).id).toMatch(/^duplicate:legacy:/);
    expect(sales.find(({ timestamp }) => timestamp.includes('10-17')).id)
      .toBe('legacy-sale:2022-10-17T20:00:00.000Z');
    expect(sales.find(({ timestamp }) => timestamp.includes('10-18')).id).toBe(42);
    expect(backup).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalId: 'duplicate', idRemapped: false, remapReason: null }),
      expect.objectContaining({ originalId: 'duplicate', idRemapped: true, remapReason: 'duplicate_id' }),
      expect.objectContaining({ originalId: null, idRemapped: true, remapReason: 'missing_id' })
    ]));
  });

  it('generates identical deterministic ids on repeated executions', async () => {
    const records = sampleRecords();
    await createLegacyDatabase(records);
    await preflightAndRepairIndexedDb();
    const first = (await readAll('sales')).map(({ id }) => id);
    await deleteDatabase();
    await createLegacyDatabase(records);
    await preflightAndRepairIndexedDb();
    expect((await readAll('sales')).map(({ id }) => id)).toEqual(first);
  });

  it('resumes from backup_complete using stored migratedId values', async () => {
    await createBackupCompleteDatabase();
    await preflightAndRepairIndexedDb();
    expect((await readAll('sales')).map(({ id }) => id)).toEqual([
      'duplicate',
      'duplicate:legacy:fixed'
    ]);
  });

  it('cancels the opening timeout after upgrade starts even when success is slow', async () => {
    const request = {
      result: { name: 'SlowUpgradeDB' },
      transaction: { abort: vi.fn() }
    };
    const factory = { open: vi.fn(() => request) };
    const onUpgrade = vi.fn();
    const opening = openNativeDatabase({
      factory,
      name: 'SlowUpgradeDB',
      version: 2,
      openTimeoutMs: 5,
      onUpgrade
    });

    request.onupgradeneeded({ oldVersion: 1, newVersion: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    request.onsuccess();

    await expect(opening).resolves.toBe(request.result);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(request.transaction.abort).not.toHaveBeenCalled();
  });

  it('migrates a reasonable volume without loss or duplicate ids', async () => {
    const sales = Array.from({ length: 500 }, (_, index) => ({
      id: index % 2 ? undefined : 'shared',
      timestamp: `sale-${String(index).padStart(4, '0')}`,
      total: index + 1
    }));
    await createLegacyDatabase({ sales });
    const result = await preflightAndRepairIndexedDb();
    const migrated = await readAll('sales');
    expect(result.migrated).toBe(true);
    expect(migrated).toHaveLength(500);
    expect(new Set(migrated.map(({ id }) => id)).size).toBe(500);
  });

  it('continues one blocked native request after the other connection closes', async () => {
    const blocker = await createLegacyDatabase({
      sales: [{ id: 's1', timestamp: '2024-01-01', total: 100 }],
      keepOpen: true
    });
    const onBlocked = vi.fn();
    const migration = preflightAndRepairIndexedDb({ onBlocked });
    await waitUntil(() => onBlocked.mock.calls.length === 1);
    expect(getActiveNativeOpenOperations().filter(({ state }) => state === 'blocked')).toHaveLength(1);
    blocker.close();
    expect((await migration).migrated).toBe(true);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('deduplicates retries at the complete preparation boundary', async () => {
    const blocker = await createLegacyDatabase({
      sales: [{ timestamp: '2024-02-01', total: 10 }],
      keepOpen: true
    });
    const onBlocked = vi.fn();
    const first = preflightAndRepairIndexedDb({ onBlocked });
    await waitUntil(() => onBlocked.mock.calls.length === 1);
    const second = preflightAndRepairIndexedDb({ onBlocked });

    expect(second).toBe(first);
    expect(getActiveIndexedDbPreflightOperations()).toEqual([DB_NAME]);
    expect(getActiveNativeOpenOperations().filter(({ state }) => state === 'blocked')).toHaveLength(1);
    blocker.close();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.migrated).toBe(true);
    expect(await readAll('sales')).toHaveLength(1);
    expect(getActiveIndexedDbPreflightOperations()).toEqual([]);
  });

  it('times out a truly hung opening request without starting another', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };
    const snapshots = [];
    const unsubscribe = subscribeNativeOpenOperations(() => {
      snapshots.push(getActiveNativeOpenOperations());
    });
    const first = openNativeDatabase({ factory, name: 'HungDB', openTimeoutMs: 5 });
    await expect(first).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    expect(getActiveNativeOpenOperations()).toEqual([{
      key: 'HungDB:current',
      state: 'timed_out_waiting_native_settlement'
    }]);
    const second = openNativeDatabase({ factory, name: 'HungDB', openTimeoutMs: 5 });
    expect(second).toBe(first);
    await expect(second).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    expect(factory.open).toHaveBeenCalledTimes(1);
    expect(snapshots.map((snapshot) => snapshot.map(({ state }) => state))).toEqual([
      ['opening'],
      ['timed_out_waiting_native_settlement']
    ]);
    unsubscribe();
  });

  it('publishes a stable snapshot and removes a timed-out request after late settlement', async () => {
    const database = { close: vi.fn() };
    const request = { result: database };
    const factory = { open: vi.fn(() => request) };
    const snapshots = [];
    const listener = vi.fn(() => snapshots.push(getActiveNativeOpenOperations()));
    const unsubscribe = subscribeNativeOpenOperations(listener);

    const opening = openNativeDatabase({ factory, name: 'LateDB', openTimeoutMs: 5 });
    const openingSnapshot = getActiveNativeOpenOperations();
    expect(getActiveNativeOpenOperations()).toBe(openingSnapshot);
    await expect(opening).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    const timeoutSnapshot = getActiveNativeOpenOperations();
    expect(getActiveNativeOpenOperations()).toBe(timeoutSnapshot);

    request.onsuccess();

    expect(database.close).toHaveBeenCalledTimes(1);
    expect(getActiveNativeOpenOperations()).toEqual([]);
    expect(factory.open).toHaveBeenCalledTimes(1);
    expect(snapshots.map((snapshot) => snapshot.map(({ state }) => state))).toEqual([
      ['opening'],
      ['timed_out_waiting_native_settlement'],
      ['succeeded'],
      []
    ]);
    unsubscribe();
  });

  it('rejects a newer native version without downgrade or deletion', async () => {
    await openDatabase(310, (database) => database.createObjectStore('sales', { keyPath: 'id' }));
    await expect(preflightAndRepairIndexedDb()).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION'
    });
    expect((await inspectIndexedDbStructure()).nativeVersion).toBe(310);
  });

  it('allows a compatible incomplete schema through normal Dexie upgrade', async () => {
    await openDatabase(120, (database) => {
      database.createObjectStore('sales', { keyPath: 'id' });
      database.createObjectStore('deleted_sales', { keyPath: 'id' });
    });
    const result = await preflightAndRepairIndexedDb();
    expect(result.migrated).toBe(false);
    expect(result.inspection).toMatchObject({ classification: 'compatible_outdated', mismatches: [] });
  });

  it('is idempotent after successful reconstruction', async () => {
    await createLegacyDatabase({
      sales: [{ timestamp: '2024-01-01', total: 100 }],
      deletedSales: [{ timestamp: '2024-01-02', total: 50 }]
    });
    expect((await preflightAndRepairIndexedDb()).migrated).toBe(true);
    expect((await preflightAndRepairIndexedDb()).migrated).toBe(false);
    expect(await readAll('sales')).toHaveLength(1);
    expect(await readAll('deleted_sales')).toHaveLength(1);
  });
});
