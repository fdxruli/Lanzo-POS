// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIdempotencyKey } from '../../sync/idempotency';
import { CONFLICT_STATUS, POS_SYNC_STORES, SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';

const mocks = vi.hoisted(() => ({
  pullCatalogSnapshot: vi.fn(),
  deleteProductBatch: vi.fn(),
  enqueueOperation: vi.fn(),
  actor: { status: 'granted', sessionId: 'session-a', permissions: ['products', 'inventory'] },
  license: { license_key: 'tenant-a', features: { cloud_pos_sync: true, cloud_products_sync: true } }
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ licenseDetails: mocks.license }) } }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { getState: () => mocks.actor, capture: () => ({ assertCurrent() {} }) } }));
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
  productCloudRepository: { negotiateSnapshotProtocol: async () => ({ supported: true }), pullCatalogSnapshot: mocks.pullCatalogSnapshot, deleteProductBatch: mocks.deleteProductBatch }
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
const productId = 'local-product';
const batchId = 'Local-Batch:01';
const product = { id: productId, stock: 0, committedStock: 0, syncStatus: 'local' };
const batch = {
  id: batchId, productId, stock: 0, committedStock: 0, isActive: false, status: 'inactive',
  syncStatus: 'local', manufacturerBatchId: 'LOT-01', expiryDate: '2027-01-15',
  notes: '', createdAt: '2026-11-20T13:00:00.000Z'
};
const archiveRequest = {
  ...batch, status: 'archived', isArchived: true, deletedAt: '2026-11-21T13:00:00.000Z'
};
let db;
let productRepository;
let localRepository;
let productConflictService;
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
  ({ productConflictService } = await import('../productConflictService'));
  ({ queryBatchManagerPage } = await import('../batchManagerQueries'));
});
afterAll(async () => db?.delete());

const snapshotPage = (rows = {}) => ({
  success: true, snapshot_contract: 'keyset_reference_v1', snapshot_contract_version: 1,
  snapshot_reference_change_seq: 8, safe_change_seq: 8, sync_deferred: false,
  categories: [], products: [], batches: [], limit: 500,
  has_more: false, snapshot_complete: true, next_page_cursor: null, ...rows
});

const snapshot = ({ limit }, rows = []) => snapshotPage({ limit, batches: rows });

beforeEach(async () => {
  vi.resetAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.table(stores.MENU).put(product);
  await db.table(stores.PRODUCT_BATCHES).bulkPut([
    batch, { ...batch, id: 'local-batch-02', notes: 'Original' },
    { ...batch, id: 'local-batch-03', manufacturerBatchId: 'LOT-EXPIRED', notes: 'Vencido' }
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
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledWith(expect.objectContaining({ limit: 500, snapshotReferenceChangeSeq: null, pageCursor: null }));
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
      if (mode === 'incomplete') return { ...snapshot(args), snapshot_reference_change_seq: null };
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
    const batches = db.table(stores.PRODUCT_BATCHES);
    const siblings = await batches.where('productId').equals(productId).filter((row) => row.id !== batchId).toArray();
    const entityType = SYNC_ENTITY_TYPES.PRODUCT_BATCH;
    const idempotencyKey = generateIdempotencyKey({
      prefix: 'product', entityType, operation: SYNC_OPERATIONS.DELETE, entityId: batchId
    });
    // Reproduce the original deleteBatch -> saveConflict call with the legacy RPC response.
    const priorConflict = await productConflictService.saveConflict({
      operation: { entityType, entityId: batchId, payload: { batchId, expectedVersion: null } },
      response: { success: false, code: 'BATCH_NOT_FOUND', message: 'El lote no existe.', idempotency_key: idempotencyKey },
      localPayload: archiveRequest,
      source: 'productRepository'
    });
    const unrelated = { ...priorConflict, id: 'unrelated', entityId: 'another-batch' };
    const conflicts = db.table(POS_SYNC_STORES.CONFLICTS);
    await conflicts.put(unrelated);

    mocks.pullCatalogSnapshot.mockImplementation(async (args) => snapshot(args, [{ id: 'local-batch-02', product_id: productId }]));
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: false, blocked: true });
    expect(await conflicts.get(priorConflict.id)).toEqual(priorConflict);

    mocks.pullCatalogSnapshot.mockImplementation(async (args) => snapshot(args));
    await expect(productRepository.deleteBatch(archiveRequest)).resolves.toMatchObject({ success: true });
    expect(await conflicts.get(priorConflict.id)).toMatchObject({
      ...priorConflict, status: CONFLICT_STATUS.RESOLVED, resolvedAt: expect.any(String),
      resolvedPayload: { productId, batchId, cloudRevision: 8 }
    });
    expect(await conflicts.get(unrelated.id)).toEqual(unrelated);
    expect(await batches.get(batchId)).toMatchObject({
      status: 'archived', conflictReason: null, stock: 0, committedStock: 0
    });
    expect(await batches.bulkGet(siblings.map(({ id }) => id))).toEqual(siblings);
    expect(mocks.deleteProductBatch).not.toHaveBeenCalled();
  });
});
