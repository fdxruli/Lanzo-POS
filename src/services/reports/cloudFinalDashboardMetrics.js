import { Money } from '../../utils/moneyMath';

const FIELD_ALIASES = Object.freeze({
  netSales: ['net_sales_total', 'netSalesTotal'],
  cashPayments: ['cash_sales_total', 'cashSalesTotal'],
  cardPayments: ['card_sales_total', 'cardSalesTotal'],
  transferPayments: ['transfer_sales_total', 'transferSalesTotal'],
  creditPayments: ['credit_payments_total', 'creditPaymentsTotal'],
  initialCreditPayments: ['credit_initial_payments_total', 'creditInitialPaymentsTotal'],
  cancelledCount: ['cancelled_sales_count', 'cancelledSalesCount'],
  cashReversals: ['cash_reversal_total', 'cashReversalTotal'],
  creditReversals: ['credit_reversal_total', 'creditReversalTotal']
});

const readMetric = (record = {}, keys = []) => {
  for (const key of keys) {
    const raw = record?.[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return { has: true, value };
  }
  return { has: false, value: null };
};

const metricSet = (overview = {}) => Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([name, aliases]) => [name, readMetric(overview, aliases)])
);

const unavailable = (reason) => ({ value: null, status: 'unavailable', reason });
const complete = (value) => ({ value, status: 'complete', reason: null });
const incomplete = (reason) => ({ value: null, status: 'incomplete', reason });

const getRangeValue = (range, keys) => {
  for (const key of keys) {
    const value = range?.[key];
    if (value !== null && value !== undefined && value !== '') return String(value);
  }
  return null;
};

const sameDateRange = (overviewReport, historyReport) => {
  const overviewRange = overviewReport?.dateRange || overviewReport?.date_range || overviewReport?.raw?.date_range;
  const historyRange = historyReport?.dateRange || historyReport?.date_range || historyReport?.raw?.date_range;
  const overviewFrom = getRangeValue(overviewRange, ['date_from', 'start', 'from', 'dateFrom']);
  const overviewTo = getRangeValue(overviewRange, ['date_to', 'end', 'to', 'dateTo']);
  const historyFrom = getRangeValue(historyRange, ['date_from', 'start', 'from', 'dateFrom']);
  const historyTo = getRangeValue(historyRange, ['date_to', 'end', 'to', 'dateTo']);
  return Boolean(overviewFrom && overviewTo && historyFrom && historyTo
    && Date.parse(overviewFrom) === Date.parse(historyFrom)
    && Date.parse(overviewTo) === Date.parse(historyTo));
};

export const isCloudFinalSource = (source = {}) => (
  source.final === true
  || source.mode === 'cloud_final'
  || (source.mode === 'cache' && source.final === true)
);

const summarizeCreditFromCloudSales = ({ reportData, historyReport }) => {
  if (!historyReport || historyReport.success === false) return unavailable('cloud_sales_history_not_available');
  if (!isCloudFinalSource(reportData?.source) || !isCloudFinalSource(historyReport.source)) {
    return unavailable('cloud_sales_history_not_official');
  }
  if (!Array.isArray(historyReport.rows || historyReport.sales)) {
    return unavailable('cloud_sales_history_not_available');
  }
  if (historyReport.hasMore || historyReport.has_more) return incomplete('cloud_sales_history_is_paged');
  if (reportData.scope && historyReport.scope && reportData.scope !== historyReport.scope) {
    return incomplete('cloud_sales_history_scope_mismatch');
  }
  if (historyReport.source?.stale !== reportData?.source?.stale || !sameDateRange(reportData, historyReport)) {
    return incomplete('cloud_sales_history_range_not_reconciled');
  }

  const overview = reportData?.overview || reportData?.summary || reportData || {};
  const netSales = readMetric(overview, FIELD_ALIASES.netSales);
  const netSalesCount = readMetric(overview, ['net_sales_count', 'netSalesCount']);
  const rows = historyReport.rows || historyReport.sales;
  if (!netSales.has || !netSalesCount.has) return unavailable('net_sales_not_in_report');

  const activeSales = rows.filter((sale = {}) => (
    String(sale.status || '').toLowerCase() === 'closed'
    && !sale.cancelledAt
    && !sale.cancelled_at
  ));
  if (activeSales.length !== netSalesCount.value) return incomplete('cloud_sales_history_count_mismatch');

  let salesTotal = Money.init(0);
  let creditTotal = Money.init(0);
  for (const sale of activeSales) {
    const total = Number(sale.total);
    const amountPaidValue = sale.amount_paid ?? sale.paid_total;
    const amountPaid = Number(amountPaidValue);
    const creditEffectStatus = String(sale.creditEffectStatus || sale.credit_effect_status || '').toLowerCase();
    if (sale.source_mode !== 'cloud_committed'
      || !Number.isFinite(total) || total <= 0
      || amountPaidValue === null || amountPaidValue === undefined || amountPaidValue === ''
      || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > total + 0.01) {
      return incomplete('cloud_sale_initial_payment_not_recorded');
    }
    if (!['applied', 'not_required'].includes(creditEffectStatus)) {
      return incomplete('cloud_sale_credit_effect_not_confirmed');
    }

    salesTotal = Money.add(salesTotal, total);
    if (creditEffectStatus === 'applied') {
      creditTotal = Money.add(creditTotal, Math.max(total - amountPaid, 0));
    }
  }

  if (Math.abs(Money.toNumber(salesTotal) - netSales.value) > 0.01) {
    return incomplete('cloud_sales_history_total_mismatch');
  }
  return complete(Money.toNumber(creditTotal));
};

const hasCancellationSignals = (metrics) => {
  const count = metrics.cancelledCount;
  const cash = metrics.cashReversals;
  const credit = metrics.creditReversals;
  if (!count.has || !cash.has || !credit.has) return { known: false, cancelled: false };
  return {
    known: true,
    cancelled: count.value !== 0 || cash.value !== 0 || credit.value !== 0
  };
};

export const getCloudFinalDashboardMetrics = (reportData = null, { historyReport = null } = {}) => {
  if (!reportData || reportData.success === false) {
    return {
      netSales: unavailable('cloud_report_not_successful'),
      collected: unavailable('cloud_report_not_successful'),
      creditGenerated: unavailable('cloud_report_not_successful'),
      pendingDebt: unavailable('cloud_report_not_successful'),
      missingFields: []
    };
  }

  if (!isCloudFinalSource(reportData.source)) {
    return {
      netSales: unavailable('cloud_report_not_official'),
      collected: unavailable('cloud_report_not_official'),
      creditGenerated: unavailable('cloud_report_not_official'),
      pendingDebt: unavailable('cloud_report_not_official'),
      missingFields: []
    };
  }

  const overview = reportData.overview || reportData.summary || reportData;
  const metrics = metricSet(overview);
  const cancellationSignals = hasCancellationSignals(metrics);
  const missingFields = Object.entries(metrics)
    .filter(([, metric]) => !metric.has)
    .map(([name]) => name);

  const netSales = metrics.netSales.has
    ? (metrics.netSales.value >= 0 ? complete(metrics.netSales.value) : incomplete('negative_net_sales_total'))
    : unavailable('net_sales_not_in_report');

  let collected = unavailable('payment_breakdown_not_in_report');
  const collectionInputs = [
    metrics.cashPayments,
    metrics.cardPayments,
    metrics.transferPayments,
    metrics.creditPayments,
    metrics.initialCreditPayments
  ];

  if (!cancellationSignals.known) {
    collected = unavailable('reversal_metrics_not_in_report');
  } else if (cancellationSignals.cancelled) {
    collected = incomplete('cancellation_or_reversal_requires_detail');
  } else if (collectionInputs.every((metric) => metric.has)) {
    const laterCreditPayments = metrics.creditPayments.value - metrics.initialCreditPayments.value;
    if (collectionInputs.some((metric) => metric.value < 0) || laterCreditPayments < -0.01) {
      collected = incomplete('credit_payment_totals_do_not_reconcile');
    } else {
      // Sale payment rows already contain the initial tender breakdown. The
      // ledger total includes that initial payment too, so only its remainder
      // is added here as later customer collections.
      collected = complete(
        metrics.cashPayments.value
        + metrics.cardPayments.value
        + metrics.transferPayments.value
        + Math.max(laterCreditPayments, 0)
      );
    }
  }

  let creditGenerated = unavailable('credit_breakdown_not_in_report');
  if (!cancellationSignals.known) {
    creditGenerated = unavailable('reversal_metrics_not_in_report');
  } else if (cancellationSignals.cancelled) {
    creditGenerated = incomplete('credit_cancellation_requires_detail');
  } else {
    // The aggregate credit_balance_created_total is grouped by ledger.created_at,
    // which can differ from sale.sold_at for an offline sale synced later. Use
    // immutable initial amount_paid from the sale history for sale-period credit.
    creditGenerated = summarizeCreditFromCloudSales({ reportData, historyReport });
  }

  return {
    netSales,
    collected,
    creditGenerated,
    // `customer_debt_total` in the RPC is license-wide while Dashboard asks
    // for `scope: mine`; don't expose that wider aggregate as this user's debt.
    pendingDebt: unavailable('cloud_balance_not_available_for_scope'),
    missingFields
  };
};

export default getCloudFinalDashboardMetrics;
