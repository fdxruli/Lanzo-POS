import { describe, expect, it } from 'vitest';
import { makeSaleDiscount, orderTotals, withOrderTotals } from '../orderTotals';

const items = [{ id: 'p1', name: 'Product', price: 100, quantity: 2, selectedModifiers: [{ id: 'extra-1', name: 'Extra' }] }];

describe('orderTotals', () => {
  it('calculates amount discount', () => {
    const discount = makeSaleDiscount({ items }, { type: 'amount', value: 20, reason: 'manual' });
    const totals = orderTotals({ items, saleDiscount: discount });
    expect(totals.subtotal).toBe(200);
    expect(totals.discountTotal).toBe(20);
    expect(totals.total).toBe(180);
  });

  it('calculates percent discount', () => {
    const discount = makeSaleDiscount({ items }, { type: 'percent', value: 10, reason: 'manual' });
    expect(orderTotals({ items, saleDiscount: discount }).total).toBe(180);
  });

  it('removes sale discount and keeps modifiers', () => {
    const clean = withOrderTotals({ items, saleDiscount: null }, null);
    expect(clean.discountTotal).toBe(0);
    expect(clean.total).toBe(200);
    expect(clean.items[0].selectedModifiers).toEqual(items[0].selectedModifiers);
  });
});
