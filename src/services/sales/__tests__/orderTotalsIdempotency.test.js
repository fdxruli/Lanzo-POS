import { describe, expect, it } from 'vitest';
import { hasSameFinancialTotals, makeSaleDiscount, withOrderTotals } from '../orderTotals';

const baseItems = [{
  id: 'p1',
  lineId: 'line-1',
  name: 'Product',
  price: 100,
  quantity: 2
}];

describe('order totals idempotency', () => {
  it('detects when financial totals are already normalized', () => {
    const saleDiscount = makeSaleDiscount(
      { items: baseItems },
      { type: 'amount', value: 20, reason: 'manual' },
      { now: '2026-07-03T12:00:00.000Z' }
    );
    const normalized = withOrderTotals({ items: baseItems, saleDiscount });
    const normalizedAgain = withOrderTotals(normalized);

    expect(hasSameFinancialTotals(normalized, normalizedAgain)).toBe(true);
  });

  it('detects when a financial update is required', () => {
    const stale = withOrderTotals({ items: baseItems, saleDiscount: null });
    const next = withOrderTotals({
      ...stale,
      items: [{ ...stale.items[0], quantity: 3 }]
    });

    expect(hasSameFinancialTotals(stale, next)).toBe(false);
  });
});
