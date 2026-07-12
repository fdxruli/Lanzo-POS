import { describe, expect, it } from 'vitest';
import { processSaleCoreInternals } from '../processSaleCore';

const createItems = () => ([
  {
    id: 'product-1',
    lineId: 'line-1',
    ecommerceOrderItemId: 'item-1',
    name: 'Producto 1',
    quantity: 2,
    price: 999,
    batchId: 'batch-1'
  },
  {
    id: 'product-2',
    lineId: 'line-2',
    ecommerceOrderItemId: 'item-2',
    name: 'Producto 2',
    quantity: 1,
    price: 999
  }
]);

const createCheckout = (overrides = {}) => ({
  origin: 'ecommerce',
  ecommerceOrderId: 'order-1',
  ecommerceOrderCode: 'EC-0001',
  idempotencyKey: 'ecommerce:order-1',
  snapshot: {
    ecommerceOrderId: 'order-1',
    expectedSubtotal: 50,
    expectedDeliveryFee: 10,
    expectedDiscountTotal: 5,
    expectedTaxTotal: 8,
    expectedTotal: 63,
    currency: 'MXN',
    lines: [
      {
        lineId: 'line-1',
        ecommerceOrderItemId: 'item-1',
        productId: 'product-1',
        quantity: 2,
        unitPriceSnapshot: 20,
        lineTotalSnapshot: 40,
        batchId: 'batch-1',
        requiredInventoryQuantity: 2
      },
      {
        lineId: 'line-2',
        ecommerceOrderItemId: 'item-2',
        productId: 'product-2',
        quantity: 1,
        unitPriceSnapshot: 10,
        lineTotalSnapshot: 10,
        batchId: null,
        requiredInventoryQuantity: 1
      }
    ],
    ...overrides
  }
});

describe('processSaleCore ecommerce snapshot', () => {
  it('replaces catalog-facing prices with accepted immutable prices', () => {
    const items = createItems();
    const financials = processSaleCoreInternals.applyAndValidateEcommerceSnapshot({
      itemsToProcess: items,
      checkout: createCheckout(),
      total: 63
    });

    expect(items).toEqual([
      expect.objectContaining({
        lineId: 'line-1',
        price: 20,
        exactTotal: 40,
        lineSubtotal: 40,
        lineTotal: 40,
        batchId: 'batch-1'
      }),
      expect.objectContaining({
        lineId: 'line-2',
        price: 10,
        exactTotal: 10,
        lineSubtotal: 10,
        lineTotal: 10
      })
    ]);
    expect(financials).toMatchObject({
      subtotal: 50,
      deliveryFee: 10,
      discountTotal: 5,
      taxTotal: 8,
      total: 63,
      currency: 'MXN'
    });
  });

  it('blocks a changed line quantity', () => {
    const items = createItems();
    items[0].quantity = 3;

    expect(() => processSaleCoreInternals.applyAndValidateEcommerceSnapshot({
      itemsToProcess: items,
      checkout: createCheckout(),
      total: 63
    })).toThrow('El pedido ecommerce cambió');
  });

  it('blocks a changed or missing batch', () => {
    const items = createItems();
    items[0].batchId = 'batch-2';

    expect(() => processSaleCoreInternals.applyAndValidateEcommerceSnapshot({
      itemsToProcess: items,
      checkout: createCheckout(),
      total: 63
    })).toThrow('El pedido ecommerce cambió');
  });

  it('blocks a total that omits delivery or tax', () => {
    expect(() => processSaleCoreInternals.applyAndValidateEcommerceSnapshot({
      itemsToProcess: createItems(),
      checkout: createCheckout(),
      total: 50
    })).toThrow('El total del pedido cambió');
  });

  it('blocks inconsistent accepted totals', () => {
    expect(() => processSaleCoreInternals.applyAndValidateEcommerceSnapshot({
      itemsToProcess: createItems(),
      checkout: createCheckout({ expectedTotal: 64 }),
      total: 64
    })).toThrow('El total del pedido cambió');
  });

  it('removes internal ecommerce data before payment effects', () => {
    const paymentData = {
      paymentMethod: 'cash',
      amountPaid: 63,
      __ecommerceCheckout: createCheckout()
    };
    const sanitized = processSaleCoreInternals.sanitizePaymentData(paymentData);

    expect(sanitized).toEqual({ paymentMethod: 'cash', amountPaid: 63 });
    expect(paymentData).toHaveProperty('__ecommerceCheckout');
  });
});
