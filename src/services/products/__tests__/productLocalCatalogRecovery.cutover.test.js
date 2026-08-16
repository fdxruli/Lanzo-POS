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
  upsertCategory: vi.fn(),
  upsertProduct: vi.fn(),
  upsertProductBatch: vi.fn(),
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
vi.mock('../../tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
}));
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
  upsertCategory: mocks.upsertCategory,
  upsertProduct: mocks.upsertProduct,
  upsertProductBatch: mocks.upsertProductBatch,
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

const recoveryTenantId = 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
    mocks.upsertCategory.mockImplementation(async ({ category }) => ({ success: true, category }));
    mocks.upsertProduct.mockImplementation(async ({ product }) => ({ success: true, product }));
    mocks.upsertProductBatch.mockImplementation(async ({ batch }) => ({ success: true, batch }));
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

  it('reconciles FREE updates and creates through canonical OCC upserts', async () => {
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: localCatalog.products,
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-UPDATE-CREATE'
    })).resolves.toMatchObject({ success: true, recovered: 2 });

    expect(mocks.migrateLocalCatalog).not.toHaveBeenCalled();
    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(1, expect.objectContaining({
       licenseKey: 'CUTOVER-UPDATE-CREATE',
       expectedVersion: 4,
       idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:existing-product:4:legacy`
     }));
    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(2, expect.objectContaining({
      licenseKey: 'CUTOVER-UPDATE-CREATE',
      expectedVersion: null,
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:new-product:new:legacy`
    }));
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(2);
    expect(mocks.events).toEqual([]);
    expect(mocks.deleteProduct).not.toHaveBeenCalled();
  });

  it('uses OCC for category and batch updates and keeps deterministic retry keys', async () => {
    const category = {
      id: 'category-1',
      name: 'Category',
      serverVersion: 2,
      updatedAt: '2026-08-15T00:00:00.000Z',
      pendingOperationId: 'old-category-operation',
      localMutationId: 'category-mutation-2'
    };
    const batch = {
      id: 'batch-1',
      productId: 'existing-product',
      stock: 3,
      serverVersion: 6,
      updatedAt: '2026-08-15T00:00:01.000Z',
      pendingOperationId: 'old-batch-operation',
      localMutationId: 'batch-mutation-6'
    };
    mocks.listUnsynced.mockResolvedValue({
      categories: [category],
      products: [],
      batches: [batch],
      deletes: { categories: [], products: [], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [category], products: [], batches: [batch] });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-CATEGORY-BATCH'
    })).resolves.toMatchObject({ success: true, recovered: 2 });

    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2,
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:category:category-1:2:category-mutation-2`
    }));
    expect(mocks.upsertProductBatch).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 6,
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product_batch:batch-1:6:batch-mutation-6`
    }));
    expect(mocks.upsertCategory).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'old-category-operation' }));
    expect(mocks.upsertProductBatch).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'old-batch-operation' }));
  });

  it('recovers inactive unsynced products as upserts and keeps real deletes on the tombstone path', async () => {
    const deactivated = {
      id: 'deactivated-product',
      name: 'Deactivated',
      isActive: false,
      serverVersion: 10,
      syncStatus: 'local',
      lastSyncedAt: null,
      localMutationId: 'mutation-deactivate'
    };
    const activated = {
      id: 'activated-product',
      name: 'Activated',
      isActive: true,
      serverVersion: 11,
      syncStatus: 'local',
      lastSyncedAt: null,
      localMutationId: 'mutation-activate'
    };
    const tombstone = {
      id: 'deleted-product',
      isActive: false,
      deletedAt: '2026-08-15T00:00:00.000Z',
      deletionPending: true,
      serverVersion: 12,
      localMutationId: 'mutation-delete'
    };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [deactivated, activated],
      batches: [],
      deletes: { categories: [], products: [tombstone], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [deactivated, activated], batches: [] });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-INACTIVE-INTENT'
    })).resolves.toMatchObject({ success: true, recovered: 3 });

    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedVersion: 10,
      product: expect.objectContaining({ id: 'deactivated-product', isActive: false }),
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:deactivated-product:10:mutation-deactivate`
    }));
    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedVersion: 11,
      product: expect.objectContaining({ id: 'activated-product', isActive: true }),
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:activated-product:11:mutation-activate`
    }));
    expect(mocks.deleteProduct).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'deleted-product',
      idempotencyKey: `products-recovery:${recoveryTenantId}:delete:product:deleted-product:12:mutation-delete`
    }));
  });

  it('does not replay an old outbox key, keeps retries stable, and changes key after a second edit', async () => {
    const firstEdit = {
      id: 'reused-key-product',
      name: 'New FREE edit',
      serverVersion: 7,
      updatedAt: '2026-08-15T00:00:00.000Z',
      pendingOperationId: 'old-completed-operation-k',
      localMutationId: 'new-free-mutation-a'
    };
    const catalog = (record) => ({
      categories: [],
      products: [record],
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });
    mocks.listUnsynced.mockResolvedValue(catalog(firstEdit));
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [firstEdit], batches: [] });
    mocks.upsertProduct
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({ success: true, product: firstEdit });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-IDEMPOTENCY-RETRY'
    })).resolves.toMatchObject({ success: false, blocked: true });
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-IDEMPOTENCY-RETRY'
    })).resolves.toMatchObject({ success: true, recovered: 1 });

    const firstKey = mocks.upsertProduct.mock.calls[0][0].idempotencyKey;
    const retryKey = mocks.upsertProduct.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(retryKey);
    expect(firstKey).not.toBe('old-completed-operation-k');
    expect(firstKey).not.toContain('CUTOVER-IDEMPOTENCY-RETRY');

    const secondEdit = { ...firstEdit, name: 'Second FREE edit', localMutationId: 'new-free-mutation-b' };
    mocks.listUnsynced.mockResolvedValueOnce(catalog(firstEdit)).mockResolvedValueOnce(catalog(secondEdit));
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [secondEdit], batches: [] });
    mocks.upsertProduct.mockResolvedValue({ success: true, product: secondEdit });

    await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey: 'CUTOVER-IDEMPOTENCY-SECOND-EDIT' });
    await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey: 'CUTOVER-IDEMPOTENCY-SECOND-EDIT' });

    const secondEditKeys = mocks.upsertProduct.mock.calls.slice(-2).map(([payload]) => payload.idempotencyKey);
    expect(secondEditKeys[0]).not.toBe(secondEditKeys[1]);
    expect(secondEditKeys[0]).toContain('new-free-mutation-a');
    expect(secondEditKeys[1]).toContain('new-free-mutation-b');
  });

  it('treats a server replay on the old key as stale and surfaces VERSION_CONFLICT for the new mutation', async () => {
    const record = {
      id: 'server-replay-product',
      name: 'Current FREE edit',
      serverVersion: 3,
      pendingOperationId: 'old-completed-operation-k',
      localMutationId: 'current-mutation'
    };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [record],
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [record], batches: [] });
    mocks.upsertProduct.mockImplementation(async ({ idempotencyKey }) => (
      idempotencyKey === 'old-completed-operation-k'
        ? { success: true, product: { id: 'server-replay-product', name: 'Old response' } }
        : { success: false, code: 'VERSION_CONFLICT', message: 'Current server version is newer.' }
    ));

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-SERVER-REPLAY'
    })).resolves.toMatchObject({ success: false, blocked: true });

    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:server-replay-product:3:current-mutation`
    }));
    expect(mocks.saveConflict).toHaveBeenCalledWith(expect.objectContaining({
      localPayload: { issues: [expect.objectContaining({ code: 'VERSION_CONFLICT' })] }
    }));
  });

  it('reconciles mixed create, update, and delete intent in one cutover', async () => {
    const updatedProduct = { id: 'updated-product', name: 'Updated', serverVersion: 5 };
    const newProduct = { id: 'new-product', name: 'New', price: 25 };
    const tombstone = {
      id: 'deleted-product',
      serverVersion: 8,
      deletedTimestamp: '2026-08-15T00:00:00.000Z',
      deletionPending: true,
      pendingOperationId: 'old-upsert-operation',
      localMutationId: 'delete-after-upsert'
    };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [updatedProduct, newProduct],
      batches: [],
      deletes: { categories: [], products: [tombstone], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [updatedProduct, newProduct], batches: [] });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-MIXED-INTENT'
    })).resolves.toMatchObject({ success: true, recovered: 3 });

    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedVersion: 5,
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:updated-product:5:legacy`
    }));
    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedVersion: null,
      idempotencyKey: `products-recovery:${recoveryTenantId}:upsert:product:new-product:new:legacy`
    }));
    expect(mocks.deleteProduct).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 8,
      idempotencyKey: `products-recovery:${recoveryTenantId}:delete:product:deleted-product:8:delete-after-upsert`
    }));
    expect(mocks.markDeletionSynced).toHaveBeenCalledWith({
      entityType: 'product',
      entityId: 'deleted-product'
    });
  });

  it('blocks VERSION_CONFLICT without snapshot or clearing the local record', async () => {
    const product = { id: 'stale-product', name: 'Stale', serverVersion: 5, updatedAt: '2026-08-15T00:00:00.000Z' };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [product],
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [product], batches: [] });
    mocks.upsertProduct.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'Cloud version advanced.',
      server_version: 6,
      product: { id: 'stale-product', server_version: 6 }
    });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-VERSION-CONFLICT'
    })).resolves.toMatchObject({ success: false, blocked: true, unsynced: 1 });

    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
    expect(mocks.markDeletionSynced).not.toHaveBeenCalled();
    expect(mocks.saveConflict).toHaveBeenCalledWith(expect.objectContaining({
      localPayload: { issues: [expect.objectContaining({
        entityType: 'product',
        entityId: 'stale-product',
        code: 'VERSION_CONFLICT',
        serverVersion: 6
      })] }
    }));
  });

  it('fails closed for duplicate barcode and preserves active local conflict state', async () => {
    const product = { id: 'duplicate-product', name: 'Duplicate', serverVersion: 5 };
    mocks.listUnsynced.mockResolvedValue({
      categories: [],
      products: [product],
      batches: [],
      deletes: { categories: [], products: [], batches: [] }
    });
    mocks.getLocalCatalog.mockResolvedValue({ categories: [], products: [product], batches: [] });
    mocks.upsertProduct.mockResolvedValue({ success: false, code: 'DUPLICATE_BARCODE' });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
      licenseKey: 'CUTOVER-DUPLICATE'
    })).resolves.toMatchObject({ success: false, blocked: true });

    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
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
       idempotencyKey: `products-recovery:${recoveryTenantId}:delete:product:deleted-product:8:2026-08-15T00-00-00.000Z`
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
