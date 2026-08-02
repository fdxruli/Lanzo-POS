// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const STORES = { PRODUCT_BATCHES: 'product_batches' };
let isolatedDb;
let queryBatchManagerPage;
let queryBatchManagerSnapshot;

const makeBatch = (index, productId = 'product-a') => ({
  id: `batch-${String(index).padStart(4, '0')}`,
  productId,
  createdAt: index < 75
    ? '2026-07-31T12:00:00.000Z'
    : `2026-07-30T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  isActive: index < 65,
  isArchived: index >= 65,
  status: index < 65 ? 'active' : 'archived',
  stock: index < 65 ? 2 : 0,
  committedStock: index < 65 ? 0.5 : 0,
  cost: 3
});

beforeAll(async () => {
  isolatedDb = new Dexie(`batch-manager-pagination-${crypto.randomUUID()}`);
  isolatedDb.version(1).stores({
    [STORES.PRODUCT_BATCHES]: 'id, productId, createdAt'
  });
  await isolatedDb.open();
  await isolatedDb.table(STORES.PRODUCT_BATCHES).bulkPut([
    ...Array.from({ length: 112 }, (_, index) => makeBatch(index)),
    ...Array.from({ length: 20 }, (_, index) => makeBatch(index + 200, 'product-b'))
  ]);

  vi.doMock('../../db/dexie', () => ({ db: isolatedDb, STORES }));
  ({ queryBatchManagerPage, queryBatchManagerSnapshot } = await import('../batchManagerQueries'));
});

afterAll(async () => {
  isolatedDb.close();
  await isolatedDb.delete();
  vi.doUnmock('../../db/dexie');
});

describe('batch manager pagination against IndexedDB', () => {
  it('recorre tres páginas reales sin omisiones, duplicados ni mezcla de productos', async () => {
    const visited = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const page = await queryBatchManagerPage({
        productId: 'product-a',
        cursor,
        pageSize: 50
      });
      visited.push(...page.items);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }

    expect(visited).toHaveLength(112);
    expect(new Set(visited.map((batch) => batch.id)).size).toBe(112);
    expect(visited.every((batch) => batch.productId === 'product-a')).toBe(true);
    expect(visited.slice(0, 75).map((batch) => batch.id)).toEqual(
      [...visited.slice(0, 75).map((batch) => batch.id)].sort().reverse()
    );
  });

  it('produce resumen completo mientras materializa solo la primera página', async () => {
    const snapshot = await queryBatchManagerSnapshot({ productId: 'product-a', pageSize: 10 });

    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.summary).toMatchObject({
      totalRecords: 112,
      activeRecords: 65,
      archivedRecords: 47,
      totalPhysicalStock: 130,
      totalAvailableStock: 97.5,
      totalCommittedStock: 32.5,
      inventoryValue: 390
    });
  });
});
