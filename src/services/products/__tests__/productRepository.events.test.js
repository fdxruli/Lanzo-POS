// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloudEnabled: false,
  notify: vi.fn(),
  enqueue: vi.fn(),
  prepareProduct: vi.fn(),
  savePreparedProductLocal: vi.fn(),
  deleteProductLocal: vi.fn(),
  toggleProductStatusLocal: vi.fn(),
  applyCloudCatalog: vi.fn(),
  getProductById: vi.fn(),
  upsertProduct: vi.fn(),
  deleteProduct: vi.fn(),
  toggleProductStatus: vi.fn()
}));

vi.mock('../../Logger', () => ({
  default: { warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../utils', () => ({ generateID: vi.fn(() => 'generated-id') }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ licenseDetails: {}, appStatus: 'active' }) }
}));
vi.mock('../../sync/idempotency', () => ({
  generateIdempotencyKey: vi.fn(() => 'operation-id')
}));
vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: { enqueueOperation: mocks.enqueue }
}));
vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: () => 'license-key',
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
  }
}));
vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  productToCloudPayload: (value) => value
}));
vi.mock('../productCloudRepository', () => ({
  productCloudRepository: {
    upsertProduct: mocks.upsertProduct,
    deleteProduct: mocks.deleteProduct,
    toggleProductStatus: mocks.toggleProductStatus
  }
}));
vi.mock('../productLocalRepository', () => ({
  productLocalRepository: {
    prepareProduct: mocks.prepareProduct,
    savePreparedProductLocal: mocks.savePreparedProductLocal,
    deleteProductLocal: mocks.deleteProductLocal,
    toggleProductStatusLocal: mocks.toggleProductStatusLocal,
    applyCloudCatalog: mocks.applyCloudCatalog,
    getProductById: mocks.getProductById
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cloudEnabled = false;
  mocks.prepareProduct.mockResolvedValue(preparedProduct(false));
  mocks.savePreparedProductLocal.mockResolvedValue({ success: true, productId: 'product-1' });
  mocks.deleteProductLocal.mockResolvedValue({ success: true });
  mocks.toggleProductStatusLocal.mockResolvedValue({ success: true });
  mocks.applyCloudCatalog.mockResolvedValue({ products: 1, categories: 0, batches: 0 });
  mocks.upsertProduct.mockResolvedValue({ success: true, product: { id: 'product-1' } });
  vi.stubGlobal('navigator', { onLine: true });
});

describe('productRepository directed catalog events', () => {
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
