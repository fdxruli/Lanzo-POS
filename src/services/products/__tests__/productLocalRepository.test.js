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
    vi.setSystemTime(new Date(2026, 5, 24, 12));
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

  it('preserves the default supplier in the initial batch traceability', async () => {
    const { productLocalRepository } = await import('../productLocalRepository');
    const prepared = await productLocalRepository.prepareProduct({
      id: 'supplier-product', name: 'Arroz', price: 20, cost: 10, stock: 4,
      trackStock: true, expirationMode: 'NONE', supplier: 'Distribuidora Centro'
    });

    expect(prepared.batches[0].supplier).toBe('Distribuidora Centro');
  });

  it('keeps existing apparel variants out of initial batches while editing', async () => {
    const { productLocalRepository } = await import('../productLocalRepository');
    const existing = { id: 'shirt-1', name: 'Playera', createdAt: '2026-01-01T00:00:00.000Z', stock: 4 };
    const prepared = await productLocalRepository.prepareProduct({
      ...existing,
      price: 30,
      cost: 12,
      trackStock: true,
      stock: 4,
      quickVariants: [{ id: 'batch-shirt-blue-m', talla: 'M', color: 'Azul', stock: 4, cost: 12, price: 30 }]
    }, existing);

    expect(prepared.editing).toBe(true);
    expect(prepared.batches).toEqual([]);
  });

  it('changes product shelf-life defaults without recreating or overwriting existing batches', async () => {
    const { productLocalRepository } = await import('../productLocalRepository');
    const existing = {
      id: 'produce-1', name: 'Manzanas', stock: 5, price: 20, cost: 10,
      createdAt: '2026-08-01T00:00:00.000Z', expirationMode: 'STRICT',
      expiryDate: '2026-08-11T00:00:00.000Z'
    };

    const prepared = await productLocalRepository.prepareProduct({
      ...existing,
      expirationMode: 'SHELF_LIFE',
      expiryDate: null,
      shelfLifeValue: 7,
      shelfLifeUnit: 'days'
    }, existing);

    expect(prepared.product).toMatchObject({
      expirationMode: 'SHELF_LIFE',
      shelfLifeValue: 7,
      shelfLifeUnit: 'days',
      expiryDate: null
    });
    expect(prepared.batches).toEqual([]);
  });
});
