import { describe, expect, it } from 'vitest';
import { aggregateProductStats } from '../productStats';
describe('Shared dashboard/bot product statistics', () => {
  it('uses net line revenue, preserves normal walk-in sales and excludes cancelled sales', () => {
    const sale = { customerId: 'GENERIC', items: [{ id: 'variant', parentId: 'product', name: 'Producto', price: 100, quantity: 2, lineTotal: 150, cost: 30 }] };
    const rows = aggregateProductStats([sale, { ...sale, status: 'cancelled' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'product', quantity: 2, revenue: 150, confirmedProfit: 90 });
  });
  it('does not assume profit for items with missing costs', () => {
    expect(aggregateProductStats([{ items: [{ id: 'a', price: 50, quantity: 1 }] }])[0]).toMatchObject({ revenue: 50, confirmedProfit: 0, missingRevenue: 50, marginPct: null });
  });
});
