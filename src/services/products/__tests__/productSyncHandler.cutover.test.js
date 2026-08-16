import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  runMigration: vi.fn(),
  runRecovery: vi.fn(),
  upsertProduct: vi.fn(),
  upsertCategory: vi.fn(),
  upsertProductBatch: vi.fn(),
  deleteProduct: vi.fn(),
  deleteCategory: vi.fn(),
  deleteProductBatch: vi.fn(),
  saveConflict: vi.fn(),
  applyCloudCatalog: vi.fn(),
  getCatalogRecordForSync: vi.fn(),
  setMeta: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState }
}));
vi.mock('../../sync/posSyncOrchestrator', () => ({
  posSyncOrchestrator: { registerEntitySyncHandler: vi.fn() }
}));
vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: vi.fn(),
  setMeta: mocks.setMeta
} }));
vi.mock('../productMigrationService', () => ({ productMigrationService: {
  runInitialMigrationIfNeeded: mocks.runMigration,
  pullFullSnapshot: vi.fn()
} }));
vi.mock('../productLocalCatalogRecovery', () => ({ productLocalCatalogRecovery: {
  runUnsyncedCatalogRecovery: mocks.runRecovery,
  savePermissionBlockedWarning: vi.fn()
} }));
vi.mock('../productCloudRepository', () => ({ productCloudRepository: {
  upsertProduct: mocks.upsertProduct,
  upsertCategory: mocks.upsertCategory,
  upsertProductBatch: mocks.upsertProductBatch,
  deleteProduct: mocks.deleteProduct,
  deleteCategory: mocks.deleteCategory,
  deleteProductBatch: mocks.deleteProductBatch
} }));
vi.mock('../productLocalRepository', () => ({ productLocalRepository: {
  applyCloudCatalog: mocks.applyCloudCatalog,
  getCatalogRecordForSync: mocks.getCatalogRecordForSync
} }));
vi.mock('../productConflictService', () => ({ productConflictService: {
  isConflictResponse: (response) => response?.code === 'VERSION_CONFLICT',
  saveConflict: mocks.saveConflict
} }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));
vi.mock('../../inventory/inventoryEntryService', () => ({ markInventoryEntrySynced: vi.fn() }));
vi.mock('../../Logger', () => ({ default: {
  log: vi.fn(),
  warn: vi.fn()
} }));

import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';
import { productSyncHandler } from '../productSyncHandler';

describe('product sync repeated cutover safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      canAccess: () => true,
      licenseDetails: { license_key: 'CUTOVER-HANDLER' }
    });
    mocks.runMigration.mockResolvedValue({
      success: true,
      recovery: { success: true, recovered: 1 }
    });
    mocks.runRecovery.mockResolvedValue({ success: true, skipped: true, reason: 'no_unsynced_catalog' });
    mocks.applyCloudCatalog.mockResolvedValue({ categories: 0, products: 1, batches: 0, rejected: [] });
    mocks.getCatalogRecordForSync.mockResolvedValue(null);
  });

  it('does not double-submit recovery when migration already returned its recovery result', async () => {
    await expect(productSyncHandler.onStart({
      licenseKey: 'CUTOVER-HANDLER',
      reason: 'manual',
      force: true
    })).resolves.toMatchObject({
      success: true,
      recovery: { recovered: 1 }
    });

    expect(mocks.runMigration).toHaveBeenCalledWith({ licenseKey: 'CUTOVER-HANDLER' });
    expect(mocks.runRecovery).not.toHaveBeenCalled();
  });

  it('keeps a stale outbox mutation OCC-conflicted instead of applying cloud state locally', async () => {
    const response = {
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'Cloud version advanced.',
      server_version: 6,
      product: { id: 'product-stale', server_version: 6 }
    };
    mocks.upsertProduct.mockResolvedValue(response);

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPDATE,
      entityId: 'product-stale',
      id: 'old-outbox-operation',
      idempotencyKey: 'old-outbox-operation',
      payload: {
        expectedVersion: 5,
        productId: 'product-stale',
        product: { id: 'product-stale', price: 20 }
      }
    });

    expect(result).toEqual({ conflict: response, success: false });
    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5 }));
    expect(mocks.saveConflict).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ id: 'old-outbox-operation' }),
      response,
      source: 'productSyncHandler.pushOperation'
    }));
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('does not apply a successful replay from an old outbox key over a newer FREE mutation', async () => {
    const replayResponse = { success: true, product: { id: 'product-stale', name: 'Old response', server_version: 6 } };
    mocks.upsertProduct.mockResolvedValue(replayResponse);
    mocks.getCatalogRecordForSync
      .mockResolvedValueOnce({
        id: 'product-stale',
        serverVersion: 5,
        localMutationId: 'old-outbox-operation',
        syncStatus: 'pending'
      })
      .mockResolvedValueOnce({
        id: 'product-stale',
        serverVersion: 6,
        localMutationId: 'new-free-mutation',
        syncStatus: 'pending',
        isActive: false
      });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPDATE,
      entityId: 'product-stale',
      id: 'old-outbox-operation',
      idempotencyKey: 'old-outbox-operation',
      payload: {
        expectedVersion: 5,
        productId: 'product-stale',
        product: { id: 'product-stale', is_active: true }
      }
    });

    expect(result).toMatchObject({
      success: false,
      conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'post_rpc' }
    });
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
    expect(mocks.saveConflict).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ id: 'old-outbox-operation' }),
      response: expect.objectContaining({ code: 'STALE_LOCAL_MUTATION' })
    }));
  });

  it('blocks a stale product before invoking the remote RPC', async () => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-preflight-stale',
      serverVersion: 7,
      localMutationId: 'new-free-mutation',
      syncStatus: 'pending'
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: 'product-preflight-stale',
      id: 'old-outbox-operation',
      idempotencyKey: 'old-outbox-operation',
      payload: { product: { id: 'product-preflight-stale', name: 'Old' } }
    });

    expect(result).toMatchObject({
      success: false,
      conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' }
    });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('keeps the old UPDATE OCC stale guard intact when the server version is newer', async () => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-occ-stale',
      serverVersion: 6,
      syncStatus: 'synced',
      pendingOperationId: null,
      localMutationId: null
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPDATE,
      entityId: 'product-occ-stale',
      id: 'old-update-k',
      idempotencyKey: 'old-update-k',
      payload: {
        expectedVersion: 5,
        productId: 'product-occ-stale',
        product: { id: 'product-occ-stale', name: 'Old update' }
      }
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it('allows a same-operation product retry when the local mutation is still K', async () => {
    const response = { success: true, product: { id: 'product-retry', name: 'Retry' } };
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-retry',
      localMutationId: 'operation-k',
      pendingOperationId: 'operation-k',
      syncStatus: 'pending'
    });
    mocks.upsertProduct.mockResolvedValue(response);

    await expect(productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: 'product-retry',
      id: 'operation-id',
      idempotencyKey: 'operation-k',
      payload: { product: { id: 'product-retry', name: 'Retry' } }
    })).resolves.toEqual(response);

    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'operation-k' }));
    expect(mocks.applyCloudCatalog).toHaveBeenCalledWith(response);
  });

  it('allows a same-operation retry when the local mutation matches operation.id', async () => {
    const response = { success: true, product: { id: 'product-id-fallback', name: 'Retry' } };
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-id-fallback',
      localMutationId: 'operation-id-fallback',
      pendingOperationId: 'operation-id-fallback',
      syncStatus: 'pending'
    });
    mocks.upsertProduct.mockResolvedValue(response);

    await expect(productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: 'product-id-fallback',
      id: 'operation-id-fallback',
      idempotencyKey: 'different-idempotency-key',
      payload: { product: { id: 'product-id-fallback', name: 'Retry' } }
    })).resolves.toEqual(response);

    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'category',
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      operation: SYNC_OPERATIONS.UPDATE,
      entityId: 'category-preflight-stale',
      payload: { category: { id: 'category-preflight-stale', name: 'Old' } },
      rpc: 'upsertCategory'
    },
    {
      label: 'batch',
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      operation: SYNC_OPERATIONS.UPDATE,
      entityId: 'batch-preflight-stale',
      payload: { batch: { id: 'batch-preflight-stale', product_id: 'product-1' } },
      rpc: 'upsertProductBatch'
    }
  ])('blocks a stale $label before invoking its remote RPC', async ({ entityType, operation, entityId, payload, rpc }) => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: entityId,
      localMutationId: 'new-free-mutation',
      syncStatus: 'pending'
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType,
      operation,
      entityId,
      id: 'old-outbox-operation',
      idempotencyKey: 'old-outbox-operation',
      payload
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks[rpc]).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'category CREATE',
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      entityId: 'category-recovered',
      payload: { category: { id: 'category-recovered', name: 'Old category' } },
      rpc: 'upsertCategory'
    },
    {
      label: 'batch CREATE',
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      entityId: 'batch-recovered',
      payload: { batch: { id: 'batch-recovered', product_id: 'product-1' } },
      rpc: 'upsertProductBatch'
    }
  ])('blocks a never-sent stale $label after newer recovery', async ({ entityType, entityId, payload, rpc }) => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: entityId,
      serverVersion: 7,
      syncStatus: 'synced',
      pendingOperationId: null,
      localMutationId: null
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType,
      operation: SYNC_OPERATIONS.CREATE,
      entityId,
      id: 'old-create-k',
      idempotencyKey: 'old-create-k',
      payload
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks[rpc]).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('does not apply an old CREATE response after recovery has already produced a synced server-backed record', async () => {
    const response = { success: true, product: { id: 'product-recovered', name: 'Old response', server_version: 4 } };
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-recovered',
      serverVersion: 7,
      syncStatus: 'synced',
      pendingOperationId: null,
      localMutationId: null,
      name: 'New FREE value'
    });
    mocks.upsertProduct.mockResolvedValue(response);

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: 'product-recovered',
      id: 'old-create-operation',
      idempotencyKey: 'old-create-operation',
      payload: { product: { id: 'product-recovered', name: 'Old value' } }
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('blocks an old UPSERT after newer recovery before invoking the product RPC', async () => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-upsert-recovered',
      serverVersion: 7,
      syncStatus: 'synced',
      pendingOperationId: null,
      localMutationId: null
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: 'product-upsert-recovered',
      id: 'old-upsert-k',
      idempotencyKey: 'old-upsert-k',
      payload: { product: { id: 'product-upsert-recovered', name: 'Old upsert' } }
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it('allows a legitimate first-time CREATE retry while its local mutation still corresponds to K', async () => {
    const response = { success: true, product: { id: 'product-first-create', name: 'First create' } };
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-first-create',
      serverVersion: null,
      syncStatus: 'pending',
      localMutationId: 'create-k',
      pendingOperationId: 'create-k'
    });
    mocks.upsertProduct.mockResolvedValue(response);

    await expect(productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: 'product-first-create',
      id: 'create-operation-id',
      idempotencyKey: 'create-k',
      payload: { product: { id: 'product-first-create', name: 'First create' } }
    })).resolves.toEqual(response);

    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudCatalog).toHaveBeenCalledWith(response);
  });

  it('allows a valid DELETE retry for the current local mutation', async () => {
    const response = { success: true, product: { id: 'product-delete-retry', is_active: false, server_version: 8 } };
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-delete-retry',
      serverVersion: 7,
      syncStatus: 'pending',
      localMutationId: 'delete-k',
      deletionPending: true
    });
    mocks.deleteProduct.mockResolvedValue(response);

    await expect(productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: 'product-delete-retry',
      id: 'delete-operation-id',
      idempotencyKey: 'delete-k',
      payload: { productId: 'product-delete-retry', expectedVersion: 7 }
    })).resolves.toEqual(response);

    expect(mocks.deleteProduct).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 7,
      idempotencyKey: 'delete-k'
    }));
    expect(mocks.applyCloudCatalog).toHaveBeenCalledWith(response);
  });

  it('does not replay an old upsert after a newer FREE delete intent', async () => {
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-free-delete',
      serverVersion: 8,
      syncStatus: 'pending',
      localMutationId: 'new-free-delete',
      deletedAt: '2026-08-15T00:00:00.000Z',
      deletionPending: true
    });

    const result = await productSyncHandler.pushOperation({
      licenseKey: 'CUTOVER-HANDLER',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: 'product-free-delete',
      id: 'old-upsert-operation',
      idempotencyKey: 'old-upsert-operation',
      payload: { product: { id: 'product-free-delete', name: 'Old upsert' } }
    });

    expect(result).toMatchObject({ success: false, conflict: { code: 'STALE_LOCAL_MUTATION', stalePhase: 'pre_rpc' } });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });
});
