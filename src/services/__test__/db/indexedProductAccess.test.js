import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchProductsInTable } from '../../db/productSearch';

describe('acceso indexado de productos', () => {
  let testDb;

  beforeEach(async () => {
    testDb = new Dexie(`indexed-products-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      menu: 'id, barcode, sku, name_lower, activeStockStatus'
    });
    await testDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete();
  });

  it('mantiene consistencia entre el indice y los datos reales tras operaciones masivas', async () => {
    await testDb.table('menu').bulkAdd([
      { id: 'p1', stock: 10, isActive: true },
      { id: 'p2', stock: 0, isActive: true },
      { id: 'p3', stock: 5, isActive: false }
    ]);

    await testDb.table('menu').toCollection().modify((product) => {
      product.activeStockStatus =
        product.isActive !== false && Number(product.stock) > 0 ? 1 : 0;
    });

    const byIndex = await testDb.table('menu')
      .where('activeStockStatus')
      .equals(1)
      .toArray();
    const byFilter = (await testDb.table('menu').toArray())
      .filter((product) => product.isActive !== false && Number(product.stock) > 0);

    expect(new Set(byIndex.map((product) => product.id)))
      .toEqual(new Set(byFilter.map((product) => product.id)));
  });

  it('encuentra un barcode numerico exacto mediante su indice', async () => {
    await testDb.table('menu').bulkAdd(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `p-${index}`,
        barcode: `750123456${index.toString().padStart(3, '0')}`,
        sku: `sku-${index}`,
        name_lower: `product ${index}`,
        isActive: true
      }))
    );

    const whereSpy = vi.spyOn(testDb.table('menu'), 'where');
    const start = performance.now();

    const result = await searchProductsInTable(
      testDb.table('menu'),
      '750123456500',
      'active'
    );
    const duration = performance.now() - start;

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p-500');
    expect(whereSpy).toHaveBeenCalledWith('barcode');
    expect(duration).toBeLessThan(50);
  });
});
