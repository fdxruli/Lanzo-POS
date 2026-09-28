import { describe, expect, it, vi } from 'vitest';
import { buildRestaurantOrderPayloadFromOpenSale } from '../restaurantOrderMapper';
import { buildRestaurantOrderLineCommercialSnapshot } from '../restaurantSplitCommercialSnapshot';
import { preflightCloudRestaurantOrderSplit } from '../restaurantSplitCloudPreflight';

const VERSION = '2026-09-28T16:05:05.123456Z';

const buildSale = (overrides = {}) => ({
  id: 'sale-open-1',
  status: 'open',
  orderType: 'table',
  tableData: 'Mesa 5',
  subtotal: '60',
  discountTotal: '0',
  total: '60',
  currency: 'MXN',
  items: [{
    id: 'product-1',
    productId: 'product-1',
    lineId: 'line-1',
    name: 'Producto',
    quantity: 2,
    unitPrice: '30.00',
    price: '30.00',
    lineTotal: '60.00',
    discountAmount: '0',
    selectedModifiers: [],
    batchId: 'batch-1',
    isVariant: true
  }],
  ...overrides
});

const buildCloudOrder = (sale = buildSale(), updates = {}) => {
  const payload = buildRestaurantOrderPayloadFromOpenSale({ sale });
  return {
    ...payload.order,
    id: 'restaurant-order-1',
    status: 'pending',
    fulfillmentStatus: 'pending',
    paymentStatus: 'unpaid',
    archivedAt: null,
    checkoutClosedAt: null,
    updatedAt: VERSION,
    items: payload.items.map((item) => ({ ...item, status: 'pending' })),
    ...updates
  };
};

const runPreflight = (sale = buildSale(), order = buildCloudOrder(sale), response) => {
  const repository = { getRestaurantOrderByLocalOrder: vi.fn(async () => (
    response === undefined ? { success: true, found: true, order } : response
  )) };
  return {
    repository,
    promise: preflightCloudRestaurantOrderSplit({
      licenseKey: 'license-1',
      parentOrderId: sale.id,
      parentSale: sale,
      repository
    })
  };
};

describe('preflightCloudRestaurantOrderSplit', () => {
  it.each(['preparing', 'ready', 'delivered'])('allows kitchen status %s when commercial data is unchanged', async (status) => {
    const sale = buildSale();
    const order = buildCloudOrder(sale, {
      status,
      fulfillmentStatus: status,
      updatedAt: '2026-09-28T16:05:05.123456Z',
      items: buildCloudOrder(sale).items.map((item) => ({ ...item, status }))
    });
    const { promise, repository } = runPreflight(sale, order);

    await expect(promise).resolves.toMatchObject({
      success: true,
      parentExpectedVersion: VERSION,
      cloudOrderId: 'restaurant-order-1'
    });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledWith({
      licenseKey: 'license-1', localOrderId: sale.id, force: true
    });
  });

  it('verifies a standard persisted table order from explicit price and quantity when derived totals are not stored', async () => {
    const sale = {
      id: 'sale-open-1',
      status: 'open',
      orderType: 'table',
      total: '60',
      items: [{ id: 'product-1', lineId: 'line-1', quantity: 2, price: '30' }]
    };
    const order = buildCloudOrder(sale, { status: 'delivered', fulfillmentStatus: 'delivered' });

    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: true, parentExpectedVersion: VERSION });
  });

  it('uses a stable cartLineId when the sale does not carry lineId', async () => {
    const sale = {
      id: 'sale-open-1',
      total: '60',
      items: [{ id: 'product-1', cartLineId: 'cart-line-stable', quantity: 2, price: '30' }]
    };
    const order = buildCloudOrder(sale);

    expect(order.items[0].localLineId).toBe('cart-line-stable');
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: true, parentExpectedVersion: VERSION });
    order.items[0].localLineId = 'different-line';
    await expect(runPreflight(sale, order).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('blocks a local item without a verifiable unit price', async () => {
    const sale = {
      id: 'sale-open-1', total: '60',
      items: [{ id: 'product-1', lineId: 'line-1', quantity: 2 }]
    };
    await expect(runPreflight(sale, buildCloudOrder(sale)).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects an added product even when the grand total still matches', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    order.items.push({
      ...order.items[0],
      localLineId: 'line-added',
      productId: 'product-2'
    });
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects a quantity change', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    order.items[0].quantity = 3;
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects a unit price change even when another amount is adjusted to preserve the total', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    order.items[0].unitPrice = 35;
    order.items[0].lineTotal = 60;
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('blocks contradictory price aliases and blank financial fields instead of treating them as zero', async () => {
    const sale = buildSale();
    sale.items[0].unitPrice = '35';
    const order = buildCloudOrder(sale);
    await expect(runPreflight(sale, order).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });

    const blankAmountSale = buildSale();
    blankAmountSale.items[0].lineTotal = '';
    await expect(runPreflight(blankAmountSale, buildCloudOrder(blankAmountSale)).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects a different composition with the same order total', async () => {
    const sale = buildSale({ items: [
      { id: 'product-1', productId: 'product-1', lineId: 'line-1', quantity: 1, price: 30, unitPrice: 30, lineTotal: 30, discountAmount: 0 },
      { id: 'product-2', productId: 'product-2', lineId: 'line-2', quantity: 1, price: 30, unitPrice: 30, lineTotal: 30, discountAmount: 0 }
    ] });
    const order = buildCloudOrder(sale);
    order.items[1].productId = 'product-3';
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects a changed discount snapshot', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    order.items[0].metadata.restaurantSplitCommercialSnapshot = buildRestaurantOrderLineCommercialSnapshot({
      ...sale.items[0], discount: { type: 'amount', value: 5, amount: 5 }, discountAmount: 5, lineTotal: 55
    });
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('rejects changed modifiers and variant selection even when line amounts match', async () => {
    const sale = buildSale({
      items: [{
        ...buildSale().items[0],
        selectedModifiers: [{ id: 'modifier-1', price: 2 }]
      }]
    });
    const modifierOrder = buildCloudOrder(sale);
    modifierOrder.items[0].selectedModifiers = [{ id: 'modifier-2', price: 2 }];
    await expect(runPreflight(sale, modifierOrder).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });

    const variantOrder = buildCloudOrder(sale);
    variantOrder.items[0].metadata.restaurantSplitCommercialSnapshot = buildRestaurantOrderLineCommercialSnapshot({
      ...sale.items[0], batchId: 'batch-2'
    });
    await expect(runPreflight(sale, variantOrder).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('blocks a cancelled line', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    order.items[0].status = 'cancelled';
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_ITEM_CANCELLED' });
  });

  it('blocks paid and cancelled orders', async () => {
    const sale = buildSale();
    await expect(runPreflight(sale, buildCloudOrder(sale, { paymentStatus: 'paid' })).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_ALREADY_PAID' });
    await expect(runPreflight(sale, buildCloudOrder(sale, { status: 'cancelled' })).promise)
      .resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_ALREADY_CANCELLED' });
  });

  it.each([
    ['timeout', () => Promise.reject(new Error('timeout'))],
    ['null response', async () => null],
    ['lost connection', async () => ({ success: false, found: false, order: null, code: 'OFFLINE' })],
    ['RPC error response', async () => ({ success: false, found: false, order: null })],
    ['missing order', async () => ({ success: true, found: true, order: null })]
  ])('fails closed on %s', async (_label, implementation) => {
    const sale = buildSale();
    const repository = { getRestaurantOrderByLocalOrder: vi.fn(implementation) };
    await expect(preflightCloudRestaurantOrderSplit({
      licenseKey: 'license-1', parentOrderId: sale.id, parentSale: sale, repository
    })).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_PREFLIGHT_FAILED' });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledWith({
      licenseKey: 'license-1', localOrderId: sale.id, force: true
    });
  });

  it('blocks missing commercial metadata instead of treating it as unchanged', async () => {
    const sale = buildSale();
    const order = buildCloudOrder(sale);
    delete order.metadata.restaurantSplitCommercialSnapshot;
    await expect(runPreflight(sale, order).promise).resolves.toMatchObject({ success: false, code: 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT' });
  });

  it('retains cloud timestamp text and precision', async () => {
    const sale = buildSale();
    const exactVersion = '2026-09-28T16:05:05.123456789Z';
    const { promise } = runPreflight(sale, buildCloudOrder(sale, { updatedAt: exactVersion }));
    await expect(promise).resolves.toMatchObject({ success: true, parentExpectedVersion: exactVersion });
  });
});
