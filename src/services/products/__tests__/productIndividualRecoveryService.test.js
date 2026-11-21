import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assessIndividualProductRecovery,
  buildIndividualRecoveryIdempotencyKey,
  createProductIndividualRecoveryService
} from '../productIndividualRecoveryService';
import { productToCloudPayload } from '../productMapper';

const baseProduct = (overrides = {}) => ({
  id: 'local-product-1',
  name: 'Algodón QA',
  syncStatus: 'local',
  isActive: true,
  trackStock: true,
  stock: 0,
  committedStock: 0,
  cost: 2,
  price: 10,
  expirationMode: 'NONE',
  updatedAt: '2026-11-20T12:00:00.000Z',
  ...overrides
});

const basePublication = (overrides = {}) => ({
  id: 'published-1',
  sourceType: 'local_snapshot',
  productId: null,
  localProductRef: 'local-product-1',
  isPublished: true,
  isAvailable: true,
  ...overrides
});

const baseBatch = (overrides = {}) => ({
  id: 'local-batch-1',
  productId: 'local-product-1',
  manufacturerBatchId: 'QA-LOTE-ALGODON-1',
  status: 'active',
  isActive: true,
  trackStock: true,
  stock: 17,
  committedStock: 0,
  cost: 2,
  price: 10,
  expiryDate: '2027-12-31',
  ...overrides
});

const goodAssessment = (overrides = {}) => {
  const product = baseProduct({ stock: 17, ...overrides.product });
  const batches = overrides.localBatches || [baseBatch({ stock: 17 })];
  return assessIndividualProductRecovery({
    licenseKey: 'tenant-a',
    requestedLicenseMatches: true,
    cloudSyncEnabled: true,
    online: true,
    lockSupported: true,
    actor: { status: 'granted', sessionId: 'session-1', permissions: ['products', 'inventory'] },
    product,
    localBatches: batches,
    publications: [basePublication()],
    cloudProducts: [],
    cloudBatches: [],
    cloudCategories: [],
    outboxRows: [],
    localOnlyInventoryEvents: [],
    ...overrides
  });
};

describe('individual product recovery assessment', () => {
  it('requires an exact tenant and publication reference instead of matching names', () => {
    const wrongTenant = goodAssessment({ requestedLicenseMatches: false });
    const sameNameOnly = goodAssessment({ publications: [{ ...basePublication(), localProductRef: 'another-id' }] });

    expect(wrongTenant.canRecover).toBe(false);
    expect(wrongTenant.issues.map((issue) => issue.code)).toContain('TENANT_CONTEXT_MISMATCH');
    expect(sameNameOnly.issues.map((issue) => issue.code)).toContain('PUBLICATION_NOT_FOUND');
  });

  it('keeps only the selected product and preserves its original active lot IDs', () => {
    const selectedBatch = baseBatch({ stock: 17 });
    const otherBatch = baseBatch({ id: 'other-batch', productId: 'other-product', stock: 999 });
    const report = goodAssessment({ localBatches: [selectedBatch, otherBatch] });

    expect(report.canRecover).toBe(true);
    expect(report.recovery.entityCount).toBe(1);
    expect(report.recovery.batchIds).toEqual(['local-batch-1']);
    expect(report.recovery.expectedProduct.id).toBe('local-product-1');
  });

  it('blocks product and lot stock projections that the Cloud RPC would recalculate differently', () => {
    const report = goodAssessment({ localBatches: [baseBatch({ stock: 16 })] });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('PRODUCT_BATCH_STOCK_MISMATCH');
  });

  it('keeps an archived zero-stock lot local and omits it from recovery', () => {
    const report = goodAssessment({
      localBatches: [
        baseBatch({ stock: 17 }),
        baseBatch({ id: 'archived-batch', manufacturerBatchId: 'QA-ARCHIVED', stock: 0, isActive: false, status: 'archived', deletedAt: '2026-11-01T00:00:00Z' })
      ]
    });

    expect(report.canRecover).toBe(true);
    expect(report.recovery.batchIds).toEqual(['local-batch-1']);
    expect(report.recovery.omittedArchivedBatchIds).toEqual(['archived-batch']);
    expect(report.batches.find((batch) => batch.id === 'archived-batch')).toMatchObject({
      action: 'keep_local',
      cloudStatus: 'absent',
      stock: 0
    });
  });

  it('holds when a deleted or archived local lot still carries stock', () => {
    const report = goodAssessment({
      localBatches: [
        baseBatch({ stock: 17 }),
        baseBatch({ id: 'archived-with-stock', stock: 1, isActive: false, status: 'archived', deletedAt: '2026-11-01T00:00:00Z' })
      ]
    });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('ARCHIVED_BATCH_HAS_STOCK');
  });

  it('holds positive stock for protected medicines under the installed receipt guard', () => {
    const report = goodAssessment({
      product: baseProduct({
        stock: 17,
        metadata: { pharmacy: { kind: 'medicine', status: 'confirmed', fraction: 'VI' } }
      })
    });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('PHARMACY_DOCUMENTED_RECEIPT_REQUIRED');
  });

  it('requires inventory permission when the write includes stock or any batch', () => {
    const report = goodAssessment({
      actor: { status: 'granted', sessionId: 'session-1', permissions: ['products'] }
    });

    expect(report.permissions).toMatchObject({ products: true, inventoryRequired: true, inventory: false });
    expect(report.issues.map((issue) => issue.code)).toContain('INVENTORY_PERMISSION_REQUIRED');
  });

  it('blocks categories and recipe ingredients that do not have active Cloud identities', () => {
    const report = goodAssessment({
      product: baseProduct({ categoryId: 'local-category', recipe: [{ ingredientId: 'local-ingredient' }] }),
      localCategory: { id: 'local-category', isActive: true },
      localIngredients: [{ id: 'local-ingredient', name: 'Harina', isActive: true }],
      cloudCategories: [],
      cloudProducts: []
    });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('CLOUD_CATEGORY_REFERENCE_MISSING');
    expect(report.issues.map((issue) => issue.code)).toContain('CLOUD_RECIPE_REFERENCE_MISSING');
  });

  it('holds pending or conflicted catalog and local-only inventory operations', () => {
    const report = goodAssessment({
      outboxRows: [{ id: 'pending-1', status: 'processing' }],
      localOnlyInventoryEvents: [{ productId: 'local-product-1', syncDisposition: 'local_only' }]
    });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('CATALOG_OPERATION_UNRESOLVED');
    expect(report.issues.map((issue) => issue.code)).toContain('LOCAL_ONLY_INVENTORY_HISTORY');
  });

  it('holds pending product or lot state and invalid local numeric values', () => {
    const pendingProduct = goodAssessment({ product: baseProduct({ stock: 17, syncStatus: 'pending' }) });
    const conflictedBatch = goodAssessment({ localBatches: [baseBatch({ syncStatus: 'conflict' })] });
    const invalidStock = goodAssessment({ product: baseProduct({ stock: -1 }), localBatches: [] });

    expect(pendingProduct.issues.map((issue) => issue.code)).toContain('LOCAL_PRODUCT_OPERATION_UNRESOLVED');
    expect(conflictedBatch.issues.map((issue) => issue.code)).toContain('LOCAL_BATCH_CONFLICT');
    expect(invalidStock.issues.map((issue) => issue.code)).toContain('LOCAL_PRODUCT_NUMERIC_INVALID');
  });

  it('does not overwrite existing Cloud products, deleted IDs, or Cloud lots', () => {
    const activeProduct = goodAssessment({ cloudProducts: [{ id: 'local-product-1', is_active: true }] });
    const deletedProduct = goodAssessment({ cloudProducts: [{ id: 'local-product-1', is_active: false, deleted_at: '2026-11-10' }] });
    const existingLot = goodAssessment({ cloudBatches: [{ id: 'local-batch-1', product_id: 'local-product-1', is_active: true }] });

    expect(activeProduct.issues.map((issue) => issue.code)).toContain('CLOUD_PRODUCT_EXISTS');
    expect(deletedProduct.issues.map((issue) => issue.code)).toContain('CLOUD_PRODUCT_TOMBSTONE');
    expect(existingLot.issues.map((issue) => issue.code)).toContain('ACTIVE_BATCH_CLOUD_EXISTS');
  });

  it('holds without an authenticated session, product permission, or an exclusive browser lock', () => {
    const session = goodAssessment({ actor: { status: 'locked', permissions: [] } });
    const products = goodAssessment({ actor: { status: 'granted', sessionId: 'session-1', permissions: ['inventory'] } });
    const lock = goodAssessment({ lockSupported: false });

    expect(session.issues.map((issue) => issue.code)).toContain('SESSION_REQUIRED');
    expect(products.issues.map((issue) => issue.code)).toContain('PRODUCT_PERMISSION_REQUIRED');
    expect(lock.issues.map((issue) => issue.code)).toContain('RECOVERY_LOCK_UNAVAILABLE');
  });

  it('creates a stable idempotency key for the same local revision and a new key after a stock edit', () => {
    const product = baseProduct({ stock: 17, localMutationId: 'mutation-a' });
    const batch = baseBatch({ stock: 17, localMutationId: 'batch-mutation-a' });
    const first = buildIndividualRecoveryIdempotencyKey({ licenseKey: 'tenant-a', product, batches: [batch] });
    const retry = buildIndividualRecoveryIdempotencyKey({ licenseKey: 'tenant-a', product: { ...product }, batches: [{ ...batch }] });
    const changed = buildIndividualRecoveryIdempotencyKey({ licenseKey: 'tenant-a', product: { ...product, stock: 16 }, batches: [batch] });

    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
  });
});

const makeServiceHarness = ({ responseMode = 'complete', canInventory = true } = {}) => {
  let currentProduct = baseProduct({ stock: 17, cost: 2 });
  let currentBatches = [
    baseBatch({ stock: 17 }),
    baseBatch({ id: 'archived-batch', manufacturerBatchId: 'QA-ARCHIVED', stock: 0, isActive: false, status: 'archived', deletedAt: '2026-11-01T00:00:00Z' })
  ];
  let cloudProducts = [];
  let cloudBatches = [];
  let requestArgs = null;
  let cloudReadFailure = false;
  const activeBatch = currentBatches[0];

  const localRepository = {
    getProductById: vi.fn(async (id) => id === currentProduct.id ? currentProduct : null),
    getBatchesByProductId: vi.fn(async () => currentBatches),
    getProductDeletionTombstoneById: vi.fn(async () => null),
    getCategoryById: vi.fn(async () => null),
    getDeletedCategoryById: vi.fn(async () => null),
    applyCloudCatalog: vi.fn(async ({ product: _cloudProduct, batches }) => {
      currentProduct = { ...currentProduct, syncStatus: 'synced', serverVersion: 1, lastSyncedAt: '2026-11-20T12:01:00.000Z' };
      currentBatches = currentBatches.map((batch) => (
        batches.some((cloudBatch) => String(cloudBatch.id) === String(batch.id))
          ? { ...batch, syncStatus: 'synced', serverVersion: 1, lastSyncedAt: '2026-11-20T12:01:00.000Z' }
          : batch
      ));
      return { products: 1, batches: batches.length, categories: 0, rejected: [], deferredInventory: 0 };
    })
  };

  const cloudRepository = {
    pullCatalogSnapshot: vi.fn(async ({ entityType }) => {
      if (cloudReadFailure) throw new Error('Cloud read timed out');
      return {
        success: true,
        products: entityType === 'product' ? cloudProducts : undefined,
        batches: entityType === 'product_batch' ? cloudBatches : undefined,
        categories: entityType === 'category' ? [] : undefined,
        has_more: false
      };
    }),
    upsertProduct: vi.fn(async (args) => {
      requestArgs = args;
      if (responseMode === 'transport-absent') throw new Error('RPC transport timed out');
      if (responseMode === 'transport-unknown') {
        cloudReadFailure = true;
        throw new Error('RPC transport timed out');
      }
      const product = {
        ...productToCloudPayload(args.product),
        server_version: 1,
        deleted_at: null,
        is_active: true
      };
      const batches = args.initialBatches.map((batch) => ({
          ...batch,
          id: batch.id,
          product_id: batch.product_id,
          server_version: 1,
          deleted_at: null
        }));
      cloudProducts = responseMode === 'no-write' ? [] : [product];
      cloudBatches = ['partial-cloud', 'failure-product-only', 'transport-product-only', 'no-write'].includes(responseMode)
        ? [] : batches;
      if (responseMode === 'transport-product-only') throw new Error('RPC transport timed out');
      return {
        success: responseMode !== 'failure-product-only' && responseMode !== 'no-write',
        code: responseMode === 'failure-product-only' ? 'BATCH_VALIDATION_FAILED' : undefined,
        message: responseMode === 'failure-product-only' ? 'The product was inserted but its lot was rejected.' : undefined,
        product,
        batches: responseMode === 'partial-response' ? [] : batches,
        idempotency_key: args.idempotencyKey
      };
    })
  };

  const service = createProductIndividualRecoveryService({
    getAppState: () => ({ licenseDetails: { license_key: 'tenant-a' } }),
    actorController: { getState: () => ({
      status: 'granted', sessionId: 'session-1',
      permissions: canInventory ? ['products', 'inventory'] : ['products']
    }) },
    localRepository,
    cloudRepository,
    outboxService: {
      listOperationsForEntity: vi.fn(async () => []),
      listInventoryEntriesForRecovery: vi.fn(async () => [])
    },
    listLocalOnlyInventoryEntries: vi.fn(async () => []),
    listPublishedProducts: vi.fn(async () => ({ success: true, products: [basePublication()] })),
    runWithTenantLease: vi.fn(async (_tenant, _options, operation) => operation()),
    assertTenantAccess: vi.fn(async () => true),
    runWithRecoveryLock: vi.fn(async ({ operation }) => operation({ locked: true })),
    captureMutation: vi.fn(() => ({ captured: true })),
    assertMutationCurrent: vi.fn(() => true),
    isCloudSyncEnabled: () => true,
    isOnline: () => true,
    hasRecoveryLock: () => true
  });

  return {
    service,
    localRepository,
    cloudRepository,
    getProduct: () => currentProduct,
    getBatches: () => currentBatches,
    getRequestArgs: () => requestArgs,
    getCloud: () => ({ products: cloudProducts, batches: cloudBatches }),
    activeBatch
  };
};

describe('individual product recovery execution', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inspects local Dexie and Cloud without writing either side', async () => {
    const harness = makeServiceHarness();
    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(true);
    expect(report.product.id).toBe('local-product-1');
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('writes only the selected product and active lots, using create-only OCC and original IDs', async () => {
    const harness = makeServiceHarness();
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });
    const request = harness.getRequestArgs();

    expect(result).toMatchObject({ success: true, recovered: true, verified: true, productId: 'local-product-1' });
    expect(request.product.id).toBe('local-product-1');
    expect(request.expectedVersion).toBe(0);
    expect(request.initialBatches.map((batch) => batch.id)).toEqual(['local-batch-1']);
    expect(harness.cloudRepository.upsertProduct).toHaveBeenCalledTimes(1);
    expect(harness.localRepository.applyCloudCatalog).toHaveBeenCalledTimes(1);
    expect(harness.getProduct()).toMatchObject({ id: 'local-product-1', stock: 17, syncStatus: 'synced' });
    expect(harness.getBatches().find((batch) => batch.id === 'archived-batch')).toEqual({
      id: 'archived-batch',
      productId: 'local-product-1',
      manufacturerBatchId: 'QA-ARCHIVED',
      status: 'archived',
      isActive: false,
      trackStock: true,
      stock: 0,
      committedStock: 0,
      cost: 2,
      price: 10,
      expiryDate: '2027-12-31',
      deletedAt: '2026-11-01T00:00:00Z'
    });
  });

  it('trusts a complete Cloud reread when the RPC response omitted its batch projection', async () => {
    const harness = makeServiceHarness({ responseMode: 'partial-response' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({ success: true, recovered: true, verified: true, cloudOutcome: 'complete' });
    expect(harness.localRepository.applyCloudCatalog).toHaveBeenCalledTimes(1);
    expect(harness.getProduct().syncStatus).toBe('synced');
  });

  it('holds a success response when the Cloud reread finds only the product and no lot', async () => {
    const harness = makeServiceHarness({ responseMode: 'partial-cloud' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: true, cloudOutcome: 'partial',
      code: 'PRODUCT_RECOVERY_PARTIAL_CLOUD_WRITE'
    });
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.getProduct().syncStatus).toBe('local');
  });

  it('holds success:false when Cloud contains the inserted product but not its original lot, without retrying', async () => {
    const harness = makeServiceHarness({ responseMode: 'failure-product-only' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: true, cloudOutcome: 'partial',
      code: 'PRODUCT_RECOVERY_PARTIAL_CLOUD_WRITE'
    });
    expect(result.message).toContain('HOLD');
    expect(result.message).toContain('faltan lotes local-batch-1');
    expect(harness.getCloud().products).toHaveLength(1);
    expect(harness.getCloud().batches).toHaveLength(0);
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.getProduct().syncStatus).toBe('local');

    const retry = await harness.service.recoverProduct({ productId: 'local-product-1' });
    expect(retry.blocked).toBe(true);
    expect(harness.cloudRepository.upsertProduct).toHaveBeenCalledTimes(1);
  });

  it('rereads Cloud after an RPC transport error and holds a product-only partial write', async () => {
    const harness = makeServiceHarness({ responseMode: 'transport-product-only' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: true, cloudOutcome: 'partial',
      code: 'PRODUCT_RECOVERY_PARTIAL_CLOUD_WRITE'
    });
    expect(harness.cloudRepository.pullCatalogSnapshot.mock.calls.map(([args]) => args.entityType))
      .toEqual(['product', 'product_batch', 'category', 'product', 'product_batch', 'category']);
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('distinguishes a failed RPC with a confirmed absent Cloud source from a partial write', async () => {
    const harness = makeServiceHarness({ responseMode: 'no-write' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: false, cloudOutcome: 'absent',
      code: 'PRODUCT_RECOVERY_RPC_FAILED_NO_CLOUD_WRITE'
    });
    expect(harness.getCloud()).toEqual({ products: [], batches: [] });
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.getProduct().syncStatus).toBe('local');
  });

  it('keeps HOLD when transport uncertainty prevents the post-RPC Cloud reread', async () => {
    const harness = makeServiceHarness({ responseMode: 'transport-unknown' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: true,
      code: 'PRODUCT_RECOVERY_CLOUD_OUTCOME_UNKNOWN'
    });
    expect(result).not.toHaveProperty('cloudOutcome');
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.getProduct().syncStatus).toBe('local');
  });

  it('does not call the RPC when the current actor lacks inventory permission for a lot write', async () => {
    const harness = makeServiceHarness({ canInventory: false });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result.blocked).toBe(true);
    expect(result.report?.issues.map((issue) => issue.code)).toContain('INVENTORY_PERMISSION_REQUIRED');
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
  });
});
