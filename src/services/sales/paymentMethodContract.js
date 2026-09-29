/** Canonical methods shared by restaurant split payment flows. */
const PAYMENT_METHOD_ALIASES = new Map([
  ['cash', 'cash'], ['efectivo', 'cash'],
  ['card', 'card'], ['tarjeta', 'card'], ['tarjeta_credito', 'card'], ['tarjeta_debito', 'card'],
  ['debit', 'card'], ['credit_card', 'card'], ['debit_card', 'card'],
  ['transfer', 'transfer'], ['transferencia', 'transfer'], ['spei', 'transfer'], ['bank_transfer', 'transfer'],
  ['credit', 'credit'], ['fiado', 'credit'], ['credito', 'credit'], ['crédito', 'credit'],
  ['debt', 'credit'], ['customer_credit', 'credit'], ['cuenta_cliente', 'credit'],
  ['mixed_credit', 'credit'], ['partial_credit', 'credit'],
  ['mixed', 'mixed'], ['mixto', 'mixed']
]);

export const RESTAURANT_SPLIT_PAYMENT_METHODS = Object.freeze([
  'cash', 'card', 'transfer', 'credit'
]);

export const normalizeRestaurantSplitPaymentMethod = (value) => {
  const candidate = String(value ?? '').trim().toLowerCase();
  return PAYMENT_METHOD_ALIASES.get(candidate) || null;
};

export const toLegacyRestaurantSplitPaymentMethod = (value) => {
  const method = normalizeRestaurantSplitPaymentMethod(value);
  if (method === 'cash') return 'efectivo';
  if (method === 'card') return 'tarjeta';
  if (method === 'transfer') return 'transferencia';
  if (method === 'credit') return 'fiado';
  if (method === 'mixed') return 'mixed';
  return null;
};

export const isRestaurantSplitCashPayment = (payment = {}) => (
  normalizeRestaurantSplitPaymentMethod(payment.method || payment.paymentMethod || payment.payment_method) === 'cash'
);

const isValidSalePaymentRow = (payment) => {
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return false;
  const method = normalizeRestaurantSplitPaymentMethod(
    payment.method || payment.paymentMethod || payment.payment_method
  );
  const amountValue = payment.amount ?? payment.total;
  const numericAmount = Number(amountValue);
  return Boolean(method) && amountValue !== null && amountValue !== undefined
    && amountValue !== '' && Number.isFinite(numericAmount) && numericAmount > 0;
};

/**
 * `null` means there is no non-empty explicit payment source, so legacy fields
 * remain usable. An empty array means a non-empty explicit source was present
 * but contained no valid positive applied payments; callers must not fall back
 * to the legacy sale total in that case.
 */
export const getExplicitSalePaymentRows = (sale = {}) => {
  const safeSale = sale && typeof sale === 'object' && !Array.isArray(sale) ? sale : {};
  const candidates = [
    safeSale.payments,
    safeSale.paymentBreakdown,
    safeSale.paymentDetails?.payments
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    // The first non-empty source is authoritative, including when every row
    // is zero, malformed, negative, or uses an unknown payment method.
    return candidate.filter(isValidSalePaymentRow);
  }
  return null;
};
