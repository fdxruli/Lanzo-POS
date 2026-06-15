import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchProductsInTable } from '../../db/productSearch';
import { buildProductSearchFields } from '../../db/productSearchIndex';

describe('acceso indexado de productos', () => {
  let testDb;

  beforeEach(async () => {
    testDb = new Dexie(`indexed-products-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      menu: 'id, barcode, sku, name_lower, barcode_normalized, sku_normalized, *search_tokens, *search_ngrams, activeStockStatus'
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
      Array.from({ length: 1000 }, (_, index) => {
        const product = {
          id: `p-${index}`,
          barcode: `750123456${index.toString().padStart(3, '0')}`,
          sku: `sku-${index}`,
          name: `product ${index}`,
          isActive: true
        };
        return { ...product, ...buildProductSearchFields(product) };
      })
    );

    const table = testDb.table('menu');
    const whereSpy = vi.spyOn(table, 'where');
    const filterSpy = vi.spyOn(table, 'filter');
    const result = await searchProductsInTable(
      table,
      '750123456500',
      'active'
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p-500');
    expect(whereSpy).toHaveBeenCalledWith('barcode_normalized');
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it('resuelve substring con el indice invertido sin recorrer la tabla', async () => {
    const products = [
      { id: 'p1', name: 'Tortilla de maiz', barcode: '7788', sku: 'TOR-01', isActive: true },
      { id: 'p2', name: 'Pan integral', barcode: '3322', sku: 'PAN-01', isActive: true }
    ].map((product) => ({ ...product, ...buildProductSearchFields(product) }));
    await testDb.table('menu').bulkAdd(products);

    const table = testDb.table('menu');
    const filterSpy = vi.spyOn(table, 'filter');
    const result = await searchProductsInTable(table, 'aiz');

    expect(result.map((product) => product.id)).toEqual(['p1']);
    expect(filterSpy).not.toHaveBeenCalled();
  });
});
