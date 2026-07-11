import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  productState: { menu: [] },
  table: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => mocks.activeState }
}));

vi.mock('../../../store/useProductStore', () => ({
  useProductStore: { getState: () => mocks.productState }
}));

vi.mock('../../db/dexie', () => ({
  db: { table: mocks.table },
  STORES: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches' }
}));

vi.mock('../ecommercePosDraftService', () => ({
  getEcommercePosContextIdentity: () => 'context-1'
}));

import {
  ECOMMERCE_INVENTORY_READ_FAILED,
  ECOMMERCE_INVENTORY_STALE_RESPONSE,
  applyEcommerceInventoryResolution,
  calculateEcommerceInventoryStatus,
  getEcommerceDraftBatchOptions,
  getEcommerceInventoryLineMessage,
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
  id: 'product-1',
  name: 'Producto exacto',
  isActive: true,
  trackStock: true,
  stock: 10,
  committedStock: 0,
  expirationMode: 'NONE',
  batchManagement: { enabled: false },
  updatedAt: '2026-07-11T10:00:00.000Z',
  ...overrides
});

const batchProduct = (overrides = {}) => exactProduct({
  name: 'Producto por lote',
  stock: 0,
  committedStock: 0,
  expirationMode: 'STRICT',
  batchManagement: { enabled: true },
  ...overrides
});

const lineFromProduct = (product, overrides = {}) => ({
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
  id,
  productId: 'product-1',
  sku: id.toUpperCase(),
  expiryDate,
  stock,
  committedStock: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides
});

const orderFrom = (items, overrides = {}) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceDraftStatus: 'prepared',
  ecommerceLicenseIdentity: 'context-1',
  revision: 0,
  updatedAt: '2026-07-11T11:00:00.000Z',
  items,
  ...overrides
});

const createActiveState = (order) => {
  const state = {
    activeOrders: new Map([[order.id, order]]),
    updateOrder: vi.fn((orderId, updates) => {
      const current = state.activeOrders.get(orderId);
      if (!current) return;
      const revision = Number(current.revision || 0) + 1;
      state.activeOrders.set(orderId, {
        ...current,
        ...updates,
        revision,
        updatedAt: `2026-07-11T11:00:${String(revision).padStart(2, '0')}.000Z`
      });
    }),
    removeEcommerceDraftLocal: vi.fn((orderId) => {
      state.activeOrders.delete(orderId);
      return { success: true };
    })
  };
  return state;
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const depsFor = (activeOrders, products, extra = {}) => ({
  activeOrders,
  products,
  getContextIdentity: () => 'context-1',
  ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  resetEcommerceInventoryResolutionAttemptsForTests();
  mocks.productState = { menu: [] };
  mocks.activeState = createActiveState(orderFrom([]));
});

describe('canonical inventory quantity', () => {
  it('uses the same valid conversion semantics as checkout', () => {
    const product = exactProduct({ conversionFactor: { enabled: true, factor: 10 } });
    expect(getInventoryQuantityForSale({ quantity: 10 }, product)).toBe(1);
  });

  it.each([null, 0, 1, 'invalid'])('keeps sale quantity for invalid or neutral factor %s', (factor) => {
    const product = exactProduct({ conversionFactor: { enabled: true, factor } });
    expect(getInventoryQuantityForSale({ quantity: 2 }, product)).toBe(2);
  });
});

describe('pure inventory resolution', () => {
  it('resolves unlimited inventory automatically without assigning or querying a batch', async () => {
    const product = exactProduct({ trackStock: false, stock: null });
    const item = lineFromProduct(product);
    const queryBatchesByProduct = vi.fn();

    const result = await resolveEcommerceDraftInventory({
      order: orderFrom([item]),
      now,
      deps: { products: [product], queryBatchesByProduct, db: null, STORES: {} }
    });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items[0]).toMatchObject({
      needsInventoryResolution: false,
      inventoryResolution: {
        mode: 'unlimited',
        status: 'resolved',
        code: null,
        requestedSaleQuantity: 2,
        requiredInventoryQuantity: 2,
        batchId: null
      }
    });
    expect(result.items[0].batchId).toBeUndefined();
    expect(queryBatchesByProduct).not.toHaveBeenCalled();
  });

  it('accumulates sufficient exact-stock demand across duplicate product lines', () => {
    const product = exactProduct({ stock: 10 });
    const original = structuredClone(product);
    const order = orderFrom([
      lineFromProduct(product, { lineId: 'line-a', quantity: 4 }),
      lineFromProduct(product, { lineId: 'line-b', quantity: 4 })
    ]);

    const result = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items.map((item) => item.inventoryResolution.status)).toEqual(['resolved', 'resolved']);
    expect(result.items[0].inventoryResolution.availableQuantitySnapshot).toBe(10);
    expect(result.items[1].inventoryResolution.availableQuantitySnapshot).toBe(6);
    expect(product).toEqual(original);
  });

  it('fails the later exact-stock line with the real remaining availability', () => {
    const product = exactProduct({ stock: 5 });
    const order = orderFrom([
      lineFromProduct(product, { lineId: 'line-a', quantity: 4 }),
      lineFromProduct(product, { lineId: 'line-b', quantity: 4 })
    ]);

    const result = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });

    expect(result.ecommerceInventoryStatus).toBe('conflict');
    expect(result.items[0].inventoryResolution.status).toBe('resolved');
    expect(result.items[1].inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'INSUFFICIENT_STOCK',
      availableQuantitySnapshot: 1,
      requiredInventoryQuantity: 4
    });
  });

  it('respects committedStock before accumulating exact demand', () => {
    const product = exactProduct({ stock: 10, committedStock: 4 });
    const order = orderFrom([
      lineFromProduct(product, { lineId: 'line-a', quantity: 4 }),
      lineFromProduct(product, { lineId: 'line-b', quantity: 4 })
    ]);

    const result = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });

    expect(result.ecommerceInventoryStatus).toBe('conflict');
    expect(result.items[0].inventoryResolution.availableQuantitySnapshot).toBe(6);
    expect(result.items[1].inventoryResolution).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      availableQuantitySnapshot: 2
    });
    expect(product.committedStock).toBe(4);
  });

  it.each([null, undefined, 'invalid'])('fails exact stock closed when stock is %s', (stock) => {
    const product = exactProduct({ stock });
    const result = resolveEcommerceDraftLineInventory({ item: lineFromProduct(product), product, now });
    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'INVENTORY_UNKNOWN' });
  });

  it('does not allocate the same batch stock twice', () => {
    const product = batchProduct();
    const order = orderFrom([
      lineFromProduct(product, { lineId: 'line-a', quantity: 4 }),
      lineFromProduct(product, { lineId: 'line-b', quantity: 4 })
    ]);
    const batchesByProduct = new Map([['product-1', [batch('l1', '2026-08-01', 5)]]]);

    const result = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], batchesByProduct, now });

    expect(result.ecommerceInventoryStatus).toBe('conflict');
    expect(result.items[0]).toMatchObject({ batchId: 'l1', inventoryResolution: { status: 'resolved' } });
    expect(result.items[1].batchId).toBeUndefined();
    expect(result.items[1].inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'INSUFFICIENT_BATCH_STOCK',
      availableQuantitySnapshot: 1
    });
  });

  it('assigns two lines deterministically across two FEFO batches without over-allocation', () => {
    const product = batchProduct();
    const order = orderFrom([
      lineFromProduct(product, { lineId: 'line-a', quantity: 4 }),
      lineFromProduct(product, { lineId: 'line-b', quantity: 4 })
    ]);
    const batches = [batch('l2', '2026-09-01', 4), batch('l1', '2026-08-01', 4)];
    const original = structuredClone(batches);

    const result = resolveEcommerceDraftInventoryFromInputs({
      order,
      products: [product],
      batchesByProduct: new Map([['product-1', batches]]),
      now
    });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items.map((item) => item.batchId)).toEqual(['l1', 'l2']);
    expect(batches).toEqual(original);
  });

  it('processes a valid manual selection before automatic FEFO allocation', () => {
    const product = batchProduct();
    const manual = lineFromProduct(product, {
      lineId: 'line-a',
      quantity: 4,
      batchId: 'l2',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l2', selectionMode: 'manual' }
    });
    const automatic = lineFromProduct(product, { lineId: 'line-b', quantity: 4 });

    const result = resolveEcommerceDraftInventoryFromInputs({
      order: orderFrom([automatic, manual]),
      products: [product],
      batchesByProduct: new Map([['product-1', [
        batch('l1', '2026-08-01', 4),
        batch('l2', '2026-09-01', 4)
      ]]]),
      now
    });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items[1]).toMatchObject({
      batchId: 'l2',
      inventoryResolution: { selectionMode: 'manual', status: 'resolved' }
    });
    expect(result.items[0]).toMatchObject({
      batchId: 'l1',
      inventoryResolution: { selectionMode: 'fefo_auto', status: 'resolved' }
    });
  });

  it('keeps only the first of two incompatible manual selections valid', () => {
    const product = batchProduct();
    const manualLine = (lineId) => lineFromProduct(product, {
      lineId,
      quantity: 4,
      batchId: 'l1',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l1', selectionMode: 'manual' }
    });

    const result = resolveEcommerceDraftInventoryFromInputs({
      order: orderFrom([manualLine('line-a'), manualLine('line-b')]),
      products: [product],
      batchesByProduct: new Map([['product-1', [batch('l1', '2026-08-01', 5)]]]),
      now
    });

    expect(result.items[0].inventoryResolution.status).toBe('resolved');
    expect(result.items[1]).toMatchObject({
      batchId: 'l1',
      inventoryResolution: { status: 'conflict', code: 'BATCH_STALE', availableQuantitySnapshot: 1 }
    });
  });

  it('distinguishes no valid batches, expired batches and split stock', () => {
    const product = batchProduct();
    const item = lineFromProduct(product, { quantity: 4 });

    expect(resolveEcommerceDraftLineInventory({ item, product, batches: [], now }).inventoryResolution.code)
      .toBe('NO_VALID_BATCH');
    expect(resolveEcommerceDraftLineInventory({
      item,
      product,
      batches: [batch('expired', '2026-07-10', 8)],
      now
    }).inventoryResolution.code).toBe('ONLY_EXPIRED_BATCHES');
    expect(resolveEcommerceDraftLineInventory({
      item,
      product,
      batches: [batch('one', '2026-08-01', 2), batch('two', '2026-09-01', 2)],
      now
    }).inventoryResolution.code).toBe('MULTI_BATCH_REQUIRED');
  });

  it('uses converted inventory quantity for exact stock', () => {
    const product = exactProduct({ stock: 2, conversionFactor: { enabled: true, factor: 10 } });
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product, { quantity: 10 }),
      product,
      now
    });

    expect(result.inventoryResolution).toMatchObject({
      status: 'resolved',
      requestedSaleQuantity: 10,
      requiredInventoryQuantity: 1,
      requestedQuantity: 1,
      availableQuantitySnapshot: 2
    });
    expect(getEcommerceInventoryLineMessage(result)).toContain('10 unidades vendidas · 1 unidad de inventario requerida');
  });

  it('uses converted inventory quantity for exact-stock conflict', () => {
    const product = exactProduct({ stock: 1, conversionFactor: { enabled: true, factor: 10 } });
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product, { quantity: 20 }),
      product,
      now
    });

    expect(result.inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'INSUFFICIENT_STOCK',
      requestedSaleQuantity: 20,
      requiredInventoryQuantity: 2,
      availableQuantitySnapshot: 1
    });
  });

  it('uses converted inventory quantity for batch allocation', () => {
    const product = batchProduct({ conversionFactor: { enabled: true, factor: 10 } });
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product, { quantity: 10 }),
      product,
      batches: [batch('l1', '2026-08-01', 1)],
      now
    });

    expect(result).toMatchObject({
      batchId: 'l1',
      inventoryResolution: {
        status: 'resolved',
        requestedSaleQuantity: 10,
        requiredInventoryQuantity: 1
      }
    });
  });

  it.each([null, 0, 1, 'invalid'])('keeps original quantity for invalid factor %s', (factor) => {
    const product = exactProduct({ stock: 2, conversionFactor: { enabled: true, factor } });
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product, { quantity: 2 }),
      product,
      now
    });

    expect(result.inventoryResolution).toMatchObject({
      status: 'resolved',
      requestedSaleQuantity: 2,
      requiredInventoryQuantity: 2
    });
  });

  it('keeps recipe products fail-closed', () => {
    const product = exactProduct({ recipe: [{ ingredientId: 'ingredient-1', quantity: 1 }] });
    const result = resolveEcommerceDraftLineInventory({ item: lineFromProduct(product), product, now });
    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'INVENTORY_UNKNOWN' });
  });

  it('calculates global status with conflict over pending over ready priority', () => {
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'resolved' } },
      { inventoryResolution: { status: 'pending' } }
    ])).toBe('pending');
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'pending' } },
      { inventoryResolution: { status: 'conflict' } }
    ])).toBe('conflict');
    expect(calculateEcommerceInventoryStatus([
      { inventoryResolution: { status: 'resolved' } }
    ])).toBe('ready');
  });
});

describe('manual selection and provisional ledger', () => {
  it('accepts a valid manual batch and persists the fully recalculated draft', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const result = await selectEcommerceDraftBatch({
      orderId: order.id,
      lineId: 'line-1',
      batchId: 'manual',
      now,
      deps: depsFor(activeOrders, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('manual', '2026-09-01', 5)])
      })
    });

    expect(result.success).toBe(true);
    expect(activeOrders.activeOrders.get(order.id)).toMatchObject({
      revision: 1,
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryError: null
    });
    expect(activeOrders.activeOrders.get(order.id).items[0]).toMatchObject({
      batchId: 'manual',
      needsInventoryResolution: false,
      inventoryResolution: { status: 'resolved', selectionMode: 'manual' }
    });
  });

  it.each([
    ['other product', batch('manual', '2026-09-01', 5, { productId: 'other' }), 'BATCH_STALE'],
    ['expired', batch('manual', '2026-07-10', 5), 'BATCH_STALE'],
    ['insufficient', batch('manual', '2026-09-01', 1), 'BATCH_STALE']
  ])('rejects a manual batch that is %s', async (_label, selectedBatch, code) => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const result = await selectEcommerceDraftBatch({
      orderId: order.id,
      lineId: 'line-1',
      batchId: 'manual',
      now,
      deps: depsFor(activeOrders, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([selectedBatch])
      })
    });

    expect(result).toMatchObject({ success: false, changed: false, code });
    expect(activeOrders.updateOrder).not.toHaveBeenCalled();
  });

  it('subtracts other manual allocations from displayed batch options', async () => {
    const product = batchProduct();
    const order = orderFrom([
      lineFromProduct(product, {
        lineId: 'manual-line',
        quantity: 4,
        batchId: 'l1',
        inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'l1', selectionMode: 'manual' }
      }),
      lineFromProduct(product, { lineId: 'target-line', quantity: 2 })
    ]);
    const activeOrders = createActiveState(order);

    const result = await getEcommerceDraftBatchOptions({
      orderId: order.id,
      lineId: 'target-line',
      now,
      deps: depsFor(activeOrders, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('l1', '2026-08-01', 5),
          batch('l2', '2026-09-01', 4)
        ])
      })
    });

    expect(result.options).toEqual([
      expect.objectContaining({ batchId: 'l1', availableQuantity: 1, canCoverRequested: false }),
      expect.objectContaining({ batchId: 'l2', availableQuantity: 4, canCoverRequested: true })
    ]);
  });
});

describe('stale response protection', () => {
  it('rejects R1 when R2 starts later and writes conflict first', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const r1Batches = deferred();
    const r2Batches = deferred();

    const r1 = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], { queryBatchesByProduct: () => r1Batches.promise })
    });
    const r2 = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], { queryBatchesByProduct: () => r2Batches.promise })
    });

    r2Batches.resolve([]);
    const r2Result = await r2;
    expect(r2Result.success).toBe(true);
    expect(activeOrders.activeOrders.get(order.id).ecommerceInventoryStatus).toBe('conflict');

    r1Batches.resolve([batch('l1', '2026-08-01', 5)]);
    const r1Result = await r1;

    expect(r1Result).toMatchObject({
      success: false,
      stale: true,
      changed: false,
      code: ECOMMERCE_INVENTORY_STALE_RESPONSE
    });
    expect(activeOrders.activeOrders.get(order.id).ecommerceInventoryStatus).toBe('conflict');
  });

  it('does not let an automatic response replace a manual selection made while it was pending', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const oldRead = deferred();

    const oldResolution = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], { queryBatchesByProduct: () => oldRead.promise })
    });

    const manualResult = await selectEcommerceDraftBatch({
      orderId: order.id,
      lineId: 'line-1',
      batchId: 'l2',
      now,
      deps: depsFor(activeOrders, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('l1', '2026-08-01', 5),
          batch('l2', '2026-09-01', 5)
        ])
      })
    });
    expect(manualResult.success).toBe(true);

    oldRead.resolve([
      batch('l1', '2026-08-01', 5),
      batch('l2', '2026-09-01', 5)
    ]);
    const oldResult = await oldResolution;

    expect(oldResult.code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(activeOrders.activeOrders.get(order.id).items[0]).toMatchObject({
      batchId: 'l2',
      inventoryResolution: { selectionMode: 'manual' }
    });
  });

  it('does not recreate a released order when a pending resolution finishes', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const pendingRead = deferred();

    const pending = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], { queryBatchesByProduct: () => pendingRead.promise })
    });

    activeOrders.removeEcommerceDraftLocal(order.id);
    pendingRead.resolve([batch('l1', '2026-08-01', 5)]);
    const result = await pending;

    expect(result.code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(activeOrders.activeOrders.has(order.id)).toBe(false);
    expect(activeOrders.updateOrder).not.toHaveBeenCalled();
  });
});

describe('read failures are fail closed', () => {
  it('turns a previously ready order into conflict while preserving prior batch metadata', async () => {
    const product = batchProduct();
    const readyItem = lineFromProduct(product, {
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
    const order = orderFrom([readyItem], {
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryResolvedAt: '2026-07-11T10:00:00.000Z'
    });
    const activeOrders = createActiveState(order);

    const result = await revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [], {
        loadProductsForOrder: vi.fn().mockRejectedValue(new Error('Dexie unavailable'))
      })
    });

    const live = activeOrders.activeOrders.get(order.id);
    expect(result).toMatchObject({
      success: false,
      changed: true,
      code: ECOMMERCE_INVENTORY_READ_FAILED
    });
    expect(live).toMatchObject({
      ecommerceInventoryStatus: 'conflict',
      ecommerceInventoryResolvedAt: null,
      ecommerceInventoryError: { code: 'INVENTORY_READ_FAILED' }
    });
    expect(live.items[0]).toMatchObject({
      batchId: 'l1',
      inventoryResolution: { status: 'conflict', code: 'INVENTORY_READ_FAILED', resolvedAt: null }
    });
  });

  it('ignores an old read failure after a newer successful resolution wrote ready', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const oldRead = deferred();

    const r1 = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], { queryBatchesByProduct: () => oldRead.promise })
    });
    const r2 = revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [product], {
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('l1', '2026-08-01', 5)])
      })
    });

    const r2Result = await r2;
    expect(r2Result.success).toBe(true);
    expect(activeOrders.activeOrders.get(order.id).ecommerceInventoryStatus).toBe('ready');

    oldRead.reject(new Error('late Dexie failure'));
    const r1Result = await r1;

    expect(r1Result.code).toBe(ECOMMERCE_INVENTORY_STALE_RESPONSE);
    expect(activeOrders.activeOrders.get(order.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryError: null
    });
  });

  it('recovers from a read failure on the next successful revalidation', async () => {
    const product = exactProduct({ stock: 5 });
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const failed = await revalidateEcommerceDraftInventory({
      orderId: order.id,
      now,
      deps: depsFor(activeOrders, [], {
        loadProductsForOrder: vi.fn().mockRejectedValue(new Error('offline'))
      })
    });
    expect(failed.code).toBe(ECOMMERCE_INVENTORY_READ_FAILED);
    expect(activeOrders.activeOrders.get(order.id).ecommerceInventoryStatus).toBe('conflict');

    const recovered = await revalidateEcommerceDraftInventory({
      orderId: order.id,
      now: new Date('2026-07-11T12:01:00.000Z'),
      deps: depsFor(activeOrders, [product])
    });

    expect(recovered.success).toBe(true);
    expect(activeOrders.activeOrders.get(order.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryError: null
    });
    expect(activeOrders.activeOrders.get(order.id).items[0].inventoryResolution.status).toBe('resolved');
  });
});

describe('persistence and absence of effects', () => {
  it('applies compact metadata and deletion removes it with the draft', () => {
    const product = exactProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const resolution = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });

    const applied = applyEcommerceInventoryResolution({
      orderId: order.id,
      resolution,
      deps: depsFor(activeOrders, [product])
    });

    expect(applied).toMatchObject({ success: true, changed: true });
    expect(activeOrders.activeOrders.get(order.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryResolutionVersion: 2
    });

    activeOrders.removeEcommerceDraftLocal(order.id);
    expect(activeOrders.activeOrders.has(order.id)).toBe(false);
  });

  it('does not mutate products, batches, committed stock, sales or caja', () => {
    const product = batchProduct();
    const batches = [batch('l1', '2026-08-01', 5, { committedStock: 1 })];
    const productBefore = structuredClone(product);
    const batchesBefore = structuredClone(batches);
    const activeOrders = createActiveState(orderFrom([lineFromProduct(product)]));

    const result = resolveEcommerceDraftInventoryFromInputs({
      order: activeOrders.activeOrders.get('ecom-order-1'),
      products: [product],
      batchesByProduct: new Map([['product-1', batches]]),
      now
    });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(product).toEqual(productBefore);
    expect(batches).toEqual(batchesBefore);
    expect(batches[0].committedStock).toBe(1);
    expect(activeOrders).not.toHaveProperty('processSale');
    expect(activeOrders).not.toHaveProperty('caja');
    expect(activeOrders).not.toHaveProperty('inventoryMovement');
  });
});
