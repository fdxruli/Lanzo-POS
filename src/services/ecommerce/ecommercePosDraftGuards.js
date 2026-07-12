export const ECOMMERCE_POS_CHECKOUT_NOT_ENABLED = 'ECOMMERCE_POS_CHECKOUT_NOT_ENABLED';
export const ECOMMERCE_POS_CHECKOUT_NOT_ELIGIBLE = 'ECOMMERCE_POS_CHECKOUT_NOT_ELIGIBLE';

export const ECOMMERCE_POS_CHECKOUT_MESSAGE = 'Este pedido online todavía no cumple todas las condiciones para cobrar.';

export const isEcommercePosDraft = (order) => order?.origin === 'ecommerce';

export const isEcommercePosEffectBlocked = (order, effect = 'checkout') => {
  if (!isEcommercePosDraft(order)) return false;
  if (effect !== 'checkout') return true;
  return order?.ecommerceCheckoutGateStatus !== 'authorized';
};

export const getEcommercePosBlockedResult = (order = null) => ({
  success: false,
  code: order?.ecommerceCheckoutGateCode || ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
  message: order?.ecommerceCheckoutGateMessage || ECOMMERCE_POS_CHECKOUT_MESSAGE
});
