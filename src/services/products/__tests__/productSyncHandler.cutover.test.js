import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  runMigration: vi.fn(),
  runRecovery: vi.fn(),
  upsertProduct: vi.fn(),
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
  upsertProduct: mocks.upsertProduct
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
    mocks.getCatalogRecordForSync.mockResolvedValue({
      id: 'product-stale',
      serverVersion: 6,
      localMutationId: 'new-free-mutation',
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
      conflict: { code: 'STALE_LOCAL_MUTATION' }
    });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
    expect(mocks.saveConflict).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ id: 'old-outbox-operation' }),
      response: expect.objectContaining({ code: 'STALE_LOCAL_MUTATION' })
    }));
  });
});
