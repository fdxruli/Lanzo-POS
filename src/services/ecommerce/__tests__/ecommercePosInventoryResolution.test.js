import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activeState: null, productState: { menu: [] }, table: vi.fn() }));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({ useActiveOrders: { getState: () => mocks.activeState } }));
vi.mock('../../../store/useProductStore', () => ({ useProductStore: { getState: () => mocks.productState } }));
vi.mock('../../db/dexie', () => ({
  db: { table: mocks.table },
  STORES: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' }
}));
vi.mock('../ecommercePosDraftService', () => ({ getEcommercePosContextIdentity: () => 'context-1' }));

import {
  ECOMMERCE_INVENTORY_READ_FAILED,
  ECOMMERCE_INVENTORY_STALE_RESPONSE,
  applyEcommerceInventoryResolution,
  calculateEcommerceInventoryStatus,
  getEcommerceDraftBatchOptions,
  revalidateEcommerceDraftInventory,
  resetEcommerceInventoryResolutionAttemptsForTests,
  resolveEcommerceDraftInventory,
  resolveEcommerceDraftInventoryFromInputs,
  resolveEcommerceDraftLineInventory,
  selectEcommerceDraftBatch
} from '../ecommercePosInventoryResolution';
import { getInventoryQuantityForSale } from '../../sales/stockValidation';

const now = new Date('2026-07-11T12:00:00.000Z');
const exactProduct = (overrides = {}) => ({
  id: 'product-1', name: 'Producto exacto', isActive: true, trackStock: true,
  stock: 10, committedStock: 0, expirationMode: 'NONE',
  batchManagement: { enabled: false }, updatedAt: '2026-07-11T10:00:00.000Z', ...overrides
});
const batchProduct = (overrides = {}) => exactProduct({
  name: 'Producto por lote', stock: 0, expirationMode: 'STRICT',
  batchManagement: { enabled: true }, ...overrides
});
const line = (product, overrides = {}) => ({
  ...product,
  lineId: overrides.lineId || 'line-1',
  uniqueLineId: overrides.lineId || 'line-1',
  ecommerceOrderItemId: overrides.lineId || 'ecom-item-1',
  quantity: 2,
  needsInventoryResolution: true,
  batchId: undefined,
  ...overrides
});
const batch = (id, expiryDate, stock, overrides = {}) => ({
  id, productId: 'product-1', sku: id.toUpperCase(), expiryDate, stock,
  committedStock: 0, isActive: true, createdAt: '2026-01-01T00:00:00.000Z', ...overrides
});
const order = (items, overrides = {}) => ({
  id: 'ecom-order-1', origin: 'ecommerce', ecommerceDraftStatus: 'prepared',
  ecommerceLicenseIdentity: 'context-1', revision: 0,
  updatedAt: '2026-07-11T11:00:00.000Z', items, ...overrides
});
const activeState = (initialOrder) => {
  const state = {
    activeOrders: new Map([[initialOrder.id, initialOrder]]),
    updateOrder: vi.fn((orderId, updates) => {
      const current = state.activeOrders.get(orderId);
      if (!current) return;
      const revision = Number(current.revision || 0) + 1;
      state.activeOrders.set(orderId, {
        ...current, ...updates, revision,
        updatedAt: `2026-07-11T11:00:${String(revision).padStart(2, '0')}.000Z`
      });
    }),
    removeEcommerceDraftLocal: vi.fn((orderId) => state.activeOrders.delete(orderId))
  };
  return state;
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const deps = (state, products, extra = {}) => ({
  activeOrders: state,
  products,
  getContextIdentity: () => 'context-1',
  ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  resetEcommerceInventoryResolutionAttemptsForTests();
  mocks.productState = { menu: [] };
  mocks.activeState = activeState(order([]));
});

describe('canonical quantity shared with checkout', () => {
  it('divides by a valid conversion factor greater than one', () => {
    expect(getInventoryQuantityForSale(
      { quantity: 10 },
      exactProduct({ conversionFactor: { enabled: true, factor: 10 } })
    )).toBe(1);
  });

  it.each([null, 0, 1, 'invalid'])('keeps sale quantity for factor %s', (factor) => {
    expect(getInventoryQuantityForSale(
      { quantity: 2 },
      exactProduct({ conversionFactor: { enabled: true, factor } })
    )).toBe(2);
  });
});

describe('exact and unlimited inventory', () => {
  it('resolves unlimited inventory without querying batches', async () => {
    const product = exactProduct({ trackStock: false, stock: null });
    const queryBatchesByProduct = vi.fn();
    const result = await resolveEcommerceDraftInventory({
      order: order([line(product)]), now,
      deps: { products: [product], queryBatchesByProduct, db: null, STORES: {} }
    });
    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items[0]).toMatchObject({
      batchId: undefined,
      needsInventoryResolution: false,
      inventoryResolution: { mode: 'unlimited', status: 'resolved', batchId: null }
    });
    expect(queryBatchesByProduct).not.toHaveBeenCalled();
  });

  it('accumulates two sufficient lines and does not mutate the product', () => {
    const product = exactProduct({ stock: 10 });
    const snapshot = structuredClone(product);
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'a', quantity: 4 }), line(product, { lineId: 'b', quantity: 4 })]),
      products: [product], now
    });
    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items.map((item) => item.inventoryResolution.availableQuantitySnapshot)).toEqual([10, 6]);
    expect(product).toEqual(snapshot);
  });

  it('conflicts the later line using its real remaining availability', () => {
    const product = exactProduct({ stock: 5 });
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'a', quantity: 4 }), line(product, { lineId: 'b', quantity: 4 })]),
      products: [product], now
    });
    expect(result.ecommerceInventoryStatus).toBe('conflict');
    expect(result.items[0].inventoryResolution.status).toBe('resolved');
    expect(result.items[1].inventoryResolution).toMatchObject({
      status: 'conflict', code: 'INSUFFICIENT_STOCK', availableQuantitySnapshot: 1
    });
  });

  it('subtracts committedStock before accumulating demand', () => {
    const product = exactProduct({ stock: 10, committedStock: 4 });
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'a', quantity: 4 }), line(product, { lineId: 'b', quantity: 4 })]),
      products: [product], now
    });
    expect(result.items[0].inventoryResolution.availableQuantitySnapshot).toBe(6);
    expect(result.items[1].inventoryResolution).toMatchObject({
      code: 'INSUFFICIENT_STOCK', availableQuantitySnapshot: 2
    });
    expect(product.committedStock).toBe(4);
  });

  it.each([null, undefined, 'invalid'])('fails closed for unknown exact stock %s', (stock) => {
    const product = exactProduct({ stock });
    expect(resolveEcommerceDraftLineInventory({ item: line(product), product, now }).inventoryResolution)
      .toMatchObject({ status: 'conflict', code: 'INVENTORY_UNKNOWN' });
  });

  it('keeps recipe products fail-closed', () => {
    const product = exactProduct({ recipe: [{ ingredientId: 'ingredient-1', quantity: 1 }] });
    expect(resolveEcommerceDraftLineInventory({ item: line(product), product, now }).inventoryResolution)
      .toMatchObject({ status: 'conflict', code: 'INVENTORY_UNKNOWN' });
  });

  it.each([
    [10, 10, 2, 'resolved'],
    [20, 10, 1, 'conflict']
  ])('uses converted exact demand: sale=%s factor=%s stock=%s', (sale, factor, stock, status) => {
    const product = exactProduct({ stock, conversionFactor: { enabled: true, factor } });
    const result = resolveEcommerceDraftLineInventory({ item: line(product, { quantity: sale }), product, now });
    expect(result.inventoryResolution).toMatchObject({
      status,
      requestedSaleQuantity: sale,
      requiredInventoryQuantity: sale / factor,
      requestedQuantity: sale / factor
    });
    if (status === 'conflict') expect(result.inventoryResolution.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('batch ledger, FEFO and manual priority', () => {
  it('selects the nearest valid FEFO batch and ignores expired/exhausted batches', () => {
    const product = batchProduct();
    const batches = [
      batch('expired', '2026-07-10', 10),
      batch('empty', '2026-07-12', 0),
      batch('later', '2026-09-01', 8),
      batch('nearest', '2026-08-01', 6)
    ];
    const snapshot = structuredClone(batches);
    const result = resolveEcommerceDraftLineInventory({ item: line(product), product, batches, now });
    expect(result).toMatchObject({
      batchId: 'nearest',
      inventoryResolution: { status: 'resolved', selectionMode: 'fefo_auto', expirationDate: '2026-08-01' }
    });
    expect(batches).toEqual(snapshot);
  });

  it('does not assign one batch twice', () => {
    const product = batchProduct();
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'a', quantity: 4 }), line(product, { lineId: 'b', quantity: 4 })]),
      products: [product],
      batchesByProduct: new Map([['product-1', [batch('l1', '2026-08-01', 5)]]]), now
    });
    expect(result.ecommerceInventoryStatus).toBe('conflict');
    expect(result.items[0].batchId).toBe('l1');
    expect(result.items[1]).toMatchObject({
      batchId: undefined,
      inventoryResolution: { code: 'INSUFFICIENT_BATCH_STOCK', availableQuantitySnapshot: 1 }
    });
  });

  it('allocates two FEFO batches deterministically', () => {
    const product = batchProduct();
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'a', quantity: 4 }), line(product, { lineId: 'b', quantity: 4 })]),
      products: [product],
      batchesByProduct: new Map([['product-1', [
        batch('l2', '2026-09-01', 4), batch('l1', '2026-08-01', 4)
      ]]]), now
    });
    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items.map((item) => item.batchId)).toEqual(['l1', 'l2']);
  });

  it('consumes existing manual selections before automatic lines', () => {
    const product = batchProduct();
    const manual = line(product, {
      lineId: 'manual', quantity: 4, batchId: 'l2',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l2', selectionMode: 'manual' }
    });
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product, { lineId: 'automatic', quantity: 4 }), manual]),
      products: [product],
      batchesByProduct: new Map([['product-1', [
        batch('l1', '2026-08-01', 4), batch('l2', '2026-09-01', 4)
      ]]]), now
    });
    expect(result.items[1]).toMatchObject({ batchId: 'l2', inventoryResolution: { selectionMode: 'manual' } });
    expect(result.items[0]).toMatchObject({ batchId: 'l1', inventoryResolution: { selectionMode: 'fefo_auto' } });
  });

  it('keeps only the first incompatible manual allocation', () => {
    const product = batchProduct();
    const manual = (lineId) => line(product, {
      lineId, quantity: 4, batchId: 'l1',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l1', selectionMode: 'manual' }
    });
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([manual('a'), manual('b')]), products: [product],
      batchesByProduct: new Map([['product-1', [batch('l1', '2026-08-01', 5)]]]), now
    });
    expect(result.items[0].inventoryResolution.status).toBe('resolved');
    expect(result.items[1]).toMatchObject({
      batchId: undefined,
      inventoryResolution: { status: 'conflict', code: 'BATCH_STALE', availableQuantitySnapshot: 1 }
    });
  });

  it.each([
    [[], 'NO_VALID_BATCH'],
    [[batch('expired', '2026-07-10', 8)], 'ONLY_EXPIRED_BATCHES'],
    [[batch('one', '2026-08-01', 2), batch('two', '2026-09-01', 1)], 'INSUFFICIENT_BATCH_STOCK'],
    [[batch('one', '2026-08-01', 2), batch('two', '2026-09-01', 2)], 'MULTI_BATCH_REQUIRED']
  ])('classifies batch conflicts', (batches, code) => {
    const product = batchProduct();
    const quantity = code === 'INSUFFICIENT_BATCH_STOCK' ? 5 : 4;
    expect(resolveEcommerceDraftLineInventory({ item: line(product, { quantity }), product, batches, now }).inventoryResolution.code)
      .toBe(code);
  });

  it('uses converted inventory quantity for batches', () => {
    const product = batchProduct({ conversionFactor: { enabled: true, factor: 10 } });
    const result = resolveEcommerceDraftLineInventory({
      item: line(product, { quantity: 10 }), product,
      batches: [batch('l1', '2026-08-01', 1)], now
    });
    expect(result).toMatchObject({
      batchId: 'l1',
      inventoryResolution: { status: 'resolved', requestedSaleQuantity: 10, requiredInventoryQuantity: 1 }
    });
  });

  it('clears a stale selected batch', () => {
    const product = batchProduct();
    const item = line(product, {
      batchId: 'selected',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'selected', selectionMode: 'manual' }
    });
    const result = resolveEcommerceDraftLineInventory({
      item, product, batches: [batch('selected', '2026-09-01', 0)], now
    });
    expect(result).toMatchObject({ batchId: undefined, inventoryResolution: { code: 'BATCH_STALE' } });
  });

  it('detects inventory mode changes', () => {
    const original = exactProduct();
    const current = batchProduct();
    expect(resolveEcommerceDraftLineInventory({ item: line(original), product: current, batches: [], now }).inventoryResolution)
      .toMatchObject({ status: 'conflict', code: 'INVENTORY_MODE_CHANGED' });
  });
});

describe('manual selection service', () => {
  it('persists a valid manual batch and increments revision through updateOrder', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const result = await selectEcommerceDraftBatch({
      orderId: current.id, lineId: 'line-1', batchId: 'manual', now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('manual', '2026-09-01', 5)])
      })
    });
    expect(result.success).toBe(true);
    expect(state.activeOrders.get(current.id)).toMatchObject({ revision: 1, ecommerceInventoryStatus: 'ready' });
    expect(state.activeOrders.get(current.id).items[0]).toMatchObject({
      batchId: 'manual', inventoryResolution: { selectionMode: 'manual', status: 'resolved' }
    });
  });

  it.each([
    ['other product', batch('manual', '2026-09-01', 5, { productId: 'other' }), 'BATCH_STALE'],
    ['expired', batch('manual', '2026-07-10', 5), 'ONLY_EXPIRED_BATCHES'],
    ['insufficient', batch('manual', '2026-09-01', 1), 'INSUFFICIENT_BATCH_STOCK']
  ])('rejects a batch that is %s', async (_label, selected, code) => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const result = await selectEcommerceDraftBatch({
      orderId: current.id, lineId: 'line-1', batchId: 'manual', now,
      deps: deps(state, [product], { queryBatchesByProduct: vi.fn().mockResolvedValue([selected]) })
    });
    expect(result).toMatchObject({ success: false, changed: false, code });
    expect(state.updateOrder).not.toHaveBeenCalled();
  });

  it('subtracts prior manual allocations from batch options', async () => {
    const product = batchProduct();
    const current = order([
      line(product, {
        lineId: 'manual', quantity: 4, batchId: 'l1',
        inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l1', selectionMode: 'manual' }
      }),
      line(product, { lineId: 'target', quantity: 2 })
    ]);
    const state = activeState(current);
    const result = await getEcommerceDraftBatchOptions({
      orderId: current.id, lineId: 'target', now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('l1', '2026-08-01', 5), batch('l2', '2026-09-01', 4)
        ])
      })
    });
    expect(result.options).toEqual([
      expect.objectContaining({ batchId: 'l1', availableQuantity: 1, canCoverRequested: false }),
      expect.objectContaining({ batchId: 'l2', availableQuantity: 4, canCoverRequested: true })
    ]);
  });

  it('lists only valid options and identifies FEFO recommendation', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const result = await getEcommerceDraftBatchOptions({
      orderId: current.id, lineId: 'line-1', now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('expired', '2026-07-10', 10),
          batch('later', '2026-09-01', 5),
          batch('recommended', '2026-08-01', 4)
        ])
      })
    });
    expect(result.options.map((option) => option.batchId)).toEqual(['recommended', 'later']);
    expect(result.options[0]).toMatchObject({ isRecommended: true, canCoverRequested: true });
  });
});

describe('stale response protection', () => {
  it('rejects R1 after a newer R2 writes conflict', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const r1Read = deferred();
    const r2Read = deferred();
    const r1 = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], { queryBatchesByProduct: () => r1Read.promise })
    });
    const r2 = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], { queryBatchesByProduct: () => r2Read.promise })
    });
    r2Read.resolve([]);
    expect((await r2).success).toBe(true);
    r1Read.resolve([batch('l1', '2026-08-01', 5)]);
    expect(await r1).toMatchObject({
      success: false, stale: true, changed: false, code: ECOMMERCE_INVENTORY_STALE_RESPONSE
    });
    expect(state.activeOrders.get(current.id).ecommerceInventoryStatus).toBe('conflict');
  });

  it('does not replace a manual selection with an older automatic response', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const oldRead = deferred();
    const oldResolution = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], { queryBatchesByProduct: () => oldRead.promise })
    });
    const manual = await selectEcommerceDraftBatch({
      orderId: current.id, lineId: 'line-1', batchId: 'l2', now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('l1', '2026-08-01', 5), batch('l2', '2026-09-01', 5)
        ])
      })
    });
    expect(manual.success).toBe(true);
    oldRead.resolve([batch('l1', '2026-08-01', 5), batch('l2', '2026-09-01', 5)]);
    expect((await oldResolution).code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(state.activeOrders.get(current.id).items[0]).toMatchObject({
      batchId: 'l2', inventoryResolution: { selectionMode: 'manual' }
    });
  });

  it('does not recreate a released draft after a delayed response', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const read = deferred();
    const pending = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], { queryBatchesByProduct: () => read.promise })
    });
    state.removeEcommerceDraftLocal(current.id);
    read.resolve([batch('l1', '2026-08-01', 5)]);
    expect((await pending).code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(state.activeOrders.has(current.id)).toBe(false);
    expect(state.updateOrder).not.toHaveBeenCalled();
  });
});

describe('read failures and recovery', () => {
  it('marks a previously ready draft conflict while preserving prior manual metadata', async () => {
    const product = batchProduct();
    const readyLine = line(product, {
      batchId: 'l1', needsInventoryResolution: false,
      inventoryResolution: {
        mode: 'batch', status: 'resolved', code: null, batchId: 'l1', batchNumber: 'L1',
        selectionMode: 'manual', requestedSaleQuantity: 2, requiredInventoryQuantity: 2,
        requestedQuantity: 2, resolvedAt: '2026-07-11T10:00:00.000Z'
      }
    });
    const current = order([readyLine], {
      ecommerceInventoryStatus: 'ready', ecommerceInventoryResolvedAt: '2026-07-11T10:00:00.000Z'
    });
    const state = activeState(current);
    const result = await revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [], { loadProductsForOrder: vi.fn().mockRejectedValue(new Error('Dexie unavailable')) })
    });
    expect(result).toMatchObject({ success: false, changed: true, code: ECOMMERCE_INVENTORY_READ_FAILED });
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'conflict', ecommerceInventoryResolvedAt: null,
      ecommerceInventoryError: { code: 'INVENTORY_READ_FAILED' }
    });
    expect(state.activeOrders.get(current.id).items[0]).toMatchObject({
      batchId: 'l1', inventoryResolution: { status: 'conflict', code: 'INVENTORY_READ_FAILED', resolvedAt: null }
    });
  });

  it('ignores an old read failure after a newer successful ready result', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const oldRead = deferred();
    const r1 = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], { queryBatchesByProduct: () => oldRead.promise })
    });
    const r2 = revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('l1', '2026-08-01', 5)])
      })
    });
    expect((await r2).success).toBe(true);
    oldRead.reject(new Error('late failure'));
    expect((await r1).code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready', ecommerceInventoryError: null
    });
  });

  it('recovers from conflict to ready on a later successful revalidation', async () => {
    const product = exactProduct({ stock: 5 });
    const current = order([line(product)]);
    const state = activeState(current);
    const failed = await revalidateEcommerceDraftInventory({
      orderId: current.id, now,
      deps: deps(state, [], { loadProductsForOrder: vi.fn().mockRejectedValue(new Error('offline')) })
    });
    expect(failed.code).toBe(ECOMMERCE_INVENTORY_READ_FAILED);
    const recovered = await revalidateEcommerceDraftInventory({
      orderId: current.id, now: new Date('2026-07-11T12:01:00.000Z'), deps: deps(state, [product])
    });
    expect(recovered.success).toBe(true);
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready', ecommerceInventoryError: null
    });
  });
});

describe('manual batch option read safety', () => {
  const readyBatchLine = (product) => line(product, {
    batchId: 'l1',
    needsInventoryResolution: false,
    inventoryResolution: {
      mode: 'batch',
      status: 'resolved',
      code: null,
      batchId: 'l1',
      batchNumber: 'L1',
      selectionMode: 'manual',
      requestedSaleQuantity: 2,
      requiredInventoryQuantity: 2,
      requestedQuantity: 2,
      resolvedAt: '2026-07-11T10:00:00.000Z'
    }
  });

  it('fails closed when product loading rejects while opening batch options', async () => {
    const product = batchProduct();
    const current = order([readyBatchLine(product)], {
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryResolvedAt: '2026-07-11T10:00:00.000Z'
    });
    const state = activeState(current);

    const result = await getEcommerceDraftBatchOptions({
      orderId: current.id,
      lineId: 'line-1',
      now,
      deps: deps(state, [], {
        loadProductsForOrder: vi.fn().mockRejectedValue(new Error('Dexie product read failed'))
      })
    });

    expect(result).toMatchObject({
      success: false,
      changed: true,
      code: ECOMMERCE_INVENTORY_READ_FAILED,
      options: []
    });
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'conflict',
      ecommerceInventoryResolvedAt: null,
      ecommerceInventoryError: { code: 'INVENTORY_READ_FAILED' }
    });
    expect(state.activeOrders.get(current.id).items[0]).toMatchObject({
      batchId: 'l1',
      needsInventoryResolution: true,
      inventoryResolution: {
        status: 'conflict',
        code: 'INVENTORY_READ_FAILED',
        resolvedAt: null
      }
    });
  });

  it('fails closed when batch loading rejects while opening batch options', async () => {
    const product = batchProduct();
    const current = order([readyBatchLine(product)], {
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryResolvedAt: '2026-07-11T10:00:00.000Z'
    });
    const state = activeState(current);

    const result = await getEcommerceDraftBatchOptions({
      orderId: current.id,
      lineId: 'line-1',
      now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockRejectedValue(new Error('Dexie batch read failed'))
      })
    });

    expect(result).toMatchObject({
      success: false,
      changed: true,
      code: ECOMMERCE_INVENTORY_READ_FAILED,
      options: []
    });
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'conflict',
      ecommerceInventoryResolvedAt: null,
      ecommerceInventoryError: { code: 'INVENTORY_READ_FAILED' }
    });
  });

  it('discards a late option read failure after a newer revalidation leaves the draft ready', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const oldRead = deferred();
    const r1 = getEcommerceDraftBatchOptions({
      orderId: current.id,
      lineId: 'line-1',
      now,
      deps: deps(state, [product], { queryBatchesByProduct: () => oldRead.promise })
    });

    const r2 = revalidateEcommerceDraftInventory({
      orderId: current.id,
      now,
      deps: deps(state, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('l1', '2026-08-01', 5)])
      })
    });
    expect((await r2).success).toBe(true);

    oldRead.reject(new Error('late option failure'));
    expect(await r1).toMatchObject({
      success: false,
      stale: true,
      changed: false,
      code: ECOMMERCE_INVENTORY_STALE_RESPONSE,
      options: []
    });
    expect(state.activeOrders.get(current.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryError: null
    });
    expect(state.updateOrder).toHaveBeenCalledTimes(1);
  });

  it('does not recreate or update a draft released during the option read', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const read = deferred();
    const pending = getEcommerceDraftBatchOptions({
      orderId: current.id,
      lineId: 'line-1',
      now,
      deps: deps(state, [product], { queryBatchesByProduct: () => read.promise })
    });

    state.removeEcommerceDraftLocal(current.id);
    read.reject(new Error('released while reading'));

    expect(await pending).toMatchObject({
      success: false,
      stale: true,
      changed: false,
      code: ECOMMERCE_INVENTORY_STALE_RESPONSE,
      options: []
    });
    expect(state.activeOrders.has(current.id)).toBe(false);
    expect(state.updateOrder).not.toHaveBeenCalled();
  });

  it('discards options when the target line changes during the read', async () => {
    const product = batchProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const read = deferred();
    const pending = getEcommerceDraftBatchOptions({
      orderId: current.id,
      lineId: 'line-1',
      now,
      deps: deps(state, [product], { queryBatchesByProduct: () => read.promise })
    });

    state.activeOrders.set(current.id, {
      ...current,
      revision: 1,
      updatedAt: '2026-07-11T11:00:01.000Z',
      items: current.items.map((item) => ({ ...item, quantity: 3, batchId: 'new-batch' }))
    });
    read.resolve([batch('l1', '2026-08-01', 5)]);

    expect(await pending).toMatchObject({
      success: false,
      stale: true,
      changed: false,
      code: ECOMMERCE_INVENTORY_STALE_RESPONSE,
      options: []
    });
    expect(state.updateOrder).not.toHaveBeenCalled();
  });
});

describe('global status, persistence and no effects', () => {
  it('uses conflict over pending over ready priority', () => {
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'resolved' } }, { inventoryResolution: { status: 'pending' } }
    ])).toBe('pending');
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'pending' } }, { inventoryResolution: { status: 'conflict' } }
    ])).toBe('conflict');
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'resolved' } }
    ])).toBe('ready');
  });

  it('persists compact resolution and deletion removes the whole draft', () => {
    const product = exactProduct();
    const current = order([line(product)]);
    const state = activeState(current);
    const resolution = resolveEcommerceDraftInventoryFromInputs({ order: current, products: [product], now });
    expect(applyEcommerceInventoryResolution({
      orderId: current.id, resolution, deps: deps(state, [product])
    })).toMatchObject({ success: true, changed: true });
    expect(state.activeOrders.get(current.id).ecommerceInventoryResolutionVersion).toBe(2);
    state.removeEcommerceDraftLocal(current.id);
    expect(state.activeOrders.has(current.id)).toBe(false);
  });

  it('does not rewrite an unchanged resolution', () => {
    const product = exactProduct();
    const initial = order([line(product)]);
    const first = resolveEcommerceDraftInventoryFromInputs({ order: initial, products: [product], now });
    const resolved = { ...initial, ...first };
    const state = activeState(resolved);
    const second = resolveEcommerceDraftInventoryFromInputs({ order: resolved, products: [product], now });
    expect(applyEcommerceInventoryResolution({
      orderId: resolved.id, resolution: second, deps: deps(state, [product])
    })).toMatchObject({ success: true, changed: false });
    expect(state.updateOrder).not.toHaveBeenCalled();
  });

  it('does not mutate product, batch, committed stock, sale, caja or movement state', () => {
    const product = batchProduct();
    const batches = [batch('l1', '2026-08-01', 5, { committedStock: 1 })];
    const productSnapshot = structuredClone(product);
    const batchSnapshot = structuredClone(batches);
    const result = resolveEcommerceDraftInventoryFromInputs({
      order: order([line(product)]), products: [product],
      batchesByProduct: new Map([['product-1', batches]]), now
    });
    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(product).toEqual(productSnapshot);
    expect(batches).toEqual(batchSnapshot);
    expect(batches[0].committedStock).toBe(1);
    expect(result).not.toHaveProperty('processSale');
    expect(result).not.toHaveProperty('caja');
    expect(result).not.toHaveProperty('inventoryMovement');
    expect(JSON.stringify(result)).not.toContain('customerPhone');
  });
});
