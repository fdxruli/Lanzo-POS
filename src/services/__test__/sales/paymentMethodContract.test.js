import { describe, expect, it } from 'vitest';
import { getExplicitSalePaymentRows } from '../../sales/paymentMethodContract';

describe('getExplicitSalePaymentRows', () => {
  it('returns null when payment rows are absent or only empty arrays', () => {
    expect(getExplicitSalePaymentRows({ paymentMethod: 'cash', total: 100 })).toBeNull();
    expect(getExplicitSalePaymentRows({
      payments: [],
      paymentBreakdown: [],
      paymentDetails: { payments: [] }
    })).toBeNull();
  });

  it('preserves a non-empty explicit source even when its applied amount is zero', () => {
    expect(getExplicitSalePaymentRows({
      paymentMethod: 'cash',
      total: 100,
      payments: [{ method: 'cash', amount: 0 }]
    })).toEqual([]);
  });

  it('does not replace a non-empty zero or malformed higher-priority source', () => {
    expect(getExplicitSalePaymentRows({
      payments: [{ method: 'cash', amount: 0 }],
      paymentBreakdown: [{ method: 'cash', amount: 100 }]
    })).toEqual([]);

    expect(getExplicitSalePaymentRows({
      payments: [
        { method: 'cash', amount: -5 },
        { method: 'cash', amount: 'invalid' },
        { method: 'other', amount: 100 },
        null
      ],
      paymentDetails: { payments: [{ method: 'cash', amount: 100 }] }
    })).toEqual([]);
  });

  it('keeps only positive, valid rows from the first non-empty source', () => {
    expect(getExplicitSalePaymentRows({
      payments: [
        { method: 'cash', amount: '25' },
        { method: 'card', amount: 0 },
        { method: 'transfer', amount: '75' },
        { method: 'cash', amount: -10 },
        { method: 'cash', amount: 'invalid' }
      ],
      paymentBreakdown: [{ method: 'cash', amount: 500 }]
    })).toEqual([
      { method: 'cash', amount: '25' },
      { method: 'transfer', amount: '75' }
    ]);
  });

  it('skips an empty higher-priority array and preserves the next explicit source', () => {
    expect(getExplicitSalePaymentRows({
      payments: [],
      paymentBreakdown: [{ method: 'cash', amount: 25 }],
      paymentDetails: { payments: [{ method: 'cash', amount: 100 }] }
    })).toEqual([{ method: 'cash', amount: 25 }]);
  });
});
