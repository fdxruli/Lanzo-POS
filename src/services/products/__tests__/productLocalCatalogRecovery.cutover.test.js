// @vitest-environment node
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recover: vi.fn(), contract: vi.fn(), snapshot: vi.fn(), category: vi.fn(), negotiateSnapshotProtocol: vi.fn(),
  getMeta: vi.fn(), setMeta: vi.fn(),
  tenantLease: vi.fn(), readInventory: vi.fn(), saveConflict: vi.fn()
}));

vi.mock('../../db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const db = new Dexie('catalog-recovery-cutover');
  db.version(1).stores({
    menu: '&id', categories: '&id', productBatches: '&id,productId', deletedMenu: '&id',
    deletedCategories: '&id', sales: '&id,status', layaways: '&id,status', inventoryEvents: '&id,productId',
    posSyncOutbox: '&id,entityType'
  });
  return { db, STORES: {
    MENU: 'menu', CATEGORIES: 'categories', PRODUCT_BATCHES: 'productBatches', DELETED_MENU: 'deletedMenu',
    DELETED_CATEGORIES: 'deletedCategories', SALES: 'sales', LAYAWAYS: 'layaways', INVENTORY_EVENTS: 'inventoryEvents'
  } };
});
vi.mock('../../sync/syncConstants', async (loadActual) => {
  const actual = await loadActual();
  return { ...actual, POS_SYNC_STORES: { ...actual.POS_SYNC_STORES, OUTBOX: 'posSyncOutbox' } };
});
vi.mock('../../database', () => ({}));
vi.mock('../../db/general', () => ({ categoriesRepository: {} }));
vi.mock('../../utils', () => ({ generateID: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({}) } }));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(),
  isLocalTenantAccessError: (error) => error.code === 'TENANT_RUNTIME_STALE',
  runWithLocalTenantSyncLease: mocks.tenantLease
}));
vi.mock('../../inventory/inventoryEntryService', () => ({
  listLocalOnlyInventoryEntriesForRecovery: vi.fn(async () => [])
}));
vi.mock('../../sync/syncOutboxService', () => ({ syncOutboxService: {
  listInventoryEntriesForRecovery: mocks.readInventory,
  listOperationsForEntity: vi.fn(async () => [])
} }));
vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: mocks.getMeta, setMeta: mocks.setMeta
} }));
vi.mock('../../sync/syncConflictService', () => ({ syncConflictService: { saveConflict: mocks.saveConflict } }));
vi.mock('../productCloudRepository', () => ({ productCloudRepository: {
  recoverLocalProductGroup: mocks.recover, getLocalCatalogRecoveryContract: mocks.contract,
  negotiateSnapshotProtocol: mocks.negotiateSnapshotProtocol, pullCatalogSnapshot: mocks.snapshot,
  upsertCategory: mocks.category
} }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));

import { db } from '../../db/dexie';
import { productLocalCatalogRecovery } from '../productLocalCatalogRecovery';
import { productLocalRepository } from '../productLocalRepository';
import { productMigrationService } from '../productMigrationService';

const licenseKey = 'CUTOVER';
const createdAt = '2026-08-01T00:00:00.000Z';
const local = (id) => ({
  id, name: id, sku: id, stock: 4, committedStock: 0, cost: 5, price: 10, createdAt,
  rubroContext: 'apparel', syncStatus: 'local', batchManagement: { enabled: true }
});
const lot = (id) => ({
  id: 'lot-' + id, productId: id, stock: 4, committedStock: 0, price: 10, cost: 5,
  createdAt, status: 'active', attributes: { size: 'M' }, syncStatus: 'local'
});
const asReceipt = ({ product, batches, idempotencyKey }) => ({
  success: true, product: { ...product, server_version: 2 }, outcome: 'created',
  batches: batches.map((batch) => ({ ...batch, server_version: 1 })), idempotency_key: idempotencyKey
});

const seed = async (products) => {
  await db.table('menu').bulkPut(products);
  await db.table('productBatches').bulkPut(products.map(({ id }) => lot(id)));
};

describe('atomic catalog recovery and local confirmation', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
    mocks.tenantLease.mockImplementation(async (source, _options, operation) => {
      if (source.license_key !== licenseKey) {
        throw Object.assign(new Error('tenant changed'), { code: 'TENANT_RUNTIME_STALE' });
      }
      return operation();
    });
    mocks.readInventory.mockResolvedValue([]);
    mocks.contract.mockResolvedValue({ success: true, contract_version: 1 });
    mocks.getMeta.mockResolvedValue(true);
    mocks.setMeta.mockResolvedValue(true);
    mocks.negotiateSnapshotProtocol.mockResolvedValue({ supported: false, reason: 'legacy_fixture' });
    mocks.snapshot.mockResolvedValue({ success: true, categories: [], products: [], batches: [] });
    mocks.recover.mockImplementation(async (args) => asReceipt(args));
  });

  it.each([false, true])('recovers all safe groups with 13 already confirmed, conflict = %s', async (conflict) => {
    await db.table('menu').bulkPut(Array.from({ length: 13 }, (_, index) => ({
      ...local('cloud-' + index), stock: 9, committedStock: 3, syncStatus: 'synced', serverVersion: 4,
      lastSyncedAt: createdAt
    })));
    await db.table('categories').put({ id: 'apparel', name: 'Apparel', color: '#cccccc', createdAt, syncStatus: 'local' });
    mocks.category.mockImplementation(async ({ category }) => ({ success: true, category: { ...category, server_version: 1 } }));
    await seed(Array.from({ length: 24 }, (_, index) => ({
      ...local('apparel-' + index), categoryId: 'apparel'
    })));
    if (conflict) mocks.recover.mockResolvedValueOnce({ success: false, code: 'DUPLICATE_SKU' });

    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey })).resolves.toMatchObject({
      success: !conflict, recovery: {
        recovered: conflict ? 24 : 25,
        issues: conflict ? [{ entityId: 'apparel-0', code: 'DUPLICATE_SKU' }] : []
      }
    });
    expect(await db.table('menu').count()).toBe(37);
    expect(await db.table('productBatches').count()).toBe(24);
    expect(await db.table('menu').get('cloud-0')).toMatchObject({
      stock: 9, committedStock: 3, syncStatus: 'synced', serverVersion: 4
    });
    expect(await db.table('menu').get('apparel-0')).toMatchObject({
      stock: 4, syncStatus: conflict ? 'conflict' : 'synced', conflictReason: conflict ? 'DUPLICATE_SKU' : null
    });
    expect(await db.table('menu').get('apparel-23')).toMatchObject({ stock: 4, syncStatus: 'synced' });
    expect(await db.table('categories').get('apparel')).toMatchObject({ syncStatus: 'synced' });
    expect(await db.table('productBatches').get('lot-apparel-23')).toMatchObject({
      stock: 4, committedStock: 0, syncStatus: 'synced'
    });
  });

  it('recovers unrelated Apparel while the original pharmacy receipt is still outstanding', async () => {
    await seed([{ ...local('medicine'), metadata: { pharmacy: { kind: 'medicine' } } }, local('apparel')]);
    mocks.readInventory.mockResolvedValue([{ entityId: 'medicine', status: 'failed' }]);

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey })).resolves.toMatchObject({
      recovered: 1, blocked: true, issues: [{ entityId: 'medicine', code: 'PRODUCT_RECOVERY_ORIGINAL_INVENTORY_OPERATION_PENDING' }]
    });
    expect(await db.table('menu').get('medicine')).toMatchObject({ stock: 4, syncStatus: 'local' });
    expect(await db.table('menu').get('apparel')).toMatchObject({ rubroContext: 'apparel', syncStatus: 'synced' });
  });

  it('retains pending data after an uncertain response and reuses the exact request', async () => {
    await seed([local('apparel')]);
    mocks.recover.mockRejectedValueOnce(new Error('Network timeout'));
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey })).resolves.toMatchObject({ blocked: true });
    expect(await db.table('menu').get('apparel')).toMatchObject({ stock: 4, syncStatus: 'local' });

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey })).resolves.toMatchObject({ success: true });
    expect(mocks.recover.mock.calls[0]).toEqual(mocks.recover.mock.calls[1]);
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey }))
      .resolves.toMatchObject({ reason: 'no_unsynced_catalog' });
    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });

  it('keeps pending changes and tombstones through pulls and delayed confirmations', async () => {
    await seed([local('edited')]);
    await db.table('deletedMenu').put({ id: 'deleted', deletionPending: true });
    const stale = asReceipt({
      product: { id: 'edited', stock: 1 }, batches: [], idempotencyKey: 'stale'
    });
    await expect(productLocalRepository.applyCloudCatalog({
      ...stale, products: [{ id: 'deleted', name: 'Deleted', stock: 2 }]
    }, { protectLocalChanges: true })).resolves.toMatchObject({ deferredCatalog: 2 });
    expect(await db.table('menu').get('deleted')).toBeUndefined();

    mocks.recover.mockImplementationOnce(async (args) => {
      await db.table('menu').update('edited', { price: 20 });
      return asReceipt(args);
    });
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey })).resolves.toMatchObject({
      blocked: true, issues: expect.arrayContaining([expect.objectContaining({ code: 'PRODUCT_RECOVERY_LOCAL_CHANGED' })])
    });
    expect(await db.table('menu').get('edited')).toMatchObject({ price: 20, stock: 4, syncStatus: 'local' });
  });

  it('preserves active local reservations even if their cached commitment is missing', async () => {
    await seed([local('held'), local('independent')]);
    await db.table('layaways').put({
      id: 'active-layaway', status: 'active', reservedInventory: [{ productId: 'held', quantity: 2 }]
    });
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey })).resolves.toMatchObject({
      recovered: 1, blocked: true, issues: [{ entityId: 'held', code: 'RECOVERY_LOCAL_RESERVATION_UNVERIFIED' }]
    });
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(await db.table('layaways').get('active-layaway')).toMatchObject({
      reservedInventory: [{ productId: 'held', quantity: 2 }]
    });
  });

  it('keeps the catalog pending without writes when the server migration is missing', async () => {
    await seed([local('apparel')]);
    await db.table('categories').put({ id: 'apparel', name: 'Apparel', createdAt, syncStatus: 'local' });
    mocks.contract.mockRejectedValueOnce({ code: 'PGRST202' });
    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey })).resolves.toMatchObject({
      success: false, blocked: true, recovery: { issues: [{ code: 'PGRST202' }] }
    });
    expect(mocks.category).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('does not send cross-tenant or unauthorized local data', async () => {
    await seed([local('apparel')]);
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey: 'OTHER' }))
      .rejects.toMatchObject({ code: 'TENANT_RUNTIME_STALE' });
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey, canMigrateProducts: false }))
      .resolves.toMatchObject({ blocked: true, reason: 'permission_denied' });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it.runIf(process.env.LANZO_CATALOG_TEST_POSTGRES === '1')('applies a real PostgreSQL receipt after losing the first response', async () => {
    const id = 'client-pg-' + process.pid;
    await seed([local(id)]);
    const execute = ({ product, batches, idempotencyKey }) => {
      const sql = `select public.pos_recover_local_product_group_v1('one','device-a','token-one',null,
        $p$${JSON.stringify(product)}$p$::jsonb, $b$${JSON.stringify(batches)}$b$::jsonb, '${idempotencyKey}');`;
      return JSON.parse(execFileSync('docker', [
        'exec', '-i', 'lanzo-catalog-recovery-pg', 'psql', '-X', '-qAt', '-U', 'postgres',
        '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'
      ], { input: sql, encoding: 'utf8' }));
    };
    mocks.recover.mockImplementationOnce(async (args) => {
      execute(args);
      throw new Error('response lost after commit');
    }).mockImplementation(async (args) => execute(args));

    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey }))
      .resolves.toMatchObject({ blocked: true });
    await expect(productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey }))
      .resolves.toMatchObject({ success: true });
    expect(await db.table('menu').get(id)).toMatchObject({ syncStatus: 'synced', stock: 4, committedStock: 0, serverVersion: 2 });
    expect(await db.table('productBatches').get('lot-' + id)).toMatchObject({ syncStatus: 'synced', stock: 4, committedStock: 0 });
  });
});
