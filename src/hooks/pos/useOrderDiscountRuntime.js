import { useEffect } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { orderTotalsForSave, withOrderTotals } from '../../services/sales/orderTotals';
import { useActiveOrders } from './useActiveOrders';

let patched = false;

const setOrderTotalsInState = (orderId) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;

  const nextOrder = withOrderTotals(order);
  if (
    Number(order.total || 0) === Number(nextOrder.total || 0) &&
    Number(order.discountTotal || 0) === Number(nextOrder.discountTotal || 0) &&
    Number(order.subtotal || 0) === Number(nextOrder.subtotal || 0) &&
    JSON.stringify(order.saleDiscount || null) === JSON.stringify(nextOrder.saleDiscount || null)
  ) {
    return;
  }

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, nextOrder);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const patchActiveOrders = () => {
  if (patched) return;
  const state = useActiveOrders.getState();
  if (state.__restDiscOrderTotalsPatched) {
    patched = true;
    return;
  }

  const originalGetTotalPrice = state.getTotalPrice;
  const originalUpdateOrderItems = state.updateOrderItems;
  const originalUpdateOrder = state.updateOrder;
  const originalSaveOrderAsOpen = state.saveOrderAsOpen;

  useActiveOrders.setState({
    __restDiscOrderTotalsPatched: true,

    getTotalPrice: () => {
      const currentState = useActiveOrders.getState();
      const currentOrder = currentState.currentOrderId
        ? currentState.activeOrders.get(currentState.currentOrderId)
        : null;
      if (!currentOrder) return typeof originalGetTotalPrice === 'function' ? originalGetTotalPrice() : 0;
      return orderTotalsForSave(currentOrder).total || 0;
    },

    updateOrderItems: (orderId, updater) => {
      originalUpdateOrderItems(orderId, updater);
      setOrderTotalsInState(orderId);
    },

    updateOrder: (orderId, updates) => {
      originalUpdateOrder(orderId, updates);
      setOrderTotalsInState(orderId);
    },

    saveOrderAsOpen: async (orderId, orderSnapshot = null) => {
      const currentState = useActiveOrders.getState();
      const order = orderSnapshot || (orderId ? currentState.activeOrders.get(orderId) : null);
      const normalizedSnapshot = order ? withOrderTotals(order) : orderSnapshot;
      const result = await originalSaveOrderAsOpen(orderId, normalizedSnapshot);

      if (result && result.success) {
        const saleId = result.id || orderId;
        const persistedOrder = normalizedSnapshot || (saleId ? useActiveOrders.getState().activeOrders.get(saleId) : null);
        if (saleId && persistedOrder) {
          await db.table(STORES.SALES).update(saleId, orderTotalsForSave(persistedOrder));
        }
      }

      return result;
    }
  });

  patched = true;
};

export const useOrderDiscountRuntime = () => {
  useEffect(() => {
    patchActiveOrders();
  }, []);
};

export const syncOrderTotalsNow = setOrderTotalsInState;
