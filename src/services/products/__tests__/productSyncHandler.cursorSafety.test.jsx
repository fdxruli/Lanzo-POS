// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloud: {
    upsertProduct: vi.fn(),
    pullCatalogChanges: vi.fn()
  },
  orchestrator: { registerEntitySyncHandler: vi.fn() }
}));

vi.mock('../productCloudRepository', () => ({ productCloudRepository: mocks.cloud }));
vi.mock('../../sync/posSyncOrchestrator', () => ({ posSyncOrchestrator: mocks.orchestrator }));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => {
  const actual = await importOriginal();
  const { getActiveTenantRuntime } = await import('../../db/tenantRuntimeRouter');
  return {
    ...actual,
    actorRuntimeController: actual.createActorRuntimeController({ getTenantAuthority: () => getActiveTenantRuntime() })
  };
});

import { actorRuntimeController } from '../../auth/actorRuntimeController';
import { db, STORES } from '../../db/dexie';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { useAppStore } from '../../../store/useAppStore';
import { syncMetaService } from '../../sync/syncMetaService';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';
import { PRODUCT_CATALOG_LAST_SEQ_KEY } from '../productConstants';
import { productLocalRepository } from '../productLocalRepository';
import { productSyncHandler, pullCatalogChanges } from '../productSyncHandler';

const TEST_LICENSE_KEY = 'license-key-sha256:test-tenant-runtime-a';
const OTHER_LICENSE_KEY = 'license-key-sha256:other-business';

const cloudProduct = (id, name, serverVersion = 1) => ({
  id,
  name,
  category_id: null,
  price: 10,
  cost: 4,
  stock: 0,
  is_active: true,
  server_version: serverVersion,
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z'
});

const pendingProduct = (id, name = 'Pendiente local') => ({
  id,
  name,
  categoryId: '',
  price: 10,
  cost: 4,
  stock: 0,
  isActive: true,
  serverVersion: null,
  syncStatus: 'pending',
  pendingOperationId: id,
  localMutationId: id,
  lastSyncedAt: null
});

const productOperation = (id, name = 'Producto propio') => ({
  id,
  idempotencyKey: id,
  licenseKey: TEST_LICENSE_KEY,
  entityType: SYNC_ENTITY_TYPES.PRODUCT,
  entityId: id,
  operation: SYNC_OPERATIONS.UPSERT,
  payload: { product: { ...cloudProduct(id, name), name }, expectedVersion: null }
});

const grantProductActor = (sessionId = 'product-cursor-session') => {
  actorRuntimeController.lock('product_cursor_test_reset');
  actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'product-cursor-device' });
  actorRuntimeController.grant({
    actorType: 'admin',
    actorId: 'product-cursor-admin',
    sessionId,
    deviceRef: 'product-cursor-device',
    permissions: ['products'],
    authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
};

describe('product sync read cursor safety', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    useAppStore.setState({ licenseDetails: {
      license_key: TEST_LICENSE_KEY,
      plan_code: 'pro',
      valid: true,
      features: { cloud_pos_sync: true, cloud_products_sync: true }
    } });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    actorRuntimeController.lock('product_cursor_test_reset');
    for (const method of Object.values(mocks.cloud)) method.mockReset();
    mocks.cloud.pullCatalogChanges.mockResolvedValue({
      success: true, categories: [], products: [], batches: [], latest_change_seq: 0, has_more: false
    });
    mocks.cloud.upsertProduct.mockImplementation(async ({ product }) => ({
      success: true,
      product: cloudProduct(product.id, product.name),
      latest_change_seq: 42
    }));
  });

  afterEach(async () => {
    actorRuntimeController.lock('product_cursor_test_closed');
    useAppStore.setState({ licenseDetails: null });
    await closeTestTenantRuntime();
    vi.restoreAllMocks();
  });

  it('keeps a remote change before a write ACK reachable from the old cursor', async () => {
    await db.table(STORES.MENU).put(pendingProduct('own-product-42', 'Escritura propia'));
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });
    const ownAck = cloudProduct('own-product-42', 'Escritura propia', 2);
    mocks.cloud.upsertProduct.mockResolvedValueOnce({
      success: true, product: ownAck, latest_change_seq: 42
    });

    await expect(productSyncHandler.pushOperation(productOperation('own-product-42', 'Escritura propia')))
      .resolves.toMatchObject({ success: true, product: { id: 'own-product-42' } });
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(40);
    expect(await productLocalRepository.getCatalogRecordForSync(SYNC_ENTITY_TYPES.PRODUCT, 'own-product-42'))
      .toMatchObject({ name: 'Escritura propia', syncStatus: 'synced', serverVersion: 2 });

    const remote41 = cloudProduct('remote-product-41', 'Cambio remoto anterior', 1);
    mocks.cloud.pullCatalogChanges.mockResolvedValue({
      success: true,
      categories: [],
      products: [remote41, ownAck],
      batches: [],
      latest_change_seq: 42,
      has_more: false
    });
    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).resolves.toMatchObject({ applied: 2, latestChangeSeq: 42 });

    expect(mocks.cloud.pullCatalogChanges.mock.calls[0][0].sinceChangeSeq).toBe(40);
    expect(await productLocalRepository.getCatalogRecordForSync(SYNC_ENTITY_TYPES.PRODUCT, remote41.id))
      .toMatchObject({ name: 'Cambio remoto anterior', serverVersion: 1 });
    expect(await db.table(STORES.MENU).count()).toBe(2);
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(42);
  });

  it('does not let out-of-order write ACKs move the cursor and applies each record once on pull', async () => {
    await db.table(STORES.MENU).bulkPut([
      pendingProduct('own-product-42', 'Primera operación'),
      pendingProduct('own-product-43', 'Segunda operación')
    ]);
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });

    let resolveFirst;
    let resolveSecond;
    mocks.cloud.upsertProduct
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const firstPush = productSyncHandler.pushOperation(productOperation('own-product-42', 'Primera operación'));
    const secondPush = productSyncHandler.pushOperation(productOperation('own-product-43', 'Segunda operación'));
    await vi.waitFor(() => expect(mocks.cloud.upsertProduct).toHaveBeenCalledTimes(2));

    resolveSecond({ success: true, product: cloudProduct('own-product-43', 'Segunda operación', 1), change_seq: 43 });
    await secondPush;
    resolveFirst({ success: true, product: cloudProduct('own-product-42', 'Primera operación', 1), change_seq: 42 });
    await firstPush;
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(40);

    mocks.cloud.pullCatalogChanges.mockResolvedValueOnce({
      success: true,
      categories: [],
      products: [
        cloudProduct('remote-product-41', 'Cambio remoto'),
        cloudProduct('own-product-42', 'Primera operación'),
        cloudProduct('own-product-43', 'Segunda operación')
      ],
      batches: [],
      latest_change_seq: 43,
      has_more: false
    });
    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).resolves.toMatchObject({ applied: 3, latestChangeSeq: 43 });
    expect(await db.table(STORES.MENU).count()).toBe(3);
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(43);
  });

  it('keeps the pull cursor monotonic when older pull responses finish last', async () => {
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });
    let resolveOlderPage;
    let resolveNewerPage;
    mocks.cloud.pullCatalogChanges
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOlderPage = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewerPage = resolve; }));

    const olderPull = pullCatalogChanges(TEST_LICENSE_KEY);
    const newerPull = pullCatalogChanges(TEST_LICENSE_KEY);
    await vi.waitFor(() => expect(mocks.cloud.pullCatalogChanges).toHaveBeenCalledTimes(2));
    resolveNewerPage({
      success: true, categories: [], products: [cloudProduct('pull-seq-42', 'Página 42')],
      batches: [], latest_change_seq: 42, has_more: false
    });
    await newerPull;
    resolveOlderPage({
      success: true, categories: [], products: [cloudProduct('pull-seq-41', 'Página 41')],
      batches: [], latest_change_seq: 41, has_more: false
    });
    await olderPull;

    expect(mocks.cloud.pullCatalogChanges.mock.calls.map(([request]) => request.sinceChangeSeq)).toEqual([40, 40]);
    expect(await db.table(STORES.MENU).count()).toBe(2);
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(42);
  });

  it('leaves the cursor unchanged when a downloaded page cannot be applied', async () => {
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });
    mocks.cloud.pullCatalogChanges.mockResolvedValue({
      success: true, categories: [], products: [cloudProduct('remote-product-41', 'Cambio remoto')],
      batches: [], latest_change_seq: 41, has_more: false
    });
    const failure = new Error('LOCAL_APPLY_FAILED');
    const apply = vi.spyOn(productLocalRepository, 'applyCloudCatalog').mockRejectedValueOnce(failure);

    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).rejects.toBe(failure);
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(40);

    apply.mockRestore();
    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).resolves.toMatchObject({ applied: 1, latestChangeSeq: 41 });
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(41);
  });

  it('preserves a pending local catalog edit while applying a pull page', async () => {
    await db.table(STORES.MENU).put(pendingProduct('local-pending-product', 'Edición local pendiente'));
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });
    mocks.cloud.pullCatalogChanges.mockResolvedValue({
      success: true,
      categories: [],
      products: [cloudProduct('local-pending-product', 'Versión remota', 2)],
      batches: [],
      latest_change_seq: 41,
      has_more: false
    });

    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).rejects.toMatchObject({ code: 'PRODUCT_CATALOG_LOCAL_CHANGES_PENDING' });

    expect(await productLocalRepository.getCatalogRecordForSync(SYNC_ENTITY_TYPES.PRODUCT, 'local-pending-product'))
      .toMatchObject({ name: 'Edición local pendiente', syncStatus: 'pending', localMutationId: 'local-pending-product' });
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(40);

    await db.table(STORES.MENU).update('local-pending-product', {
      syncStatus: 'synced', serverVersion: 1, pendingOperationId: null,
      localMutationId: null, lastSyncedAt: '2026-11-01T10:00:00.000Z'
    });
    await expect(pullCatalogChanges(TEST_LICENSE_KEY)).resolves.toMatchObject({ applied: 1, latestChangeSeq: 41 });
    expect(await productLocalRepository.getCatalogRecordForSync(SYNC_ENTITY_TYPES.PRODUCT, 'local-pending-product'))
      .toMatchObject({ name: 'Versión remota', serverVersion: 2, syncStatus: 'synced' });
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(41);
  });

  it('rejects a late ACK after its actor session changes and keeps both license cursors intact', async () => {
    grantProductActor();
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 40, { licenseKey: TEST_LICENSE_KEY });
    await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 90, { licenseKey: OTHER_LICENSE_KEY });
    let resolveCloud;
    mocks.cloud.upsertProduct.mockImplementationOnce(() => new Promise((resolve) => { resolveCloud = resolve; }));
    const actorHandle = actorRuntimeController.capture();
    const operation = productOperation('actor-fenced-product', 'Respuesta tardía');
    const push = productSyncHandler.pushOperation(operation, { actorHandle });
    await vi.waitFor(() => expect(resolveCloud).toBeTypeOf('function'));

    actorRuntimeController.lock('product_session_changed');
    resolveCloud({ success: true, product: cloudProduct(operation.entityId, 'Respuesta tardía', 1), change_seq: 41 });
    await expect(push).rejects.toMatchObject({ code: expect.stringMatching(/^ACTOR_/) });

    expect(await productLocalRepository.getCatalogRecordForSync(SYNC_ENTITY_TYPES.PRODUCT, operation.entityId)).toBeUndefined();
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: TEST_LICENSE_KEY })).toBe(40);
    expect(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey: OTHER_LICENSE_KEY })).toBe(90);
  });
});
