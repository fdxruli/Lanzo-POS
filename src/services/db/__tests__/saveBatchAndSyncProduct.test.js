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

const dbMock = {
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
};

vi.mock('../dexie', () => ({
  STORES: {
    MENU: 'menu', PRODUCT_BATCHES: 'product_batches',
    INVENTORY_EVENTS: 'inventory_events', INVENTORY_MOVEMENTS: 'inventory_movements'
  },
  db: dbMock
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

  it('registra un lote general vacío sin aumentar el stock ni escribir movimientos', async () => {
    const { productsRepository } = await import('../products');
    const { db, STORES } = await import('../dexie');
    state.product = { ...state.product, stock: 0, committedStock: 0 };
    db.table.mockClear();

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: 'batch-empty-identity', productId: 'product_legacy', stock: 0, committedStock: 0,
      trackStock: false, isActive: false, manufacturerBatchId: 'LOT-EMPTY-QA', supplier: null
    })).resolves.toEqual({ success: true });

    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({ stock: 0, trackStock: false, isActive: false });
    expect(state.product.stock).toBe(0);
    expect(db.table).not.toHaveBeenCalledWith(STORES.INVENTORY_EVENTS);
    expect(db.table).not.toHaveBeenCalledWith(STORES.INVENTORY_MOVEMENTS);
  });

  it('permite una identidad medicinal en cero, pero no la convierte en una recepción', async () => {
    const { productsRepository } = await import('../products');
    const { db, STORES } = await import('../dexie');
    state.product.stock = 0;
    state.product.metadata.pharmacy = { kind: 'medicine', fraction: 'VI', status: 'confirmed' };

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: 'medicine-empty-identity', productId: 'product_legacy', stock: 0, committedStock: 0,
      trackStock: false, isActive: false, manufacturerBatchId: 'MED-EMPTY-001',
      expiryDate: '2027-10-31', supplier: null
    })).resolves.toEqual({ success: true });

    expect(state.batches[0]).toMatchObject({ stock: 0, isActive: false, manufacturerBatchId: 'MED-EMPTY-001' });
    expect(state.product.stock).toBe(0);
    expect(db.table).not.toHaveBeenCalledWith(STORES.INVENTORY_EVENTS);
    expect(db.table).not.toHaveBeenCalledWith(STORES.INVENTORY_MOVEMENTS);
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

  it('rejects duplicate pharmacy manufacturer identities atomically in Free/Local', async () => {
    const { productsRepository } = await import('../products');
    state.product.metadata.pharmacy = { kind: 'medicine', fraction: 'VI', status: 'confirmed' };
    state.batches = [{ id: 'lot-a', productId: 'product_legacy', manufacturerBatchId: 'VI-LOT-A', stock: 0,
      isActive: false, status: 'inactive' }];

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: 'lot-b', productId: 'product_legacy', manufacturerBatchId: ' vi-lot-a ', stock: 0,
      isActive: true, status: 'active'
    })).rejects.toMatchObject({ code: 'PHARMACY_EXISTING_BATCH_REQUIRED' });
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].manufacturerBatchId).toBe('VI-LOT-A');
  });

  it.each([
    ['archived lot reactivation', {
      stored: { id: 'lot-a', productId: 'product_legacy', manufacturerBatchId: 'VI-LOT-A', stock: 0,
        isActive: false, status: 'archived', deletedAt: '2026-11-18T00:00:00.000Z' },
      update: { isActive: true, status: 'active', deletedAt: null }, code: 'PHARMACY_ARCHIVED_BATCH_EXISTS'
    }],
    ['manufacturer identity mutation', {
      stored: { id: 'lot-a', productId: 'product_legacy', manufacturerBatchId: 'VI-LOT-A', stock: 0,
        isActive: true, status: 'active' },
      update: { manufacturerBatchId: 'VI-LOT-B' }, code: 'PHARMACY_BATCH_IDENTITY_IMMUTABLE'
    }],
    ['undocumented stock increase', {
      stored: null,
      update: { id: 'lot-a', manufacturerBatchId: 'VI-LOT-A', stock: 1, isActive: true, status: 'active' },
      code: 'PHARMACY_BATCH_STOCK_INCREASE_REQUIRES_DOCUMENTED_RECEIPT'
    }]
  ])('protects pharmacy batch invariants for %s', async (_label, scenario) => {
    const { productsRepository } = await import('../products');
    state.product.metadata.pharmacy = { kind: 'medicine', fraction: 'VI', status: 'confirmed' };
    state.batches = scenario.stored ? [scenario.stored] : [];

    await expect(productsRepository.saveBatchAndSyncProduct({
      id: scenario.stored?.id || 'lot-a', productId: 'product_legacy', stock: 0,
      ...scenario.stored, ...scenario.update
    })).rejects.toMatchObject({ code: scenario.code });
    expect(state.batches).toEqual(scenario.stored ? [scenario.stored] : []);
  });
});
