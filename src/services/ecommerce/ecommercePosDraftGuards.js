export const ECOMMERCE_POS_CHECKOUT_NOT_ENABLED = 'ECOMMERCE_POS_CHECKOUT_NOT_ENABLED';

export const ECOMMERCE_POS_CHECKOUT_MESSAGE = 'Este pedido online está preparado para revisión. El cobro y la conversión definitiva se habilitarán en la siguiente fase.';

export const isEcommercePosDraft = (order) => order?.origin === 'ecommerce';

export const isEcommercePosEffectBlocked = (order) => isEcommercePosDraft(order);

export const getEcommercePosBlockedResult = () => ({
  success: false,
  code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
  message: ECOMMERCE_POS_CHECKOUT_MESSAGE
});
