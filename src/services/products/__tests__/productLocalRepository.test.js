import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/dexie', () => ({
  db: {
    isOpen: () => true,
    table: vi.fn()
  },
  STORES: {
    CATEGORIES: 'categories',
    MENU: 'menu',
    PRODUCT_BATCHES: 'productBatches',
    DELETED_CATEGORIES: 'deletedCategories',
    DELETED_MENU: 'deletedMenu'
  }
}));

vi.mock('../../database', () => ({
  createProductWithInitialInventorySafe: vi.fn(),
  loadData: vi.fn(),
  loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(),
  saveImageToDB: vi.fn(),
  softDeleteWithCascadeSafe: vi.fn(),
  updateProductSafe: vi.fn()
}));

vi.mock('../../db/general', () => ({
  categoriesRepository: {
    getActiveCategories: vi.fn()
  }
}));

vi.mock('../../utils', () => ({
  generateID: vi.fn((prefix = 'id') => `${prefix}-generated`)
}));

describe('productLocalRepository.prepareProduct', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('crea lote inicial SHELF_LIFE con expiryDate y alertTargetDate calculadas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T00:00:00.000Z'));
    const { productLocalRepository } = await import('../productLocalRepository');

    const prepared = await productLocalRepository.prepareProduct({
      id: '1782274601471',
      name: 'Volt',
      price: 20,
      cost: 10,
      stock: 2,
      trackStock: true,
      expirationMode: 'SHELF_LIFE',
      shelfLifeValue: 7,
      shelfLifeUnit: 'months',
      batchManagement: { enabled: true }
    });

    expect(prepared.batches).toHaveLength(1);
    expect(prepared.batches[0]).toMatchObject({
      id: 'batch-1782274601471-initial',
      productId: '1782274601471',
      stock: 2,
      expiryDate: '2027-01-24T00:00:00.000Z',
      alertTargetDate: '2027-01-24T00:00:00.000Z',
      alertType: 'VIDA_UTIL_ESTIMADA'
    });
  });

  it('no arrastra fechas residuales cuando expirationMode es NONE', async () => {
    const { productLocalRepository } = await import('../productLocalRepository');

    const prepared = await productLocalRepository.prepareProduct({
      id: 'none-product',
      name: 'Sin caducidad',
      price: 20,
      cost: 10,
      stock: 2,
      trackStock: true,
      expirationMode: 'NONE',
      expiryDate: '2026-07-01T00:00:00.000Z',
      alertTargetDate: '2026-07-01T00:00:00.000Z',
      batchManagement: { enabled: true }
    });

    expect(prepared.batches[0]).toMatchObject({
      expiryDate: null,
      alertTargetDate: null,
      alertType: null
    });
  });
});
