import { describe, expect, it, vi } from 'vitest';
import {
  SALE_STATUS,
  buildDailyStatsFromSales,
  getLegacyFinancialSaleStatus,
  isFinanciallyClosedSale
} from '../../sales/financialStats';

describe('financialStats', () => {
  it('preserva cancelaciones legacy al mapear status financiero', () => {
    expect(getLegacyFinancialSaleStatus({ fulfillmentStatus: 'cancelled' })).toBe(SALE_STATUS.CANCELLED);
    expect(getLegacyFinancialSaleStatus({ fulfillmentStatus: 'completed' })).toBe(SALE_STATUS.CLOSED);
    expect(getLegacyFinancialSaleStatus({})).toBe(SALE_STATUS.CLOSED);
  });

  it('solo agrega ventas con status closed en daily stats', () => {
    const logger = { warn: vi.fn() };
    const stats = buildDailyStatsFromSales(
      [
        {
          id: 'sale-closed',
          status: SALE_STATUS.CLOSED,
          timestamp: '2026-03-12T12:00:00.000Z',
          total: 20,
          items: [{ id: 'prod-1', quantity: 2, price: 10 }]
        },
        {
          id: 'sale-open',
          status: SALE_STATUS.OPEN,
          timestamp: '2026-03-12T13:00:00.000Z',
          total: 50,
          items: [{ id: 'prod-1', quantity: 5, price: 10 }]
        },
        {
          id: 'sale-cancelled',
          status: SALE_STATUS.CANCELLED,
          timestamp: '2026-03-12T14:00:00.000Z',
          total: 30,
          items: [{ id: 'prod-1', quantity: 3, price: 10 }]
        }
      ],
      new Map([['prod-1', 4]]),
      logger
    );

    expect(stats).toEqual([
      {
        id: '2026-03-12',
        date: '2026-03-12',
        revenue: 20,
        profit: 12,
        orders: 1,
        itemsSold: 2,
        hasMissingCosts: false
      }
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('isFinanciallyClosedSale solo acepta closed estricto', () => {
    expect(isFinanciallyClosedSale({ status: SALE_STATUS.CLOSED })).toBe(true);
    expect(isFinanciallyClosedSale({ status: SALE_STATUS.OPEN })).toBe(false);
    expect(isFinanciallyClosedSale({ status: SALE_STATUS.CANCELLED })).toBe(false);
    expect(isFinanciallyClosedSale({})).toBe(false);
  });
});
