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
  applyEcommerceInventoryResolution,
  calculateEcommerceInventoryStatus,
  getEcommerceDraftBatchOptions,
  resolveEcommerceDraftInventory,
  resolveEcommerceDraftInventoryFromInputs,
  resolveEcommerceDraftLineInventory,
  selectEcommerceDraftBatch
} from '../ecommercePosInventoryResolution';

const now = new Date('2026-07-11T12:00:00.000Z');

const exactProduct = (overrides = {}) => ({
  id: 'product-1',
  name: 'Producto exacto',
  isActive: true,
  trackStock: true,
  stock: 10,
  committedStock: 2,
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
  lineId: 'line-1',
  uniqueLineId: 'line-1',
  ecommerceOrderItemId: 'ecom-item-1',
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

const orderFrom = (items) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceDraftStatus: 'prepared',
  ecommerceLicenseIdentity: 'context-1',
  items
});

const createActiveState = (order) => {
  const state = {
    activeOrders: new Map([[order.id, order]]),
    updateOrder: vi.fn((orderId, updates) => {
      const current = state.activeOrders.get(orderId);
      state.activeOrders.set(orderId, { ...current, ...updates });
    }),
    removeEcommerceDraftLocal: vi.fn((orderId) => {
      state.activeOrders.delete(orderId);
      return { success: true };
    })
  };
  return state;
};

describe('ecommercePosInventoryResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.productState = { menu: [] };
    mocks.activeState = createActiveState(orderFrom([]));
  });

  it('resolves unlimited inventory automatically without assigning or querying a batch', async () => {
    const product = exactProduct({ trackStock: false, stock: null });
    const item = lineFromProduct(product);
    const queryBatchesByProduct = vi.fn();

    const result = await resolveEcommerceDraftInventory({
      order: orderFrom([item]),
      now,
      deps: {
        products: [product],
        queryBatchesByProduct,
        db: null,
        STORES: {}
      }
    });

    expect(result.ecommerceInventoryStatus).toBe('ready');
    expect(result.items[0]).toMatchObject({
      needsInventoryResolution: false,
      inventoryResolution: { mode: 'unlimited', status: 'resolved', code: null, batchId: null }
    });
    expect(result.items[0].batchId).toBeUndefined();
    expect(queryBatchesByProduct).not.toHaveBeenCalled();
  });

  it('resolves exact stock when sufficient without mutating the product', () => {
    const product = exactProduct();
    const item = lineFromProduct(product);
    const productBefore = structuredClone(product);

    const result = resolveEcommerceDraftLineInventory({ item, product, now });

    expect(result.inventoryResolution).toMatchObject({
      mode: 'exact',
      status: 'resolved',
      code: null,
      requestedQuantity: 2,
      availableQuantitySnapshot: 8
    });
    expect(product).toEqual(productBefore);
  });

  it('fails exact stock closed when insufficient', () => {
    const product = exactProduct({ stock: 1, committedStock: 0 });
    const result = resolveEcommerceDraftLineInventory({ item: lineFromProduct(product), product, now });

    expect(result.inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'INSUFFICIENT_STOCK',
      availableQuantitySnapshot: 1
    });
  });

  it.each([null, undefined, 'invalid'])('fails closed when exact stock is %s', (stock) => {
    const product = exactProduct({ stock });
    const result = resolveEcommerceDraftLineInventory({ item: lineFromProduct(product), product, now });

    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'INVENTORY_UNKNOWN' });
  });

  it('selects the nearest valid FEFO batch and ignores expired and exhausted batches', () => {
    const product = batchProduct();
    const batches = [
      batch('expired', '2026-07-10', 10),
      batch('empty', '2026-07-12', 0),
      batch('later', '2026-09-01', 8),
      batch('nearest', '2026-08-01', 6)
    ];
    const batchesBefore = structuredClone(batches);

    const result = resolveEcommerceDraftLineInventory({ item: lineFromProduct(product), product, batches, now });

    expect(result.batchId).toBe('nearest');
    expect(result.inventoryResolution).toMatchObject({
      mode: 'batch',
      status: 'resolved',
      batchId: 'nearest',
      batchNumber: 'NEAREST',
      expirationDate: '2026-08-01',
      selectionMode: 'fefo_auto'
    });
    expect(batches).toEqual(batchesBefore);
  });

  it('reports no valid batch when none exists', () => {
    const product = batchProduct();
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product),
      product,
      batches: [],
      now
    });

    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'NO_VALID_BATCH' });
  });

  it('distinguishes products with only expired available batches', () => {
    const product = batchProduct();
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product),
      product,
      batches: [batch('expired', '2026-07-10', 8)],
      now
    });

    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'ONLY_EXPIRED_BATCHES' });
  });

  it('detects when valid stock is distributed across multiple batches', () => {
    const product = batchProduct();
    const item = lineFromProduct(product, { quantity: 4 });
    const result = resolveEcommerceDraftLineInventory({
      item,
      product,
      batches: [batch('one', '2026-08-01', 2), batch('two', '2026-09-01', 2)],
      now
    });

    expect(result.inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'MULTI_BATCH_REQUIRED',
      availableQuantitySnapshot: 4
    });
    expect(result.batchId).toBeUndefined();
  });

  it('reports insufficient total stock across valid batches', () => {
    const product = batchProduct();
    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(product, { quantity: 5 }),
      product,
      batches: [batch('one', '2026-08-01', 2), batch('two', '2026-09-01', 1)],
      now
    });

    expect(result.inventoryResolution).toMatchObject({
      status: 'conflict',
      code: 'INSUFFICIENT_BATCH_STOCK',
      availableQuantitySnapshot: 3
    });
  });

  it('preserves a valid manual selection during revalidation', () => {
    const product = batchProduct();
    const item = lineFromProduct(product, {
      batchId: 'manual',
      inventoryResolution: {
        mode: 'batch',
        status: 'resolved',
        batchId: 'manual',
        selectionMode: 'manual'
      }
    });

    const result = resolveEcommerceDraftLineInventory({
      item,
      product,
      batches: [batch('manual', '2026-09-01', 4), batch('earlier', '2026-08-01', 6)],
      now
    });

    expect(result.batchId).toBe('manual');
    expect(result.inventoryResolution.selectionMode).toBe('manual');
  });

  it('clears and marks a selected batch stale when its stock is exhausted', () => {
    const product = batchProduct();
    const item = lineFromProduct(product, {
      batchId: 'selected',
      inventoryResolution: { mode: 'batch', status: 'resolved', batchId: 'selected', selectionMode: 'manual' }
    });

    const result = resolveEcommerceDraftLineInventory({
      item,
      product,
      batches: [batch('selected', '2026-09-01', 0)],
      now
    });

    expect(result.batchId).toBeUndefined();
    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'BATCH_STALE' });
  });

  it('detects an inventory mode change after the ecommerce order was prepared', () => {
    const original = exactProduct();
    const current = exactProduct({ batchManagement: { enabled: true }, expirationMode: 'STRICT' });

    const result = resolveEcommerceDraftLineInventory({
      item: lineFromProduct(original),
      product: current,
      batches: [],
      now
    });

    expect(result.inventoryResolution).toMatchObject({ status: 'conflict', code: 'INVENTORY_MODE_CHANGED' });
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

  it('accepts a valid manual batch and persists it in the active ecommerce draft', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const result = await selectEcommerceDraftBatch({
      orderId: order.id,
      lineId: 'line-1',
      batchId: 'manual',
      now,
      deps: {
        activeOrders,
        products: [product],
        queryBatchesByProduct: vi.fn().mockResolvedValue([batch('manual', '2026-09-01', 5)]),
        getContextIdentity: () => 'context-1'
      }
    });

    expect(result.success).toBe(true);
    expect(activeOrders.activeOrders.get(order.id).items[0]).toMatchObject({
      batchId: 'manual',
      needsInventoryResolution: false,
      inventoryResolution: { status: 'resolved', selectionMode: 'manual' }
    });
    expect(activeOrders.activeOrders.get(order.id).ecommerceInventoryStatus).toBe('ready');
  });

  it.each([
    ['other product', batch('manual', '2026-09-01', 5, { productId: 'other' }), 'BATCH_STALE'],
    ['expired', batch('manual', '2026-07-10', 5), 'ONLY_EXPIRED_BATCHES'],
    ['insufficient', batch('manual', '2026-09-01', 1), 'INSUFFICIENT_BATCH_STOCK']
  ])('rejects a manual batch that is %s', async (_label, selectedBatch, code) => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const result = await selectEcommerceDraftBatch({
      orderId: order.id,
      lineId: 'line-1',
      batchId: 'manual',
      now,
      deps: {
        activeOrders,
        products: [product],
        queryBatchesByProduct: vi.fn().mockResolvedValue([selectedBatch]),
        getContextIdentity: () => 'context-1'
      }
    });

    expect(result).toMatchObject({ success: false, code });
    expect(activeOrders.updateOrder).not.toHaveBeenCalled();
  });

  it('exposes only valid manual options and identifies the FEFO recommendation', async () => {
    const product = batchProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);

    const result = await getEcommerceDraftBatchOptions({
      orderId: order.id,
      lineId: 'line-1',
      now,
      deps: {
        activeOrders,
        products: [product],
        queryBatchesByProduct: vi.fn().mockResolvedValue([
          batch('expired', '2026-07-10', 10),
          batch('later', '2026-09-01', 5),
          batch('recommended', '2026-08-01', 4)
        ])
      }
    });

    expect(result.options.map((option) => option.batchId)).toEqual(['recommended', 'later']);
    expect(result.options[0]).toMatchObject({ isRecommended: true, canCoverRequested: true });
  });

  it('applies compact resolution metadata and deletion removes it with the draft', () => {
    const product = exactProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const activeOrders = createActiveState(order);
    const resolution = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });

    const applied = applyEcommerceInventoryResolution({
      orderId: order.id,
      resolution,
      deps: { activeOrders, getContextIdentity: () => 'context-1' }
    });

    expect(applied).toMatchObject({ success: true, changed: true });
    expect(activeOrders.activeOrders.get(order.id)).toMatchObject({
      ecommerceInventoryStatus: 'ready',
      ecommerceInventoryResolutionVersion: 1
    });
    expect(JSON.stringify(activeOrders.activeOrders.get(order.id))).not.toContain('customerPhone');

    activeOrders.removeEcommerceDraftLocal(order.id);
    expect(activeOrders.activeOrders.has(order.id)).toBe(false);
  });

  it('does not rewrite an unchanged resolution and does not mutate stock, batches or caja', () => {
    const product = exactProduct();
    const order = orderFrom([lineFromProduct(product)]);
    const firstResolution = resolveEcommerceDraftInventoryFromInputs({ order, products: [product], now });
    const resolvedOrder = { ...order, ...firstResolution };
    const activeOrders = createActiveState(resolvedOrder);
    const productBefore = structuredClone(product);

    const applied = applyEcommerceInventoryResolution({
      orderId: order.id,
      resolution: resolveEcommerceDraftInventoryFromInputs({ order: resolvedOrder, products: [product], now }),
      deps: { activeOrders, getContextIdentity: () => 'context-1' }
    });

    expect(applied).toMatchObject({ success: true, changed: false });
    expect(activeOrders.updateOrder).not.toHaveBeenCalled();
    expect(product).toEqual(productBefore);
    expect(activeOrders).not.toHaveProperty('processSale');
    expect(activeOrders).not.toHaveProperty('caja');
  });
});
