import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  product: null,
  batches: []
};

const clone = (value) => structuredClone(value);

const menuTable = {
  get: vi.fn(async (id) => (state.product?.id === id ? clone(state.product) : undefined)),
  put: vi.fn(async (product) => { state.product = clone(product); })
};

const batchTable = {
  get: vi.fn(async (id) => state.batches.find((batch) => batch.id === id) && clone(state.batches.find((batch) => batch.id === id))),
  put: vi.fn(async (batch) => {
    const index = state.batches.findIndex((current) => current.id === batch.id);
    if (index >= 0) state.batches[index] = clone(batch);
    else state.batches.push(clone(batch));
  }),
  where: vi.fn(() => ({
    equals: (productId) => ({
      toArray: async () => state.batches.filter((batch) => batch.productId === productId).map(clone)
    })
  }))
};

vi.mock('../dexie', () => ({
  STORES: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' },
  db: {
    table: vi.fn((store) => (store === 'menu' ? menuTable : batchTable)),
    transaction: vi.fn(async (...args) => {
      const operation = args.at(-1);
      const before = clone(state);
      try {
        return await operation();
      } catch (error) {
        state.product = before.product;
        state.batches = before.batches;
        throw error;
      }
    })
  }
}));

describe('productsRepository.saveBatchAndSyncProduct', () => {
  beforeEach(() => {
    state.product = {
      id: 'product_legacy',
      name: 'Producto legacy',
      stock: 3,
      committedStock: 1,
      price: 30,
      cost: 8,
      bulkData: null,
      conversionFactor: null,
      wholesaleTiers: null,
      batchManagement: null,
      recipe: null,
      modifiers: null,
      serverVersion: 7,
      syncStatus: 'pending',
      pendingOperationId: 'operation_1',
      lastSyncedAt: '2026-07-18T00:00:00.000Z',
      cloudUpdatedAt: '2026-07-18T00:00:00.000Z',
      metadata: { origin: 'cloud' },
      activeStockStatus: 1,
      pharmacyData: { dosage: '10mg' }
    };
    state.batches = [];
    vi.clearAllMocks();
  });

  it('recupera un padre legacy y conserva metadata/sync al guardar un lote', async () => {
    const { productsRepository } = await import('../products');

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: 'batch_1', productId: 'product_legacy', stock: 10, committedStock: 2,
      cost: 5, price: 99, isActive: true, updateGlobalPrice: false
    })).resolves.toEqual({ success: true });

    expect(state.batches).toHaveLength(1);
    expect(state.product).toMatchObject({
      stock: 10,
      committedStock: 2,
      cost: 5,
      price: 30,
      recipe: [],
      modifiers: [],
      wholesaleTiers: [],
      serverVersion: 7,
      syncStatus: 'pending',
      pendingOperationId: 'operation_1',
      metadata: { origin: 'cloud' },
      pharmacyData: { dosage: '10mg' }
    });
    expect(state.product.bulkData).toBeUndefined();
    expect(state.product.conversionFactor).toBeUndefined();
    expect(state.product.batchManagement).toBeUndefined();
  });

  it('conserva DatabaseError y hace rollback completo ante una validacion real', async () => {
    const { productsRepository } = await import('../products');
    const before = clone(state);
    state.product.name = '';

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: 'batch_invalid', productId: 'product_legacy', stock: 6, committedStock: 0,
      cost: 4, price: 10, isActive: true
    })).rejects.toMatchObject({
      name: 'DatabaseError',
      code: 'VALIDATION_ERROR',
      details: { actionable: 'CHECK_FORM' }
    });

    expect(state.batches).toEqual(before.batches);
    expect(state.product).toEqual({ ...before.product, name: '' });
  });
});
