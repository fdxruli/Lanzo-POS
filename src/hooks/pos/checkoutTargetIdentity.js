export const POS_CHECKOUT_TARGET_CHANGED = 'POS_CHECKOUT_TARGET_CHANGED';
export const ECOMMERCE_CHECKOUT_TARGET_CHANGED = 'ECOMMERCE_CHECKOUT_TARGET_CHANGED';
export const POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER = 'POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER';
export const ECOMMERCE_STALE_CHECKOUT_ATTEMPT = 'ECOMMERCE_STALE_CHECKOUT_ATTEMPT';

export const POS_CHECKOUT_TARGET_CHANGED_MESSAGE = (
  'La orden activa cambió durante el inicio del cobro. Vuelve a abrir el pedido e inténtalo nuevamente.'
);

export const buildCheckoutTargetChangedResult = ({ expectedOrigin = null } = {}) => ({
  success: false,
  aborted: true,
  targetChanged: true,
  code: expectedOrigin === 'ecommerce'
    ? ECOMMERCE_CHECKOUT_TARGET_CHANGED
    : POS_CHECKOUT_TARGET_CHANGED,
  message: POS_CHECKOUT_TARGET_CHANGED_MESSAGE
});

export const buildCheckoutAlreadyActiveResult = (snapshot = null) => ({
  success: false,
  ignored: true,
  code: POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER,
  orderId: snapshot?.orderId || null,
  checkoutAttemptId: snapshot?.checkoutAttemptId || null,
  message: 'Ya existe otro cobro activo en esta pestaña.'
});

export const buildStaleCheckoutAttemptResult = (result = {}) => ({
  ...result,
  success: result?.success === true,
  ignored: true,
  staleAttempt: true,
  code: ECOMMERCE_STALE_CHECKOUT_ATTEMPT
});

export const resolveCheckoutTarget = ({
  state,
  posActiveOrderId = null,
  expectedOrderId = null,
  expectedOrigin = null
} = {}) => {
  const strictTarget = Boolean(expectedOrderId);
  const orderId = strictTarget
    ? expectedOrderId
    : (state?.currentOrderId || posActiveOrderId || null);
  const activeOrder = orderId
    ? state?.activeOrders?.get(orderId) || null
    : null;

  if (!strictTarget) {
    return {
      success: Boolean(orderId && activeOrder),
      strictTarget: false,
      state,
      orderId,
      activeOrder,
      code: orderId && activeOrder ? null : POS_CHECKOUT_TARGET_CHANGED
    };
  }

  const targetMatches = Boolean(
    state?.currentOrderId === expectedOrderId
    && activeOrder
    && activeOrder.id === expectedOrderId
    && (!expectedOrigin || activeOrder.origin === expectedOrigin)
  );

  if (!targetMatches) {
    return {
      ...buildCheckoutTargetChangedResult({ expectedOrigin }),
      strictTarget: true,
      state,
      orderId: expectedOrderId,
      activeOrder
    };
  }

  return {
    success: true,
    strictTarget: true,
    state,
    orderId: expectedOrderId,
    activeOrder
  };
};

export const ownsCheckoutSnapshot = ({
  snapshot,
  expectedOrderId,
  expectedCheckoutAttemptId
} = {}) => Boolean(
  snapshot
  && expectedOrderId
  && expectedCheckoutAttemptId
  && snapshot.orderId === expectedOrderId
  && snapshot.checkoutAttemptId === expectedCheckoutAttemptId
);

export const checkoutTargetIdentityInternals = Object.freeze({
  buildCheckoutTargetChangedResult,
  buildCheckoutAlreadyActiveResult,
  buildStaleCheckoutAttemptResult,
  resolveCheckoutTarget,
  ownsCheckoutSnapshot
});
