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

vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  productToCloudPayload: (value) => value
}));

vi.mock('../productCloudRepository', () => ({
  productCloudRepository: mocks.cloud
}));

vi.mock('../productLocalRepository', () => ({
  productLocalRepository: {
    listProductsPage: vi.fn(),
    listCategories: vi.fn(),
    saveCategoryLocal: mocks.saveCategoryLocal,
    deleteCategoryLocal: mocks.deleteCategoryLocal,
    getCategoryById: vi.fn(),
    prepareProduct: mocks.prepareProduct,
    savePreparedProductLocal: mocks.savePreparedProductLocal,
    deleteProductLocal: mocks.deleteProductLocal,
    getProductById: vi.fn(),
    toggleProductStatusLocal: mocks.toggleProductStatusLocal,
    markProductPending: vi.fn(),
    saveBatchLocal: mocks.saveBatchLocal,
    deleteBatchLocal: mocks.deleteBatchLocal,
    getBatchById: vi.fn(),
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
});
