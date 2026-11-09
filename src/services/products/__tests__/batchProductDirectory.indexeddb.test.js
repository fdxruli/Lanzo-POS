// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const STORES = { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' };
let isolatedDb;
let queryBatchProductDirectoryPage;

beforeAll(async () => {
  isolatedDb = new Dexie(`batch-directory-${crypto.randomUUID()}`);
  isolatedDb.version(1).stores({
    [STORES.MENU]: 'id, name',
    [STORES.PRODUCT_BATCHES]: 'id, productId'
  });
  await isolatedDb.open();
  const products = Array.from({ length: 33 }, (_, index) => ({
    id: `product-${String(index).padStart(3, '0')}`,
    name: `Producto ${index}`
  }));
  await isolatedDb.table(STORES.MENU).bulkPut(products);
  await isolatedDb.table(STORES.PRODUCT_BATCHES).bulkPut([
    ...products.flatMap((product) => [
      { id: `${product.id}-lot-a`, productId: product.id, isArchived: false },
      { id: `${product.id}-lot-b`, productId: product.id, isArchived: true }
    ])
  ]);

  vi.doMock('../../db/dexie', () => ({ db: isolatedDb, STORES }));
  ({ queryBatchProductDirectoryPage } = await import('../batchProductDirectory'));
});

afterAll(async () => {
  isolatedDb.close();
  await isolatedDb.delete();
  vi.doUnmock('../../db/dexie');
});

describe('directorio de productos con lotes en IndexedDB', () => {
  it('avanza por índice en páginas pequeñas sin repetir productos con múltiples lotes', async () => {
    let cursor = null;
    let hasMore = true;
    const visited = [];
    const pageLengths = [];
    while (hasMore) {
      const result = await queryBatchProductDirectoryPage({ cursor, pageSize: 16 });
      visited.push(...result.items.map((product) => product.id));
      pageLengths.push(result.items.length);
      cursor = result.nextCursor;
      hasMore = result.hasMore;
    }
    expect(pageLengths).toEqual([16, 16, 1]);
    expect(visited).toHaveLength(33);
    expect(new Set(visited).size).toBe(33);
    expect(visited[0]).toBe('product-000');
    expect(visited.at(-1)).toBe('product-032');
  });

  it('no presenta un producto eliminado aunque queden lotes históricos', async () => {
    await isolatedDb.table(STORES.MENU).update('product-000', {
      deletedAt: '2026-11-09T12:00:00Z'
    });
    const result = await queryBatchProductDirectoryPage({ pageSize: 4 });
    expect(result.items.map((product) => product.id)).not.toContain('product-000');
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(true);
  });

  it('permite volver al inicio sin retener cursor anterior', async () => {
    const first = await queryBatchProductDirectoryPage({ pageSize: 2 });
    const second = await queryBatchProductDirectoryPage({ cursor: first.nextCursor, pageSize: 2 });
    expect(second.items.map((product) => product.id)).not.toContain('product-000');
    expect(first.nextCursor).not.toBe(second.nextCursor);
  });
});
