import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => ({
  categories: [],
  menu: [],
  productBatches: [],
  deletedCategories: [],
  deletedMenu: []
}));

const tableFor = (storeName) => ({
  toArray: vi.fn(async () => rows[storeName].map((row) => ({ ...row }))),
  get: vi.fn(async (id) => rows[storeName].find((row) => row.id === id) || null),
  put: vi.fn(async (record) => {
    const index = rows[storeName].findIndex((row) => row.id === record.id);
    if (index >= 0) rows[storeName][index] = { ...record };
    else rows[storeName].push({ ...record });
    return record.id;
  }),
  update: vi.fn(async (id, changes) => {
    const index = rows[storeName].findIndex((row) => row.id === id);
    if (index >= 0) rows[storeName][index] = { ...rows[storeName][index], ...changes };
    return index >= 0 ? 1 : 0;
  })
});

const tables = vi.hoisted(() => new Map());

vi.mock('../../db/dexie', () => ({
  db: {
    isOpen: () => true,
    open: vi.fn(),
    table: vi.fn((name) => {
      if (!tables.has(name)) tables.set(name, tableFor(name));
      return tables.get(name);
    })
  },
  STORES: {
    CATEGORIES: 'categories',
    MENU: 'menu',
    PRODUCT_BATCHES: 'productBatches',
    DELETED_CATEGORIES: 'deletedCategories',
    DELETED_MENU: 'deletedMenu'
  }
}));

vi.mock('../../database', () => ({
  createProductWithInitialInventorySafe: vi.fn(),
  loadData: vi.fn(),
  loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(),
  saveImageToDB: vi.fn(),
  softDeleteWithCascadeSafe: vi.fn(),
  updateProductSafe: vi.fn()
}));
vi.mock('../../db/general', () => ({ categoriesRepository: { getActiveCategories: vi.fn() } }));
vi.mock('../../utils', () => ({ generateID: vi.fn((prefix = 'id') => `${prefix}-generated`) }));

import { productLocalRepository } from '../productLocalRepository';

describe('product local catalog cutover intent', () => {
  beforeEach(() => {
    Object.keys(rows).forEach((key) => { rows[key].length = 0; });
    tables.clear();
  });

  it('exposes active mutations and product/category/batch tombstones to cutover recovery', async () => {
    rows.menu.push({ id: 'updated-product', name: 'Updated', syncStatus: 'local', serverVersion: 4 });
    rows.deletedMenu.push({ id: 'deleted-product', deletedTimestamp: '2026-08-15T00:00:00Z', serverVersion: 7, deletionPending: true });
    rows.deletedCategories.push({ id: 'deleted-category', deletedTimestamp: '2026-08-15T00:00:00Z', serverVersion: 2, deletionPending: true });
    rows.productBatches.push({ id: 'deleted-batch', productId: 'updated-product', isActive: false, deletedAt: '2026-08-15T00:00:00Z', deletionPending: true, syncStatus: 'local' });

    await expect(productLocalRepository.listUnsyncedLocalCatalogForCloud()).resolves.toEqual({
      categories: [],
      products: [expect.objectContaining({ id: 'updated-product' })],
      batches: [],
      deletes: {
        categories: [expect.objectContaining({ id: 'deleted-category' })],
        products: [expect.objectContaining({ id: 'deleted-product' })],
        batches: [expect.objectContaining({ id: 'deleted-batch' })]
      }
    });
  });

  it('does not emit a deletion intent after a tombstone was explicitly reconciled', async () => {
    rows.deletedMenu.push({ id: 'already-reconciled', deletionPending: false, syncStatus: 'synced' });
    rows.productBatches.push({ id: 'already-reconciled-batch', isActive: false, deletedAt: '2026-08-15T00:00:00Z', deletionPending: false, syncStatus: 'synced' });

    await expect(productLocalRepository.listUnsyncedLocalCatalogForCloud()).resolves.toMatchObject({
      deletes: { categories: [], products: [], batches: [] }
    });
  });

  it('does not delete a large previously synced PRO catalog merely because cloud sync is disabled', async () => {
    rows.menu.push(...Array.from({ length: 120 }, (_, index) => ({
      id: `pro-product-${index}`,
      name: `PRO ${index}`,
      syncStatus: 'synced',
      serverVersion: index + 1,
      lastSyncedAt: '2026-08-15T00:00:00.000Z',
      isActive: true
    })));

    const intent = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    expect(intent).toMatchObject({
      categories: [],
      products: [],
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });
    expect(rows.menu).toHaveLength(120);
  });
});
