import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockLocalSource } from '../ecommercePublishedStockLocalSource';

describe('ecommercePublishedStockLocalSource', () => {
  let testDb;

  beforeEach(async () => {
    testDb = new Dexie(`ecommerce-published-stock-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      menu: 'id',
      product_batches: 'id, productId'
    });
    await testDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete();
  });

  it('resuelve todas las referencias sin limite fijo de 500', async () => {
    const products = Array.from({ length: 601 }, (_, index) => ({
      id: `product-${index}`,
      stock: index
    }));
    await testDb.table('menu').bulkAdd(products);
    const table = testDb.table('menu');
    const bulkGet = vi.spyOn(table, 'bulkGet');
    const source = createEcommercePublishedStockLocalSource({
      database: testDb,
      stores: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' }
    });

    const result = await source.getProductsByIds(products.map((product) => product.id));

    expect(result.size).toBe(601);
    expect(result.get('product-600')).toMatchObject({ id: 'product-600' });
    expect(bulkGet).toHaveBeenCalledTimes(2);
  });

  it('carga lotes por grupos indexados y no consulta por producto', async () => {
    const batches = Array.from({ length: 410 }, (_, index) => ({
      id: `batch-${index}`,
      productId: `product-${index}`,
      stock: 1
    }));
    await testDb.table('product_batches').bulkAdd(batches);
    const table = testDb.table('product_batches');
    const where = vi.spyOn(table, 'where');
    const source = createEcommercePublishedStockLocalSource({
      database: testDb,
      stores: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' }
    });

    const result = await source.getBatchesByProductIds(
      batches.map((batch) => batch.productId)
    );

    expect(result.size).toBe(410);
    expect(result.get('product-409')).toHaveLength(1);
    expect(where).toHaveBeenCalledTimes(3);
    expect(where).toHaveBeenCalledWith('productId');
  });
});
