// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database', () => ({
  createProductWithInitialInventorySafe: vi.fn(), loadData: vi.fn(), loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(), saveImageToDB: vi.fn(),
  softDeleteWithCascadeSafe: vi.fn(), updateProductSafe: vi.fn()
}));
vi.mock('../../db/general', () => ({ categoriesRepository: {} }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: {} }));
vi.mock('../../sales/tableReservationReconciliation', () => ({ reconcileActiveTableReservations: vi.fn() }));

let connections;
let repositories;
const normalize = (name) => name.replace(/\s+/g, '').toLowerCase();
const openConnection = async (name) => {
  const db = new Dexie(name);
  db.version(1).stores({ categories: 'id, name, isActive, sortOrder', deleted_categories: 'id' });
  await db.open();
  return db;
};
const loadRepository = async (db) => {
  vi.resetModules();
  vi.doMock('../../db/dexie', () => ({ db, STORES: { CATEGORIES: 'categories' } }));
  return (await import('../productLocalRepository')).productLocalRepository;
};

beforeEach(async () => {
  const name = `category-f05-${crypto.randomUUID()}`;
  connections = [await openConnection(name), await openConnection(name)];
  repositories = [await loadRepository(connections[0]), await loadRepository(connections[1])];
});
afterEach(async () => {
  vi.restoreAllMocks();
  connections.forEach((db) => db.close());
  await connections[0].delete();
  vi.doUnmock('../../db/dexie');
});

// Test-only barrier: make the original nontransactional implementation finish both
// checks before either put. Atomic writes must not wait for another rw transaction:
// IndexedDB serializes those transactions, so the barrier applies only outside one.
const coordinateUnprotectedWrites = () => {
  let arrivals = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  for (const db of connections) {
    const table = db.table('categories');
    const put = table.put.bind(table);
    vi.spyOn(table, 'put').mockImplementation(async (...args) => {
      if (!Dexie.currentTransaction) {
        if (++arrivals === 2) release();
        await ready;
      }
      return put(...args);
    });
  }
};

const assertRace = async (inputs) => {
  coordinateUnprotectedWrites();
  const results = await Promise.allSettled(inputs.map((input, i) => repositories[i].saveCategoryLocal(input)));
  const rows = await connections[0].table('categories').toArray();
  const winners = results.filter((result) => result.status === 'fulfilled');
  expect(winners).toHaveLength(1);
  const loser = results.find((result) => result.status === 'rejected');
  expect(loser.reason.message).toBe('Ya existe una categoria activa con este nombre.');
  const active = rows.filter((row) => row.isActive !== false);
  expect(new Set(active.map((row) => normalize(row.name))).size).toBe(active.length);
  expect(active.filter((row) => normalize(row.name) === normalize(inputs[0].name))).toEqual([winners[0].value]);
  expect(rows.map((row) => row.id).sort()).toEqual(inputs.map((row) => row.id).sort());
  return { rows, results };
};

describe('F-05 category uniqueness with real Dexie and two IndexedDB connections', () => {
  it.each([
    ['Bebidas', ' bebidas '], ['Refrescos', 'REFRESCOS'], ['Refrescos', ' Re frescos ']
  ])('serializes concurrent creates: %s / %s', async (a, b) => {
    const untouched = { id: 'unrelated', name: 'Botanas', color: '#abcdef', sortOrder: 8 };
    await connections[0].table('categories').put(untouched);
    coordinateUnprotectedWrites();
    const results = await Promise.allSettled([
      repositories[0].saveCategoryLocal({ id: 'a', name: a }),
      repositories[1].saveCategoryLocal({ id: 'b', name: b })
    ]);
    const rows = await connections[1].table('categories').toArray();
    expect(rows.filter((row) => normalize(row.name) === normalize(a))).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.message).toBe('Ya existe una categoria activa con este nombre.');
    const winner = results.find((result) => result.status === 'fulfilled').value;
    expect(['a', 'b']).toContain(winner.id);
    expect(rows).toEqual(expect.arrayContaining([untouched, winner]));
    expect(rows).toHaveLength(2);
  });

  it('preserves complete records for concurrent different names', async () => {
    const results = await Promise.all([
      repositories[0].saveCategoryLocal({ id: 'a', name: 'Bebidas', color: '#123abc', sortOrder: 7 }),
      repositories[1].saveCategoryLocal({ id: 'b', name: 'Botanas', color: '#abcdef', sortOrder: 2 })
    ]);
    expect(await connections[0].table('categories').toArray()).toEqual(results);
    expect(results[0]).toMatchObject({ color: '#123abc', sortOrder: 7 });
  });

  it('allows an edit of the same ID and rejects renaming another without partial writes', async () => {
    const first = await repositories[0].saveCategoryLocal({ id: 'a', name: 'Bebidas' });
    const second = await repositories[0].saveCategoryLocal({ id: 'b', name: 'Botanas' });
    const edited = await repositories[1].saveCategoryLocal({ ...first, color: '#123abc', sortOrder: 9 });
    await expect(repositories[0].saveCategoryLocal({ ...second, name: ' bebidas ' })).rejects.toThrow('Ya existe una categoria activa');
    expect(await connections[1].table('categories').toArray()).toEqual([edited, second]);
  });

  it('serializes concurrent edits and preserves the losing original record', async () => {
    const original = [{ id: 'a', name: 'A', color: '#123abc' }, { id: 'b', name: 'B', sortOrder: 7 }];
    await connections[0].table('categories').bulkPut(original);
    const { rows, results } = await assertRace(original.map((row, i) => ({ ...row, name: i ? ' bebidas ' : 'Bebidas' })));
    const loserIndex = results.findIndex((result) => result.status === 'rejected');
    expect(rows.find((row) => row.id === original[loserIndex].id)).toEqual(original[loserIndex]);
  });

  it('preserves inactive and trashed records and applies the existing legacy active rule', async () => {
    const inactive = { id: 'old', name: 'Bebidas', isActive: false, deletedAt: '2026-01-01' };
    const trashed = { id: 'trash', name: 'Bebidas' };
    await connections[0].table('categories').put(inactive);
    await connections[0].table('deleted_categories').put(trashed);
    const saved = await repositories[0].saveCategoryLocal({ name: 'Bebidas' });
    expect(saved.id).not.toBe(inactive.id);
    expect(saved.id).not.toBe(trashed.id);
    expect(await connections[1].table('categories').toArray()).toEqual(expect.arrayContaining([inactive, saved]));
    expect(await connections[1].table('deleted_categories').toArray()).toEqual([trashed]);
    await connections[0].table('categories').put({ id: 'legacy', name: 'Legacy' });
    await expect(repositories[1].saveCategoryLocal({ id: 'new', name: ' LEG ACY ' })).rejects.toThrow('Ya existe una categoria activa');
  });

  it('propagates actual IndexedDB clone failures without writing a partial record', async () => {
    const original = await repositories[0].saveCategoryLocal({ id: 'a', name: 'Original' });
    await expect(repositories[1].saveCategoryLocal({ id: 'a', name: 'Changed', uncloneable: () => {} })).rejects.toThrow();
    expect(await connections[0].table('categories').toArray()).toEqual([original]);
  });

  it('does not return success when the transaction aborts after put succeeds', async () => {
    const table = connections[0].table('categories');
    const put = table.put.bind(table);
    vi.spyOn(table, 'put').mockImplementation(async (...args) => {
      const key = await put(...args);
      Dexie.currentTransaction.abort();
      return key;
    });
    await expect(repositories[0].saveCategoryLocal({ id: 'aborted', name: 'Bebidas' })).rejects.toThrow();
    expect(await connections[1].table('categories').toArray()).toEqual([]);
  });

  it('retains the existing PRO pending mutation contract', async () => {
    const saved = await repositories[0].saveCategoryLocal({
      id: 'pro', name: 'Pending', color: '#123abc', sortOrder: 4,
      serverVersion: 9, customMetadata: { source: 'offline' }, createdAt: '2026-01-01'
    }, { syncStatus: 'pending', pendingOperationId: 'op', localMutationId: 'mutation', lastSyncedAt: 'old', conflictReason: 'old' });
    expect(saved).toMatchObject({
      id: 'pro', syncStatus: 'pending', pendingOperationId: 'op', localMutationId: 'mutation',
      lastSyncedAt: null, conflictReason: null, serverVersion: 9, customMetadata: { source: 'offline' }, createdAt: '2026-01-01'
    });
    expect(await connections[1].table('categories').get('pro')).toEqual(saved);
  });

  it('joins a compatible parent rw transaction and rolls back with it', async () => {
    await expect(connections[0].transaction('rw', 'categories', async () => {
      await repositories[0].saveCategoryLocal({ id: 'nested', name: 'Nested' });
      throw new Error('abort parent');
    })).rejects.toThrow('abort parent');
    expect(await connections[1].table('categories').toArray()).toEqual([]);
  });

  it('isolates a different business database', async () => {
    const other = await openConnection(`category-other-${crypto.randomUUID()}`);
    try {
      const otherRepository = await loadRepository(other);
      const a = await repositories[0].saveCategoryLocal({ id: 'a', name: 'Bebidas' });
      const b = await otherRepository.saveCategoryLocal({ id: 'b', name: 'Bebidas' });
      expect(await connections[0].table('categories').toArray()).toEqual([a]);
      expect(await other.table('categories').toArray()).toEqual([b]);
    } finally {
      await other.delete();
    }
  });
});
