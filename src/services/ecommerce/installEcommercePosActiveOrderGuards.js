import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  getEcommercePosBlockedResult,
  isEcommercePosEffectBlocked
} from './ecommercePosDraftGuards';

let installed = false;

const resolveOrder = (orderId, orderSnapshot = null) => {
  if (orderSnapshot) return orderSnapshot;
  const state = useActiveOrders.getState();
  const targetOrderId = orderId || state.currentOrderId;
  return targetOrderId ? state.activeOrders.get(targetOrderId) || null : null;
};

export function installEcommercePosActiveOrderGuards() {
  if (installed) return;

  const initialState = useActiveOrders.getState();
  const originalSaveOrderAsOpen = initialState.saveOrderAsOpen;
  const originalCloseOrder = initialState.closeOrder;
  const originalLockOrderForCheckout = initialState.lockOrderForCheckout;

  useActiveOrders.setState({
    saveOrderAsOpen: async (orderId, orderSnapshot = null) => {
      const order = resolveOrder(orderId, orderSnapshot);
      if (isEcommercePosEffectBlocked(order)) return getEcommercePosBlockedResult();
      return originalSaveOrderAsOpen(orderId, orderSnapshot);
    },
    closeOrder: async (orderId, paymentData) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosEffectBlocked(order)) return getEcommercePosBlockedResult();
      return originalCloseOrder(orderId, paymentData);
    },
    lockOrderForCheckout: async (orderId) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosEffectBlocked(order)) {
        const blocked = getEcommercePosBlockedResult();
        return { ...blocked, reason: blocked.message };
      }
      return originalLockOrderForCheckout(orderId);
    }
  });

  installed = true;
}

export const ecommercePosActiveOrderGuardsInternals = Object.freeze({
  resolveOrder,
  resetForTests: () => {
    installed = false;
  }
});
