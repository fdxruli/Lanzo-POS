import { describe, expect, it } from 'vitest';
import {
  summarizeLocalCustomerDebt,
  summarizeLocalDashboardFinance
} from '../dashboardFinancialSummary';

const range = {
  start: '2026-11-08T00:00:00.000Z',
  end: '2026-11-08T23:59:59.999Z'
};

const sale = (overrides = {}) => ({
  id: 'sale-1',
  status: 'closed',
  timestamp: '2026-11-08T10:00:00.000Z',
  total: '20.00',
  paymentMethod: 'fiado',
  abono: '0.00',
  ...overrides
});

describe('summarizeLocalDashboardFinance', () => {
  it('uses current local customer balances only when every projection is known', () => {
    expect(summarizeLocalCustomerDebt([
      { debt: '20.00', financialSource: 'local' },
      { debt: 0, financialSource: 'local' }
    ], { authoritative: true })).toMatchObject({ value: 20, status: 'complete' });
    expect(summarizeLocalCustomerDebt([], { authoritative: true })).toMatchObject({ value: 0, status: 'complete' });
    expect(summarizeLocalCustomerDebt([
      { debt: null, debtCents: null, financialProjectionStatus: 'NOT_INCLUDED' }
    ], { authoritative: true }).status).toBe('incomplete');
    expect(summarizeLocalCustomerDebt([
      { debt: 20, financialSource: 'cloud' }
    ], { authoritative: true }).status).toBe('incomplete');
    expect(summarizeLocalCustomerDebt([
      { debt: 20, debtCents: 1500, financialSource: 'local' }
    ], { authoritative: true }).status).toBe('incomplete');
  });

  it('counts a fully fiado sale as sales and credit, with no collection', () => {
    const result = summarizeLocalDashboardFinance({
      sales: [sale()],
      currentDebt: 20,
      range
    });

    expect(result.totalSales).toBe(20);
    expect(result.collected).toMatchObject({ value: 0, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: 20, status: 'complete' });
    expect(result.currentDebt).toMatchObject({ value: 20, status: 'complete' });
  });

  it('attributes a later customer payment to its own period without adding a sale', () => {
    const result = summarizeLocalDashboardFinance({
      sales: [],
      customerLedger: [{
        id: 'payment-1',
        customerId: 'customer-1',
        type: 'PAYMENT',
        amount: '-10.00',
        timestamp: '2026-11-08T11:00:00.000Z'
      }],
      currentDebt: 10,
      range
    });

    expect(result.totalSales).toBe(0);
    expect(result.collected).toMatchObject({ value: 10, status: 'complete' });
    expect(result.currentDebt).toMatchObject({ value: 10, status: 'complete' });
  });

  it('counts an explicit fully paid sale and a mixed sale without treating credit as cash', () => {
    const paid = summarizeLocalDashboardFinance({
      sales: [sale({ total: '50.00', abono: '50.00', paymentMethod: 'efectivo' })],
      range
    });
    expect(paid.totalSales).toBe(50);
    expect(paid.collected).toMatchObject({ value: 50, status: 'complete' });
    expect(paid.creditGenerated).toMatchObject({ value: 0, status: 'complete' });

    const mixed = summarizeLocalDashboardFinance({
      sales: [sale({ total: '30.00', abono: '10.00', paymentMethod: 'mixed_credit' })],
      customerLedger: [{
        id: 'payment-2',
        type: 'PAYMENT',
        amount: '-5.00',
        timestamp: '2026-11-08T12:00:00.000Z'
      }],
      currentDebt: 15,
      range
    });
    expect(mixed.totalSales).toBe(30);
    expect(mixed.collected).toMatchObject({ value: 15, status: 'complete' });
    expect(mixed.creditGenerated).toMatchObject({ value: 20, status: 'complete' });
    expect(mixed.currentDebt).toMatchObject({ value: 15, status: 'complete' });
  });

  it('deduplicates a sale-linked initial ledger payment already recorded on the sale', () => {
    const result = summarizeLocalDashboardFinance({
      sales: [sale({ total: '30.00', abono: '10.00' })],
      customerLedger: [{
        id: 'initial-payment',
        saleId: 'sale-1',
        type: 'PAYMENT',
        amount: '-10.00',
        timestamp: '2026-11-08T10:00:00.000Z'
      }],
      range
    });

    expect(result.collected).toMatchObject({ value: 10, status: 'complete' });
  });

  it('keeps verified payments available when the unpaid remainder cannot be classified as credit', () => {
    const result = summarizeLocalDashboardFinance({
      sales: [sale({
        total: '30.00',
        abono: '10.00',
        paymentMethod: 'mixed',
        payments: [{ method: 'cash', amount: '10.00' }]
      })],
      range
    });

    expect(result.collected).toMatchObject({ value: 10, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: null, status: 'incomplete' });
  });

  it('excludes open and incomplete sales, and marks legacy payments without evidence unavailable', () => {
    const open = summarizeLocalDashboardFinance({
      sales: [sale({ status: 'open' })],
      range
    });
    expect(open.totalSales).toBe(0);
    expect(open.collected).toMatchObject({ value: 0, status: 'complete' });

    const legacy = summarizeLocalDashboardFinance({
      sales: [sale({ abono: undefined, amountPaid: undefined, payments: undefined })],
      range
    });
    expect(legacy.totalSales).toBe(20);
    expect(legacy.collected).toMatchObject({ value: null, status: 'incomplete' });
    expect(legacy.creditGenerated).toMatchObject({ value: null, status: 'incomplete' });
  });

  it('does not count provisional payments or present affected reversals as complete totals', () => {
    const provisional = summarizeLocalDashboardFinance({
      sales: [],
      customerLedger: [{ type: 'PAYMENT', amount: '-10.00', status: 'pending', timestamp: range.start }],
      range
    });
    expect(provisional.collected).toMatchObject({ value: null, status: 'incomplete' });

    const reversed = summarizeLocalDashboardFinance({
      sales: [sale({ total: '50.00', abono: '50.00', paymentMethod: 'cash' })],
      cashReversalMovements: [{ type: 'cancelacion_venta', timestamp: range.start }],
      range
    });
    expect(reversed.collected).toMatchObject({ value: null, status: 'incomplete' });
    expect(reversed.creditGenerated).toMatchObject({ value: null, status: 'incomplete' });

    const cancelledCredit = summarizeLocalDashboardFinance({
      sales: [],
      cancelledSales: [{ id: 'sale-credit', status: 'cancelled', cancelledAt: range.start }],
      customerLedger: [{
        id: 'credit-charge',
        type: 'CHARGE',
        amount: '20.00',
        reference: 'sale-credit',
        timestamp: range.start
      }],
      currentDebt: 20,
      hasUnresolvedCreditCancellation: true,
      range
    });
    expect(cancelledCredit.creditGenerated).toMatchObject({ value: null, status: 'incomplete' });
    expect(cancelledCredit.currentDebt).toMatchObject({ value: null, status: 'incomplete' });
  });

  it('attributes later payments by their event timestamp and flags unlocated rows in bounded periods', () => {
    const outsideRange = summarizeLocalDashboardFinance({
      sales: [],
      customerLedger: [{ type: 'PAYMENT', amount: '-10.00', timestamp: '2026-11-07T23:59:59.999Z' }],
      range
    });
    expect(outsideRange.collected).toMatchObject({ value: 0, status: 'complete' });

    const noTimestamp = summarizeLocalDashboardFinance({
      sales: [],
      customerLedger: [{ type: 'PAYMENT', amount: '-10.00' }],
      range
    });
    expect(noTimestamp.collected).toMatchObject({ value: null, status: 'incomplete' });

    const normalizedRange = summarizeLocalDashboardFinance({
      sales: [],
      customerLedger: [{ type: 'PAYMENT', amount: '-10.00' }],
      range: {
        startIso: '2026-11-08T00:00:00.000Z',
        endIso: '2026-11-08T23:59:59.999Z'
      }
    });
    expect(normalizedRange.collected).toMatchObject({ value: null, status: 'incomplete' });
  });
});
