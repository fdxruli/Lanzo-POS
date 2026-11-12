import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { findBarcodeConflictsInTable } from '../barcodeDuplicates';

const database = new Dexie('lanzo-barcode-conflicts-tests', { indexedDB, IDBKeyRange });
database.version(1).stores({ menu: 'id, barcode' });
const menu = () => database.table('menu');
const matches = (barcode, id = null) => findBarcodeConflictsInTable(menu(), barcode, id);

beforeAll(async () => { await database.open(); });
beforeEach(async () => { await menu().clear(); });
afterAll(async () => { await database.delete(); });

describe('Local barcode collisions (real IndexedDB)', () => {
  it('preserves leading zeroes and ignores meaningless whitespace', async () => {
    await menu().add({ id: 'a', name: 'Primero', barcode: ' 0750 12 ', isActive: false });
    expect((await matches('075012')).map((row) => row.id)).toEqual(['a']);
    expect(await matches('75012')).toEqual([]);
  });

  it('returns every historical duplicate except the edited record', async () => {
    await menu().bulkAdd([
      { id: 'a', barcode: '7501400800069', name: 'Bicarbonato de Sodio' },
      { id: 'b', barcode: '7501400800069', name: 'Bicarbonato Nordin', trackStock: false },
      { id: 'c', barcode: '7501400800069', deletedAt: '2026-11-11' }
    ]);
    expect((await matches('7501400800069', 'a')).map((row) => row.id)).toEqual(['b']);
    expect((await matches('7501400800069')).map((row) => row.id)).toEqual(['a', 'b']);
    expect(await matches('')).toEqual([]);
  });

  it('serializes two competing transactional writes for the same code', async () => {
    const createIfUnique = (id) => database.transaction('rw', menu(), async () => {
      if ((await findBarcodeConflictsInTable(menu(), '009955')).length) {
        throw new Error('DUPLICATE_BARCODE');
      }
      await menu().add({ id, barcode: '009955' });
    });
    const results = await Promise.allSettled([createIfUnique('a'), createIfUnique('b')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await menu().count()).toBe(1);
  });
});
