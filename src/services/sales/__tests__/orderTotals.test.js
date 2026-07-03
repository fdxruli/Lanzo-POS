import { describe, expect, it } from 'vitest';
import { makeSaleDiscount, orderTotals, withLineDiscount, withoutLineDiscount, withOrderTotals } from '../orderTotals';

const items = [{
  id: 'p1',
  lineId: 'line-1',
  name: 'Product',
  price: 100,
  quantity: 2,
  selectedModifiers: [{ id: 'extra-1', name: 'Extra', ingredientId: 'ing-1', ingredientQuantity: 1, tracksInventory: true }],
  batchesUsed: [{ batchId: 'batch-1', quantity: 2 }]
}];

describe('orderTotals', () => {
  it('calculates sale amount discount', () => {
    const discount = makeSaleDiscount({ items }, { type: 'amount', value: 20, reason: 'manual' });
    const totals = orderTotals({ items, saleDiscount: discount });
    expect(totals.subtotal).toBe(200);
    expect(totals.discountTotal).toBe(20);
    expect(totals.total).toBe(180);
  });

  it('calculates sale percent discount', () => {
    const discount = makeSaleDiscount({ items }, { type: 'percent', value: 10, reason: 'manual' });
    expect(orderTotals({ items, saleDiscount: discount }).total).toBe(180);
  });

  it('calculates line amount discount', () => {
    const discountedItems = withLineDiscount(items, 'line-1', { type: 'amount', value: 20, reason: 'line manual' });
    const totals = orderTotals({ items: discountedItems });
    expect(totals.subtotal).toBe(200);
    expect(totals.lineDiscountTotal).toBe(20);
    expect(totals.total).toBe(180);
    expect(totals.items[0].lineTotal).toBe(180);
  });

  it('calculates line percent discount', () => {
    const discountedItems = withLineDiscount(items, 'line-1', { type: 'percent', value: 10, reason: 'line manual' });
    const totals = orderTotals({ items: discountedItems });
    expect(totals.discountTotal).toBe(20);
    expect(totals.total).toBe(180);
  });

  it('removes line discount and keeps operational fields', () => {
    const discountedItems = withLineDiscount(items, 'line-1', { type: 'amount', value: 20, reason: 'line manual' });
    const clean = withOrderTotals({ items: withoutLineDiscount(discountedItems, 'line-1'), saleDiscount: null }, null);
    expect(clean.discountTotal).toBe(0);
    expect(clean.total).toBe(200);
    expect(clean.items[0].quantity).toBe(2);
    expect(clean.items[0].selectedModifiers).toEqual(items[0].selectedModifiers);
    expect(clean.items[0].batchesUsed).toEqual(items[0].batchesUsed);
  });

  it('combines line discount and sale discount', () => {
    const discountedItems = withLineDiscount(items, 'line-1', { type: 'percent', value: 10, reason: 'line manual' });
    const saleDiscount = makeSaleDiscount({ items: discountedItems }, { type: 'percent', value: 10, reason: 'sale manual' });
    const totals = orderTotals({ items: discountedItems, saleDiscount });
    expect(totals.subtotal).toBe(200);
    expect(totals.lineDiscountTotal).toBe(20);
    expect(totals.subtotalAfterLineDiscounts).toBe(180);
    expect(totals.saleDiscountAmount).toBe(18);
    expect(totals.discountTotal).toBe(38);
    expect(totals.total).toBe(162);
  });

  it('recalculates line subtotal when quantity changes after discount', () => {
    const discountedItems = withLineDiscount(items, 'line-1', { type: 'percent', value: 10, reason: 'line manual' });
    const changed = [{ ...discountedItems[0], quantity: 3 }];
    const totals = orderTotals({ items: changed });
    expect(totals.subtotal).toBe(300);
    expect(totals.lineDiscountTotal).toBe(30);
    expect(totals.total).toBe(270);
  });
});
