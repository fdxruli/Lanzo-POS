import { describe, expect, it } from 'vitest';
import {
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale
} from '../salesCloudCashierMapper';
import { localSaleToCloudShadowPayload, cloudSaleToLocalSyncPatch } from '../salesCloudMapper';

describe('salesCloudMapper operational folio', () => {
  it('maps the server-assigned POS folio without replacing the financial folio', () => {
    const patch = cloudSaleToLocalSyncPatch({
      id: 'sale-48',
      folio: 'V-000048',
      cloud_folio: 'V-000048',
      pos_folio: 'FG-01-000048',
      source_mode: 'cloud_committed'
    });

    expect(patch).toMatchObject({
      folio: 'V-000048',
      cloudFolio: 'V-000048',
      posFolio: 'FG-01-000048'
    });
  });
});

describe('sales cloud cost snapshot nullability', () => {
  const sale = { id: 'cost-nullability-sale', timestamp: '2026-09-25T12:00:00.000Z', total: 25 };
  const baseItem = { id: 'product-cost', lineId: 'line-cost', name: 'Producto sintético', price: 25, quantity: 1, exactTotal: 25, lineTotal: 25 };

  it.each([
    ['missing', { ...baseItem }, null],
    ['explicit null', { ...baseItem, cost: null }, null],
    ['blank', { ...baseItem, cost: '   ' }, null],
    ['fallback unitCost', { ...baseItem, cost: null, unitCost: 7 }, 7],
    ['explicit zero', { ...baseItem, cost: 0 }, 0],
    ['positive', { ...baseItem, cost: 9.5 }, 9.5]
  ])('preserves %s unit cost in cashier and shadow payloads', (_caseName, item, expected) => {
    const cashier = mapLocalCheckoutToCloudSale({
      sale,
      processedItems: [item],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 25 },
      total: 25
    });
    const shadow = localSaleToCloudShadowPayload({
      ...sale,
      items: [item]
    });

    expect(cashier.items[0].unit_cost).toBe(expected);
    expect(shadow.items[0].unit_cost).toBe(expected);
  });
});

describe('restaurant split tender mapping', () => {
  it('preserves stable payer IDs across cashier and credit tender mapping', () => {
    const cashSale = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-monetary-split', timestamp: '2026-09-29T12:00:00.000Z', total: 100 },
      paymentData: {
        paymentMethod: 'mixed',
        amountPaid: 100,
        payments: [
          { method: 'cash', amount: 30, received_amount: 35, change_amount: 5, metadata: { splitPayerId: 'T1', source: 'restaurant_split' } },
          { method: 'card', amount: 70, received_amount: 70, change_amount: 0, metadata: { splitPayerId: 'T2', source: 'restaurant_split' } }
        ]
      },
      total: 100
    });
    const creditSale = mapLocalCreditCheckoutToCloudSale({
      sale: { id: 'sale-monetary-credit-split', timestamp: '2026-09-29T12:00:00.000Z', total: 100 },
      paymentData: {
        paymentMethod: 'fiado',
        amountPaid: 20,
        saldoPendiente: 80,
        customerId: 'customer-1',
        payments: [
          { method: 'cash', amount: 20, received_amount: 25, change_amount: 5, metadata: { splitPayerId: 'T3', source: 'restaurant_split' } }
        ]
      },
      total: 100
    });

    expect(cashSale.payments.map((payment) => [payment.method, payment.metadata.splitPayerId])).toEqual([
      ['cash', 'T1'],
      ['card', 'T2']
    ]);
    expect(creditSale.payments).toMatchObject([
      { method: 'cash', amount: 20, received_amount: 25, change_amount: 5, metadata: { splitPayerId: 'T3' } }
    ]);
  });
});

describe('salesCloudCashierMapper discounts', () => {
  it('keeps prorated percentage-origin child discounts as fixed amounts with traceability', () => {
    const lineDiscount = {
      type: 'amount', value: 0.17, amount: 0.17,
      splitParentDiscountType: 'percent', splitParentDiscountValue: 33.3333, splitParentDiscountScope: 'line',
      reason: 'Promoción de línea', scope: 'line',
      appliedAt: '2026-09-27T12:00:00.000Z', appliedByRole: 'owner',
      appliedByStaffUserId: 'staff-1', appliedByDeviceId: 'device-1',
      applied_at: '2026-09-27T12:00:00.000Z', applied_by_role: 'owner',
      applied_by_staff_user_id: 'staff-1', applied_by_device_id: 'device-1'
    };
    const saleDiscount = {
      type: 'amount', value: 0.11, amount: 0.11,
      splitParentDiscountType: 'percent', splitParentDiscountValue: 33.3333, splitParentDiscountScope: 'sale',
      reason: 'Promoción general'
    };
    const payload = mapLocalCheckoutToCloudSale({
      sale: {
        id: 'sale-split-percent', timestamp: '2026-09-27T12:00:00.000Z', subtotal: 0.5,
        saleDiscount, discountTotal: 0.28, total: 0.22
      },
      processedItems: [{
        id: 'product-split-percent', lineId: 'line-split-percent', name: 'Producto',
        price: 0.5, quantity: 1, exactTotal: 0.5, lineTotal: 0.33,
        discount: lineDiscount, discountAmount: 0.17
      }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 0.22 },
      total: 0.22
    });

    expect(payload.items[0].discount).toMatchObject({
      type: 'amount',
      value: 0.17,
      amount: 0.17,
      reason: 'Promoción de línea',
      scope: 'line',
      splitParentDiscountType: 'percent',
      splitParentDiscountValue: 33.3333,
      splitParentDiscountScope: 'line'
    });
    expect(payload.items[0].discount).toEqual(lineDiscount);
    expect(payload.items[0].discount_amount).toBe(0.17);
    expect(payload.items[0].metadata.discount).toEqual(lineDiscount);
    expect(payload.sale.discount_total).toBe(0.28);
    expect(payload.sale.metadata.discount).toMatchObject({
      type: 'amount', value: 0.11, amount: 0.11,
      splitParentDiscountType: 'percent', splitParentDiscountValue: 33.3333, splitParentDiscountScope: 'sale'
    });
  });

  it('maps a normal fixed-amount line discount at the cloud item level', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-fixed-discount', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 100, discountTotal: 10, total: 90 },
      processedItems: [{
        id: 'product-fixed-discount', lineId: 'line-fixed-discount', name: 'Producto',
        price: 100, quantity: 1, exactTotal: 100, lineTotal: 90,
        discount: { type: 'amount', value: 10, amount: 10, reason: 'Promoción fija', scope: 'line' },
        discountAmount: 10
      }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 90 },
      total: 90
    });

    expect(payload.items[0].discount).toMatchObject({
      type: 'amount', value: 10, amount: 10, reason: 'Promoción fija', scope: 'line'
    });
    expect(payload.items[0].discount_amount).toBe(10);
    expect(payload.items[0].line_total).toBe(90);
  });

  it('does not add a discount object for an item without a discount', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-no-discount', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 100, total: 100 },
      processedItems: [{
        id: 'product-no-discount', lineId: 'line-no-discount', name: 'Producto',
        price: 100, quantity: 1, exactTotal: 100, lineTotal: 100
      }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 100 },
      total: 100
    });

    expect(payload.items[0]).not.toHaveProperty('discount');
    expect(payload.items[0].discount_amount).toBe(0);
    expect(payload.items[0].line_total).toBe(100);
    expect(payload.items[0].metadata.discount).toBeNull();
  });

  it('maps line discount as net line_total', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-1', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 200, discountTotal: 20, total: 180 },
      processedItems: [{ id: 'product-1', lineId: 'line-1', name: 'Producto', price: 100, quantity: 2, exactTotal: 200, discount: { amount: 20, reason: 'Cortesía' }, discountAmount: 20, lineTotal: 180 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 180 },
      total: 180
    });

    expect(payload.sale.discount_total).toBe(20);
    expect(payload.sale.total).toBe(180);
    expect(payload.items[0].discount_amount).toBe(20);
    expect(payload.items[0].line_total).toBe(180);
  });

  it('uses exactTotal minus discount when lineTotal is missing', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-3', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 200, discountTotal: 20, total: 180 },
      processedItems: [{ id: 'product-1', lineId: 'line-1', name: 'Producto', price: 100, quantity: 2, exactTotal: 200, discountAmount: 20 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 180 },
      total: 180
    });

    expect(payload.items[0].line_subtotal).toBe(200);
    expect(payload.items[0].discount_amount).toBe(20);
    expect(payload.items[0].line_total).toBe(180);
  });

  it('keeps restaurant modifiers with cloud inventory', () => {
    const selectedModifiers = [{ id: 'extra-cheese', name: 'Queso extra', price: 10, ingredientId: 'ingredient-cheese', ingredientQuantity: 1, ingredientUnit: 'pieza', tracksInventory: true, quantity: 1 }];
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-2', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 210, discountTotal: 10, total: 200 },
      processedItems: [{ id: 'burger-1', lineId: 'line-burger', name: 'Hamburguesa', price: 210, quantity: 1, exactTotal: 210, selectedModifiers, discountAmount: 10, lineTotal: 200 }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 200 },
      total: 200,
      inventoryEnabled: true
    });

    expect(payload.items[0].quantity).toBe(1);
    expect(payload.items[0].selected_modifiers).toEqual(selectedModifiers);
    expect(payload.items[0].metadata.selectedModifiers).toEqual(selectedModifiers);
    expect(payload.items[0].line_total).toBe(200);
  });
});

describe('salesCloudMapper product and line identity', () => {
  it('keeps an explicit product reference separate from the cart line id', () => {
    const item = {
      id: 'product-1',
      lineId: 'line-1',
      productId: 'product-1',
      name: 'Producto',
      price: 20,
      quantity: 1,
      exactTotal: 20,
      lineTotal: 20
    };

    const cashierPayload = mapLocalCheckoutToCloudSale({
      sale: { id: 'identity-sale-1', timestamp: '2026-07-03T12:00:00.000Z', total: 20 },
      processedItems: [item],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 20 },
      total: 20
    });
    const shadowPayload = localSaleToCloudShadowPayload({
      id: 'identity-sale-1',
      timestamp: '2026-07-03T12:00:00.000Z',
      total: 20,
      items: [item]
    });

    expect(cashierPayload.items[0]).toMatchObject({ id: 'identity-sale-1:item:line-1:1', product_id: 'product-1' });
    expect(shadowPayload.items[0]).toMatchObject({ id: 'line-1', product_id: 'product-1' });
  });

  it('namespaces the same source line by child sale while preserving product and price', () => {
    const parentLine = {
      id: 'product-1',
      productId: 'product-1',
      lineId: 'line-parent-1',
      name: 'Producto',
      price: 30,
      quantity: 1,
      exactTotal: 30,
      lineTotal: 30
    };
    const mapChild = (saleId) => mapLocalCheckoutToCloudSale({
      sale: { id: saleId, timestamp: '2026-09-28T12:00:00.000Z', subtotal: 30, total: 30 },
      processedItems: [parentLine],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 30 },
      total: 30
    });
    const child1 = mapChild('sale_split_A');
    const child2 = mapChild('sale_split_B');

    expect(child1.items[0].id).not.toBe(child2.items[0].id);
    expect(child1.items[0].metadata.lineId).toBe('line-parent-1');
    expect(child2.items[0].metadata.lineId).toBe('line-parent-1');
    expect([child1.items[0], child2.items[0]]).toEqual([
      expect.objectContaining({ product_id: 'product-1', quantity: 1, unit_price: 30, line_total: 30 }),
      expect.objectContaining({ product_id: 'product-1', quantity: 1, unit_price: 30, line_total: 30 })
    ]);
    expect(child1.items[0].line_total + child2.items[0].line_total).toBe(60);
  });

  it('keeps fractional quantities and unit price across distinct child sale IDs', () => {
    const parentLine = {
      id: 'product-fractional',
      productId: 'product-fractional',
      lineId: 'line-fractional',
      name: 'Producto fraccionable',
      price: 100,
      quantity: 0.5,
      exactTotal: 50,
      lineTotal: 50
    };
    const child1 = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-fraction-A', total: 50 }, processedItems: [parentLine],
      paymentData: { paymentMethod: 'cash', amountPaid: 50 }, total: 50
    });
    const child2 = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-fraction-B', total: 100 },
      processedItems: [{ ...parentLine, quantity: 1, exactTotal: 100, lineTotal: 100 }],
      paymentData: { paymentMethod: 'cash', amountPaid: 100 }, total: 100
    });

    expect(child1.items[0].id).not.toBe(child2.items[0].id);
    expect(child1.items[0].metadata.lineId).toBe('line-fractional');
    expect(child2.items[0].metadata.lineId).toBe('line-fractional');
    expect([child1.items[0].quantity, child2.items[0].quantity]).toEqual([0.5, 1]);
    expect([child1.items[0].unit_price, child2.items[0].unit_price]).toEqual([100, 100]);
    expect(child1.items[0].line_total + child2.items[0].line_total).toBe(150);
  });

  it('keeps split percentage discounts materialized as traceable fixed amounts', () => {
    const parentLine = {
      id: 'product-discount', productId: 'product-discount', lineId: 'line-discount',
      name: 'Producto con descuento', price: 50, quantity: 1, exactTotal: 50, lineTotal: 42.5,
      discountAmount: 7.5,
      discount: {
        type: 'amount', value: 7.5, amount: 7.5, reason: 'Promoción 15%', scope: 'line',
        splitParentDiscountType: 'percent', splitParentDiscountValue: 15, splitParentDiscountScope: 'line'
      }
    };
    const child1 = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-discount-A', total: 42.5 }, processedItems: [parentLine],
      paymentData: { paymentMethod: 'cash', amountPaid: 42.5 }, total: 42.5
    });
    const child2 = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-discount-B', total: 42.5 }, processedItems: [parentLine],
      paymentData: { paymentMethod: 'cash', amountPaid: 42.5 }, total: 42.5
    });

    expect(child1.items[0].id).not.toBe(child2.items[0].id);
    for (const child of [child1, child2]) {
      expect(child.items[0]).toMatchObject({ product_id: 'product-discount', unit_price: 50, quantity: 1, discount_amount: 7.5, line_total: 42.5 });
      expect(child.items[0].metadata.lineId).toBe('line-discount');
      expect(child.items[0].discount).toMatchObject({
        type: 'amount', value: 7.5, amount: 7.5, reason: 'Promoción 15%',
        splitParentDiscountType: 'percent', splitParentDiscountValue: 15, splitParentDiscountScope: 'line'
      });
    }
  });

  it('uses the sale namespace and item ordinal when no line identity is available', () => {
    const item = { id: 'product-1', productId: 'product-1', name: 'Producto', price: 30, quantity: 1, exactTotal: 30, lineTotal: 30 };
    const mapChild = (saleId) => mapLocalCheckoutToCloudSale({
      sale: { id: saleId, total: 30 }, processedItems: [item],
      paymentData: { paymentMethod: 'cash', amountPaid: 30 }, total: 30
    });
    const childA = mapChild('sale-A');
    const childB = mapChild('sale-B');

    expect(childA.items[0].id).toBe('sale-A:item:index-1:1');
    expect(childB.items[0].id).toBe('sale-B:item:index-1:1');
    expect(childA.items[0].id).not.toBe(childB.items[0].id);
    expect(childA.items[0].id).not.toBe('product-1:1');
  });

  it('preserves an item ID used as the source line without replacing product_id', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { id: 'sale-item-id-source', total: 30 },
      processedItems: [{
        id: 'local-line-from-item-id', productId: 'product-1',
        name: 'Producto', price: 30, quantity: 1, exactTotal: 30, lineTotal: 30
      }],
      paymentData: { paymentMethod: 'cash', amountPaid: 30 },
      total: 30
    });

    expect(payload.items[0]).toMatchObject({
      id: 'sale-item-id-source:item:local-line-from-item-id:1',
      product_id: 'product-1'
    });
    expect(payload.items[0].metadata).toMatchObject({ sourceLineId: 'local-line-from-item-id' });
  });

  it('keeps same-product lines distinct and returns stable IDs on retries', () => {
    const sale = { id: 'sale-retry', total: 40 };
    const processedItems = [
      { id: 'product-1', productId: 'product-1', lineId: 'line-one', price: 20, quantity: 1, exactTotal: 20, lineTotal: 20 },
      { id: 'product-1', productId: 'product-1', lineId: 'line-two', price: 20, quantity: 1, exactTotal: 20, lineTotal: 20 }
    ];
    const mapSale = () => mapLocalCheckoutToCloudSale({
      sale, processedItems, paymentData: { paymentMethod: 'cash', amountPaid: 40 }, total: 40
    });
    const firstAttempt = mapSale();
    const retry = mapSale();

    expect(firstAttempt.items[0].id).not.toBe(firstAttempt.items[1].id);
    expect(retry.items.map((item) => item.id)).toEqual(firstAttempt.items.map((item) => item.id));
  });

  it('preserves all source line aliases and applies the sale namespace to credit items', () => {
    const payload = mapLocalCreditCheckoutToCloudSale({
      sale: { id: 'sale-credit-identity', total: 60 },
      processedItems: [{
        id: 'product-credit', productId: 'product-credit', lineId: 'line-credit',
        cartLineId: 'cart-line-credit', local_line_id: 'local-line-credit',
        price: 60, quantity: 1, exactTotal: 60, lineTotal: 60
      }],
      paymentData: { customerId: 'customer-1', amountPaid: 0, saldoPendiente: 60 },
      total: 60
    });

    expect(payload.items[0].id).toBe('sale-credit-identity:item:line-credit:1');
    expect(payload.items[0].metadata).toMatchObject({
      lineId: 'line-credit', cartLineId: 'cart-line-credit', localLineId: 'local-line-credit'
    });
  });
});

describe('salesCloudCashierMapper split rounding contract', () => {
  it('keeps the catalog unit price while carrying the one-cent split adjustment', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: {
        id: 'split-rounding-sale',
        timestamp: '2026-07-03T12:00:00.000Z',
        subtotal: 10.01,
        total: 10.01,
        metadata: {
          source: 'split_bill_child',
          splitGroupId: 'split-1',
          splitParentId: 'parent-1',
          splitRoundingAdjustment: '0.01'
        }
      },
      processedItems: [{
        id: 'product-1',
        lineId: 'line-1',
        name: 'Producto',
        price: 10.01,
        splitBasePrice: 10,
        splitRoundingAdjustment: '0.01',
        quantity: 1,
        exactTotal: 10.01,
        lineTotal: 10.01
      }],
      paymentData: { paymentMethod: 'efectivo', amountPaid: 10.01 },
      total: 10.01
    });

    expect(payload.items[0]).toMatchObject({
      unit_price: 10,
      line_subtotal: 10.01,
      line_total: 10.01
    });
    expect(payload.items[0].metadata).toMatchObject({
      splitBasePrice: 10,
      splitRoundingAdjustment: 0.01
    });
    expect(payload.sale.metadata).toMatchObject({
      source: 'split_bill_child',
      splitRoundingAdjustment: '0.01'
    });
  });
});

describe('salesCloudCashierMapper batch allocation compatibility', () => {
  const baseSale = { id: 'batch-sale-1', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 25, total: 25 };
  const baseItem = { id: 'product-1', lineId: 'line-1', name: 'Producto', price: 25, quantity: 1, exactTotal: 25, lineTotal: 25 };
  const mapCheckout = (item, options = {}) => mapLocalCheckoutToCloudSale({
    sale: baseSale,
    processedItems: [item],
    paymentData: { paymentMethod: 'efectivo', amountPaid: 25 },
    total: 25,
    ...options
  });

  it('omits batchesUsed when the item has no batch allocation property', () => {
    const payload = mapCheckout({ ...baseItem });

    expect(payload.items[0].metadata).not.toHaveProperty('batchesUsed');
    expect(JSON.stringify(payload.items[0])).not.toContain('"batchesUsed":null');
  });

  it('treats batchesUsed null as no explicit allocation', () => {
    const payload = mapCheckout({ ...baseItem, batchesUsed: null });

    expect(payload.items[0].metadata).not.toHaveProperty('batchesUsed');
    expect(JSON.stringify(payload.items[0])).not.toContain('"batchesUsed":null');
  });

  it('keeps the canonical no-allocation shape for an empty array', () => {
    const payload = mapCheckout({ ...baseItem, batchesUsed: [] });

    expect(payload.items[0].metadata).not.toHaveProperty('batchesUsed');
  });

  it('preserves a valid explicit batch allocation array', () => {
    const batchesUsed = [{ batchId: 'batch-1', usedQuantity: 1 }];
    const payload = mapCheckout({ ...baseItem, batchesUsed });

    expect(payload.items[0].metadata.batchesUsed).toEqual(batchesUsed);
  });

  it('preserves manually selected batch and allocation semantics with cloud inventory', () => {
    const batchesUsed = [{ batchId: 'batch-1', usedQuantity: 1 }];
    const payload = mapCheckout({
      ...baseItem,
      batchesUsed,
      manualBatchSelection: true,
      batchId: 'batch-1',
      batchSku: 'BATCH-1'
    }, { inventoryEnabled: true });

    expect(payload.items[0].batch_id).toBe('batch-1');
    expect(payload.items[0].metadata.batchesUsed).toEqual(batchesUsed);
    expect(payload.items[0].metadata.batchSelectionSource).toBe('manual');
  });

  it('applies the same null omission to credit-sale mapping', () => {
    const payload = mapLocalCreditCheckoutToCloudSale({
      sale: { ...baseSale, id: 'credit-batch-sale-1' },
      processedItems: [{ ...baseItem, batchesUsed: null }],
      paymentData: { amountPaid: 0, saldoPendiente: 25 },
      total: 25
    });

    expect(payload.items[0].metadata).not.toHaveProperty('batchesUsed');
    expect(JSON.stringify(payload.items[0])).not.toContain('"batchesUsed":null');
  });
});


describe('salesCloudCashierMapper payment arithmetic contract', () => {
  const mapCheckout = (paymentData, options = {}) => mapLocalCheckoutToCloudSale({
    sale: { id: 'payment-contract-sale', timestamp: '2026-07-03T12:00:00.000Z', subtotal: 100, total: 100 },
    processedItems: [{ id: 'product-1', lineId: 'line-1', name: 'Producto', price: 100, quantity: 1, exactTotal: 100, lineTotal: 100 }],
    paymentData,
    total: 100,
    ...options
  });

  it('defaults an omitted cash receipt to the amount paid instead of zero', () => {
    const payload = mapCheckout({ paymentMethod: 'efectivo', amountPaid: 100 });

    expect(payload.sale).toMatchObject({ amount_paid: 100, change_amount: 0, balance_due: 0 });
    expect(payload.payments).toHaveLength(1);
    expect(payload.payments[0]).toMatchObject({ method: 'cash', amount: 100, received_amount: 100, change_amount: 0 });
  });

  it('preserves cash overpayment and derives the correct change', () => {
    const payload = mapCheckout({ paymentMethod: 'efectivo', amountPaid: 150 });

    expect(payload.sale.change_amount).toBe(50);
    expect(payload.payments[0]).toMatchObject({ amount: 100, received_amount: 150, change_amount: 50 });
  });

  it('preserves an explicit cash receipt/change contract', () => {
    const payload = mapCheckout({
      paymentMethod: 'cash',
      amountPaid: 100,
      receivedAmount: 150,
      changeAmount: 50
    });

    expect(payload.sale.change_amount).toBe(50);
    expect(payload.payments[0]).toMatchObject({ amount: 100, received_amount: 150, change_amount: 50 });
  });

  it('does not mask an underpayment as a fully paid sale', () => {
    const payload = mapCheckout({ paymentMethod: 'efectivo', amountPaid: 90 });

    expect(payload.sale.amount_paid).toBe(100);
    expect(payload.payments[0]).toMatchObject({ amount: 100, received_amount: 90, change_amount: 0 });
  });

  it('treats blank receipt/change fields as omitted values', () => {
    const payload = mapCheckout({ paymentMethod: 'efectivo', amountPaid: 100, receivedAmount: '', changeAmount: '' });

    expect(payload.payments[0]).toMatchObject({ received_amount: 100, change_amount: 0 });
  });

  it('defaults non-cash payment receipt to the sale total with zero change', () => {
    const payload = mapCheckout({ paymentMethod: 'tarjeta', amountPaid: 100 });

    expect(payload.payments[0]).toMatchObject({ method: 'card', amount: 100, received_amount: 100, change_amount: 0 });
  });

  it('derives change for an explicit cash payment when only receipt is supplied', () => {
    const payload = mapCheckout({
      paymentMethod: 'mixed',
      payments: [{ method: 'cash', amount: 100, receivedAmount: 150 }]
    });

    expect(payload.sale.change_amount).toBe(50);
    expect(payload.payments[0]).toMatchObject({ method: 'cash', amount: 100, received_amount: 150, change_amount: 50 });
  });
});
