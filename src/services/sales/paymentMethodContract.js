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
  normalizeRestaurantSplitPaymentMethod(payment.method || payment.paymentMethod) === 'cash'
);
