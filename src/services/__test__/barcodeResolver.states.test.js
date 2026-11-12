import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const { indexedDB, IDBKeyRange } = await import('fake-indexeddb');
  const db = new Dexie('barcode-resolution-stage2-tests', { indexedDB, IDBKeyRange });
  db.version(1).stores({
    menu: 'id, barcode, sku',
    product_batches: 'id, productId, sku',
  });
  return { db, STORES: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' } };
});
vi.mock('../db/utils', () => ({
  getAvailableStock: (record) => Number(record?.stock || 0) - Number(record?.committedStock || 0),
}));
vi.mock('../Logger', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

import { db, STORES } from '../db/dexie';
import { resolveBarcodeResult } from '../barcodeResolver';
import { clearCache, getCacheStats, resolveWithCacheResult } from '../barcodeCache';

const makeProduct = (id, overrides = {}) => ({
  id, name: id, barcode: '7501400800069', sku: `SKU-${id}`,
  price: 20, cost: 5, stock: 4, trackStock: true, isActive: true,
  batchManagement: { enabled: false }, ...overrides,
});
const makeBatch = (id, productId, overrides = {}) => ({
  id, productId, sku: `LOT-${id}`, stock: 4,
  createdAt: '2026-01-01', expiryDate: '2099-01-01', isActive: true, ...overrides,
});
const menu = () => db.table(STORES.MENU);
const batches = () => db.table(STORES.PRODUCT_BATCHES);

beforeAll(async () => db.open());
beforeEach(async () => {
  await db.transaction('rw', [STORES.MENU, STORES.PRODUCT_BATCHES], async () => {
    await menu().clear();
    await batches().clear();
  });
  clearCache();
});
afterAll(async () => db.delete());

describe('barcode resolution: identity before availability', () => {
  it('resolves a unique product and preserves a leading zero', async () => {
    await menu().add(makeProduct('unique', { barcode: '00123456' }));
    expect(await resolveBarcodeResult('00123456')).toMatchObject({
      status: 'RESOLVED', product: { id: 'unique' },
    });
    expect((await resolveBarcodeResult('123456')).status).toBe('NOT_FOUND');
  });

  it.each([['first', 'second'], ['second', 'first']])(
    'reports historical duplicates regardless of insertion order (%s then %s)',
    async (first, second) => {
      await menu().bulkAdd([
        makeProduct(first),
        makeProduct(second, { trackStock: false, batchManagement: { enabled: true }, stock: 0 }),
      ]);
      const result = await resolveBarcodeResult('7501400800069');
      expect(result.status).toBe('DUPLICATE');
      expect(result.matches.map((item) => item.id).sort()).toEqual(['first', 'second']);
    }
  );

  it('ignores deleted records, but includes inactive products in conflicts', async () => {
    await menu().bulkAdd([
      makeProduct('live'),
      makeProduct('deleted', { deletedAt: '2026-11-11' }),
      makeProduct('inactive', { isActive: false }),
    ]);
    expect((await resolveBarcodeResult('7501400800069')).matches.map((item) => item.id).sort())
      .toEqual(['inactive', 'live']);
    await menu().delete('live');
    expect((await resolveBarcodeResult('7501400800069')).status).toBe('INACTIVE');
  });

  it('returns NO_SELLABLE_BATCH instead of NOT_FOUND for a tracked product', async () => {
    await menu().add(makeProduct('tracked', { batchManagement: { enabled: true }, stock: 0 }));
    const result = await resolveBarcodeResult('7501400800069');
    expect(result).toMatchObject({
      status: 'NO_SELLABLE_BATCH', product: { id: 'tracked' },
    });
  });

  it('does not require an artificial batch when stock tracking is disabled', async () => {
    await menu().add(makeProduct('untracked', {
      batchManagement: { enabled: true }, trackStock: false, stock: 0,
    }));
    expect(await resolveBarcodeResult('7501400800069')).toMatchObject({
      status: 'RESOLVED', product: { id: 'untracked', trackStock: false },
    });
  });

  it('keeps multiple matching batches of one product distinct from duplicate products', async () => {
    await menu().add(makeProduct('tracked', {
      batchManagement: { enabled: true }, stock: 0,
    }));
    await batches().bulkAdd([
      makeBatch('a', 'tracked', { sku: 'LOT-UNIQUE' }),
      makeBatch('b', 'tracked', { sku: 'LOT-UNIQUE', createdAt: '2026-02-01' }),
    ]);
    expect(await resolveBarcodeResult('LOT-UNIQUE')).toMatchObject({
      status: 'RESOLVED', product: { id: 'tracked', batchId: 'a' },
    });
  });

  it('does not bypass an explicitly scanned unavailable lot even if stock tracking is disabled', async () => {
    await menu().add(makeProduct('untracked', {
      barcode: 'different',
      batchManagement: { enabled: true },
      trackStock: false,
    }));
    await batches().add(makeBatch('expired', 'untracked', {
      sku: 'LOT-UNAVAILABLE', isActive: false,
    }));
    expect((await resolveBarcodeResult('LOT-UNAVAILABLE')).status).toBe('NO_SELLABLE_BATCH');
    expect((await resolveBarcodeResult('different')).status).toBe('RESOLVED');
  });

  it('detects a batch SKU colliding with a different product barcode', async () => {
    await menu().bulkAdd([
      makeProduct('one', { barcode: 'LOT-COLLISION' }),
      makeProduct('two', { barcode: 'different', batchManagement: { enabled: true } }),
    ]);
    await batches().add(makeBatch('a', 'two', { sku: 'LOT-COLLISION' }));
    const result = await resolveBarcodeResult('LOT-COLLISION');
    expect(result.status).toBe('DUPLICATE');
    expect(result.matches.map((item) => item.id).sort()).toEqual(['one', 'two']);
  });

  it('surfaces inactive matching lots and never swallows Dexie read errors', async () => {
    await menu().add(makeProduct('tracked', { batchManagement: { enabled: true } }));
    await batches().add(makeBatch('a', 'tracked', { stock: 0 }));
    expect((await resolveBarcodeResult('LOT-a')).status).toBe('NO_SELLABLE_BATCH');
    const spy = vi.spyOn(db, 'table').mockImplementation(() => { throw new Error('read error'); });
    try {
      await expect(resolveBarcodeResult('7501400800069')).rejects.toThrow('read error');
    } finally {
      spy.mockRestore();
    }
  });

  it('detects new duplicates and recovers after a catalog change despite a cached reference', async () => {
    await menu().add(makeProduct('one'));
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('RESOLVED');
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('RESOLVED');
    expect(getCacheStats().hits).toBe(1);
    await menu().add(makeProduct('two', { trackStock: false }));
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('DUPLICATE');
    await menu().delete('two');
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('RESOLVED');
    await menu().update('one', { isActive: false });
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('INACTIVE');
    await menu().update('one', { isActive: true, barcode: '001999' });
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('NOT_FOUND');
    expect((await resolveWithCacheResult('001999')).status).toBe('RESOLVED');
  });

  it('revalidates batches after a cached barcode becomes unavailable', async () => {
    await menu().add(makeProduct('tracked', { batchManagement: { enabled: true } }));
    await batches().add(makeBatch('a', 'tracked', { stock: 5 }));
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('RESOLVED');
    await batches().update('a', { committedStock: 5 });
    expect((await resolveWithCacheResult('7501400800069')).status).toBe('NO_SELLABLE_BATCH');
  });

  it('compares SKU case-insensitively without altering original barcode text', async () => {
    await menu().add(makeProduct('unique', { barcode: ' 0750 12 ', sku: 'MED-ABC' }));
    expect((await resolveBarcodeResult('075012')).status).toBe('RESOLVED');
    expect((await resolveBarcodeResult('med-abc')).status).toBe('RESOLVED');
  });
});
