import { Money } from '../../utils/moneyMath';
import {
  getExplicitSalePaymentRows,
  normalizeRestaurantSplitPaymentMethod
} from './paymentMethodContract';

export const REFUNDABLE_PAYMENT_METHODS = Object.freeze(['cash', 'card', 'transfer']);

const toPaymentRow = (row, index, source) => {
  const method = normalizeRestaurantSplitPaymentMethod(
    row?.method || row?.paymentMethod || row?.payment_method
  );
  const amount = Money.init(row?.amount ?? row?.total ?? 0);
  if (!method || amount.lte(0)) return null;
  return {
    id: row?.id || row?.paymentId || row?.payment_id || `${source}:${index}`,
    method,
    amount: Money.toExactString(amount),
    source,
    timestamp: row?.timestamp || row?.date || row?.createdAt || null,
    cashSessionId: row?.cashSessionId || row?.cash_session_id || row?.cajaId || null,
    cashMovementId: row?.cashMovementId || row?.cash_movement_id || null
  };
};

/** The known original tenders for a sale. Legacy rows are inferred only when
 * the recorded sale method makes the paid amount unambiguous. */
export const getSalePaymentSources = (sale = {}) => {
  const paymentData = sale.paymentData || {};
  const candidate = {
    ...sale,
    payments: sale.payments || paymentData.payments,
    paymentBreakdown: sale.paymentBreakdown || paymentData.paymentBreakdown,
    paymentDetails: sale.paymentDetails || paymentData.paymentDetails
  };
  const explicit = getExplicitSalePaymentRows(candidate);
  if (explicit !== null) {
    return explicit
      .map((row, index) => toPaymentRow(row, index, 'sale'))
      .filter(Boolean);
  }

  const method = normalizeRestaurantSplitPaymentMethod(
    sale.paymentMethod || sale.payment_method
  );
  if (REFUNDABLE_PAYMENT_METHODS.includes(method)) {
    const amount = Money.init(sale.total || paymentData.amount || 0);
    return amount.gt(0)
      ? [{ id: `sale:${sale.id || sale.timestamp}:0`, method, amount: Money.toExactString(amount), source: 'sale', timestamp: sale.timestamp || null, cashSessionId: sale.cash_session_id || null, cashMovementId: null }]
      : [];
  }

  if (method === 'credit') {
    const initialMethod = normalizeRestaurantSplitPaymentMethod(
      sale.initialPaymentMethod
        || sale.initial_payment_method
        || paymentData.initialPaymentMethod
        || paymentData.abonoPaymentMethod
        || paymentData.creditPaymentMethod
        || paymentData.partialPaymentMethod
    );
    const initialAmount = Money.init(sale.abono || paymentData.amountPaid || 0);
    if (REFUNDABLE_PAYMENT_METHODS.includes(initialMethod) && initialAmount.gt(0)) {
      return [{
        id: `sale:${sale.id || sale.timestamp}:initial`,
        method: initialMethod,
        amount: Money.toExactString(initialAmount),
        source: 'initial_credit_payment',
        timestamp: sale.timestamp || null,
        cashSessionId: sale.cash_session_id || null,
        cashMovementId: null
      }];
    }
  }

  return [];
};

export const getSalePaymentCollections = (sale = {}) => (
  (Array.isArray(sale.paymentCollections) ? sale.paymentCollections : [])
    .map((row, index) => toPaymentRow(row, index, 'customer_payment'))
    .filter((row) => row && REFUNDABLE_PAYMENT_METHODS.includes(row.method))
);

export const getRefundableAmountsByMethod = (sale = {}) => {
  const totals = Object.fromEntries(REFUNDABLE_PAYMENT_METHODS.map((method) => [method, Money.init(0)]));
  if (sale.cancellationFinancials?.version === 1 || sale.status === 'cancelled') {
    return Object.fromEntries(REFUNDABLE_PAYMENT_METHODS.map((method) => [method, '0']));
  }
  for (const source of [...getSalePaymentSources(sale), ...getSalePaymentCollections(sale)]) {
    if (totals[source.method]) totals[source.method] = Money.add(totals[source.method], source.amount);
  }
  return Object.fromEntries(Object.entries(totals).map(([method, value]) => [method, Money.toExactString(value)]));
};

export const normalizeSaleRefunds = (refunds = []) => {
  if (!Array.isArray(refunds)) {
    const error = new Error('Los importes devueltos no tienen un formato válido.');
    error.code = 'INVALID_REFUND';
    throw error;
  }
  const totals = new Map();
  for (const refund of refunds) {
    const method = normalizeRestaurantSplitPaymentMethod(
      refund?.method || refund?.paymentMethod || refund?.payment_method
    );
    const rawAmount = refund?.amount ?? refund?.total;
    let amount;
    try {
      amount = Money.fromCents(Money.toCents(rawAmount || 0));
    } catch {
      amount = Money.init(-1);
    }
    if (!REFUNDABLE_PAYMENT_METHODS.includes(method) || amount.lt(0)) {
      const error = new Error('Cada devolución debe indicar un medio de pago válido y un importe no negativo.');
      error.code = 'INVALID_REFUND';
      throw error;
    }
    if (amount.eq(0)) continue;
    totals.set(method, Money.add(totals.get(method) || 0, amount));
  }
  return Array.from(totals.entries()).map(([method, amount]) => ({
    method,
    amount: Money.toExactString(amount)
  }));
};

export const buildSalePaymentSnapshot = ({ paymentData = {}, paymentMethod, total, initialPaid = 0, saleId } = {}) => {
  const explicit = getExplicitSalePaymentRows({
    payments: paymentData.payments,
    paymentBreakdown: paymentData.paymentBreakdown,
    paymentDetails: paymentData.paymentDetails
  });
  if (explicit !== null) {
    return explicit.map((row, index) => ({
      id: row.id || row.paymentId || `${saleId || 'sale'}:payment:${index}`,
      method: normalizeRestaurantSplitPaymentMethod(row.method || row.paymentMethod || row.payment_method),
      amount: Money.toExactString(row.amount ?? row.total)
    }));
  }

  const method = normalizeRestaurantSplitPaymentMethod(paymentMethod);
  if (REFUNDABLE_PAYMENT_METHODS.includes(method)) {
    const amount = Money.init(total || 0);
    return amount.gt(0)
      ? [{ id: `${saleId || 'sale'}:payment:0`, method, amount: Money.toExactString(amount) }]
      : [];
  }

  if (method === 'credit' && Money.init(initialPaid || 0).gt(0)) {
    const initialMethod = normalizeRestaurantSplitPaymentMethod(
      paymentData.initialPaymentMethod
        || paymentData.abonoPaymentMethod
        || paymentData.creditPaymentMethod
        || paymentData.partialPaymentMethod
    );
    if (REFUNDABLE_PAYMENT_METHODS.includes(initialMethod)) {
      return [{
        id: `${saleId || 'sale'}:initial-payment`,
        method: initialMethod,
        amount: Money.toExactString(initialPaid)
      }];
    }
  }
  return [];
};

export const allocateSaleRefunds = (sale, refunds) => {
  const sources = [...getSalePaymentSources(sale), ...getSalePaymentCollections(sale)];
  return refunds.map((refund) => {
    let remaining = Money.init(refund.amount);
    const allocations = [];
    for (const source of sources) {
      if (source.method !== refund.method || remaining.lte(0)) continue;
      const alreadyRefunded = (sale.cancellationFinancials?.refunds || [])
        .flatMap((entry) => entry.sourcePayments || [])
        .filter((entry) => entry.paymentId === source.id)
        .reduce((sum, entry) => Money.add(sum, entry.amount), Money.init(0));
      const available = Money.subtract(source.amount, alreadyRefunded);
      if (available.lte(0)) continue;
      const allocated = available.lte(remaining) ? available : remaining;
      allocations.push({ paymentId: source.id, source: source.source, amount: Money.toExactString(allocated) });
      remaining = Money.subtract(remaining, allocated);
    }
    return { ...refund, sourcePayments: allocations };
  });
};
