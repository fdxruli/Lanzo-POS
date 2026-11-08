import { Money } from '../../utils/moneyMath';
import {
  getExplicitSalePaymentRows,
  getExplicitSalePaymentSource,
  normalizeRestaurantSplitPaymentMethod
} from './paymentMethodContract';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { normalizeFinancialNumber, summarizeFinancialSales } from './financialPolicy';

const CLOSED_STATUSES = new Set(['closed', 'completed']);
const PAYMENT_REVERSAL_TYPES = new Set(['CANCEL_PAYMENT', 'PAYMENT_REVERSAL', 'REFUND']);
const BLOCKED_PAYMENT_STATUSES = new Set(['pending', 'failed', 'rejected', 'cancelled']);
const INCOMPLETE = (reason) => ({ value: null, status: 'incomplete', reason });
const COMPLETE = (value) => ({ value: Money.toNumber(Money.init(value)), status: 'complete', reason: null });

const hasOwnValue = (record, keys) => keys.some((key) => (
  Object.prototype.hasOwnProperty.call(record || {}, key)
  && record[key] !== null
  && record[key] !== undefined
  && record[key] !== ''
));

const readOwnedNumber = (record, keys) => {
  for (const key of keys) {
    if (!hasOwnValue(record, [key])) continue;
    return normalizeFinancialNumber(record[key], Number.NaN);
  }
  return Number.NaN;
};

const saleTotal = (sale = {}) => {
  const explicitTotal = normalizeFinancialNumber(sale.total, Number.NaN);
  if (Number.isFinite(explicitTotal)) return explicitTotal;
  return summarizeFinancialSales([sale]).totalRevenue;
};

const resolveInitialPaidAmount = (sale = {}) => {
  const total = saleTotal(sale);
  const unavailable = (reason) => ({
    paymentComplete: false,
    creditComplete: false,
    amount: null,
    creditAmount: null,
    reason
  });
  if (!Number.isFinite(total) || total < 0) return unavailable('invalid_sale_total');
  if (total === 0) return { paymentComplete: true, creditComplete: true, amount: 0, creditAmount: 0 };

  const paymentStatus = String(sale.paymentStatus || sale.payment_status || '').trim().toLowerCase();
  if (BLOCKED_PAYMENT_STATUSES.has(paymentStatus)) {
    return unavailable('payment_not_confirmed');
  }

  const explicitSource = getExplicitSalePaymentSource(sale);
  if (explicitSource) {
    const rows = getExplicitSalePaymentRows(sale) || [];
    if (rows.length !== explicitSource.length) {
      return unavailable('invalid_explicit_payment_rows');
    }

    let paid = Money.init(0);
    let breakdownTotal = Money.init(0);
    let hasCreditRow = false;

    for (const row of rows) {
      const rowStatus = String(row.status || row.paymentStatus || row.payment_status || '').trim().toLowerCase();
      if (BLOCKED_PAYMENT_STATUSES.has(rowStatus)) {
        return unavailable('payment_not_confirmed');
      }
      const method = normalizeRestaurantSplitPaymentMethod(
        row.method || row.paymentMethod || row.payment_method
      );
      const amount = normalizeFinancialNumber(row.amount ?? row.total, Number.NaN);
      if (!Number.isFinite(amount) || amount <= 0 || !method) {
        return unavailable('invalid_explicit_payment_rows');
      }

      breakdownTotal = Money.add(breakdownTotal, amount);
      if (method === 'credit') {
        hasCreditRow = true;
        continue;
      }
      if (!['cash', 'card', 'transfer'].includes(method)) {
        return unavailable('unknown_payment_method');
      }
      paid = Money.add(paid, amount);
    }

    const paidAmount = Money.toNumber(paid);
    const breakdownAmount = Money.toNumber(breakdownTotal);
    if (paidAmount > total + 0.01 || (hasCreditRow && Math.abs(breakdownAmount - total) > 0.01)) {
      return unavailable('payment_breakdown_does_not_match_sale');
    }
    const creditAmount = Math.max(total - paidAmount, 0);
    const saleMethod = normalizeRestaurantSplitPaymentMethod(
      sale.paymentMethod || sale.payment_method || ''
    );
    return {
      paymentComplete: true,
      creditComplete: creditAmount <= 0.01 || hasCreditRow || saleMethod === 'credit',
      amount: paidAmount,
      creditAmount
    };
  }

  const paid = readOwnedNumber(sale, ['abono', 'amountPaid', 'amount_paid']);
  if (!Number.isFinite(paid) || paid < 0 || paid > total + 0.01) {
    return unavailable('initial_payment_not_recorded');
  }

  const amount = Math.min(paid, total);
  const creditAmount = Math.max(total - amount, 0);
  const saleMethod = normalizeRestaurantSplitPaymentMethod(
    sale.paymentMethod || sale.payment_method || ''
  );
  return {
    paymentComplete: true,
    creditComplete: creditAmount <= 0.01 || saleMethod === 'credit',
    amount,
    creditAmount
  };
};

const eventTimestamp = (row = {}) => (
  row.timestamp || row.createdAt || row.created_at || row.fecha || null
);

const rangeBound = (range, side) => {
  const keys = side === 'start'
    ? ['start', 'startIso', 'from', 'inicio']
    : ['end', 'endIso', 'to', 'fin'];
  for (const key of keys) {
    if (range?.[key] !== null && range?.[key] !== undefined && range[key] !== '') return range[key];
  }
  return null;
};

const isInRange = (value, range = null) => {
  const startValue = rangeBound(range, 'start');
  const endValue = rangeBound(range, 'end');
  if (!startValue && !endValue) return true;
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return false;
  const start = startValue ? Date.parse(startValue) : null;
  const end = endValue ? Date.parse(endValue) : null;
  return (!Number.isFinite(start) || time >= start) && (!Number.isFinite(end) || time <= end);
};

const ledgerType = (row = {}) => String(row.type || row.tipo || '').trim().toUpperCase();
const ledgerAmount = (row = {}) => normalizeFinancialNumber(row.amount ?? row.monto, Number.NaN);
const ledgerStatus = (row = {}) => String(row.status || row.paymentStatus || row.payment_status || '').trim().toLowerCase();

const isInitialSaleLedgerPayment = (row = {}) => {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const referenceType = String(row.referenceType || row.reference_type || '').toLowerCase();
  const source = String(metadata.source || '').toLowerCase();
  return Boolean(
    row.saleId || row.sale_id
    || referenceType === 'sale'
    || metadata.initial_payment_amount !== undefined
    || source === 'pos_create_cloud_sale_credit'
  );
};

const isCashReversalMovement = (row = {}) => {
  const type = String(row.type || row.tipo || '').trim().toLowerCase();
  const source = String(row.source || row.origen || row.metadata?.source || '').trim().toLowerCase();
  return [
    'cancelacion', 'cancelacion_venta', 'cancelacion_abono_inicial',
    'sale_refund', 'cash_refund', 'refund'
  ].includes(type) || ['sale_cancellation_refund', 'sale_refund'].includes(source);
};

const isClosedSale = (sale = {}) => CLOSED_STATUSES.has(String(sale.status || '').toLowerCase());
const isCancelledSale = (sale = {}) => (
  String(sale.status || '').toLowerCase() === 'cancelled'
  || String(sale.fulfillmentStatus || sale.fulfillment_status || '').toLowerCase() === 'cancelled'
);

const UNKNOWN_DEBT_PROJECTION_STATUSES = new Set(['historical_pending', 'conflict', 'not_included', 'unknown']);

export const summarizeLocalCustomerDebt = (customers, { authoritative = false } = {}) => {
  if (!authoritative || !Array.isArray(customers)) return INCOMPLETE('current_debt_not_available');

  let total = Money.init(0);
  for (const customer of customers) {
    const projectionStatus = String(customer?.financialProjectionStatus || '').toLowerCase();
    const syncStatus = String(customer?.syncStatus || '').toLowerCase();
    if (
      UNKNOWN_DEBT_PROJECTION_STATUSES.has(projectionStatus)
      || ['conflict', 'error'].includes(syncStatus)
      || (customer?.financialSource && customer.financialSource !== 'local')
    ) {
      return INCOMPLETE('current_debt_not_available');
    }

    const rawDebt = customer?.debt ?? (
      customer?.debtCents !== null && customer?.debtCents !== undefined
        ? Number(customer.debtCents) / 100
        : null
    );
    const debt = normalizeFinancialNumber(rawDebt, Number.NaN);
    if (!Number.isFinite(debt) || debt < 0) return INCOMPLETE('current_debt_not_available');
    const debtCents = customer?.debtCents ?? customer?.debt_cents;
    if (debtCents !== null && debtCents !== undefined
      && normalizeCustomerDebtCents(debt) !== Number(debtCents)) {
      return INCOMPLETE('current_debt_not_available');
    }
    total = Money.add(total, debt);
  }

  return COMPLETE(total);
};

export const summarizeLocalDashboardFinance = ({
  sales = [],
  customerLedger = [],
  cancelledSales = [],
  cashReversalMovements = [],
  hasUnresolvedCreditCancellation = false,
  currentDebt = undefined,
  range = null
} = {}) => {
  const validSales = (sales || []).filter((sale) => isClosedSale(sale) && !isCancelledSale(sale));
  const salesSummary = summarizeFinancialSales(validSales);
  let creditGenerated = Money.init(0);
  let initialCollections = Money.init(0);
  let hasIncompleteInitialPayment = false;
  let hasIncompleteCreditEvidence = false;

  for (const sale of validSales) {
    const payment = resolveInitialPaidAmount(sale);
    if (!payment.paymentComplete) {
      hasIncompleteInitialPayment = true;
      hasIncompleteCreditEvidence = true;
      continue;
    }

    initialCollections = Money.add(initialCollections, payment.amount);
    if (payment.creditComplete) creditGenerated = Money.add(creditGenerated, payment.creditAmount);
    else hasIncompleteCreditEvidence = true;
  }

  const rawPaymentLedger = (customerLedger || []).filter((row) => (
    ['PAYMENT', 'CANCEL_CHARGE', ...PAYMENT_REVERSAL_TYPES].includes(ledgerType(row))
  ));
  const finiteRange = Boolean(rangeBound(range, 'start') || rangeBound(range, 'end'));
  const unlocatedPayment = finiteRange && rawPaymentLedger.some((row) => !eventTimestamp(row));
  const inPeriodLedger = rawPaymentLedger.filter((row) => (
    !eventTimestamp(row) ? !finiteRange : isInRange(eventTimestamp(row), range)
  ));
  const relevantLedger = inPeriodLedger;
  const unconfirmedPayment = relevantLedger.some((row) => BLOCKED_PAYMENT_STATUSES.has(ledgerStatus(row)));
  const hasPaymentReversal = relevantLedger.some((row) => PAYMENT_REVERSAL_TYPES.has(ledgerType(row)));
  const paymentReversals = inPeriodLedger.filter((row) => PAYMENT_REVERSAL_TYPES.has(ledgerType(row)));
  const ledgerCollections = relevantLedger.reduce((sum, row) => {
    const type = ledgerType(row);
    if (type !== 'PAYMENT' || isInitialSaleLedgerPayment(row)) return sum;
    const amount = ledgerAmount(row);
    return Number.isFinite(amount) ? Money.add(sum, Math.abs(amount)) : sum;
  }, Money.init(0));

  const cancellationSignals = (cancelledSales || []).length > 0
    || (cashReversalMovements || []).some(isCashReversalMovement)
    || inPeriodLedger.some((row) => ['CANCEL_CHARGE', ...PAYMENT_REVERSAL_TYPES].includes(ledgerType(row)));
  const cancellationOrRefundInPeriod = cancellationSignals;

  const collectionsBlocked = cancellationOrRefundInPeriod || hasIncompleteInitialPayment
    || unlocatedPayment || unconfirmedPayment
    || relevantLedger.some((row) => !Number.isFinite(ledgerAmount(row)));

  const creditBlocked = cancellationOrRefundInPeriod || hasIncompleteCreditEvidence;

  const collectedTotal = paymentReversals.length > 0
    ? null
    : Money.add(initialCollections, ledgerCollections);

  let currentDebtMetric;
  const parsedCurrentDebt = normalizeFinancialNumber(currentDebt, Number.NaN);
  if (!Number.isFinite(parsedCurrentDebt) || parsedCurrentDebt < 0) {
    currentDebtMetric = INCOMPLETE('current_debt_not_available');
  } else if (hasUnresolvedCreditCancellation) {
    currentDebtMetric = INCOMPLETE('credit_cancellation_not_reconciled');
  } else {
    currentDebtMetric = COMPLETE(parsedCurrentDebt);
  }

  return {
    totalSales: salesSummary.totalRevenue,
    salesCount: salesSummary.totalSales,
    collected: collectionsBlocked
      ? INCOMPLETE(cancellationOrRefundInPeriod ? 'cancellation_or_refund_in_period' : 'payment_evidence_incomplete')
      : COMPLETE(collectedTotal),
    creditGenerated: creditBlocked
      ? INCOMPLETE(cancellationOrRefundInPeriod
        ? 'credit_cancellation_in_period'
        : 'initial_payment_evidence_incomplete')
      : COMPLETE(creditGenerated),
    currentDebt: currentDebtMetric,
    hasIncompleteSalePayment: hasIncompleteInitialPayment || hasIncompleteCreditEvidence,
    hasIncompleteInitialPayment,
    hasIncompleteCreditEvidence,
    hasPaymentReversal,
    hasUnlocatedPayment: unlocatedPayment,
    hasUnconfirmedPayment: unconfirmedPayment,
    hasCancellationOrRefund: cancellationOrRefundInPeriod
  };
};

export default summarizeLocalDashboardFinance;
