import { useCallback } from 'react';
import { useActiveOrders } from './useActiveOrders';
import { ECOMMERCE_CONVERSION_STATUS } from '../../services/ecommerce/ecommercePosCheckoutConversion';
import {
  getEcommerceCheckoutInitiation,
  runEcommerceCheckoutInitiationSingleFlight
} from './ecommerceCheckoutInitiationSingleFlight';

const ACTIVE_CHECKOUT_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
  ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE
]);

const getCurrentOrder = () => {
  const state = useActiveOrders.getState();
  return state.currentOrderId
    ? state.activeOrders.get(state.currentOrderId) || null
    : null;
};

const isEcommerceCheckoutAlreadyActive = (order = {}) => (
  order.origin === 'ecommerce'
  && ACTIVE_CHECKOUT_STATUSES.has(order.ecommerceConversionStatus)
);

const updateInitiationStatus = (orderId, status) => {
  const state = useActiveOrders.getState();
  const order = state.activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') return;

  state.updateOrder(orderId, {
    ecommerceCheckoutInitiationStatus: status
  });
};

export function useEcommercePosCheckoutSingleFlight({ checkout }) {
  const handleInitiateCheckout = useCallback(() => {
    const order = getCurrentOrder();
    if (order?.origin !== 'ecommerce') return checkout.handleInitiateCheckout();

    const existing = getEcommerceCheckoutInitiation(order.id);
    if (existing) return existing.promise;

    if (order.ecommerceCheckoutInitiationStatus === 'starting') {
      updateInitiationStatus(order.id, null);
    }

    if (isEcommerceCheckoutAlreadyActive(order)) {
      return Promise.resolve({
        success: true,
        ignored: true,
        code: 'ECOMMERCE_CHECKOUT_ALREADY_ACTIVE'
      });
    }

    return runEcommerceCheckoutInitiationSingleFlight({
      orderId: order.id,
      onStart: ({ orderId }) => updateInitiationStatus(orderId, 'starting'),
      run: () => checkout.handleInitiateCheckout(),
      onSettled: ({ orderId }) => updateInitiationStatus(orderId, null)
    });
  }, [checkout]);

  return {
    ...checkout,
    handleInitiateCheckout
  };
}

export const ecommercePosCheckoutSingleFlightInternals = Object.freeze({
  ACTIVE_CHECKOUT_STATUSES,
  getCurrentOrder,
  isEcommerceCheckoutAlreadyActive,
  updateInitiationStatus
});
