import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ records: [] }));

vi.mock('../../db/dexie', () => ({
  STORES: { PRODUCT_BATCHES: 'product_batches' },
  db: {
    table: () => ({
      where: () => ({
        equals: (productId) => ({
          each: async (callback) => {
            state.records
              .filter((batch) => batch.productId === productId)
              .forEach(callback);
          }
        })
      })
    })
  }
}));

vi.mock('../../db/utils', () => ({
  getCommittedStock: (batch) => Number(batch.committedStock || 0),
  getAvailableStock: (batch) => Number(batch.stock || 0) - Number(batch.committedStock || 0)
}));

import {
  getBatchManagerStatus,
  getBatchSortValue,
  queryBatchManagerPage,
  queryBatchManagerSnapshot,
  queryBatchManagerSummary
} from '../batchManagerQueries';

const makeBatch = (index, overrides = {}) => ({
  id: `batch-${String(index).padStart(4, '0')}`,
  productId: 'product-a',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  isActive: true,
  stock: 2,
  committedStock: 0.5,
  cost: 3,
  ...overrides
});

const collectAllPages = async (options) => {
  const items = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const page = await queryBatchManagerPage({ ...options, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }

  return items;
};

describe('batchManagerQueries', () => {
  beforeEach(() => {
    state.records = [];
  });

  it('pagina 112 lotes en 50, 50 y 12 sin reemplazos, duplicados ni omisiones', async () => {
    state.records = Array.from({ length: 112 }, (_, index) => makeBatch(index));

    const first = await queryBatchManagerPage({ productId: 'product-a', pageSize: 50 });
    const second = await queryBatchManagerPage({
      productId: 'product-a', pageSize: 50, cursor: first.nextCursor
    });
    const third = await queryBatchManagerPage({
      productId: 'product-a', pageSize: 50, cursor: second.nextCursor
    });
    const ids = [...first.items, ...second.items, ...third.items].map((batch) => batch.id);

    expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 12]);
    expect(new Set(ids).size).toBe(112);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it('resuelve 75 fechas empatadas por id sin omitir registros', async () => {
    const tiedDate = '2026-07-31T12:00:00.000Z';
    state.records = Array.from({ length: 75 }, (_, index) => makeBatch(index, { createdAt: tiedDate }));

    const items = await collectAllPages({ productId: 'product-a', pageSize: 10 });
    const ids = items.map((batch) => batch.id);
    const expected = [...ids].sort((left, right) => {
      if (left === right) return 0;
      return right > left ? 1 : -1;
    });

    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(75);
  });

  it('aísla productos y soporta filtros active/archived exactos', async () => {
    state.records = [
      ...Array.from({ length: 80 }, (_, index) => makeBatch(index)),
      ...Array.from({ length: 80 }, (_, index) => makeBatch(index + 100, { productId: 'product-b' })),
      makeBatch(500, { isActive: false, status: 'archived', deletedAt: '2026-01-01' })
    ];

    const active = await collectAllPages({ productId: 'product-a', status: 'active', pageSize: 17 });
    const archived = await collectAllPages({ productId: 'product-a', status: 'archived', pageSize: 17 });

    expect(active).toHaveLength(80);
    expect(archived).toHaveLength(1);
    expect([...active, ...archived].every((batch) => batch.productId === 'product-a')).toBe(true);
  });

  it('normaliza estados legacy incompatibles en un solo grupo fail-closed', () => {
    expect(getBatchManagerStatus({ isActive: true, isArchived: true })).toBe('archived');
    expect(getBatchManagerStatus({ isActive: true, status: 'removed' })).toBe('archived');
    expect(getBatchManagerStatus({ status: 'active' })).toBe('active');
    expect(getBatchManagerStatus({ deleted_at: '2026-01-01', status: 'active' })).toBe('archived');
    expect(getBatchManagerStatus({})).toBe('archived');
  });

  it('usa fallback de fecha estable sin Date.now', () => {
    expect(getBatchSortValue({ id: 'batch_1750000000000_x', createdAt: 'invalid' })).toBe(1750000000000);
    expect(getBatchSortValue({ id: 'legacy', createdAt: null, updatedAt: null })).toBe(0);
  });

  it.each([
    [0, 0, false],
    [1, 1, false],
    [4, 4, false],
    [5, 5, false],
    [6, 5, true],
    [12, 5, true]
  ])('calcula hasMore con pageSize + 1 para %i registros', async (count, visible, hasMore) => {
    state.records = Array.from({ length: count }, (_, index) => makeBatch(index));
    const page = await queryBatchManagerPage({ productId: 'product-a', pageSize: 5 });
    expect(page.items).toHaveLength(visible);
    expect(page.hasMore).toBe(hasMore);
  });

  it('calcula resumen completo independiente de la página visible', async () => {
    state.records = [
      ...Array.from({ length: 65 }, (_, index) => makeBatch(index)),
      ...Array.from({ length: 47 }, (_, index) => makeBatch(index + 100, {
        isActive: false,
        isArchived: true,
        status: 'archived',
        stock: 99
      }))
    ];

    const snapshot = await queryBatchManagerSnapshot({ productId: 'product-a', pageSize: 10 });
    const summary = await queryBatchManagerSummary('product-a');

    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.summary).toEqual(summary);
    expect(summary).toMatchObject({
      totalRecords: 112,
      activeRecords: 65,
      archivedRecords: 47,
      totalPhysicalStock: 130,
      totalAvailableStock: 97.5,
      totalCommittedStock: 32.5,
      inventoryValue: 390
    });

    const archived = await collectAllPages({
      productId: 'product-a', status: 'archived', pageSize: 10
    });
    expect(archived).toHaveLength(47);
  });

  it('reconstruye página, cursor y resumen después de mutaciones locales o remotas', async () => {
    state.records = [makeBatch(1), makeBatch(2)];
    const before = await queryBatchManagerSnapshot({ productId: 'product-a', pageSize: 1 });
    expect(before.items[0].id).toBe('batch-0002');
    expect(before.summary.activeRecords).toBe(2);

    state.records = [
      makeBatch(1, {
        isActive: false,
        isArchived: true,
        status: 'archived',
        deletedAt: '2026-02-01T00:00:00.000Z',
        stock: 0
      }),
      makeBatch(3, { stock: 5, cost: 4 })
    ];
    const after = await queryBatchManagerSnapshot({ productId: 'product-a', pageSize: 1 });

    expect(after.items[0].id).toBe('batch-0003');
    expect(after.nextCursor).toEqual({
      sortValue: getBatchSortValue(after.items[0]),
      id: 'batch-0003'
    });
    expect(after.summary).toMatchObject({
      totalRecords: 2,
      activeRecords: 1,
      archivedRecords: 1,
      totalPhysicalStock: 5,
      inventoryValue: 20
    });
  });

  it('mantiene la primera página acotada con 1,000 lotes', async () => {
    state.records = Array.from({ length: 1000 }, (_, index) => makeBatch(index));
    const page = await queryBatchManagerPage({ productId: 'product-a', pageSize: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.requestedLimit).toBe(50);
  });
});
