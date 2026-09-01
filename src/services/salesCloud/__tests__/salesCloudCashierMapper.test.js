import { describe, expect, it } from 'vitest';
import {
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale
} from '../salesCloudCashierMapper';
import { cloudSaleToLocalSyncPatch } from '../salesCloudMapper';

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

describe('salesCloudCashierMapper discounts', () => {
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