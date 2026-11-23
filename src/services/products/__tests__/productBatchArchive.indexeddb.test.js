// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFLICT_STATUS, POS_SYNC_STORES } from '../../sync/syncConstants';

const mocks = vi.hoisted(() => ({
  pullCatalogSnapshot: vi.fn(),
  deleteProductBatch: vi.fn(),
  enqueueOperation: vi.fn(),
  actor: { status: 'granted', sessionId: 'session-a', permissions: ['products', 'inventory'] },
  license: { license_key: 'tenant-a', features: { cloud_pos_sync: true, cloud_products_sync: true } }
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ licenseDetails: mocks.license }) } }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { getState: () => mocks.actor } }));
vi.mock('../../auth/productInventoryAuthority', () => ({
  captureProductInventoryMutation: () => ({ sessionId: 'session-a' }),
  assertProductInventoryMutationCurrent: vi.fn()
}));
vi.mock('../../tenant/localTenantGuard', () => ({
  runWithLocalTenantSyncLease: async (_identity, _options, operation) => operation(),
  assertLocalTenantAccess: vi.fn()
}));
vi.mock('../productCatalogRecoveryLock', () => ({
  runWithProductCatalogRecoveryLock: async ({ operation }) => operation()
}));
vi.mock('../../utils', () => ({ generateID: (prefix) => prefix + '-test' }));
vi.mock('../../db/databaseRuntime', () => ({}));
vi.mock('../../database', () => ({ loadData: (store, id) => db.table(store).get(id) }));
vi.mock('../../db/general', () => ({ categoriesRepository: {} }));
vi.mock('../../inventory/inventoryEntryService', () => ({ listLocalOnlyInventoryEntriesForRecovery: vi.fn() }));
vi.mock('../../sales/tableReservationReconciliation', () => ({ reconcileActiveTableReservations: vi.fn() }));
vi.mock('../../ecommerce/ecommerceAdminService', () => ({ getEcommercePortal: vi.fn(), listPublishedProducts: vi.fn() }));
vi.mock('../../sync/syncOutboxService', () => ({ syncOutboxService: { enqueueOperation: mocks.enqueueOperation } }));
vi.mock('../productMigrationService', () => ({}));
vi.mock('../productSyncHandler', () => ({}));
vi.mock('../productCloudRepository', () => ({
  productCloudRepository: { pullCatalogSnapshot: mocks.pullCatalogSnapshot, deleteProductBatch: mocks.deleteProductBatch }
}));

const stores = {
  MENU: 'menu',
  DELETED_MENU: 'deleted_menu',
  CATEGORIES: 'categories',
  DELETED_CATEGORIES: 'deleted_categories',
  PRODUCT_BATCHES: 'product_batches',
  INVENTORY_EVENTS: 'inventory_events',
  SALES: 'sales'
};
const productId = 'prod_mwlorr9t_d86e4f19';
const batchId = 'batch_mwlotoyl_578dd8f6';
const product = { id: productId, stock: 0, committedStock: 0, syncStatus: 'local' };
const batch = {
  id: batchId, productId, stock: 0, committedStock: 0, isActive: false, status: 'inactive',
  syncStatus: 'local', manufacturerBatchId: 'MUSE-VI-001', expiryDate: '2027-01-15',
  notes: 'Prueba negativa: lote duplicado', createdAt: '2026-11-20T13:00:00.000Z'
};
const archiveRequest = {
  ...batch, status: 'archived', isArchived: true, deletedAt: '2026-11-21T13:00:00.000Z'
};
const priorConflict = {
  id: 'conflict-archive', entityId: batchId, entityType: 'product_batch',
  conflictType: 'BATCH_NOT_FOUND', status: CONFLICT_STATUS.PENDING, localPayload: archiveRequest,
  serverPayload: { success: false, code: 'BATCH_NOT_FOUND', idempotency_key: `product:product_batch:delete:${batchId}:device:time:random` },
  metadata: { source: 'productRepository', outboxId: null }
};

let db;
let productRepository;
let localRepository;
let queryBatchManagerPage;
beforeAll(async () => {
  db = new Dexie(`batch-archive-${crypto.randomUUID()}`);
  db.version(1).stores({
    [stores.MENU]: 'id', [stores.DELETED_MENU]: 'id',
    [stores.CATEGORIES]: 'id', [stores.DELETED_CATEGORIES]: 'id', [stores.SALES]: 'id',
    [stores.PRODUCT_BATCHES]: 'id, productId', [stores.INVENTORY_EVENTS]: 'id, productId',
    [POS_SYNC_STORES.OUTBOX]: 'id, status, entityType, createdAt, [status+createdAt], idempotencyKey',
    [POS_SYNC_STORES.CONFLICTS]: 'id, entityType, entityId, status, createdAt'
  });
  await db.open();
  vi.doMock('../../db/dexie', () => ({ db, STORES: stores }));
  ({ productRepository } = await import('../productRepository'));
  ({ productLocalRepository: localRepository } = await import('../productLocalRepository'));
  ({ queryBatchManagerPage } = await import('../batchManagerQueries'));
});
afterAll(async () => db?.delete());

const snapshot = ({ entityType, offset, limit }, rows = []) => ({
  success: true, entity_type: entityType, offset, limit, total: rows.length, has_more: false,
  latest_change_seq: 8, [entityType === 'product' ? 'products' : 'batches']: rows
});

beforeEach(async () => {
  vi.resetAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.table(stores.MENU).put(product);
  await db.table(stores.PRODUCT_BATCHES).bulkPut([
    batch, { ...batch, id: 'batch_mwloxbks_065bcb54', notes: 'Original' },
    { ...batch, id: 'batch_mwloxt79_e6e600b5', manufacturerBatchId: 'MUSE-VI-VENCIDO', notes: 'Vencido' }
  ]);
  mocks.pullCatalogSnapshot.mockImplementation(async (args) => snapshot(args));
});

describe('archiving a batch with Cloud enabled', () => {
  it('preserves pharmacy history without scheduling a remote delete', async () => {
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: true, archivedLocalOnly: true });
    const { items } = await queryBatchManagerPage({ productId, status: 'archived' });
    expect(items).toEqual([expect.objectContaining({
      ...batch, status: 'archived', isArchived: true, deletedAt: expect.any(String), deletionPending: false
    })]);
    expect((await localRepository.listUnsyncedLocalCatalogForCloud()).deletes.batches).toEqual([]);
    expect(await db.table(stores.MENU).get(productId)).toEqual(product);
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledWith(expect.objectContaining({ includeDeleted: true, force: true }));
    expect(mocks.deleteProductBatch).not.toHaveBeenCalled();
    expect(mocks.enqueueOperation).not.toHaveBeenCalled();
  });

  it('uses the versioned Cloud procedure for a synced batch', async () => {
    await db.table(stores.PRODUCT_BATCHES).update(batchId, { syncStatus: 'synced', serverVersion: 4 });
    mocks.deleteProductBatch.mockResolvedValue({ success: true });
    await expect(productRepository.deleteBatch({ ...archiveRequest, serverVersion: 4 })).resolves.toMatchObject({ success: true });
    expect(mocks.deleteProductBatch).toHaveBeenCalledWith(expect.objectContaining({ batchId, expectedVersion: 4 }));
    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();
  });

  it.each(['incomplete', 'remote tombstone', 'concurrent inventory'])('blocks a %s before archiving', async (mode) => {
    mocks.pullCatalogSnapshot.mockImplementation(async (args) => {
      if (args.entityType === 'product') return snapshot(args);
      if (mode === 'incomplete') return { ...snapshot(args), latest_change_seq: null };
      if (mode === 'remote tombstone') return snapshot(args, [{ id: batchId, product_id: productId, deleted_at: '2026-11-20' }]);
      await db.table(POS_SYNC_STORES.OUTBOX).put({
        id: 'pending-inventory', entityType: 'inventory_entry', entityId: 'entry-a',
        licenseKey: 'tenant-a', status: 'pending', payload: { entry: { productId } }
      });
      return snapshot(args);
    });
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: false, blocked: true });
    expect(await db.table(stores.PRODUCT_BATCHES).get(batchId)).toEqual(batch);
    expect(mocks.deleteProductBatch).not.toHaveBeenCalled();
    expect(mocks.enqueueOperation).not.toHaveBeenCalled();
  });

  it('resolves only the matching conflict after proving all original IDs absent', async () => {
    const unrelated = { ...priorConflict, id: 'unrelated', entityId: 'another-batch' };
    const conflicts = db.table(POS_SYNC_STORES.CONFLICTS);
    await conflicts.bulkPut([priorConflict, unrelated]);
    await db.table(stores.PRODUCT_BATCHES).update(batchId, { syncStatus: 'conflict', conflictReason: 'BATCH_NOT_FOUND' });

    mocks.pullCatalogSnapshot.mockImplementation(async (args) => snapshot(args, args.entityType === 'product_batch'
      ? [{ id: 'batch_mwloxbks_065bcb54', product_id: productId }] : []));
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: false, blocked: true });
    expect(await conflicts.get(priorConflict.id)).toEqual(priorConflict);

    mocks.pullCatalogSnapshot.mockImplementation(async (args) => snapshot(args));
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: true });
    expect(await conflicts.get(priorConflict.id)).toMatchObject({
      ...priorConflict, status: CONFLICT_STATUS.RESOLVED, resolvedPayload: { productId, batchId, cloudRevision: 8 }
    });
    expect(await conflicts.get(unrelated.id)).toEqual(unrelated);
    expect(await db.table(stores.PRODUCT_BATCHES).get(batchId)).toMatchObject({ status: 'archived', conflictReason: null });
    expect(mocks.deleteProductBatch).not.toHaveBeenCalled();
  });
});
