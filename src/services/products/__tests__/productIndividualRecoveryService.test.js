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
    const committedMismatch = goodAssessment({
      product: baseProduct({ stock: 17, committedStock: 2 }),
      localBatches: [baseBatch({ stock: 17, committedStock: 0 })]
    });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('PRODUCT_BATCH_STOCK_MISMATCH');
    expect(committedMismatch.canRecover).toBe(false);
    expect(committedMismatch.issues.map((issue) => issue.code)).toContain('PRODUCT_BATCH_COMMITTED_MISMATCH');
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
    expect(report.issues.map((issue) => issue.code)).toContain('LOCAL_CATEGORY_IDENTITY_INVALID');
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

  it('holds local product tombstones and pending local conflict records', () => {
    const tombstone = goodAssessment({ productTombstone: { id: 'local-product-1', deletedAt: '2026-11-20T00:00:00Z' } });
    const conflict = goodAssessment({ conflictRows: [{ entityType: 'product', entityId: 'local-product-1', status: 'pending' }] });

    expect(tombstone.canRecover).toBe(false);
    expect(tombstone.issues.map((issue) => issue.code)).toContain('LOCAL_PRODUCT_TOMBSTONE');
    expect(conflict.canRecover).toBe(false);
    expect(conflict.issues.map((issue) => issue.code)).toContain('LOCAL_SYNC_CONFLICT_PENDING');
  });

  it('holds Cloud SKU and variant attribute conflicts without changing the original values', () => {
    const product = baseProduct({ stock: 17, sku: 'TEE-ORIGINAL', barcode: '7501000000017' });
    const mismatchedCloudProduct = {
      ...productToCloudPayload(product),
      sku: 'TEE-OTHER', sku_key: 'tee-other', is_active: true
    };
    const productConflict = goodAssessment({ product, cloudProducts: [mismatchedCloudProduct] });
    const localBatch = baseBatch({ stock: 17, attributes: { size: 'M', color: 'black' } });
    const mismatchedCloudBatch = {
      id: localBatch.id,
      product_id: localBatch.productId,
      stock: 17,
      committed_stock: 0,
      cost: 2,
      price: 10,
      track_stock: true,
      is_active: true,
      status: 'active',
      sku: localBatch.sku,
      sku_key: localBatch.sku,
      attributes: { size: 'L', color: 'black' }
    };
    const variantConflict = goodAssessment({ localBatches: [localBatch], cloudBatches: [mismatchedCloudBatch] });

    expect(productConflict.canRecover).toBe(false);
    expect(productConflict.issues.map((issue) => issue.code)).toContain('CLOUD_PRODUCT_RECONCILIATION_REQUIRED');
    expect(variantConflict.canRecover).toBe(false);
    expect(variantConflict.issues.map((issue) => issue.code)).toContain('ACTIVE_BATCH_CLOUD_RECONCILIATION_REQUIRED');
  });

  it('does not overwrite existing Cloud products, deleted IDs, or Cloud lots', () => {
    const activeProduct = goodAssessment({ cloudProducts: [{ id: 'local-product-1', is_active: true }] });
    const deletedProduct = goodAssessment({ cloudProducts: [{ id: 'local-product-1', is_active: false, deleted_at: '2026-11-10' }] });
    const existingLot = goodAssessment({ cloudBatches: [{ id: 'local-batch-1', product_id: 'local-product-1', is_active: true }] });

    expect(activeProduct.issues.map((issue) => issue.code)).toContain('CLOUD_PRODUCT_RECONCILIATION_REQUIRED');
    expect(deletedProduct.issues.map((issue) => issue.code)).toContain('CLOUD_PRODUCT_TOMBSTONE');
    expect(existingLot.issues.map((issue) => issue.code)).toContain('ACTIVE_BATCH_CLOUD_RECONCILIATION_REQUIRED');
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

const makeServiceHarness = ({
  responseMode = 'complete',
  canInventory = true,
  actorState = null,
  product: productOverrides = {},
  batches: suppliedBatches = null,
  category: suppliedCategory = null,
  portalPresent = true,
  categoryWriteMode = 'complete',
  licenseDetailsOverrides = {}
} = {}) => {
  let currentLicenseKey = 'tenant-a';
  let currentActor = actorState || {
    status: 'granted', sessionId: 'session-1',
    permissions: canInventory ? ['products', 'inventory'] : ['products']
  };
  let currentProduct = baseProduct({ stock: 17, cost: 2, ...productOverrides });
  let currentCategory = suppliedCategory;
  let currentBatches = suppliedBatches || [
    baseBatch({ stock: 17 }),
    baseBatch({ id: 'archived-batch', manufacturerBatchId: 'QA-ARCHIVED', stock: 0, isActive: false, status: 'archived', deletedAt: '2026-11-01T00:00:00Z' })
  ];
  let cloudProducts = [];
  let cloudBatches = [];
  let cloudCategories = [];
  let cloudChangeSeq = 0;
  let requestArgs = null;
  let cloudReadFailure = false;
  const activeBatch = currentBatches[0];

  const localRepository = {
    getProductById: vi.fn(async (id) => id === currentProduct.id ? currentProduct : null),
    getBatchesByProductId: vi.fn(async () => currentBatches),
    getProductDeletionTombstoneById: vi.fn(async () => null),
    getCategoryById: vi.fn(async (id) => String(currentCategory?.id) === String(id) ? currentCategory : null),
    getDeletedCategoryById: vi.fn(async () => null),
    applyCloudCatalog: vi.fn(async ({ categories = [], product: _cloudProduct, batches }) => {
      currentProduct = { ...currentProduct, syncStatus: 'synced', serverVersion: 1, lastSyncedAt: '2026-11-20T12:01:00.000Z' };
      if (categories[0]) currentCategory = { ...currentCategory, syncStatus: 'synced', serverVersion: 1, lastSyncedAt: '2026-11-20T12:01:00.000Z' };
      currentBatches = currentBatches.map((batch) => (
        batches.some((cloudBatch) => String(cloudBatch.id) === String(batch.id))
          ? { ...batch, syncStatus: 'synced', serverVersion: 1, lastSyncedAt: '2026-11-20T12:01:00.000Z' }
          : batch
      ));
      return { products: 1, batches: batches.length, categories: categories.length, rejected: [], deferredInventory: 0 };
    })
  };

  const cloudRepository = {
    pullCatalogSnapshot: vi.fn(async ({ entityType, offset, limit }) => {
      if (cloudReadFailure) throw new Error('Cloud read timed out');
      const collection = entityType === 'product' ? cloudProducts
        : entityType === 'product_batch' ? cloudBatches : cloudCategories;
      return {
        success: true,
        entity_type: entityType,
        products: entityType === 'product' ? collection.slice(offset, offset + limit) : undefined,
        batches: entityType === 'product_batch' ? collection.slice(offset, offset + limit) : undefined,
        categories: entityType === 'category' ? collection.slice(offset, offset + limit) : undefined,
        limit,
        offset,
        total: collection.length,
        has_more: offset + limit < collection.length,
        latest_change_seq: cloudChangeSeq
      };
    }),
    upsertCategory: vi.fn(async (args) => {
      const saved = { ...args.category, server_version: 1, deleted_at: null, is_active: true };
      if (!['no-write', 'timeout-before-write'].includes(categoryWriteMode)) {
        cloudCategories = [saved];
        cloudChangeSeq += 1;
      }
      if (categoryWriteMode.startsWith('timeout')) throw new Error('Category RPC timed out');
      return { success: true, category: saved, idempotency_key: args.idempotencyKey };
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
      if (responseMode !== 'no-write') cloudChangeSeq += 1;
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
  const outboxService = {
    listOperationsForEntity: vi.fn(async () => []),
    listInventoryEntriesForRecovery: vi.fn(async () => [])
  };
  const conflictService = { listConflictsForEntity: vi.fn(async () => []) };
  const listLocalOnlyInventoryEntries = vi.fn(async () => []);
  const getEcommercePortal = vi.fn(async () => ({
    success: true,
    portal: portalPresent ? { id: 'portal-a', slug: 'tienda-a' } : null,
    plan: { code: 'qa' },
    features: {},
    timezone: 'America/Mexico_City',
    ordersPaused: false,
    publishedProductCount: portalPresent ? 1 : 0
  }));
  const listPublishedProducts = vi.fn(async () => ({ success: true, products: [basePublication()], publishedCount: 1 }));
  const runWithTenantLease = vi.fn(async (_tenant, _options, operation) => operation());
  const assertTenantAccess = vi.fn(async () => true);

  const service = createProductIndividualRecoveryService({
    getAppState: () => ({ licenseDetails: { ...licenseDetailsOverrides, license_key: currentLicenseKey } }),
    actorController: { getState: () => currentActor },
    localRepository,
    cloudRepository,
    outboxService,
    conflictService,
    listLocalOnlyInventoryEntries,
    getEcommercePortal,
    listPublishedProducts,
    runWithTenantLease,
    assertTenantAccess,
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
    outboxService,
    conflictService,
    getEcommercePortal,
    listPublishedProducts,
    listLocalOnlyInventoryEntries,
    runWithTenantLease,
    assertTenantAccess,
    getProduct: () => currentProduct,
    getBatches: () => currentBatches,
    getRequestArgs: () => requestArgs,
    getCloud: () => ({ products: cloudProducts, batches: cloudBatches, categories: cloudCategories }),
    setLicenseKey: (licenseKey) => { currentLicenseKey = licenseKey; },
    setActor: (actor) => { currentActor = actor; },
    activeBatch,
    getCategory: () => currentCategory
  };
};

describe('individual product recovery execution', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inspects local Dexie and Cloud without writing either side', async () => {
    const harness = makeServiceHarness();
    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(true);
    expect(report.product.id).toBe('local-product-1');
    expect(harness.assertTenantAccess).toHaveBeenCalledWith(
      { license_key: 'tenant-a' },
      { reason: 'individual_product_recovery_inspect' }
    );
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.listLocalOnlyInventoryEntries).toHaveBeenCalledTimes(1);
  });

  it('continues Cloud catalog verification when the authenticated business has no portal', async () => {
    const harness = makeServiceHarness({ portalPresent: false });
    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(true);
    expect(report.portal).toMatchObject({ exists: false, verified: true });
    expect(report.publication).toBeNull();
    expect(harness.listPublishedProducts).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).toHaveBeenCalledTimes(3);
  });

  it('does not treat a portal authorization error as a confirmed missing portal', async () => {
    const harness = makeServiceHarness({ portalPresent: false });
    harness.getEcommercePortal.mockResolvedValueOnce({ success: false, code: 'ECOMMERCE_STAFF_PERMISSION_DENIED' });
    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('ECOMMERCE_STAFF_PERMISSION_DENIED');
    expect(harness.cloudRepository.pullCatalogSnapshot).toHaveBeenCalledTimes(3);
    expect(harness.listPublishedProducts).not.toHaveBeenCalled();
  });

  it('holds an incomplete portal response instead of treating it as an existing or missing portal', async () => {
    const harness = makeServiceHarness();
    harness.getEcommercePortal.mockResolvedValueOnce({ success: true, portal: {} });

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('PRODUCT_RECOVERY_PORTAL_RESPONSE_INCOMPLETE');
    expect(harness.listPublishedProducts).not.toHaveBeenCalled();
  });

  it('blocks an incomplete publication list but still reports independent Cloud reads', async () => {
    const harness = makeServiceHarness();
    harness.listPublishedProducts.mockResolvedValueOnce({ success: true, products: [] });

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(false);
    expect(report.product.id).toBe('local-product-1');
    expect(report.cloud.product).toBe('missing');
    expect(report.portal).toMatchObject({ exists: true, verified: true });
    expect(report.issues.map((issue) => issue.code)).toContain('PRODUCT_RECOVERY_PUBLICATION_RESPONSE_INCOMPLETE');
    expect(harness.cloudRepository.pullCatalogSnapshot).toHaveBeenCalledTimes(3);
  });

  it('holds an incomplete Cloud pagination response instead of treating it as an empty catalog', async () => {
    const harness = makeServiceHarness();
    const originalPull = harness.cloudRepository.pullCatalogSnapshot.getMockImplementation();
    harness.cloudRepository.pullCatalogSnapshot.mockImplementation(async (args) => {
      const response = await originalPull(args);
      return args.entityType === 'product' ? { ...response, total: undefined } : response;
    });

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report).toMatchObject({ success: false, blocked: true, code: 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE' });
    expect(report.issues[0].code).toBe('PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE');
  });

  it('creates an absent local category in Cloud with its original ID before writing the product', async () => {
    const category = {
      id: 'category-playeras-original', name: 'Playeras', color: '#336699', sortOrder: 4,
      isActive: true, syncStatus: 'local', createdAt: '2026-11-20T12:00:00.000Z', updatedAt: '2026-11-20T12:00:00.000Z'
    };
    const harness = makeServiceHarness({
      product: { categoryId: category.id },
      category,
      portalPresent: false
    });

    const inspected = await harness.service.inspectProduct({ productId: 'local-product-1' });
    expect(inspected.canRecover).toBe(true);
    expect(inspected.product.references.category).toMatchObject({
      id: category.id, name: 'Playeras', local: 'active', cloud: 'missing', action: 'create_with_original_id'
    });

    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });
    expect(result).toMatchObject({ success: true, recovered: true, verified: true });
    expect(harness.cloudRepository.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      category: expect.objectContaining({ id: category.id, name: 'Playeras' }),
      expectedVersion: 0
    }));
    expect(harness.cloudRepository.upsertCategory.mock.invocationCallOrder[0])
      .toBeLessThan(harness.cloudRepository.upsertProduct.mock.invocationCallOrder[0]);
    expect(harness.getCloud().categories).toHaveLength(1);
    expect(harness.getCloud().categories[0].id).toBe(category.id);
    expect(harness.getCategory()).toMatchObject({ id: category.id, syncStatus: 'synced' });

    const reconciled = await harness.service.recoverProduct({ productId: 'local-product-1' });
    expect(reconciled).toMatchObject({ success: true, recovered: true, verified: true });
    expect(harness.cloudRepository.upsertCategory).toHaveBeenCalledOnce();
    expect(harness.cloudRepository.upsertProduct).toHaveBeenCalledOnce();
    expect(harness.getCloud().categories).toHaveLength(1);
  });

  it('holds an absent Cloud category when its local state or outbox has an unresolved mutation', async () => {
    const category = { id: 'category-pending', name: 'Playeras', isActive: true, syncStatus: 'local' };
    const harness = makeServiceHarness({ product: { categoryId: category.id }, category, portalPresent: false });
    harness.outboxService.listOperationsForEntity.mockImplementation(async ({ entityType }) => (
      entityType === 'category' ? [{ id: 'category-op', status: 'pending' }] : []
    ));

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report.canRecover).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('CATALOG_OPERATION_UNRESOLVED');
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });
    expect(result.blocked).toBe(true);
    expect(harness.cloudRepository.upsertCategory).not.toHaveBeenCalled();
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
  });

  it('keeps historical Apparel metadata on a Pharmacy license and recovers six original variant IDs totaling 25', async () => {
    const stocks = [4, 4, 4, 4, 4, 5];
    const batches = stocks.map((stock, index) => baseBatch({
      id: `historical-apparel-batch-${index + 1}`,
      stock,
      committedStock: 0,
      cost: 120,
      price: 199,
      sku: `TEE-SKU-${index + 1}`,
      manufacturerBatchId: undefined,
      expiryDate: undefined,
      attributes: { size: ['XS', 'S', 'M', 'L', 'XL', 'XXL'][index], color: 'negro' }
    }));
    const harness = makeServiceHarness({
      product: {
        stock: 25, committedStock: 0, cost: 120, price: 199,
        sku: 'TEE-ORIGINAL', barcode: '7501000000000',
        productType: 'sellable', rubroContext: 'apparel', metadata: { rubro_context: 'apparel' },
        batchManagement: { enabled: true }
      },
      batches,
      portalPresent: false,
      licenseDetailsOverrides: { business_types: ['farmacia'], rubro_context: 'farmacia' }
    });

    const inspected = await harness.service.inspectProduct({ productId: 'local-product-1' });
    expect(inspected.canRecover).toBe(true);
    expect(inspected.product).toMatchObject({
      sku: 'TEE-ORIGINAL', barcode: '7501000000000', productType: 'sellable', rubroContext: 'apparel', stock: 25
    });
    expect(inspected.product.pharmacy).toMatchObject({ recorded: false, protectedMedicine: false });
    expect(inspected.batches.map((batch) => batch.id)).toEqual(batches.map((batch) => batch.id));

    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });
    const request = harness.getRequestArgs();
    expect(result).toMatchObject({ success: true, recovered: true, verified: true });
    expect(request.product.metadata.rubro_context).toBe('apparel');
    expect(request.product.requires_prescription).not.toBe(true);
    expect(request.product.expiration_mode).toBe('NONE');
    expect(request.initialBatches).toHaveLength(6);
    expect(request.initialBatches.map((batch) => batch.id)).toEqual(batches.map((batch) => batch.id));
    expect(request.initialBatches.reduce((sum, batch) => sum + batch.stock, 0)).toBe(25);
    expect(request.initialBatches.every((batch) => batch.product_id === 'local-product-1'))
      .toBe(true);
    expect(request.initialBatches.map((batch) => batch.attributes.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(request.initialBatches.every((batch) => batch.cost === 120 && batch.price === 199)).toBe(true);
  });

  it('re-reads an uncertain category write and never retries it blindly', async () => {
    const category = { id: 'category-timeout', name: 'Playeras', isActive: true, syncStatus: 'local' };
    const harness = makeServiceHarness({
      product: { categoryId: category.id },
      category,
      portalPresent: false,
      categoryWriteMode: 'timeout-before-write'
    });

    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: true, code: 'PRODUCT_RECOVERY_CATEGORY_NOT_CONFIRMED'
    });
    expect(harness.cloudRepository.upsertCategory).toHaveBeenCalledOnce();
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.getProduct().syncStatus).toBe('local');

    const landedCategory = { id: 'category-timeout-landed', name: 'Playeras', isActive: true, syncStatus: 'local' };
    const landedHarness = makeServiceHarness({
      product: { categoryId: landedCategory.id },
      category: landedCategory,
      portalPresent: false,
      categoryWriteMode: 'timeout-after-write'
    });
    const reconciled = await landedHarness.service.recoverProduct({ productId: 'local-product-1' });
    expect(reconciled).toMatchObject({ success: true, recovered: true, verified: true });
    expect(landedHarness.cloudRepository.upsertCategory).toHaveBeenCalledOnce();
    expect(landedHarness.cloudRepository.upsertProduct).toHaveBeenCalledOnce();
    expect(landedHarness.getCloud().categories.map((row) => row.id)).toEqual([landedCategory.id]);
  });

  it('reconciles a complete existing Cloud product without a duplicate upsert on the second attempt', async () => {
    const harness = makeServiceHarness({ portalPresent: false });
    const first = await harness.service.recoverProduct({ productId: 'local-product-1' });
    const firstCloud = harness.getCloud();
    const second = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: true, recovered: true, verified: true, cloudOutcome: 'complete' });
    expect(harness.cloudRepository.upsertProduct).toHaveBeenCalledOnce();
    expect(harness.getCloud().products).toHaveLength(1);
    expect(harness.getCloud().batches).toHaveLength(1);
    expect(harness.getCloud()).toEqual(firstCloud);
  });

  it('blocks a requested tenant mismatch before reading local or Cloud data', async () => {
    const harness = makeServiceHarness();
    const report = await harness.service.inspectProduct({ productId: 'local-product-1', licenseKey: 'tenant-b' });

    expect(report).toMatchObject({ success: false, blocked: true, code: 'TENANT_CONTEXT_MISMATCH', product: null });
    expect(harness.runWithTenantLease).not.toHaveBeenCalled();
    expect(harness.localRepository.getProductById).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked session', { status: 'revoked', sessionId: 'session-1', permissions: ['*'] }, 'SESSION_REQUIRED'],
    ['missing product permission', { status: 'granted', sessionId: 'session-1', permissions: ['inventory'] }, 'PRODUCT_PERMISSION_REQUIRED'],
    ['missing inventory permission', { status: 'granted', sessionId: 'session-1', permissions: ['products'] }, 'INVENTORY_PERMISSION_REQUIRED']
  ])('denies inspection for %s before reading tenant data', async (_label, actorState, code) => {
    const harness = makeServiceHarness({ actorState });
    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report).toMatchObject({ success: false, blocked: true, code, product: null });
    expect(harness.runWithTenantLease).not.toHaveBeenCalled();
    expect(harness.localRepository.getProductById).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
  });

  it('stops before Cloud reads when the selected tenant changes during local inspection', async () => {
    const harness = makeServiceHarness();
    const selectedProduct = harness.getProduct();
    harness.localRepository.getProductById.mockImplementationOnce(async (id) => {
      harness.setLicenseKey('tenant-b');
      return id === selectedProduct.id ? selectedProduct : null;
    });

    const report = await harness.service.inspectProduct({ productId: selectedProduct.id });

    expect(report).toMatchObject({ success: false, blocked: true, code: 'TENANT_CONTEXT_MISMATCH', product: null });
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
  });

  it('shows a clear safe retry when the tenant runtime cannot be prepared', async () => {
    const harness = makeServiceHarness();
    harness.assertTenantAccess.mockRejectedValueOnce(Object.assign(new Error('TENANT_RUNTIME_NOT_READY'), {
      code: 'TENANT_RUNTIME_NOT_READY'
    }));

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report).toMatchObject({
      success: false,
      blocked: true,
      retryable: true,
      code: 'TENANT_RUNTIME_NOT_READY'
    });
    expect(report.issues[0].message).toContain('no modifica productos, lotes ni inventario');
    expect(harness.localRepository.getProductById).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
  });

  it('keeps a physical database open failure visible as a safe retryable block', async () => {
    const harness = makeServiceHarness();
    harness.assertTenantAccess.mockRejectedValueOnce(Object.assign(new Error('temporary native open failure'), {
      code: 'DB_OPEN_RETRY_TEST'
    }));

    const report = await harness.service.inspectProduct({ productId: 'local-product-1' });

    expect(report).toMatchObject({ success: false, blocked: true, retryable: true, code: 'DB_OPEN_RETRY_TEST' });
    expect(report.issues[0].message).toContain('No se pudo preparar de forma segura el runtime local');
    expect(harness.localRepository.getProductById).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
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
      .toEqual(['product', 'product_batch', 'category', 'product', 'product_batch', 'category', 'product', 'product_batch', 'category']);
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('distinguishes a failed RPC with a confirmed absent Cloud source from a partial write', async () => {
    const harness = makeServiceHarness({ responseMode: 'no-write' });
    const result = await harness.service.recoverProduct({ productId: 'local-product-1' });

    expect(result).toMatchObject({
      success: false, blocked: true, uncertain: false, cloudOutcome: 'absent',
      code: 'PRODUCT_RECOVERY_RPC_FAILED_NO_CLOUD_WRITE'
    });
    expect(harness.getCloud()).toEqual({ products: [], batches: [], categories: [] });
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

    expect(result).toMatchObject({ success: false, blocked: true, code: 'INVENTORY_PERMISSION_REQUIRED' });
    expect(harness.localRepository.getProductById).not.toHaveBeenCalled();
    expect(harness.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
    expect(harness.cloudRepository.upsertProduct).not.toHaveBeenCalled();
    expect(harness.localRepository.applyCloudCatalog).not.toHaveBeenCalled();
  });
});
