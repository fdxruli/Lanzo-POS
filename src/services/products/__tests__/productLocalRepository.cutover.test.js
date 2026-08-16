import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => ({
  categories: [],
  menu: [],
  productBatches: [],
  deletedCategories: [],
  deletedMenu: []
}));

const databaseMocks = vi.hoisted(() => ({
  createProductWithInitialInventorySafe: vi.fn(),
  loadData: vi.fn(),
  loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(),
  saveImageToDB: vi.fn(),
  softDeleteWithCascadeSafe: vi.fn(),
  updateProductSafe: vi.fn()
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
  }),
  filter: vi.fn((predicate) => ({
    first: vi.fn(async () => rows[storeName].find(predicate) || null)
  }))
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
  createProductWithInitialInventorySafe: databaseMocks.createProductWithInitialInventorySafe,
  loadData: databaseMocks.loadData,
  loadDataPaginated: databaseMocks.loadDataPaginated,
  saveBatchAndSyncProductSafe: databaseMocks.saveBatchAndSyncProductSafe,
  saveImageToDB: databaseMocks.saveImageToDB,
  softDeleteWithCascadeSafe: databaseMocks.softDeleteWithCascadeSafe,
  updateProductSafe: databaseMocks.updateProductSafe
}));
vi.mock('../../db/general', () => ({ categoriesRepository: { getActiveCategories: vi.fn() } }));
vi.mock('../../utils', () => ({ generateID: vi.fn((prefix = 'id') => `${prefix}-generated`) }));

import { productLocalRepository } from '../productLocalRepository';

describe('product local catalog cutover intent', () => {
  beforeEach(() => {
    Object.keys(rows).forEach((key) => { rows[key].length = 0; });
    tables.clear();
    vi.clearAllMocks();
    databaseMocks.createProductWithInitialInventorySafe.mockResolvedValue({ success: true });
    databaseMocks.saveBatchAndSyncProductSafe.mockResolvedValue({ success: true });
    databaseMocks.updateProductSafe.mockResolvedValue({ success: true });
    databaseMocks.softDeleteWithCascadeSafe.mockResolvedValue({ success: true });
  });

  it('exposes active mutations and product/category/batch tombstones to cutover recovery', async () => {
    rows.menu.push({ id: 'updated-product', name: 'Updated', syncStatus: 'local', serverVersion: 4 });
    rows.menu.push({
      id: 'deactivated-product',
      name: 'Deactivated',
      isActive: false,
      syncStatus: 'local',
      serverVersion: 5,
      lastSyncedAt: null,
      deletedAt: null
    });
    rows.menu.push({
      id: 'synced-inactive-product',
      name: 'Synced inactive',
      isActive: false,
      syncStatus: 'synced',
      serverVersion: 6,
      lastSyncedAt: '2026-08-15T00:00:00Z'
    });
    rows.deletedMenu.push({ id: 'deleted-product', deletedTimestamp: '2026-08-15T00:00:00Z', serverVersion: 7, deletionPending: true });
    rows.deletedCategories.push({ id: 'deleted-category', deletedTimestamp: '2026-08-15T00:00:00Z', serverVersion: 2, deletionPending: true });
    rows.productBatches.push({ id: 'deleted-batch', productId: 'updated-product', isActive: false, deletedAt: '2026-08-15T00:00:00Z', deletionPending: true, syncStatus: 'local' });

    await expect(productLocalRepository.listUnsyncedLocalCatalogForCloud()).resolves.toEqual({
      categories: [],
      products: [
        expect.objectContaining({ id: 'updated-product' }),
        expect.objectContaining({ id: 'deactivated-product', isActive: false })
      ],
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

  it('turns a FREE status toggle into a fresh local mutation while preserving OCC version', async () => {
    rows.menu.push({
      id: 'toggle-product',
      isActive: true,
      serverVersion: 9,
      syncStatus: 'synced',
      lastSyncedAt: '2026-08-14T00:00:00.000Z',
      pendingOperationId: 'old-operation',
      localMutationId: 'old-mutation'
    });

    await expect(productLocalRepository.toggleProductStatusLocal(rows.menu[0], false))
      .resolves.toMatchObject({ success: true });

    expect(databaseMocks.updateProductSafe).toHaveBeenCalledWith('toggle-product', expect.objectContaining({
      isActive: false,
      serverVersion: 9,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated',
      conflictReason: null
    }));
  });

  it('resets local metadata on category, product, and batch FREE writes without losing serverVersion', async () => {
    const oldMetadata = {
      serverVersion: 4,
      syncStatus: 'synced',
      lastSyncedAt: '2026-08-14T00:00:00.000Z',
      pendingOperationId: 'stale-operation',
      localMutationId: 'stale-mutation'
    };
    await productLocalRepository.saveCategoryLocal({ id: 'category-1', name: 'Category', ...oldMetadata });
    rows.menu.push({ id: 'product-1', ...oldMetadata });
    await productLocalRepository.savePreparedProductLocal({
      productId: 'product-1',
      product: { id: 'product-1', ...oldMetadata },
      batches: [],
      editing: true,
      inventoryValue: 0
    });
    await productLocalRepository.saveBatchLocal({ id: 'batch-1', productId: 'product-1', ...oldMetadata });

    expect(rows.categories[0]).toMatchObject({
      serverVersion: 4,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated'
    });
    expect(databaseMocks.updateProductSafe).toHaveBeenCalledWith('product-1', expect.objectContaining({
      serverVersion: 4,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated'
    }));
    expect(databaseMocks.saveBatchAndSyncProductSafe).toHaveBeenCalledWith(expect.objectContaining({
      serverVersion: 4,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated'
    }));
  });

  it('gives category, product, and batch deletes independent local intent metadata', async () => {
    databaseMocks.softDeleteWithCascadeSafe.mockImplementation(async (storeName, deletedStore, id) => {
      rows[deletedStore].push({ id, serverVersion: 8, pendingOperationId: 'old-upsert' });
      return { success: true };
    });

    await productLocalRepository.deleteCategoryLocal('category-delete');
    await productLocalRepository.deleteProductLocal({ id: 'product-delete' });
    await productLocalRepository.deleteBatchLocal({
      id: 'batch-delete',
      productId: 'product-delete',
      serverVersion: 8,
      pendingOperationId: 'old-upsert'
    }, { syncStatus: 'local' });

    expect(rows.deletedCategories[0]).toMatchObject({
      id: 'category-delete',
      serverVersion: 8,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated',
      deletionPending: true
    });
    expect(rows.deletedMenu[0]).toMatchObject({
      id: 'product-delete',
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated',
      deletionPending: true
    });
    expect(databaseMocks.saveBatchAndSyncProductSafe).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'batch-delete',
      serverVersion: 8,
      syncStatus: 'local',
      lastSyncedAt: null,
      pendingOperationId: null,
      localMutationId: 'mutation-generated',
      deletionPending: true
    }));
  });
});
