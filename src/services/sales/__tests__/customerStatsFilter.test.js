import { describe, expect, it } from 'vitest';
import { summarizeLocalDashboardFinance } from '../dashboardFinancialSummary';
import { filterLocalDashboardReportForCustomer } from '../customerStatsFilter';

const summarize = (report) => summarizeLocalDashboardFinance({
  sales: report.sales,
  customerLedger: report.customerLedger,
  cancelledSales: report.cancelledSales,
  cashReversalMovements: report.cashReversalMovements,
  range: report.range
});

describe('filterLocalDashboardReportForCustomer', () => {
  it('separates two customers and leaves all-customer totals unchanged', () => {
    const allCustomers = {
      sales: [
        { id: 'sale-a', customerId: 'customer-a', status: 'closed', total: 100, paymentMethod: 'cash', abono: 100 },
        { id: 'sale-b', customerId: 'customer-b', status: 'closed', total: 50, paymentMethod: 'cash', abono: 50 }
      ],
      customerLedger: [],
      cancelledSales: [],
      cashReversalMovements: []
    };

    const all = filterLocalDashboardReportForCustomer(allCustomers, null);
    const customerA = filterLocalDashboardReportForCustomer(allCustomers, 'customer-a');
    const customerB = filterLocalDashboardReportForCustomer(allCustomers, 'customer-b');

    expect(summarize(all.report).totalSales).toBe(150);
    expect(summarize(customerA.report).totalSales).toBe(100);
    expect(summarize(customerB.report).totalSales).toBe(50);
    expect(all.report).toBe(allCustomers);
  });

  it('counts a fiado sale commercially without inventing a collection', () => {
    const report = {
      sales: [{ id: 'fiado-a', customerId: 'customer-a', status: 'closed', total: 40, paymentMethod: 'fiado', abono: 0 }],
      customerLedger: [],
      cancelledSales: [],
      cashReversalMovements: []
    };
    const filtered = filterLocalDashboardReportForCustomer(report, 'customer-a').report;
    const result = summarize(filtered);

    expect(result.totalSales).toBe(40);
    expect(result.collected).toMatchObject({ value: 0, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: 40, status: 'complete' });
  });

  it('attributes an abono by its customer and payment date, even when its sale is outside the period', () => {
    const report = {
      sales: [],
      customerLedger: [
        { id: 'payment-a', customerId: 'customer-a', type: 'PAYMENT', amount: '-15', timestamp: '2026-11-08T10:00:00.000Z' },
        { id: 'payment-b', customerId: 'customer-b', type: 'PAYMENT', amount: '-30', timestamp: '2026-11-08T11:00:00.000Z' }
      ],
      cancelledSales: [],
      cashReversalMovements: [],
      range: { start: '2026-11-08T00:00:00.000Z', end: '2026-11-08T23:59:59.999Z' }
    };

    const customerA = filterLocalDashboardReportForCustomer(report, 'customer-a');
    expect(summarize(customerA.report).collected).toMatchObject({ value: 15, status: 'complete' });
    expect(customerA.report.customerLedger.map((row) => row.id)).toEqual(['payment-a']);
  });

  it('does not match legacy customer names and marks unattributed sales incomplete', () => {
    const report = {
      sales: [{ id: 'legacy-sale', customerName: 'María López', status: 'closed', total: 80, paymentMethod: 'cash', abono: 80 }],
      customerLedger: [],
      cancelledSales: [],
      cashReversalMovements: []
    };
    const filtered = filterLocalDashboardReportForCustomer(report, 'customer-a');

    expect(filtered.report.sales).toEqual([]);
    expect(filtered.salesAttributionIncomplete).toBe(true);
  });
});
