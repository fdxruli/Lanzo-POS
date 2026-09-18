import { CUSTOMER_MESSAGE_EVENT_TYPES, getCustomerMessageContract } from './contracts';
import {
  DEFAULT_MESSAGE_TIME_ZONE,
  isCreditPaymentMethod,
  isValueMissing,
  normalizeMessageDate,
  normalizeMoney,
  normalizePaymentMethod
} from './normalizers';

const getAtPath = (source, path) => path.split('.').reduce(
  (value, key) => (value === null || value === undefined ? undefined : value[key]),
  source
);

const cloneItems = (items) => Array.isArray(items)
  ? items.map((item) => ({
    id: item?.id || item?.productId || item?.product_id || null,
    name: item?.name || item?.productName || item?.product_name || '',
    quantity: item?.quantity ?? 0,
    price: item?.price ?? item?.unitPrice ?? item?.unit_price ?? null,
    total: item?.total ?? item?.lineTotal ?? item?.line_total ?? item?.exactTotal ?? item?.lineSubtotal ?? item?.line_subtotal ?? item?.subtotal ?? null,
    requiresPrescription: Boolean(item?.requiresPrescription)
  }))
  : [];

const normalizePrescriptionDetails = (details) => {
  if (!details || typeof details !== 'object') return null;
  const doctorName = String(details.doctorName ?? details.doctor_name ?? '').trim();
  const licenseNumber = String(details.licenseNumber ?? details.license_number ?? '').trim();
  const notes = String(details.notes ?? '').trim();
  return doctorName || licenseNumber || notes ? { doctorName, licenseNumber, notes } : null;
};

const normalizeMoneyField = (value, path, errors, { required = false } = {}) => {
  if (isValueMissing(value)) {
    if (required) errors.push({ path, code: 'MONEY_VALUE_MISSING' });
    return null;
  }

  const normalized = normalizeMoney(value);
  if (!normalized.ok) {
    errors.push({ path, code: normalized.code });
    return null;
  }
  return normalized.exact;
};

const normalizeDateField = (value, path, errors, timeZone) => {
  if (isValueMissing(value)) return null;
  const normalized = normalizeMessageDate(value, { timeZone });
  if (!normalized.ok) {
    errors.push({ path, code: normalized.code });
    return null;
  }
  return normalized.value;
};

const read = (source, ...keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
  return null;
};

const normalizeSale = (sale = {}, errors, timeZone) => {
  const originalMethod = read(sale, 'payment_method', 'paymentMethod');
  const paymentMethod = normalizePaymentMethod(originalMethod);
  return {
    id: read(sale, 'id', 'saleId', 'sale_id'),
    folio: read(sale, 'folio', 'saleFolio', 'sale_folio'),
    items: cloneItems(sale.items),
    subtotal: normalizeMoneyField(read(sale, 'subtotal', 'grossSubtotal'), 'sale.subtotal', errors),
    discount: normalizeMoneyField(read(sale, 'discount', 'discountTotal', 'discount_total'), 'sale.discount', errors),
    total: normalizeMoneyField(read(sale, 'total'), 'sale.total', errors),
    paymentMethod: paymentMethod.original ? paymentMethod.canonical : null,
    amountPaid: normalizeMoneyField(read(sale, 'amount_paid', 'abono', 'amountPaid'), 'sale.amountPaid', errors),
    receivedAmount: normalizeMoneyField(read(sale, 'received_amount', 'receivedAmount'), 'sale.receivedAmount', errors),
    changeAmount: normalizeMoneyField(read(sale, 'change_amount', 'changeAmount'), 'sale.changeAmount', errors),
    balanceDue: normalizeMoneyField(read(sale, 'balance_due', 'saldoPendiente', 'balanceDue'), 'sale.balanceDue', errors),
    dueDate: normalizeDateField(read(sale, 'dueDate', 'due_date'), 'sale.dueDate', errors, timeZone),
    creditStatus: read(sale, 'creditStatus', 'credit_status'),
    salesChannel: read(sale, 'salesChannel', 'sales_channel'),
    ecommerceOrderCode: read(sale, 'ecommerceOrderCode', 'ecommerce_order_code'),
    posFolio: read(sale, 'posFolio', 'pos_folio', 'operationalFolio', 'operational_folio'),
    discountDetail: sale.saleDiscount || sale.metadata?.discount || null,
    prescriptionDetails: normalizePrescriptionDetails(read(sale, 'prescriptionDetails', 'prescription_details')),
    originalPaymentMethod: paymentMethod.original
  };
};

const normalizePayment = (payment = {}, errors, timeZone) => ({
  id: read(payment, 'id', 'ledgerId', 'ledger_id'),
  reference: read(payment, 'reference', 'folio'),
  occurredAt: normalizeDateField(read(payment, 'occurredAt', 'createdAt', 'created_at', 'timestamp'), 'payment.occurredAt', errors, timeZone),
  method: normalizePaymentMethod(read(payment, 'method', 'paymentMethod', 'payment_method')).canonical,
  previousBalance: normalizeMoneyField(read(payment, 'previousBalance', 'previousDebt', 'previous_debt'), 'payment.previousBalance', errors),
  amount: normalizeMoneyField(read(payment, 'amount'), 'payment.amount', errors),
  newBalance: normalizeMoneyField(read(payment, 'newBalance', 'newDebt', 'new_debt'), 'payment.newBalance', errors),
  allocations: Array.isArray(payment.allocations) ? payment.allocations : [],
  originalMethod: read(payment, 'method', 'paymentMethod', 'payment_method') || null
});

const normalizeAccount = (account = {}, errors, timeZone) => ({
  cutoffAt: normalizeDateField(read(account, 'cutoffAt', 'cutoff_at'), 'account.cutoffAt', errors, timeZone),
  totalBalance: normalizeMoneyField(read(account, 'totalBalance', 'total_balance', 'debt'), 'account.totalBalance', errors),
  totalPayments: normalizeMoneyField(read(account, 'totalPayments', 'total_payments'), 'account.totalPayments', errors),
  pendingNotes: Array.isArray(read(account, 'pendingNotes', 'pending_notes')) ? read(account, 'pendingNotes', 'pending_notes') : [],
  noteDetails: Array.isArray(read(account, 'noteDetails', 'note_details')) ? read(account, 'noteDetails', 'note_details') : []
});

const normalizeLayaway = (layaway = {}, errors, timeZone) => ({
  id: read(layaway, 'id', 'layawayId', 'layaway_id'),
  reference: read(layaway, 'reference', 'folio', 'layawayReference'),
  items: cloneItems(layaway.items),
  total: normalizeMoneyField(read(layaway, 'total'), 'layaway.total', errors),
  initialPayment: normalizeMoneyField(read(layaway, 'initialPayment', 'initial_payment', 'deposit'), 'layaway.initialPayment', errors),
  previousPaid: normalizeMoneyField(read(layaway, 'previousPaid', 'previous_paid'), 'layaway.previousPaid', errors),
  paymentAmount: normalizeMoneyField(read(layaway, 'paymentAmount', 'payment_amount'), 'layaway.paymentAmount', errors),
  totalPaid: normalizeMoneyField(read(layaway, 'totalPaid', 'total_paid', 'amountPaid'), 'layaway.totalPaid', errors),
  balanceDue: normalizeMoneyField(read(layaway, 'balanceDue', 'balance_due', 'remainingBalance'), 'layaway.balanceDue', errors),
  deadline: normalizeDateField(read(layaway, 'deadline', 'dueDate', 'due_date'), 'layaway.deadline', errors, timeZone),
  status: read(layaway, 'status'),
  deliveryDate: normalizeDateField(read(layaway, 'deliveryDate', 'delivery_date', 'deliveredAt', 'delivered_at'), 'layaway.deliveryDate', errors, timeZone),
  saleFolio: read(layaway, 'saleFolio', 'sale_folio')
});

const validateRequiredFields = (payload, requiredFields) => requiredFields.reduce((errors, path) => {
  const value = getAtPath(payload, path);
  if (isValueMissing(value) || (Array.isArray(value) && value.length === 0 && path.endsWith('.items'))) {
    errors.push({ path, code: 'MESSAGE_REQUIRED_FIELD_MISSING' });
  }
  return errors;
}, []);

const isZeroOrBelow = (value) => {
  const normalized = normalizeMoney(value);
  return normalized.ok && normalized.amount.lte(0);
};

const isPositive = (value) => {
  const normalized = normalizeMoney(value);
  return normalized.ok && normalized.amount.gt(0);
};

const validateEventSemantics = (payload, errors) => {
  if (payload.eventType === 'account_settled' && !isZeroOrBelow(payload.payment.newBalance)) {
    errors.push({ path: 'payment.newBalance', code: 'ACCOUNT_SETTLED_BALANCE_INVALID' });
  }
  if (payload.eventType === 'payment_partial' && !isPositive(payload.payment.newBalance)) {
    errors.push({ path: 'payment.newBalance', code: 'PAYMENT_PARTIAL_BALANCE_INVALID' });
  }

  const layawayEventsBeforeDelivery = new Set([
    'layaway_created',
    'layaway_payment',
    'layaway_settled',
    'layaway_cancelled'
  ]);
  if (layawayEventsBeforeDelivery.has(payload.eventType) && payload.layaway.saleFolio) {
    errors.push({ path: 'layaway.saleFolio', code: 'LAYAWAY_SALE_FOLIO_EARLY' });
  }
  if (payload.eventType === 'layaway_delivered' && !payload.layaway.saleFolio) {
    errors.push({ path: 'layaway.saleFolio', code: 'LAYAWAY_SALE_FOLIO_REQUIRED' });
  }
  if (payload.eventType === 'layaway_settled' && !isZeroOrBelow(payload.layaway.balanceDue)) {
    errors.push({ path: 'layaway.balanceDue', code: 'LAYAWAY_SETTLED_BALANCE_INVALID' });
  }
};

/**
 * Builds a message-only representation from a confirmed financial result. It
 * never calls repositories, mutations, browser APIs, or clock APIs.
 */
export const buildCustomerMessagePayload = ({
  eventType,
  customer = {},
  business = {},
  occurredAt,
  currency = 'MXN',
  reference = null,
  sale = {},
  payment = {},
  account = {},
  layaway = {},
  internalContext = {},
  timeZone = DEFAULT_MESSAGE_TIME_ZONE
} = {}) => {
  if (!CUSTOMER_MESSAGE_EVENT_TYPES.includes(eventType)) {
    return { ok: false, code: 'MESSAGE_EVENT_UNSUPPORTED', errors: [{ path: 'eventType', code: 'MESSAGE_EVENT_UNSUPPORTED' }] };
  }

  const contract = getCustomerMessageContract(eventType);
  const errors = [];
  const date = normalizeMessageDate(occurredAt, { timeZone });
  if (!date.ok) errors.push({ path: 'occurredAt', code: date.code });

  const normalizedSale = normalizeSale(sale, errors, timeZone);
  const normalizedPayment = normalizePayment(payment, errors, timeZone);
  const normalizedAccount = normalizeAccount(account, errors, timeZone);
  const normalizedLayaway = normalizeLayaway(layaway, errors, timeZone);

  const payload = {
    eventType,
    customer: {
      id: read(customer, 'id', 'customerId', 'customer_id'),
      name: String(read(customer, 'name', 'customerName', 'customer_name') || '').trim(),
      phone: read(customer, 'phone', 'phoneNumber', 'phone_number') || null
    },
    business: {
      name: String(read(business, 'name', 'companyName') || '').trim(),
      phone: read(business, 'phone', 'phoneNumber') || null,
      address: read(business, 'address') || null,
      logo: read(business, 'logo') || null
    },
    occurredAt: date.ok ? date.value : null,
    currency: String(currency || 'MXN').toUpperCase(),
    reference,
    sale: normalizedSale,
    payment: normalizedPayment,
    account: normalizedAccount,
    layaway: normalizedLayaway,
    // Grouped aliases make data ownership explicit for later channels.
    financialData: {
      sale: normalizedSale,
      payment: normalizedPayment,
      account: normalizedAccount,
      layaway: normalizedLayaway
    },
    customerData: {
      id: read(customer, 'id', 'customerId', 'customer_id'),
      name: String(read(customer, 'name', 'customerName', 'customer_name') || '').trim(),
      phone: read(customer, 'phone', 'phoneNumber', 'phone_number') || null
    },
    businessData: {
      name: String(read(business, 'name', 'companyName') || '').trim(),
      phone: read(business, 'phone', 'phoneNumber') || null,
      address: read(business, 'address') || null,
      logo: read(business, 'logo') || null
    },
    messageData: {
      eventType,
      occurredAt: date.ok ? date.value : null,
      occurredAtIso: date.iso || null,
      currency: String(currency || 'MXN').toUpperCase(),
      reference
    },
    internalContext: {
      source: internalContext.source || 'unknown',
      originalPaymentMethod: normalizedSale.originalPaymentMethod || normalizedPayment.originalMethod || null,
      isCredit: isCreditPaymentMethod(normalizedSale.originalPaymentMethod),
      showLabItemMarker: internalContext.showLabItemMarker === true
    }
  };

  errors.push(...validateRequiredFields(payload, contract.requiredFields));
  validateEventSemantics(payload, errors);

  if (errors.length > 0) {
    return {
      ok: false,
      code: errors.some((error) => error.code === 'MONEY_VALUE_INVALID') ? 'MONEY_VALUE_INVALID' : 'MESSAGE_PAYLOAD_INVALID',
      errors,
      payload
    };
  }

  return { ok: true, payload, contract };
};
