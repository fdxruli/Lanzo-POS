import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  saveConflict: vi.fn(),
  listUnsynced: vi.fn(),
  getLocalCatalog: vi.fn(),
  applyCloudCatalog: vi.fn(),
  markDeletionSynced: vi.fn(),
  markDeletionConflict: vi.fn(),
  migrateLocalCatalog: vi.fn(),
  deleteCategory: vi.fn(),
  deleteProduct: vi.fn(),
  deleteBatch: vi.fn(),
  events: []
}));

vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta
} }));
vi.mock('../../sync/syncConflictService', () => ({ syncConflictService: {
  saveConflict: mocks.saveConflict
} }));
vi.mock('../productLocalRepository', () => ({ productLocalRepository: {
  listUnsyncedLocalCatalogForCloud: mocks.listUnsynced,
  getLocalCatalogForMigration: mocks.getLocalCatalog,
  applyCloudCatalog: mocks.applyCloudCatalog,
  markCatalogDeletionSynced: mocks.markDeletionSynced,
  markCatalogDeletionConflict: mocks.markDeletionConflict,
  markConflict: vi.fn()
} }));
vi.mock('../productCloudRepository', () => ({ productCloudRepository: {
  migrateLocalCatalog: mocks.migrateLocalCatalog,
  deleteCategory: mocks.deleteCategory,
  deleteProduct: mocks.deleteProduct,
  deleteProductBatch: mocks.deleteBatch
} }));
vi.mock('../productMigrationValidation', () => ({
  validateLocalCatalogForMigration: vi.fn(() => [])
}));
vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  productToCloudPayload: (value) => value
}));
vi.mock('../../Logger', () => ({ default: {
  log: vi.fn(),
  warn: vi.fn()
} }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));

import { productLocalCatalogRecovery } from '../productLocalCatalogRecovery';

const localCatalog = {
  categories: [],
  products: [
    { id: 'existing-product', name: 'Existing', price: 120, cost: 50, stock: 1, serverVersion: 4 },
    { id: 'new-product', name: 'New', price: 25, cost: 10, stock: 2 }
  ],
  batches: []
};

describe('repeated FREE to PRO catalog recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.getMeta.mockResolvedValue(null);
    mocks.setMeta.mockResolvedValue(undefined);
    mocks.saveConflict.mockResolvedValue({ id: 'recovery-conflict' });
    mocks.getLocalCatalog.mockResolvedValue(localCatalog);
    mocks.applyCloudCatalog.mockResolvedValue({ categories: 0, products: 0, batches: 0, rejected: [] });
    mocks.markDeletionSynced.mockResolvedValue(undefined);
    mocks.markDeletionConflict.mockResolvedValue(undefined);
    mocks.migrateLocalCatalog.mockImplementation(async (payload) => {
      mocks.events.push({ type: 'migrate', payload });
      return { success: true };
    });
    mocks.deleteCategory.mockImplementation(async (payload) => {
      mocks.events.push({ type: 'delete-category', payload });
      return { success: true };
    });
    mocks.deleteProduct.mockImplementation(async (payload) => {
      mocks.events.push({ type: 'delete-product', payload });
      return { success: true };
    });
    mocks.deleteBatch.mockImplementation(async (payload) => {
      mocks.events.push({ type: 'delete-batch', payload });
      return { success: true };
    });
  });

  it('reconciles FREE updates and creates through the existing migration RPC before hydration', async () => {
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: localCatalog.products,
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-UPDATE-CREATE'
    })).resolves.toMatchObject({ success: true, recovered: 2 });

    expect(mocks.migrateLocalCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.migrateLocalCatalog).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'CUTOVER-UPDATE-CREATE',
      products: localCatalog.products
    }));
    expect(mocks.events[0].type).toBe('migrate');
    expect(mocks.deleteProduct).not.toHaveBeenCalled();
  });

  it('pushes FREE product deletes before a later authoritative snapshot can reinsert them', async () => {
    const tombstone = {
      id: 'deleted-product',
      serverVersion: 8,
      deletedTimestamp: '2026-08-15T00:00:00.000Z',
      deletionPending: true
    };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [],
      batches: [],
      deletes: { categories: [], products: [tombstone], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [], batches: [] });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-DELETE'
    })).resolves.toMatchObject({ success: true, recovered: 1 });

    expect(mocks.deleteProduct).toHaveBeenCalledWith({
      licenseKey: 'CUTOVER-DELETE',
      productId: 'deleted-product',
      expectedVersion: 8,
      idempotencyKey: 'products-recovery-CUTOVER-DELETE-delete-product-deleted-product'
    });
    expect(mocks.markDeletionSynced).toHaveBeenCalledWith({
      entityType: 'product',
      entityId: 'deleted-product'
    });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('preserves local intent and blocks cutover when delete reconciliation fails', async () => {
    const tombstone = { id: 'delete-failure', serverVersion: 3, deletionPending: true };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [],
      batches: [],
      deletes: { categories: [], products: [tombstone], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [], batches: [] });
    mocks.deleteProduct.mockRejectedValue(new Error('forced delete failure'));

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-DELETE-FAILURE'
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      unsynced: 1
    });
    expect(mocks.markDeletionSynced).not.toHaveBeenCalled();
    expect(mocks.markDeletionConflict).toHaveBeenCalledWith({
      entityType: 'product',
      entityId: 'delete-failure',
      reason: 'PRODUCT_RECOVERY_RPC_FAILED'
    });
  });
});
