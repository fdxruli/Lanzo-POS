// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const STORES = { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' };
let isolatedDb;
let queryPosCatalogPage;

const makeProduct = (index) => ({
  id: `real-idb-product-${String(index).padStart(3, '0')}`,
  name: `Real IndexedDB Product ${index}`,
  name_lower: `real indexeddb product ${index}`,
  createdAt: index < 75
    ? '2026-07-31T12:00:00.000Z'
    : `2026-07-30T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  categoryId: index < 110 ? 'large-category' : 'other-category',
  productType: 'sellable',
  isActive: true,
  stock: 10
});

beforeAll(async () => {
  isolatedDb = new Dexie(`pos-pagination-${crypto.randomUUID()}`);
  isolatedDb.version(1).stores({
    [STORES.MENU]: 'id, createdAt, categoryId',
    [STORES.PRODUCT_BATCHES]: 'id, productId, expiryDate'
  });
  await isolatedDb.open();
  await isolatedDb.table(STORES.MENU).bulkPut(
    Array.from({ length: 125 }, (_, index) => makeProduct(index))
  );

  vi.doMock('../../database', () => ({
    db: isolatedDb,
    STORES,
    loadDataPaginated: vi.fn()
  }));
  vi.doMock('../../db/general', () => ({
    categoriesRepository: { getActiveCategories: vi.fn(async () => []) }
  }));
  ({ queryPosCatalogPage } = await import('../productCatalogQueryService'));
});

afterAll(async () => {
  isolatedDb.close();
  await isolatedDb.delete();
  vi.doUnmock('../../database');
  vi.doUnmock('../../db/general');
});

describe('POS pagination against real IndexedDB collections', () => {
  it('walks more than 100 category products without omissions or duplicates', async () => {
    const visited = [];
    let cursor = null;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
      const page = await queryPosCatalogPage({
        categoryId: 'large-category',
        cursor,
        pageSize: 50
      });
      visited.push(...page.data);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
      pageCount += 1;
    }

    expect(pageCount).toBe(3);
    expect(visited).toHaveLength(110);
    expect(new Set(visited.map(({ id }) => id)).size).toBe(110);
    expect(visited.slice(0, 75).map(({ id }) => id)).toEqual(
      [...visited.slice(0, 75).map(({ id }) => id)].sort().reverse()
    );
  });
});
