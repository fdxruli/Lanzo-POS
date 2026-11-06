import { describe, expect, it } from 'vitest';
import { createFinancialSalesAccumulator, summarizeFinancialSales } from '../sales/financialPolicy';
import { projectBotSales } from '../botComputationProjection';

describe('Worker financial projection preserves official policy', () => {
  it('is equivalent across chunk boundaries, discounts, missing costs and statuses', () => {
    const sales = Array.from({ length: 513 }, (_, index) => ({ status: index % 11 ? 'closed' : 'cancelled', total: '0.035', discountTotal: 0.01, items: [{ id: 'x', quantity: .125, price: '0.45', exactTotal: '0.025', discount: { amount: 0.005 }, cost: index % 9 ? .15 : null }] }));
    const accumulator = createFinancialSalesAccumulator();
    for (let index = 0; index < sales.length; index += 128) accumulator.add(projectBotSales(sales.slice(index, index + 128)));
    expect(accumulator.result()).toEqual(summarizeFinancialSales(sales));
  });
  it('never projects customers, receipts, images or tenant credentials', () => {
    expect(projectBotSales([{ customer: { name: 'private' }, receipt: 'private', tenantId: 'private', items: [{ id: 'x', image: 'private', name: 'Artículo', quantity: 1 }] }])).toEqual([{ items: [{ id: 'x', name: 'Artículo', quantity: 1 }] }]);
  });
});
