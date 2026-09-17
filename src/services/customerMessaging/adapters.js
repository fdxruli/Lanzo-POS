import { buildCustomerMessagePayload } from './payloadBuilder';
import { isCreditPaymentMethod, normalizeMoney } from './normalizers';

const read = (source, ...keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
  return null;
};

const positiveMoney = (value) => {
  const normalized = normalizeMoney(value);
  return normalized.ok && normalized.amount.gt(0);
};

const noteBalance = (note = {}) => read(
  note,
  'currentOwed',
  'current_owed',
  'balanceDue',
  'balance_due',
  'saldoPendiente',
  'remainingBalance',
  'remaining_balance',
  'pendingBalance',
  'pending_balance'
);

/**
 * This selector is shared by customer read/message surfaces. It does not
 * mutate sales, allocations, ledger entries, or cached debt projections.
 */
export const selectCreditNotes = ({ customerId = null, cloudSummary = null, localSales = [] } = {}) => {
  const cloudNoteCollections = [
    cloudSummary?.noteDetails,
    cloudSummary?.note_details,
    cloudSummary?.pendingNotes,
    cloudSummary?.pending_notes,
    cloudSummary?.creditNotes,
    cloudSummary?.credit_notes,
    cloudSummary?.pendingSales,
    cloudSummary?.pending_sales
  ].filter(Array.isArray);
  const cloudNotes = cloudNoteCollections.find((notes) => notes.length > 0) || cloudNoteCollections[0];
  const source = Array.isArray(cloudNotes) ? 'cloud' : 'local';
  const candidates = Array.isArray(cloudNotes) ? cloudNotes : (Array.isArray(localSales) ? localSales : []);

  return candidates.filter((note) => {
    if (customerId && read(note, 'customerId', 'customer_id') && read(note, 'customerId', 'customer_id') !== customerId) {
      return false;
    }
    const method = read(note, 'paymentMethod', 'payment_method', 'method');
    // A cloud `pending_notes` response already represents credit notes. When a
    // method is supplied, still enforce the shared alias predicate.
    const creditLike = source === 'cloud' && !method ? true : isCreditPaymentMethod(method);
    return creditLike && positiveMoney(noteBalance(note));
  }).map((note) => ({
    ...note,
    paymentMethod: read(note, 'paymentMethod', 'payment_method', 'method') || 'credit',
    saldoPendiente: noteBalance(note),
    timestamp: read(note, 'timestamp', 'soldAt', 'sold_at', 'createdAt', 'created_at'),
    folio: read(note, 'folio', 'saleFolio', 'sale_folio', 'reference') || null,
    items: Array.isArray(note.items) ? note.items : []
  }));
};

const cloudSummaryBalance = (summary = {}) => read(
  summary,
  'totalBalance',
  'total_balance',
  'newDebt',
  'new_debt',
  'debt'
) ?? read(
  summary?.customer,
  'totalBalance',
  'total_balance',
  'newDebt',
  'new_debt',
  'debt',
  'currentDebt',
  'current_debt'
);

const cloudSummaryCutoff = (summary = {}) => read(
  summary,
  'cutoffAt',
  'cutoff_at',
  'generatedAt',
  'generated_at',
  'asOf',
  'as_of',
  'updatedAt',
  'updated_at'
) ?? read(summary?.customer, 'updatedAt', 'updated_at', 'createdAt', 'created_at');

/**
 * The cloud repository maps an absent receipt to an object with zero-value
 * fallbacks. Treat that placeholder as absent so it cannot override a real
 * confirmed balance from the operation result.
 */
export const hasConfirmedPaymentReceipt = (receipt = null) => {
  if (!receipt || typeof receipt !== 'object') return false;
  if (read(receipt, 'id', 'ledgerId', 'ledger_id', 'reference', 'folio', 'createdAt', 'created_at', 'occurredAt', 'timestamp')) return true;

  const amount = normalizeMoney(read(receipt, 'amount'));
  return amount.ok && amount.amount.gt(0);
};

/**
 * Builds a statement from a cloud summary when available, with the local cache
 * only as a read-only fallback. The caller supplies the durable cutoff/clock.
 */
export const buildAccountStatementMessagePayload = ({
  customer,
  business,
  cloudSummary = null,
  localSales = [],
  occurredAt,
  currency = 'MXN',
  timeZone
} = {}) => {
  const notes = selectCreditNotes({
    customerId: customer?.id,
    cloudSummary,
    localSales
  });
  const balance = cloudSummaryBalance(cloudSummary) ?? customer?.debt;
  const cutoffAt = cloudSummaryCutoff(cloudSummary) || occurredAt;

  return buildCustomerMessagePayload({
    eventType: 'account_statement',
    customer,
    business,
    occurredAt: cutoffAt,
    currency,
    account: {
      cutoffAt,
      totalBalance: balance,
      totalPayments: read(cloudSummary, 'totalPayments', 'total_payments', 'paymentsTotal', 'payments_total'),
      pendingNotes: notes,
      noteDetails: notes
    },
    internalContext: { source: cloudSummary ? 'cloud_credit_summary' : 'local_sales_read' },
    timeZone
  });
};

/**
 * Uses the repository receipt first. The fallback fields are already-confirmed
 * operation data; this is a mapper and never repeats or initiates a payment.
 */
export const buildPaymentMessagePayload = ({
  customer,
  business,
  financialResult = {},
  receipt = null,
  previousBalance,
  occurredAt,
  currency = 'MXN',
  allocations = [],
  timeZone
} = {}) => {
  const confirmedReceipt = hasConfirmedPaymentReceipt(receipt) ? receipt : {};
  const newBalance = read(confirmedReceipt, 'newBalance', 'newDebt', 'new_debt')
    ?? read(financialResult, 'newBalance', 'newDebt', 'new_debt');
  const normalizedBalance = normalizeMoney(newBalance);
  const eventType = normalizedBalance.ok && normalizedBalance.amount.lte(0)
    ? 'account_settled'
    : 'payment_partial';
  const paymentOccurredAt = read(confirmedReceipt, 'occurredAt', 'createdAt', 'created_at', 'timestamp') || occurredAt;
  const paymentId = read(confirmedReceipt, 'id', 'ledgerId', 'ledger_id')
    || read(financialResult, 'ledgerId', 'ledger_id');

  return buildCustomerMessagePayload({
    eventType,
    customer,
    business,
    occurredAt: paymentOccurredAt,
    currency,
    reference: read(confirmedReceipt, 'reference', 'folio') || paymentId || null,
    payment: {
      id: paymentId,
      reference: read(confirmedReceipt, 'reference', 'folio') || paymentId || null,
      occurredAt: paymentOccurredAt,
      method: read(confirmedReceipt, 'method', 'paymentMethod', 'payment_method') || 'efectivo',
      previousBalance: read(confirmedReceipt, 'previousBalance', 'previousDebt', 'previous_debt') ?? previousBalance,
      amount: read(confirmedReceipt, 'amount') ?? financialResult.amount,
      newBalance,
      allocations
    },
    account: { totalBalance: newBalance },
    internalContext: { source: hasConfirmedPaymentReceipt(receipt) ? 'customer_credit_receipt' : 'customer_credit_confirmed_local_result' },
    timeZone
  });
};

/**
 * Contract-only adapter for layaway outcomes returned by the existing financial
 * service. It intentionally does not import that service, create a sale, or
 * create a folio. Delivery is the only event allowed to receive the final sale
 * folio supplied by the already-confirmed delivery result.
 */
export const buildLayawayMessagePayload = ({
  eventType,
  customer,
  business,
  layaway = {},
  occurredAt,
  currency = 'MXN',
  timeZone
} = {}) => buildCustomerMessagePayload({
  eventType,
  customer,
  business,
  occurredAt: occurredAt || read(layaway, 'occurredAt', 'updatedAt', 'updated_at', 'createdAt', 'created_at'),
  currency,
  reference: read(layaway, 'reference', 'layawayReference', 'folio') || null,
  layaway: {
    id: read(layaway, 'id', 'layawayId', 'layaway_id'),
    reference: read(layaway, 'reference', 'layawayReference', 'folio') || null,
    items: layaway.items || [],
    total: read(layaway, 'total'),
    initialPayment: read(layaway, 'initialPayment', 'initial_payment', 'deposit'),
    previousPaid: read(layaway, 'previousPaid', 'previous_paid'),
    paymentAmount: read(layaway, 'paymentAmount', 'payment_amount'),
    totalPaid: read(layaway, 'totalPaid', 'total_paid', 'amountPaid'),
    balanceDue: read(layaway, 'balanceDue', 'balance_due', 'remainingBalance'),
    deadline: read(layaway, 'deadline', 'dueDate', 'due_date'),
    status: read(layaway, 'status'),
    deliveryDate: read(layaway, 'deliveryDate', 'delivery_date', 'deliveredAt', 'delivered_at'),
    saleFolio: read(layaway, 'saleFolio', 'sale_folio')
  },
  internalContext: { source: 'layaway_financial_result' },
  timeZone
});
