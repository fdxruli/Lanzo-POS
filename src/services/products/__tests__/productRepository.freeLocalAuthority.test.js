// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class TestActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }

  return {
    TestActorRuntimeError,
    state: null,
    tenant: null,
    actorCapture: vi.fn(),
    enqueue: vi.fn(),
    notify: vi.fn(),
    prepareProduct: vi.fn(),
    getProductById: vi.fn(),
    getCategoryProductCounts: vi.fn(),
    syncMetaGetMeta: vi.fn(),
    getBatchesByProductId: vi.fn(),
    saveCategoryLocal: vi.fn(),
    deleteCategoryLocal: vi.fn(),
    savePreparedProductLocal: vi.fn(),
    deleteProductLocal: vi.fn(),
    toggleProductStatusLocal: vi.fn(),
    saveBatchLocal: vi.fn(),
    deleteBatchLocal: vi.fn(),
    cloud: {
      upsertCategory: vi.fn(),
      deleteCategory: vi.fn(),
      upsertProduct: vi.fn(),
      deleteProduct: vi.fn(),
      toggleProductStatus: vi.fn(),
      upsertProductBatch: vi.fn(),
      deleteProductBatch: vi.fn()
    }
  };
});

vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE'
  },
  ActorRuntimeError: mocks.TestActorRuntimeError,
  actorRuntimeController: {
    capture: mocks.actorCapture,
    assertGranted: vi.fn(() => { throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED'); })
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => mocks.state }
}));

vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: mocks.tenant })
}));

vi.mock('../../Logger', () => ({
  default: { warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../utils', () => ({ generateID: vi.fn((prefix) => `${prefix}-generated`) }));

vi.mock('../../sync/idempotency', () => ({
  generateIdempotencyKey: vi.fn(() => 'free-local-idempotency')
}));

vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: { enqueueOperation: mocks.enqueue }
}));

vi.mock('../../sync/syncMetaService', () => ({
  syncMetaService: { getMeta: mocks.syncMetaGetMeta }
}));

vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  productToCloudPayload: (value) => value,
  normalizeSkuKey: (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}));

vi.mock('../productCloudRepository', () => ({
  productCloudRepository: mocks.cloud
}));

vi.mock('../productLocalRepository', () => ({
  productLocalRepository: {
    listProductsPage: vi.fn(),
    listCategories: vi.fn(),
    getCategoryProductCounts: mocks.getCategoryProductCounts,
    saveCategoryLocal: mocks.saveCategoryLocal,
    deleteCategoryLocal: mocks.deleteCategoryLocal,
    getCategoryById: vi.fn(),
    prepareProduct: mocks.prepareProduct,
    savePreparedProductLocal: mocks.savePreparedProductLocal,
    deleteProductLocal: mocks.deleteProductLocal,
    getProductById: mocks.getProductById,
    toggleProductStatusLocal: mocks.toggleProductStatusLocal,
    markProductPending: vi.fn(),
    saveBatchLocal: mocks.saveBatchLocal,
    deleteBatchLocal: mocks.deleteBatchLocal,
    getBatchById: vi.fn(),
    getBatchesByProductId: mocks.getBatchesByProductId,
    applyCloudCatalog: vi.fn()
  }
}));

vi.mock('../productConflictService', () => ({
  productConflictService: {
    isConflictResponse: () => false,
    normalizeFailure: (value) => value,
    saveConflict: vi.fn()
  }
}));

vi.mock('../productMigrationService', () => ({
  productMigrationService: { pullFullSnapshot: vi.fn() }
}));

vi.mock('../productSyncHandler', () => ({ pullCatalogChanges: vi.fn() }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: mocks.notify }));

import { productRepository } from '../productRepository';

const freeLicense = () => ({
  license_key: 'LANZO-FREE-REPOSITORY',
  valid: true,
  plan_code: 'free_trial',
  max_devices: 1,
  device_role: 'admin',
  features: {
    cloud_pos_sync: false,
    cloud_products_sync: false,
    staff_roles: false
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant = {
    opaqueId: 'tenant-free-repository',
    databaseName: 'LanzoDB_tenant-free-repository',
    generation: 4
  };
  mocks.state = {
    appStatus: 'ready',
    licenseDetails: freeLicense(),
    currentDeviceRole: 'admin',
    currentAdminUser: null,
    currentStaffUser: null
  };
  mocks.actorCapture.mockImplementation(() => {
    throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED');
  });
  mocks.saveCategoryLocal.mockResolvedValue({ success: true });
  mocks.getCategoryProductCounts.mockResolvedValue({ 'cat-free': 2 });
  mocks.syncMetaGetMeta.mockResolvedValue(null);
  mocks.getBatchesByProductId.mockResolvedValue([]);
  mocks.deleteCategoryLocal.mockResolvedValue({ success: true });
  mocks.savePreparedProductLocal.mockResolvedValue({ success: true, productId: 'product-free' });
  mocks.deleteProductLocal.mockResolvedValue({ success: true });
  mocks.toggleProductStatusLocal.mockResolvedValue({ success: true });
  mocks.saveBatchLocal.mockResolvedValue({ success: true });
  mocks.deleteBatchLocal.mockResolvedValue({ success: true });
  mocks.prepareProduct.mockResolvedValue({
    productId: 'product-free',
    product: {
      id: 'product-free',
      name: 'Alitas',
      stock: 8,
      committedStock: 0,
      expirationMode: 'STRICT',
      trackStock: true
    },
    batches: [{
      id: 'batch-free',
      productId: 'product-free',
      stock: 8,
      manufacturerBatchId: 'FAB-001',
      expiryDate: '2026-12-31'
    }],
    editing: false,
    inventoryValue: 80,
    apparelVariantDelta: null
  });
});

describe('productRepository FREE/local authority', () => {
  it('exposes getProductById through the public repository contract', async () => {
    const product = { id: 'product-from-active-catalog' };
    mocks.getProductById.mockResolvedValue(product);

    expect(typeof productRepository.getProductById).toBe('function');
    await expect(productRepository.getProductById(product.id)).resolves.toBe(product);
    expect(mocks.getProductById).toHaveBeenCalledWith(product.id);
  });

  it('returns local category counts for FREE without requiring a Cloud snapshot marker', async () => {
    await expect(productRepository.getCategoryProductCounts(['cat-free'])).resolves.toEqual({
      source: 'local',
      complete: true,
      counts: { 'cat-free': 2 }
    });

    expect(mocks.syncMetaGetMeta).not.toHaveBeenCalled();
    expect(mocks.getCategoryProductCounts).toHaveBeenCalledWith(['cat-free']);
  });

  it.each([null, '2026-01-01T00:00:00Z', '2026-11-13T00:00:00Z'])(
    'keeps PRO counts local regardless of historical snapshot %s', async (snapshot) => {
      mocks.state.licenseDetails = {
        license_key: 'LANZO-PRO-REPOSITORY',
        features: { cloud_pos_sync: true, cloud_products_sync: true }
      };
      mocks.syncMetaGetMeta.mockResolvedValue(snapshot);
      mocks.getCategoryProductCounts.mockResolvedValue({ 'cat-pro': 0 });
      await expect(productRepository.getCategoryProductCounts(['cat-pro'])).resolves.toEqual({
        source: 'local', complete: false, counts: { 'cat-pro': 0 }
      });
      expect(mocks.syncMetaGetMeta).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])('keeps PRO pending local associations explicitly local (online=%s)', async (online) => {
    vi.stubGlobal('navigator', { onLine: online });
    mocks.state.licenseDetails = {
      license_key: 'LANZO-PRO-REPOSITORY',
      features: { cloud_pos_sync: true, cloud_products_sync: true }
    };
    mocks.getCategoryProductCounts.mockResolvedValue({ 'cat-pro': 4 });
    try {
      await expect(productRepository.getCategoryProductCounts(['cat-pro'])).resolves.toEqual({
        source: 'local', complete: false, counts: { 'cat-pro': 4 }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps category CRUD local with ActorRuntime LOCKED and never enqueues cloud work', async () => {
    await expect(productRepository.saveCategory({ name: 'Salsas' })).resolves.toMatchObject({ success: true });
    await expect(productRepository.deleteCategory('cat-free')).resolves.toMatchObject({ success: true });

    expect(mocks.saveCategoryLocal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCategoryLocal).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.upsertCategory).not.toHaveBeenCalled();
    expect(mocks.cloud.deleteCategory).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.actorCapture).not.toHaveBeenCalled();
  });

  it('creates a FREE product with stock, STRICT expiry and manufacturer batch only in the local repository', async () => {
    await expect(productRepository.saveProduct({ name: 'Alitas' })).resolves.toMatchObject({
      success: true,
      productId: 'product-free'
    });

    expect(mocks.savePreparedProductLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({ expirationMode: 'STRICT', stock: 8 }),
        batches: [expect.objectContaining({
          manufacturerBatchId: 'FAB-001',
          expiryDate: '2026-12-31'
        })]
      }),
      { syncStatus: 'local' }
    );
    expect(mocks.cloud.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.actorCapture).not.toHaveBeenCalled();
  });

  it('preserves a selected category in FREE without reading or writing Cloud', async () => {
    mocks.prepareProduct.mockResolvedValueOnce({
      productId: 'product-free',
      product: { id: 'product-free', name: 'Alitas', categoryId: 'category-free' },
      batches: [], editing: false, inventoryValue: 0
    });

    await expect(productRepository.saveProduct({ name: 'Alitas', categoryId: 'category-free' }))
      .resolves.toMatchObject({ success: true });

    expect(mocks.savePreparedProductLocal).toHaveBeenCalledWith(
      expect.objectContaining({ product: expect.objectContaining({ categoryId: 'category-free' }) }),
      { syncStatus: 'local' }
    );
    expect(mocks.cloud.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('keeps product status/delete and batch CRUD local without cloud RPC or actor-bound outbox', async () => {
    const product = { id: 'product-free', isActive: true, stock: 8 };
    const batch = { id: 'batch-free', productId: 'product-free', stock: 8 };

    await expect(productRepository.toggleProductStatus(product, false)).resolves.toMatchObject({ success: true });
    await expect(productRepository.saveBatch(batch)).resolves.toMatchObject({ success: true });
    await expect(productRepository.deleteBatch(batch)).resolves.toMatchObject({ success: true });
    await expect(productRepository.deleteProduct(product)).resolves.toMatchObject({ success: true });

    expect(mocks.toggleProductStatusLocal).toHaveBeenCalledTimes(1);
    expect(mocks.saveBatchLocal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBatchLocal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProductLocal).toHaveBeenCalledTimes(1);
    expect(mocks.cloud.toggleProductStatus).not.toHaveBeenCalled();
    expect(mocks.cloud.upsertProductBatch).not.toHaveBeenCalled();
    expect(mocks.cloud.deleteProductBatch).not.toHaveBeenCalled();
    expect(mocks.cloud.deleteProduct).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.actorCapture).not.toHaveBeenCalled();
  });

  it('rejects a duplicate pharmacy manufacturer batch locally with a useful message', async () => {
    const pharmacyProduct = {
      id: 'medicine-vi', metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    };
    mocks.getProductById.mockResolvedValue(pharmacyProduct);
    mocks.getBatchesByProductId.mockResolvedValue([{
      id: 'batch-existing', productId: pharmacyProduct.id, manufacturerBatchId: 'VI-LOT-001', stock: 0
    }]);

    await expect(productRepository.saveBatch({
      id: 'batch-duplicate', productId: pharmacyProduct.id, manufacturerBatchId: ' vi-lot-001 ', stock: 0
    })).resolves.toMatchObject({
      success: false, code: 'PHARMACY_EXISTING_BATCH_REQUIRED',
      message: 'Ya existe un lote con este código de fabricante. Consulta Lotes / historial y selecciona el lote existente.'
    });
    expect(mocks.saveBatchLocal).not.toHaveBeenCalled();
    expect(mocks.cloud.upsertProductBatch).not.toHaveBeenCalled();
  });

  it('keeps an unarchived empty pharmacy identity editable and distinct from an archived lot', async () => {
    const pharmacyProduct = {
      id: 'medicine-vi', metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    };
    const emptyBatch = {
      id: 'batch-empty', productId: pharmacyProduct.id, manufacturerBatchId: 'VI-EMPTY-001',
      stock: 0, isActive: false, status: 'inactive'
    };
    mocks.getProductById.mockResolvedValue(pharmacyProduct);

    await expect(productRepository.saveBatch({
      ...emptyBatch, supplier: 'Proveedor registrado', notes: 'Identidad histórica'
    }, { existingBatch: emptyBatch })).resolves.toMatchObject({ success: true });
    expect(mocks.saveBatchLocal).toHaveBeenCalledOnce();
    expect(mocks.saveBatchLocal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'batch-empty', stock: 0, isActive: false, manufacturerBatchId: 'VI-EMPTY-001'
    }), expect.any(Object));
  });

  it.each([
    ['archived batch reactivation', {
      original: { id: 'batch-old', productId: 'medicine-vi', manufacturerBatchId: 'VI-LOT-001',
        stock: 0, isActive: false, status: 'archived' },
      update: { isActive: true, status: 'active' }, code: 'PHARMACY_ARCHIVED_BATCH_EXISTS'
    }],
    ['manufacturer identity change', {
      original: { id: 'batch-old', productId: 'medicine-vi', manufacturerBatchId: 'VI-LOT-001', stock: 0 },
      update: { manufacturerBatchId: 'VI-LOT-002' }, code: 'PHARMACY_BATCH_IDENTITY_IMMUTABLE'
    }]
  ])('preserves pharmacy lot identity protections for %s', async (_label, scenario) => {
    mocks.getProductById.mockResolvedValue({
      id: 'medicine-vi', metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    });

    await expect(productRepository.saveBatch({
      id: scenario.original.id, productId: 'medicine-vi', ...scenario.original, ...scenario.update
    }, { existingBatch: scenario.original })).resolves.toMatchObject({ success: false, code: scenario.code });
    expect(mocks.saveBatchLocal).not.toHaveBeenCalled();
    expect(mocks.cloud.upsertProductBatch).not.toHaveBeenCalled();
  });

  it('translates an authoritative Cloud duplicate batch rejection into a useful message', async () => {
    mocks.state.licenseDetails = {
      license_key: 'LANZO-PRO-REPOSITORY', plan_code: 'pro',
      features: { cloud_pos_sync: true, cloud_products_sync: true }
    };
    mocks.actorCapture.mockReturnValue({ actorType: 'admin', actorId: 'admin', actorKey: 'admin:admin', generation: 1,
      assertCurrent: vi.fn() });
    mocks.cloud.upsertProductBatch.mockResolvedValueOnce({
      success: false, code: 'PHARMACY_EXISTING_BATCH_REQUIRED', message: 'PHARMACY_EXISTING_BATCH_REQUIRED'
    });
    mocks.getProductById.mockResolvedValue({
      id: 'medicine-vi', metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    });

    await expect(productRepository.saveBatch({
      id: 'batch-cloud-duplicate', productId: 'medicine-vi', manufacturerBatchId: 'VI-LOT-001', stock: 0
    })).resolves.toMatchObject({
      success: false, code: 'PHARMACY_EXISTING_BATCH_REQUIRED',
      message: 'Ya existe un lote con este código de fabricante. Consulta Lotes / historial y selecciona el lote existente.'
    });
    expect(mocks.cloud.upsertProductBatch).toHaveBeenCalledOnce();
  });

  it('translates a raised PostgreSQL pharmacy identity exception into a useful message', async () => {
    mocks.state.licenseDetails = {
      license_key: 'LANZO-PRO-REPOSITORY', plan_code: 'pro',
      features: { cloud_pos_sync: true, cloud_products_sync: true }
    };
    mocks.actorCapture.mockReturnValue({ actorType: 'admin', actorId: 'admin', actorKey: 'admin:admin', generation: 1,
      assertCurrent: vi.fn() });
    mocks.cloud.upsertProductBatch.mockRejectedValueOnce({
      code: 'P0001', message: 'PHARMACY_EXISTING_BATCH_REQUIRED'
    });
    mocks.getProductById.mockResolvedValue({
      id: 'medicine-vi', metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    });

    await expect(productRepository.saveBatch({
      id: 'batch-cloud-duplicate', productId: 'medicine-vi', manufacturerBatchId: 'VI-LOT-001', stock: 0
    })).resolves.toMatchObject({
      success: false, code: 'PHARMACY_EXISTING_BATCH_REQUIRED',
      message: 'Ya existe un lote con este código de fabricante. Consulta Lotes / historial y selecciona el lote existente.'
    });
  });
});
