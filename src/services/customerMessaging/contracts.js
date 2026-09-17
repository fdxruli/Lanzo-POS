export const CUSTOMER_MESSAGE_EVENT_TYPES = Object.freeze([
  'sale_paid',
  'sale_credit',
  'account_statement',
  'payment_partial',
  'account_settled',
  'layaway_created',
  'layaway_payment',
  'layaway_settled',
  'layaway_delivered',
  'layaway_cancelled',
  'debt_reminder'
]);

const commonRequiredFields = Object.freeze([
  'eventType',
  'customer.name',
  'business.name',
  'occurredAt',
  'currency'
]);

const commonOptionalFields = Object.freeze([
  'customer.id',
  'customer.phone',
  'business.phone',
  'business.address',
  'business.logo',
  'reference'
]);

const withCommon = (eventType, { requiredFields = [], optionalFields = [] }) => {
  const required = [...commonRequiredFields, ...requiredFields];
  const optional = [...commonOptionalFields, ...optionalFields];
  return Object.freeze({
    eventType,
    requiredFields: Object.freeze(required),
    optionalFields: Object.freeze(optional),
    allowedFields: Object.freeze([...new Set([...required, ...optional])]),
    defaultStatus: 'ready'
  });
};

/**
 * The definitions are intentionally data-only. Later image/template/history
 * phases can use the same fields without coupling a visual channel to finance.
 */
export const CUSTOMER_MESSAGE_CONTRACTS = Object.freeze({
  sale_paid: withCommon('sale_paid', {
    requiredFields: ['sale.id', 'sale.total', 'sale.paymentMethod'],
    optionalFields: ['sale.folio', 'sale.items', 'sale.subtotal', 'sale.discount', 'sale.amountPaid', 'sale.receivedAmount', 'sale.changeAmount']
  }),
  sale_credit: withCommon('sale_credit', {
    requiredFields: ['sale.id', 'sale.total', 'sale.paymentMethod', 'sale.balanceDue'],
    optionalFields: ['sale.folio', 'sale.items', 'sale.subtotal', 'sale.discount', 'sale.amountPaid', 'sale.dueDate', 'sale.creditStatus']
  }),
  account_statement: withCommon('account_statement', {
    requiredFields: ['account.totalBalance'],
    optionalFields: ['account.cutoffAt', 'account.totalPayments', 'account.pendingNotes', 'account.noteDetails']
  }),
  payment_partial: withCommon('payment_partial', {
    requiredFields: ['payment.amount', 'payment.previousBalance', 'payment.newBalance'],
    optionalFields: ['payment.id', 'payment.reference', 'payment.occurredAt', 'payment.method', 'payment.allocations', 'account.totalBalance']
  }),
  account_settled: withCommon('account_settled', {
    requiredFields: ['payment.amount', 'payment.previousBalance', 'payment.newBalance'],
    optionalFields: ['payment.id', 'payment.reference', 'payment.occurredAt', 'payment.method', 'payment.allocations', 'account.totalBalance']
  }),
  layaway_created: withCommon('layaway_created', {
    requiredFields: ['layaway.id', 'layaway.reference', 'layaway.total', 'layaway.initialPayment', 'layaway.balanceDue'],
    optionalFields: ['layaway.items', 'layaway.deadline', 'layaway.status']
  }),
  layaway_payment: withCommon('layaway_payment', {
    requiredFields: ['layaway.id', 'layaway.reference', 'layaway.paymentAmount', 'layaway.totalPaid', 'layaway.balanceDue'],
    optionalFields: ['layaway.items', 'layaway.previousPaid', 'layaway.total', 'layaway.deadline', 'layaway.status']
  }),
  layaway_settled: withCommon('layaway_settled', {
    requiredFields: ['layaway.id', 'layaway.reference', 'layaway.totalPaid', 'layaway.balanceDue'],
    optionalFields: ['layaway.items', 'layaway.total', 'layaway.deadline', 'layaway.status']
  }),
  layaway_delivered: withCommon('layaway_delivered', {
    requiredFields: ['layaway.id', 'layaway.reference', 'layaway.saleFolio'],
    optionalFields: ['layaway.items', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deliveryDate', 'layaway.status']
  }),
  layaway_cancelled: withCommon('layaway_cancelled', {
    requiredFields: ['layaway.id', 'layaway.reference', 'layaway.status'],
    optionalFields: ['layaway.items', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue']
  }),
  debt_reminder: withCommon('debt_reminder', {
    requiredFields: ['account.totalBalance'],
    optionalFields: ['account.cutoffAt', 'account.pendingNotes', 'account.noteDetails']
  })
});

export const getCustomerMessageContract = (eventType) => CUSTOMER_MESSAGE_CONTRACTS[eventType] || null;

export const validateCustomerMessageFields = (eventType, fields = []) => {
  const contract = getCustomerMessageContract(eventType);
  if (!contract) {
    return { ok: false, code: 'MESSAGE_EVENT_UNSUPPORTED', unknownFields: Array.isArray(fields) ? fields : [] };
  }

  const requestedFields = Array.isArray(fields) ? fields : [];
  const unknownFields = requestedFields.filter((field) => !contract.allowedFields.includes(field));
  return unknownFields.length === 0
    ? { ok: true, contract }
    : { ok: false, code: 'MESSAGE_FIELD_UNSUPPORTED', unknownFields, contract };
};
