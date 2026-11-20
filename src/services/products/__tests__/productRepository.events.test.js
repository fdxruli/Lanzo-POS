// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloudEnabled: false,
  businessTypes: ['abarrotes'],
  licenseDetails: {},
  appStatus: 'ready',
  assertProductActorCurrent: vi.fn(),
  captureProductActor: vi.fn(),
  notify: vi.fn(),
  enqueue: vi.fn(),
  prepareProduct: vi.fn(),
  findSkuConflicts: vi.fn(),
  getBatchById: vi.fn(),
  getCategoryById: vi.fn(),
  getDeletedCategoryById: vi.fn(),
  getOperation: vi.fn(),
  listOperationsForEntity: vi.fn(),
  assertTenantAccess: vi.fn(),
  markSynced: vi.fn(),
  saveBatchLocal: vi.fn(),
  saveCategoryLocal: vi.fn(),
  savePreparedProductLocal: vi.fn(),
  deleteProductLocal: vi.fn(),
  toggleProductStatusLocal: vi.fn(),
  applyCloudCatalog: vi.fn(),
  applyCloudCategory: vi.fn(),
  getProductById: vi.fn(),
  upsertCategory: vi.fn(),
  upsertProduct: vi.fn(),
  pullCatalogSnapshot: vi.fn(),
  deleteProduct: vi.fn(),
  toggleProductStatus: vi.fn(),
  upsertProductBatch: vi.fn()
}));

vi.mock('../../Logger', () => ({
  default: { warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../utils', () => ({ generateID: vi.fn(() => 'generated-id') }));vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
    TENANT_NOT_READY: 'ACTOR_TENANT_NOT_READY'
  },
  ActorRuntimeError: class ActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  },
  actorRuntimeController: {
    capture: mocks.captureProductActor
  }
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({
    licenseDetails: mocks.licenseDetails,
    appStatus: mocks.appStatus,
    companyProfile: { business_type: mocks.businessTypes }
  }) }
}));
vi.mock('../../sync/idempotency', () => ({
  generateIdempotencyKey: vi.fn(() => 'operation-id')
}));
vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: {
    enqueueOperation: mocks.enqueue,
    getOperation: mocks.getOperation,
    listOperationsForEntity: mocks.listOperationsForEntity,
    assertTenantAccess: mocks.assertTenantAccess,
    markSynced: mocks.markSynced
  }
}));
vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: (details) => details?.license_key || details?.licenseKey || 'license-key',
  isCloudProductsSyncEnabled: () => mocks.cloudEnabled,
  SYNC_ENTITY_TYPES: {
    CATEGORY: 'category',
    PRODUCT: 'product',
    PRODUCT_BATCH: 'product_batch'
  },
  SYNC_OPERATIONS: {
    UPSERT: 'upsert',
    DELETE: 'delete',
    TOGGLE_STATUS: 'toggle_status'
  },
  OUTBOX_STATUS: { PENDING: 'pending', PROCESSING: 'processing', FAILED: 'failed', SYNCED: 'synced' },
  SYNC_LIMITS: { MAX_PULL_LIMIT: 500 }
}));
vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  normalizeNameKey: (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
  productToCloudPayload: (value) => ({
    ...value,
    category_id: value.categoryId ?? value.category_id ?? null
  }),
  normalizeSkuKey: (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
}));
vi.mock('../productCloudRepository', () => ({
  productCloudRepository: {
    upsertCategory: mocks.upsertCategory,
    upsertProduct: mocks.upsertProduct,
    pullCatalogSnapshot: mocks.pullCatalogSnapshot,
    deleteProduct: mocks.deleteProduct,
    toggleProductStatus: mocks.toggleProductStatus,
    upsertProductBatch: mocks.upsertProductBatch
  }
}));
vi.mock('../productLocalRepository', () => ({
  productLocalRepository: {
    saveCategoryLocal: mocks.saveCategoryLocal,
    prepareProduct: mocks.prepareProduct,
    savePreparedProductLocal: mocks.savePreparedProductLocal,
    saveBatchLocal: mocks.saveBatchLocal,
    deleteProductLocal: mocks.deleteProductLocal,
    toggleProductStatusLocal: mocks.toggleProductStatusLocal,
    applyCloudCategory: mocks.applyCloudCategory,
    applyCloudCatalog: mocks.applyCloudCatalog,
    getProductById: mocks.getProductById,
    getCategoryById: mocks.getCategoryById,
    getDeletedCategoryById: mocks.getDeletedCategoryById,
    getBatchById: mocks.getBatchById,
    findSkuConflicts: mocks.findSkuConflicts
  }
}));
vi.mock('../productConflictService', () => ({
  productConflictService: {
    isConflictResponse: (response) => response?.code === 'VERSION_CONFLICT',
    normalizeFailure: (value, fallback = 'PRODUCT_CLOUD_ERROR') => ({
      ...value,
      success: false,
      code: value?.code || fallback,
      message: value?.message || value?.code || fallback
    }),
    saveConflict: vi.fn()
  }
}));
vi.mock('../productMigrationService', () => ({
  productMigrationService: { pullFullSnapshot: vi.fn() }
}));
vi.mock('../productSyncHandler', () => ({ pullCatalogChanges: vi.fn() }));
vi.mock('../productConstants', () => ({
  PRODUCT_CLOUD_PHASE: 'phase',
  PRODUCT_SYNC_STATUS: { LOCAL: 'local', PENDING: 'pending' }
}));
vi.mock('../productEvents', () => ({ notifyProductsChanged: mocks.notify }));

import { productRepository } from '../productRepository';

const preparedProduct = (editing = false) => ({
  productId: 'product-1',
  product: { id: 'product-1', name: 'Product', serverVersion: editing ? 1 : null },
  batches: [],
  editing,
  inventoryValue: 0
});

const apparelPreparedProduct = ({ serverVersion = 10, updated = [], created = [], removed = [] } = {}) => ({
  ...preparedProduct(true),
  product: { id: 'product-1', name: 'Product', serverVersion },
  apparelVariantDelta: { unchanged: [], updated, created, removed }
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.cloudEnabled = false;
  mocks.businessTypes = ['abarrotes'];
  mocks.licenseDetails = {};
  mocks.appStatus = 'ready';
  mocks.assertProductActorCurrent.mockReset();
  mocks.captureProductActor.mockReset().mockImplementation(() => ({
    actorType: 'admin',
    actorId: 'admin-test',
    actorKey: 'admin:admin-test',
    generation: 1,
    assertCurrent: mocks.assertProductActorCurrent
  }));
  mocks.prepareProduct.mockResolvedValue(preparedProduct(false));
  mocks.findSkuConflicts.mockResolvedValue([]);
  mocks.saveCategoryLocal.mockResolvedValue({ success: true, id: 'category-local', name: 'Local' });
  mocks.savePreparedProductLocal.mockResolvedValue({ success: true, productId: 'product-1' });
  mocks.saveBatchLocal.mockResolvedValue({ success: true, batchId: 'batch-1' });
  mocks.getProductById.mockResolvedValue(null);
  mocks.getCategoryById.mockResolvedValue(null);
  mocks.getDeletedCategoryById.mockResolvedValue(null);
  mocks.getOperation.mockResolvedValue(null);
  mocks.listOperationsForEntity.mockResolvedValue([]);
  mocks.assertTenantAccess.mockResolvedValue(true);
  mocks.markSynced.mockResolvedValue(undefined);
  mocks.getBatchById.mockResolvedValue(null);
  mocks.deleteProductLocal.mockResolvedValue({ success: true });
  mocks.toggleProductStatusLocal.mockResolvedValue({ success: true });
  mocks.applyCloudCatalog.mockResolvedValue({ products: 1, categories: 0, batches: 0 });
  mocks.applyCloudCategory.mockResolvedValue({ id: 'category-1', name: 'Category', serverVersion: 1 });
  mocks.upsertCategory.mockResolvedValue({ success: true, category: { id: 'category-1', name: 'Category' } });
  mocks.upsertProduct.mockResolvedValue({ success: true, product: { id: 'product-1', category_id: null } });
  mocks.upsertProductBatch.mockResolvedValue({ success: true, batch: { id: 'batch-1' } });
  mocks.toggleProductStatus.mockResolvedValue({ success: true, product: { id: 'product-1' } });
  mocks.pullCatalogSnapshot.mockImplementation(async ({ entityType }) => ({
    success: true,
    products: entityType === 'products' ? [] : undefined,
    batches: entityType === 'batches' ? [] : undefined,
    has_more: false
  }));
  vi.stubGlobal('navigator', { onLine: true });
});

describe('productRepository directed catalog events', () => {
  it('blocks a product save before local or Cloud writes while tenant verification is pending', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.captureProductActor.mockImplementationOnce(() => {
      throw Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' });
    });

    const result = await productRepository.saveProduct({ name: 'Jabón QA' });

    expect(result).toMatchObject({
      success: false,
      code: 'ACTOR_TENANT_NOT_READY',
      phase: 'actor_preflight',
      recoveryAction: 'retry_tenant_verification'
    });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked session', 'ADMIN_SESSION_REVOKED', 'session_required', /sesión cambió/i],
    ['denied product permission', 'ACTOR_PERMISSION_DENIED', 'permission_denied', /no tienes permiso/i]
  ])('keeps %s distinct from recoverable tenant readiness', async (_caseName, code, authorityKind, messagePattern) => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.captureProductActor.mockImplementationOnce(() => {
      throw Object.assign(new Error(code), { code });
    });

    const result = await productRepository.saveProduct({ name: 'Jabón QA' });

    expect(result).toMatchObject({
      success: false,
      code,
      phase: 'actor_preflight',
      authorityKind,
      recoveryAction: null
    });
    expect(result.message).toMatch(messagePattern);
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('reports a confirmed Cloud write as local reconciliation pending without resubmitting it', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.upsertProduct.mockResolvedValueOnce({
      success: true,
      product: { id: 'product-1', category_id: null },
      clientLocalReconciliationPending: true,
      clientIdempotencyKey: 'operation-id',
      clientAuthorityErrorCode: 'ACTOR_TENANT_NOT_READY',
      clientAuthorityErrorKind: 'tenant_verification_pending'
    });

    const result = await productRepository.saveProduct({ name: 'Product' });

    expect(result).toMatchObject({
      success: true,
      pending: true,
      cloudConfirmed: true,
      localReconciliationPending: true,
      productId: 'product-1',
      code: 'ACTOR_TENANT_NOT_READY',
      authorityKind: 'tenant_verification_pending'
    });
    expect(result.message).toMatch(/Nube confirmó.*No vuelvas a guardar/i);
    expect(mocks.upsertProduct).toHaveBeenCalledOnce();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects category recovery when the current staff actor lacks product permission', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.assertProductActorCurrent.mockImplementationOnce(() => {
      throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
    });

    await expect(productRepository.confirmLocalCategoryInCloud('category-legacy')).resolves.toMatchObject({
      success: false,
      code: 'ACTOR_PERMISSION_DENIED'
    });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.getCategoryById).not.toHaveBeenCalled();
  });

  it('rechecks the captured actor after the Cloud category query before any write', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'category-legacy', name: 'Generales QA', isActive: true });
    let actorRevoked = false;
    mocks.assertProductActorCurrent.mockImplementation(() => {
      if (actorRevoked) throw Object.assign(new Error('permission revoked'), { code: 'ACTOR_PERMISSION_DENIED' });
    });
    mocks.pullCatalogSnapshot.mockImplementationOnce(async () => {
      actorRevoked = true;
      return { success: true, categories: [], has_more: false };
    });

    await expect(productRepository.confirmLocalCategoryInCloud('category-legacy')).resolves.toMatchObject({
      success: false,
      code: 'PRODUCT_CATEGORY_RECOVERY_CONTEXT_CHANGED',
      message: expect.stringMatching(/sesión o negocio cambió/i)
    });

    expect(mocks.assertTenantAccess).toHaveBeenCalledWith({ licenseKey: 'license-key' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.applyCloudCategory).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not project a Cloud category after the active local tenant changes during the query', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    const category = { id: 'category-legacy', name: 'Generales QA', is_active: true };
    mocks.getCategoryById.mockResolvedValueOnce({ id: category.id, name: category.name, isActive: true });
    let tenantChanged = false;
    mocks.assertTenantAccess.mockImplementation(async () => {
      if (tenantChanged) throw new Error('LOCAL_TENANT_SYNC_BLOCKED');
      return true;
    });
    mocks.pullCatalogSnapshot.mockImplementationOnce(async () => {
      tenantChanged = true;
      return { success: true, categories: [category], has_more: false };
    });

    await expect(productRepository.confirmLocalCategoryInCloud(category.id)).resolves.toMatchObject({
      success: false,
      code: 'PRODUCT_CATEGORY_RECOVERY_CONTEXT_CHANGED',
      message: expect.stringMatching(/verifica su estado en Cloud/i)
    });

    expect(mocks.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.applyCloudCategory).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('rejects recovery after the active license changes during the Cloud query', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'category-legacy', name: 'Generales QA', isActive: true });
    mocks.pullCatalogSnapshot.mockImplementationOnce(async () => {
      mocks.licenseDetails = { valid: true, license_key: 'other-license' };
      return { success: true, categories: [], has_more: false };
    });

    await expect(productRepository.confirmLocalCategoryInCloud('category-legacy')).resolves.toMatchObject({
      success: false,
      code: 'PRODUCT_CATEGORY_RECOVERY_CONTEXT_CHANGED'
    });

    expect(mocks.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.applyCloudCategory).not.toHaveBeenCalled();
  });

  it('explains pending medical classification before attempting activation', async () => {
    const pendingMedicine = {
      id: 'pending-medicine', isActive: false,
      metadata: { pharmacy: { kind: 'medicine', fraction: null, status: 'pending' } }
    };

    await expect(productRepository.toggleProductStatus(pendingMedicine, true)).resolves.toMatchObject({
      success: false,
      code: 'PHARMACY_CLASSIFICATION_REQUIRED',
      message: expect.stringMatching(/clasificación sanitaria válida/i)
    });
    expect(mocks.toggleProductStatusLocal).not.toHaveBeenCalled();
    expect(mocks.toggleProductStatus).not.toHaveBeenCalled();
  });

  it('does not report a Cloud toggle success without an explicit confirmation', async () => {
    mocks.cloudEnabled = true;
    mocks.toggleProductStatus.mockResolvedValueOnce({});

    await expect(productRepository.toggleProductStatus({ id: 'product-1', isActive: false }, true))
      .resolves.toMatchObject({ success: false, code: 'PRODUCT_TOGGLE_CONFIRMATION_MISSING' });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('does not report a Cloud batch save success without an explicit confirmation', async () => {
    mocks.cloudEnabled = true;
    mocks.getProductById.mockResolvedValueOnce({
      id: 'product-1', name: 'Product', rubroContext: 'abarrotes'
    });
    mocks.upsertProductBatch.mockResolvedValueOnce({});

    await expect(productRepository.saveBatch({
      id: 'batch-1', productId: 'product-1', stock: 0, isActive: false
    })).resolves.toMatchObject({ success: false, code: 'BATCH_SYNC_CONFIRMATION_MISSING' });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('genera SKU Apparel antes de guardar cada variante y conserva el SKU manual', async () => {
    const prepared = {
      ...preparedProduct(false),
      product: { id: 'product-1', name: 'Playera QA SKU', rubroContext: 'apparel' },
      batches: [
        { id: 'batch-s-black', productId: 'product-1', attributes: { talla: 'S', color: 'Negro' }, sku: null },
        { id: 'batch-m-black', productId: 'product-1', attributes: { talla: 'M', color: 'Negro' }, sku: '' },
        { id: 'batch-l-blue', productId: 'product-1', attributes: { talla: 'L', color: 'Azul' }, sku: 'PLAYERA-L-AZUL-QA' }
      ]
    };
    mocks.prepareProduct.mockResolvedValueOnce(prepared);

    await productRepository.saveProduct({ name: 'Playera QA SKU' });

    const savedBatches = mocks.savePreparedProductLocal.mock.calls[0][0].batches;
    expect(savedBatches).toHaveLength(3);
    expect(savedBatches[0].sku).toBeTruthy();
    expect(savedBatches[1].sku).toBeTruthy();
    expect(savedBatches[0].sku).not.toBe(savedBatches[1].sku);
    expect(savedBatches[2].sku).toBe('PLAYERA-L-AZUL-QA');
  });

  it('rechaza SKU manual duplicado antes de modificar el producto', async () => {
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(false),
      product: { id: 'product-1', name: 'Playera QA SKU', rubroContext: 'apparel' },
      batches: [
        { id: 'batch-a', attributes: { talla: 'S', color: 'Negro' }, sku: 'SKU-IGUAL' },
        { id: 'batch-b', attributes: { talla: 'M', color: 'Negro' }, sku: 'sku-igual' }
      ]
    });

    const result = await productRepository.saveProduct({ name: 'Playera QA SKU' });

    expect(result).toMatchObject({ success: false, code: 'APPAREL_DUPLICATE_SKU' });
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
  });

  it('rechaza en PRO un SKU que ya aparece en el snapshot Cloud del tenant', async () => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(false),
      product: { id: 'product-1', name: 'Playera QA SKU', rubroContext: 'apparel' },
      batches: [{ id: 'batch-a', attributes: { talla: 'S', color: 'Negro' }, sku: 'CLOUD-TAKEN' }]
    });
    mocks.pullCatalogSnapshot.mockImplementation(async ({ entityType }) => ({
      success: true,
      products: entityType === 'products' ? [] : undefined,
      batches: entityType === 'batches' ? [{ id: 'existing-batch', sku: 'cloud-taken' }] : undefined,
      has_more: false
    }));

    const result = await productRepository.saveProduct({ name: 'Playera QA SKU' });

    expect(result).toMatchObject({ success: false, code: 'APPAREL_DUPLICATE_SKU' });
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it('deja el SKU histórico vacío al editar otros campos de una variante', async () => {
    mocks.businessTypes = ['apparel'];
    const prepared = apparelPreparedProduct({
      updated: [{
        id: 'historic-batch', talla: 'M', color: 'Negro', sku: '', cost: 11, price: 30,
        existingBatch: { id: 'historic-batch', productId: 'product-1', sku: null, stock: 5, serverVersion: 2 }
      }]
    });
    mocks.prepareProduct.mockResolvedValueOnce(prepared);
    const saveBatch = vi.spyOn(productRepository, 'saveBatch').mockResolvedValue({ success: true });

    const result = await productRepository.saveProduct({ name: 'Product' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ success: true });
    expect(mocks.findSkuConflicts).not.toHaveBeenCalled();
    expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'historic-batch', stock: 5, sku: null
    }), expect.objectContaining({ apparelSkuAlreadyChecked: true }));
  });

  it('no interpreta talla/color de Restaurante como variante Apparel cuando falta rubroContext', async () => {
    mocks.businessTypes = ['food_service'];
    mocks.getProductById.mockResolvedValueOnce({ id: 'restaurant-item', name: 'Platillo' });

    const result = await productRepository.saveBatch({
      id: 'restaurant-batch',
      productId: 'restaurant-item',
      sku: 'PLATILLO-S-NEGRO',
      attributes: { talla: 'S', color: 'Negro' }
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.findSkuConflicts).not.toHaveBeenCalled();
    expect(mocks.saveBatchLocal).toHaveBeenCalledOnce();
  });

  it('no ejecuta reglas de SKU Apparel para un lote ordinario de Ferretería', async () => {
    mocks.businessTypes = ['hardware'];
    mocks.getProductById.mockResolvedValueOnce({ id: 'hammer', name: 'Tornillo', rubroContext: 'hardware' });

    const result = await productRepository.saveBatch({
      id: 'hardware-batch',
      productId: 'hammer',
      sku: 'TORNILLO-M12-LOT-1',
      attributes: { modelo: 'M12', manufacturerBatchId: 'LOT-1' }
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.findSkuConflicts).not.toHaveBeenCalled();
    expect(mocks.saveBatchLocal).toHaveBeenCalledOnce();
  });

  it('rechaza un SKU nuevo duplicado al editar una variante sin guardar el producto', async () => {
    const prepared = apparelPreparedProduct({
      updated: [{
        id: 'batch-a', talla: 'M', color: 'Negro', sku: 'SKU-TAKEN', cost: 10, price: 30,
        existingBatch: { id: 'batch-a', productId: 'product-1', sku: 'SKU-OLD', stock: 5, serverVersion: 2 }
      }]
    });
    prepared.product.rubroContext = 'apparel';
    mocks.prepareProduct.mockResolvedValueOnce(prepared);
    mocks.findSkuConflicts.mockResolvedValueOnce([{ entityType: 'batch', id: 'other-batch' }]);

    const result = await productRepository.saveProduct({ name: 'Product' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ success: false, code: 'APPAREL_DUPLICATE_SKU' });
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
  });

  it('aplica la comprobación Cloud a Apparel histórico por perfil único sin rubroContext', async () => {
    mocks.cloudEnabled = true;
    mocks.businessTypes = ['apparel'];
    mocks.getProductById.mockResolvedValueOnce({ id: 'legacy-apparel', name: 'Playera heredada' });
    mocks.getBatchById.mockResolvedValueOnce(null);
    mocks.pullCatalogSnapshot.mockImplementation(async ({ entityType }) => ({
      success: true,
      products: entityType === 'products' ? [] : undefined,
      batches: entityType === 'batches' ? [{ id: 'existing-batch', sku: 'LEGACY-TAKEN' }] : undefined,
      has_more: false
    }));

    const result = await productRepository.saveBatch({
      id: 'new-apparel-batch',
      productId: 'legacy-apparel',
      sku: 'LEGACY-TAKEN',
      attributes: { talla: 'M', color: 'Negro' }
    });

    expect(result).toMatchObject({ success: false, code: 'APPAREL_DUPLICATE_SKU' });
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('propagates a rejected local category save without enqueue or success events (PRO=%s)', async (cloudEnabled) => {
    mocks.cloudEnabled = cloudEnabled;
    vi.stubGlobal('navigator', { onLine: false });
    const error = new Error('Ya existe una categoria activa con este nombre.');
    mocks.saveCategoryLocal.mockRejectedValueOnce(error);

    await expect(productRepository.saveCategory({ id: 'duplicate', name: ' bebidas ' })).rejects.toBe(error);
    expect(mocks.saveCategoryLocal).toHaveBeenCalledOnce();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('preserves offline PRO category success after the local write and enqueue', async () => {
    mocks.cloudEnabled = true;
    vi.stubGlobal('navigator', { onLine: false });
    await expect(productRepository.saveCategory({ id: 'pending', name: 'Bebidas' }))
      .resolves.toMatchObject({ success: true, pending: true });
    expect(mocks.saveCategoryLocal).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending' }), expect.objectContaining({
      syncStatus: 'pending', pendingOperationId: 'operation-id'
    }));
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it('emits created and updated IDs for Free local writes', async () => {
    await productRepository.saveProduct({ name: 'Created' });
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      productIds: ['product-1'],
      operation: 'created',
      source: 'productRepository.saveProduct.local'
    }));

    mocks.prepareProduct.mockResolvedValueOnce(preparedProduct(true));
    await productRepository.saveProduct({ name: 'Updated' }, { existingProduct: { id: 'product-1' } });
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      operation: 'updated'
    }));
  });

  it('emits a directed pending event for an offline PRO creation without calling cloud', async () => {
    mocks.cloudEnabled = true;
    vi.stubGlobal('navigator', { onLine: false });

    await productRepository.saveProduct({ name: 'Offline' });

    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      operation: 'created',
      source: 'productRepository.saveProduct.pending'
    }));
  });

  it('emits a directed event after an online PRO write is committed to IndexedDB', async () => {
    mocks.cloudEnabled = true;

    await productRepository.saveProduct({ name: 'Online' });

    expect(mocks.applyCloudCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      operation: 'created',
      source: 'productRepository.saveProduct'
    }));
  });

  it.each([
    ['create', false],
    ['edit', true]
  ])('confirms the selected commercial category in Cloud on %s', async (_label, editing) => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(editing),
      product: {
        id: 'product-1', name: 'Medicamento QA', categoryId: 'category-qa', price: 24,
        rubroContext: 'farmacia', prescriptionType: 'otc', activeSubstance: 'Paracetamol QA',
        presentation: 'Caja con 10 tabletas', serverVersion: editing ? 4 : null
      }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({
      success: true, categories: [{ id: 'category-qa', name: 'Medicamentos QA', is_active: true }], has_more: false
    });
    mocks.upsertProduct.mockResolvedValueOnce({
      success: true,
      product: {
        id: 'product-1', category_id: 'category-qa', price: 24,
        prescription_type: 'otc', active_substance: 'Paracetamol QA', presentation: 'Caja con 10 tabletas'
      }
    });

    const result = await productRepository.saveProduct(
      { name: 'Medicamento QA' },
      editing ? { existingProduct: { id: 'product-1', serverVersion: 4 } } : {}
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ category_id: 'category-qa' })
    }));
    expect(mocks.upsertProduct.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.pullCatalogSnapshot.mock.invocationCallOrder[0]);
    expect(mocks.applyCloudCatalog).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ id: 'product-1', category_id: 'category-qa' })
    }));
  });

  it('preserves a confirmed legacy category while editing price and description', async () => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(true),
      product: {
        id: 'product-1', name: 'Medicamento heredado', categoryId: 'category-old',
        price: 28, description: 'Descripción actualizada', serverVersion: 2
      }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({
      success: true, categories: [{ id: 'category-old', name: 'Higiene QA', is_active: true }], has_more: false
    });
    mocks.upsertProduct.mockResolvedValueOnce({
      success: true, product: {
        id: 'product-1', category_id: 'category-old', price: 28, description: 'Descripción actualizada'
      }
    });

    const result = await productRepository.saveProduct(
      { name: 'Medicamento heredado', price: 28, description: 'Descripción actualizada' },
      { existingProduct: { id: 'product-1', categoryId: 'category-old', serverVersion: 2 } }
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({
        category_id: 'category-old', price: 28, description: 'Descripción actualizada'
      })
    }));
  });

  it('holds a legacy category for explicit recovery without saving the product first', async () => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(true),
      product: { id: 'product-1', name: 'Jabón QA', categoryId: 'category-legacy', description: 'Cambio', serverVersion: 2 }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [], has_more: false });
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'category-legacy', name: 'Higiene QA', isActive: true, syncStatus: 'synced', serverVersion: 1
    });
    mocks.listOperationsForEntity.mockResolvedValueOnce([]);

    await expect(productRepository.saveProduct(
      { id: 'product-1', description: 'Cambio' },
      { existingProduct: { id: 'product-1', categoryId: 'category-legacy', serverVersion: 2 } }
    )).resolves.toMatchObject({
      success: false,
      code: 'PRODUCT_CATEGORY_RECOVERY_REQUIRED',
      category: { id: 'category-legacy', name: 'Higiene QA' }
    });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.savePreparedProductLocal).not.toHaveBeenCalled();
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('preserves pharmaceutical classification and existing stock/lot data during categorized edits', async () => {
    mocks.cloudEnabled = true;
    const pharmacy = { kind: 'medicine', fraction: 'VI', status: 'confirmed', classification: 'antibiotic' };
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(true),
      product: {
        id: 'medicine-qa', name: 'Medicamento QA', categoryId: 'medicines-qa', price: 24,
        stock: 12, metadata: { pharmacy }, serverVersion: 7
      },
      batches: [{ id: 'batch-qa', productId: 'medicine-qa', stock: 8, expiryDate: '2027-05-01', manufacturerBatchId: 'LOT-007' }]
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({
      success: true, categories: [{ id: 'medicines-qa', name: 'Medicamentos QA', is_active: true }], has_more: false
    });
    mocks.upsertProduct.mockResolvedValueOnce({
      success: true, product: { id: 'medicine-qa', category_id: 'medicines-qa', stock: 12 }
    });

    await expect(productRepository.saveProduct(
      { id: 'medicine-qa', price: 25 },
      { existingProduct: { id: 'medicine-qa', categoryId: 'medicines-qa', serverVersion: 7 } }
    )).resolves.toMatchObject({ success: true });

    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({
        id: 'medicine-qa', category_id: 'medicines-qa', stock: 12, metadata: { pharmacy }
      }),
      initialBatches: []
    }));
    expect(mocks.upsertProductBatch).not.toHaveBeenCalled();
  });

  it('syncs an authorized pending category for this tenant before the product RPC', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(false), product: { id: 'product-1', name: 'Con categoría', categoryId: 'category-pending' }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [], has_more: false });
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'category-pending', name: 'Generales QA', isActive: true,
      syncStatus: 'pending', pendingOperationId: 'category-operation'
    });
    mocks.getOperation.mockResolvedValueOnce({
      id: 'category-operation', idempotencyKey: 'category-operation', licenseKey: 'license-key',
      entityType: 'category', operation: 'upsert', entityId: 'category-pending', status: 'pending',
      payload: { category: { id: 'category-pending', name: 'Generales QA', is_active: true }, expectedVersion: null }
    });
    mocks.listOperationsForEntity.mockResolvedValueOnce([{
      id: 'category-operation', entityType: 'category', operation: 'upsert',
      entityId: 'category-pending', status: 'pending'
    }]);
    mocks.upsertCategory.mockResolvedValueOnce({
      success: true, category: { id: 'category-pending', name: 'Generales QA', is_active: true, server_version: 1 }
    });
    mocks.upsertProduct.mockResolvedValueOnce({
      success: true, product: { id: 'product-1', category_id: 'category-pending' }
    });

    const result = await productRepository.saveProduct({ name: 'Con categoría' });

    expect(result).toMatchObject({ success: true });
    expect(mocks.upsertCategory.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.upsertProduct.mock.invocationCallOrder[0]);
    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'license-key', idempotencyKey: 'category-operation'
    }));
  });

  it('does not call the product RPC or show success when Cloud rejects its pending category', async () => {
    mocks.cloudEnabled = true;
    mocks.licenseDetails = { valid: true, license_key: 'license-key' };
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(false), product: { id: 'product-1', name: 'Con categoría', categoryId: 'category-pending' }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [], has_more: false });
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'category-pending', name: 'Generales QA', isActive: true,
      syncStatus: 'pending', pendingOperationId: 'category-operation'
    });
    mocks.getOperation.mockResolvedValueOnce({
      id: 'category-operation', licenseKey: 'license-key', entityType: 'category', operation: 'upsert',
      entityId: 'category-pending', status: 'pending', idempotencyKey: 'category-operation',
      payload: { category: { id: 'category-pending', name: 'Generales QA', is_active: true } }
    });
    mocks.listOperationsForEntity.mockResolvedValueOnce([{
      id: 'category-operation', entityType: 'category', operation: 'upsert',
      entityId: 'category-pending', status: 'pending'
    }]);
    mocks.upsertCategory.mockResolvedValueOnce({ success: false, code: 'STAFF_PERMISSION_DENIED' });

    const result = await productRepository.saveProduct({ name: 'Con categoría' });

    expect(result).toMatchObject({ success: false, code: 'STAFF_PERMISSION_DENIED' });
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('does not apply a partial Cloud product response or report category success', async () => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValueOnce({
      ...preparedProduct(true), product: { id: 'product-1', name: 'Medicamento QA', categoryId: 'category-qa', price: 28, serverVersion: 2 }
    });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({
      success: true, categories: [{ id: 'category-qa', name: 'Medicamentos QA', is_active: true }], has_more: false
    });
    mocks.upsertProduct.mockResolvedValueOnce({ success: true, product: { id: 'product-1', price: 28 } });

    const result = await productRepository.saveProduct(
      { name: 'Medicamento QA', price: 28 },
      { existingProduct: { id: 'product-1', categoryId: 'category-qa', serverVersion: 2 } }
    );

    expect(result).toMatchObject({ success: false, code: 'PRODUCT_CATEGORY_CONFIRMATION_MISSING' });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('does not report success or reconcile local state when Cloud rejects the product', async () => {
    mocks.cloudEnabled = true;
    mocks.upsertProduct.mockResolvedValueOnce({
      success: false, code: 'STAFF_PERMISSION_DENIED', message: 'No autorizado.'
    });

    const result = await productRepository.saveProduct({ name: 'Rechazado' });

    expect(result).toMatchObject({ success: false, code: 'STAFF_PERMISSION_DENIED' });
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('keeps the RPC confirmation in PRO category results and rejects an unconfirmed response', async () => {
    mocks.cloudEnabled = true;
    mocks.upsertCategory.mockResolvedValueOnce({
      success: true,
      category: { id: 'category-cloud', name: 'Nube' }
    });

    await expect(productRepository.saveCategory({ id: 'category-cloud', name: 'Nube' }))
      .resolves.toMatchObject({ success: true, id: 'category-cloud', name: 'Nube' });
    expect(mocks.applyCloudCatalog).toHaveBeenCalledTimes(1);

    mocks.upsertCategory.mockResolvedValueOnce({ category: { id: 'category-unconfirmed', name: 'Sin confirmar' } });
    await expect(productRepository.saveCategory({ id: 'category-unconfirmed', name: 'Sin confirmar' }))
      .resolves.toMatchObject({ success: false, code: 'CATEGORY_SYNC_FAILED' });
    expect(mocks.applyCloudCatalog).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached category from the RPC conflict payload without retrying the stale write', async () => {
    mocks.cloudEnabled = true;
    const serverCategory = {
      id: 'category-1',
      name: 'Bebidas Cloud',
      color: '#abcdef',
      sort_order: 8,
      server_version: 9
    };
    mocks.upsertCategory.mockResolvedValueOnce({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoria fue modificada en otro dispositivo.',
      category: serverCategory,
      server_version: 9
    });

    const result = await productRepository.saveCategory({
      id: 'category-1',
      name: 'Bebidas local',
      serverVersion: 7
    });

    expect(result).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 }));
    expect(mocks.applyCloudCategory).toHaveBeenCalledOnce();
    expect(mocks.applyCloudCategory).toHaveBeenCalledWith(serverCategory);
    expect(mocks.applyCloudCatalog).not.toHaveBeenCalled();
  });

  it('updates only the apparel batch delta and never sends existing batches as initial batches', async () => {
    mocks.cloudEnabled = true;
    mocks.prepareProduct.mockResolvedValue({
      ...preparedProduct(true),
      batches: [{ id: 'legacy-batch' }],
      apparelVariantDelta: {
        unchanged: [{ id: 'batch-g' }],
        updated: [{ id: 'batch-m', sku: 'SKU-B', cost: 12, price: 30, existingBatch: { id: 'batch-m', serverVersion: 1, stock: 4 } }],
        created: [{ id: 'batch-ch', talla: 'CH', color: 'Negro', stock: 2, cost: 12, price: 30 }],
        removed: [{ id: 'batch-l', serverVersion: 2 }]
      }
    });
    const saveBatch = vi.spyOn(productRepository, 'saveBatch').mockResolvedValue({ success: true });
    const deleteBatch = vi.spyOn(productRepository, 'deleteBatch').mockResolvedValue({ success: true });

    await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(mocks.upsertProduct).toHaveBeenCalledWith(expect.objectContaining({ initialBatches: [] }));
    expect(saveBatch).toHaveBeenCalledTimes(2);
    expect(saveBatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'batch-m', sku: 'SKU-B', stock: 4 }), expect.objectContaining({ expectedVersion: 1 }));
    expect(saveBatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'batch-ch' }), expect.objectContaining({ expectedVersion: null }));
    expect(deleteBatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'batch-l' }), expect.objectContaining({ expectedVersion: 2 }));
  });

  it('rebases the parent from the latest confirmed apparel batch and retries with that version', async () => {
    mocks.cloudEnabled = true;
    const batchA = { id: 'batch-a', talla: 'M', color: 'Negro', sku: 'SKU-A2', cost: 10, price: 20, existingBatch: { id: 'batch-a', serverVersion: 1, stock: 4 } };
    const batchB = { id: 'batch-b', talla: 'G', color: 'Negro', sku: 'SKU-B2', cost: 10, price: 20, existingBatch: { id: 'batch-b', serverVersion: 1, stock: 5 } };
    mocks.prepareProduct
      .mockResolvedValueOnce(apparelPreparedProduct({ serverVersion: 10, updated: [batchA, batchB] }))
      .mockResolvedValueOnce(apparelPreparedProduct({ serverVersion: 12, updated: [batchB] }));
    mocks.upsertProduct
      .mockResolvedValueOnce({ success: true, product: { id: 'product-1', category_id: null, serverVersion: 11 } })
      .mockResolvedValueOnce({ success: true, product: { id: 'product-1', category_id: null, serverVersion: 13 } });
    const saveBatch = vi.spyOn(productRepository, 'saveBatch')
      .mockResolvedValueOnce({ success: true, response: { batch: { id: 'batch-a', server_version: 2 }, product: { id: 'product-1', serverVersion: 12 } } })
      .mockResolvedValueOnce({ success: false, code: 'VERSION_CONFLICT' })
      .mockResolvedValueOnce({ success: true, response: { batch: { id: 'batch-b', server_version: 2 }, product: { id: 'product-1', serverVersion: 13 } } });

    const result = await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ partial: true, success: false, productRebase: { id: 'product-1', serverVersion: 12 } });
    expect(result.appliedVariants.updated).toHaveLength(1);
    expect(result.appliedVariants.updated[0]).toMatchObject({
      variant: { id: 'batch-a', sku: 'SKU-A2' },
      result: { response: { batch: { server_version: 2 }, product: { serverVersion: 12 } } }
    });
    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedVersion: 10 }));

    await productRepository.saveProduct({ name: 'Edited again' }, { existingProduct: { id: 'product-1', serverVersion: 12 } });

    expect(mocks.upsertProduct).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedVersion: 12 }));
    expect(saveBatch.mock.calls.map(([batch]) => batch.id)).toEqual(['batch-a', 'batch-b', 'batch-b']);
  });

  it('uses the last successful batch response when several updates precede a failure', async () => {
    mocks.cloudEnabled = true;
    const variants = ['a', 'b', 'c'].map((id) => ({ id: `batch-${id}`, talla: id.toUpperCase(), color: 'Negro', sku: `SKU-${id}`, cost: 10, price: 20, existingBatch: { id: `batch-${id}`, serverVersion: 1, stock: 1 } }));
    mocks.prepareProduct.mockResolvedValue(apparelPreparedProduct({ updated: variants }));
    const saveBatch = vi.spyOn(productRepository, 'saveBatch')
      .mockResolvedValueOnce({ success: true, response: { product: { id: 'product-1', serverVersion: 12 } } })
      .mockResolvedValueOnce({ success: true, response: { product: { id: 'product-1', serverVersion: 13 } } })
      .mockResolvedValueOnce({ success: false, code: 'VERSION_CONFLICT' });

    const result = await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ partial: true, productRebase: { serverVersion: 13 } });
    expect(saveBatch).toHaveBeenCalledTimes(3);
  });

  it('uses an updated batch parent rebase when a created batch fails', async () => {
    mocks.cloudEnabled = true;
    const updated = { id: 'batch-a', talla: 'M', color: 'Negro', sku: 'SKU-A2', cost: 10, price: 20, existingBatch: { id: 'batch-a', serverVersion: 1, stock: 1 } };
    const created = { id: 'batch-b', talla: 'G', color: 'Negro', sku: 'SKU-B', cost: 10, price: 20 };
    mocks.prepareProduct.mockResolvedValue(apparelPreparedProduct({ updated: [updated], created: [created] }));
    const saveBatch = vi.spyOn(productRepository, 'saveBatch')
      .mockResolvedValueOnce({ success: true, response: { product: { id: 'product-1', serverVersion: 12 } } })
      .mockResolvedValueOnce({ success: false, code: 'VERSION_CONFLICT' });

    const result = await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ partial: true, productRebase: { serverVersion: 12 } });
    expect(result.appliedVariants).toMatchObject({ updated: [{ variant: { id: 'batch-a' } }], created: [] });
    expect(saveBatch.mock.calls.map(([batch]) => batch.id)).toEqual(['batch-a', 'batch-b']);
  });

  it('uses the latest product returned by an update when a deletion later fails', async () => {
    mocks.cloudEnabled = true;
    const updated = { id: 'batch-b', talla: 'G', color: 'Negro', sku: 'SKU-B2', cost: 10, price: 20, existingBatch: { id: 'batch-b', serverVersion: 1, stock: 1 } };
    const removed = { id: 'batch-a', serverVersion: 1 };
    mocks.prepareProduct.mockResolvedValue(apparelPreparedProduct({ updated: [updated], removed: [removed] }));
    vi.spyOn(productRepository, 'saveBatch').mockResolvedValue({ success: true, response: { product: { id: 'product-1', serverVersion: 12 } } });
    const deleteBatch = vi.spyOn(productRepository, 'deleteBatch').mockResolvedValue({ success: false, code: 'VERSION_CONFLICT' });

    const result = await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ partial: true, productRebase: { serverVersion: 12 } });
    expect(deleteBatch).toHaveBeenCalledTimes(1);
  });

  it('uses the product returned by a successful deletion before a later deletion fails', async () => {
    mocks.cloudEnabled = true;
    const removedA = { id: 'batch-a', serverVersion: 1 };
    const removedB = { id: 'batch-b', serverVersion: 1 };
    mocks.prepareProduct.mockResolvedValue(apparelPreparedProduct({ removed: [removedA, removedB] }));
    const deleteBatch = vi.spyOn(productRepository, 'deleteBatch')
      .mockResolvedValueOnce({ success: true, response: { product: { id: 'product-1', serverVersion: 12 } } })
      .mockResolvedValueOnce({ success: false, code: 'VERSION_CONFLICT' });

    const result = await productRepository.saveProduct({ name: 'Edited' }, { existingProduct: { id: 'product-1' } });

    expect(result).toMatchObject({ partial: true, productRebase: { serverVersion: 12 } });
    expect(result.appliedVariants.removed).toMatchObject([{ variant: { id: 'batch-a' } }]);
    expect(deleteBatch).toHaveBeenCalledTimes(2);
  });

  it('emits deleted, activated and deactivated operations for local mutations', async () => {
    const current = { id: 'product-1', isActive: true };
    await productRepository.deleteProduct(current);
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'deleted' }));

    await productRepository.toggleProductStatus(current, false);
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'deactivated' }));

    await productRepository.toggleProductStatus({ ...current, isActive: false }, true);
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'activated' }));
  });
});
