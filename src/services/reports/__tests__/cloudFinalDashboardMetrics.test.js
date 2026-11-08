import { describe, expect, it } from 'vitest';
import { getCloudFinalDashboardMetrics } from '../cloudFinalDashboardMetrics';

const cloudReport = (overrides = {}) => ({
  success: true,
  scope: 'mine',
  dateRange: {
    date_from: '2026-10-09T12:00:00.000Z',
    date_to: '2026-11-08T12:00:00.000Z'
  },
  source: { mode: 'cloud_final', final: true, stale: false },
  overview: {
    net_sales_total: 20,
    net_sales_count: 1,
    cash_sales_total: 0,
    card_sales_total: 0,
    transfer_sales_total: 0,
    credit_sales_total: 20,
    mixed_sales_total: 20,
    credit_payments_total: 0,
    credit_initial_payments_total: 0,
    credit_balance_created_total: 20,
    cancelled_sales_count: 0,
    cash_reversal_total: 0,
    credit_reversal_total: 0,
    ...overrides
  }
});

const historyReport = (sales = [], overrides = {}) => ({
  success: true,
  scope: 'mine',
  dateRange: {
    date_from: '2026-10-09T12:00:00.000Z',
    date_to: '2026-11-08T12:00:00.000Z'
  },
  source: { mode: 'cloud_final', final: true, stale: false },
  rows: sales,
  offset: 0,
  totalCount: sales.length,
  hasMore: false,
  ...overrides
});

const cloudSale = (overrides = {}) => ({
  id: 'sale-cloud-1',
  status: 'closed',
  source_mode: 'cloud_committed',
  total: '20.00',
  amount_paid: '0.00',
  credit_effect_status: 'applied',
  ...overrides
});

describe('getCloudFinalDashboardMetrics', () => {
  it('does not treat a fully fiado sale or the credit payment category as collected cash', () => {
    const result = getCloudFinalDashboardMetrics(cloudReport(), {
      creditHistoryReport: historyReport([cloudSale()])
    });

    expect(result.netSales).toMatchObject({ value: 20, status: 'complete' });
    expect(result.collected).toMatchObject({ value: 0, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: 20, status: 'complete' });
    expect(result.pendingDebt.status).toBe('unavailable');
  });

  it('combines sale tenders with later ledger collections and subtracts the initial ledger payment once', () => {
    const result = getCloudFinalDashboardMetrics(cloudReport({
      net_sales_total: 30,
      cash_sales_total: 10,
      credit_sales_total: 20,
      mixed_sales_total: 30,
      credit_payments_total: 15,
      credit_initial_payments_total: 10,
      credit_balance_created_total: 20
    }), {
      creditHistoryReport: historyReport([cloudSale({
        total: '30.00', amount_paid: '10.00'
      })])
    });

    expect(result.collected).toMatchObject({ value: 15, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: 20, status: 'complete' });
  });

  it('counts a fully paid sale from tender rows and keeps credit at zero', () => {
    const result = getCloudFinalDashboardMetrics(cloudReport({
      net_sales_total: 50,
      cash_sales_total: 50,
      credit_sales_total: 0,
      mixed_sales_total: 0,
      credit_balance_created_total: 0
    }), {
      creditHistoryReport: historyReport([cloudSale({
        total: '50.00', amount_paid: '50.00', credit_effect_status: 'not_required'
      })])
    });

    expect(result.netSales.value).toBe(50);
    expect(result.collected).toMatchObject({ value: 50, status: 'complete' });
    expect(result.creditGenerated).toMatchObject({ value: 0, status: 'complete' });
  });

  it('marks collections and credit incomplete when cancellations or reversals exist', () => {
    const result = getCloudFinalDashboardMetrics(cloudReport({
      cancelled_sales_count: 1,
      cash_reversal_total: 10
    }), { creditHistoryReport: historyReport([cloudSale()]) });

    expect(result.collected).toMatchObject({ value: null, status: 'incomplete' });
    expect(result.creditGenerated).toMatchObject({ value: null, status: 'incomplete' });
  });

  it('does not turn explicit RPC failure or missing reconciliation fields into zero', () => {
    const failed = getCloudFinalDashboardMetrics({ success: false, overview: {} });
    expect(failed.netSales.status).toBe('unavailable');
    expect(failed.collected.status).toBe('unavailable');

    const missingReversalFields = getCloudFinalDashboardMetrics({
      success: true,
      source: { mode: 'cloud_final', final: true, stale: false },
      overview: { net_sales_total: 0 }
    });
    expect(missingReversalFields.netSales).toMatchObject({ value: 0, status: 'complete' });
    expect(missingReversalFields.collected.status).toBe('unavailable');
    expect(missingReversalFields.creditGenerated.status).toBe('unavailable');
  });

  it('does not label a local fallback as an official Cloud financial report', () => {
    const fallback = getCloudFinalDashboardMetrics({
      success: true,
      source: { mode: 'local', final: false },
      overview: {
        net_sales_total: 120,
        cash_sales_total: 120,
        cancelled_sales_count: 0,
        cash_reversal_total: 0,
        credit_reversal_total: 0
      }
    });

    expect(fallback.netSales.status).toBe('unavailable');
    expect(fallback.collected.status).toBe('unavailable');
    expect(fallback.creditGenerated.status).toBe('unavailable');
  });

  it('uses a separate mine history for financial credit while preserving an authorized license audit history', () => {
    const report = cloudReport();
    const creditHistoryReport = historyReport([cloudSale()]);
    const auditHistoryReport = historyReport([cloudSale({ id: 'other-device-sale' })], { scope: 'license' });

    expect(getCloudFinalDashboardMetrics(report).creditGenerated.status).toBe('unavailable');
    expect(getCloudFinalDashboardMetrics(report, { creditHistoryReport })).toMatchObject({
      creditGenerated: { value: 20, status: 'complete' }
    });
    expect(auditHistoryReport.scope).toBe('license');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { hasMore: true })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { scope: 'license' })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics({ ...report, scope: 'license' }, {
      creditHistoryReport
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { dateRange: {
        date_from: '2026-10-10T12:00:00.000Z', date_to: '2026-11-08T12:00:00.000Z'
      } })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { offset: 50, hasMore: false })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { totalCount: 2 })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], {
        source: { mode: 'cache', final: true, stale: true }
      })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], {
        source: { mode: 'cache', final: true, stale: false }
      })
    }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics({
      ...report,
      source: { mode: 'cache', final: true, stale: true }
    }, {
      creditHistoryReport: historyReport([cloudSale()], {
        source: { mode: 'cache', final: true, stale: true }
      })
    }).creditGenerated).toMatchObject({ value: null, status: 'incomplete' });
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], {
        source: { mode: 'local', final: false, stale: false }
      })
    }).creditGenerated.status).toBe('unavailable');
    expect(getCloudFinalDashboardMetrics({
      ...report,
      scope: undefined,
      raw: { scope: undefined }
    }, { creditHistoryReport }).creditGenerated.status).toBe('incomplete');
    expect(getCloudFinalDashboardMetrics(report, {
      creditHistoryReport: historyReport([cloudSale()], { raw: {} })
    }).creditGenerated.status).toBe('incomplete');
  });
});
