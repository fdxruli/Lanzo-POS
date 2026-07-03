import { useEffect } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { makeSaleDiscount, orderTotalsForSave, withLineDiscount, withoutLineDiscount, withOrderTotals } from '../../services/sales/orderTotals';
import { useActiveOrders } from './useActiveOrders';

let patched = false;
const normalizeOrder = (order = {}) => withOrderTotals({ ...order, saleDiscount: order.saleDiscount || order.metadata?.discount || null });

const setOrderTotalsInState = (orderId) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;
  const nextOrder = normalizeOrder(order);
  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, nextOrder);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const writeOrder = (orderId, builder) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;
  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalizeOrder(builder(order)));
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const patchActiveOrders = () => {
  if (patched) return;
  const state = useActiveOrders.getState();
  if (state.__restDiscOrderTotalsPatched) { patched = true; return; }
  const originalGetTotalPrice = state.getTotalPrice;
  const originalUpdateOrderItems = state.updateOrderItems;
  const originalUpdateOrder = state.updateOrder;
  const originalSaveOrderAsOpen = state.saveOrderAsOpen;
  const originalLoadOpenOrder = state.loadOpenOrder;
  const originalLoadOrdersFromDB = state.loadOrdersFromDB;
  const originalLockOrderForCheckout = state.lockOrderForCheckout;

  useActiveOrders.setState({
    __restDiscOrderTotalsPatched: true,
    getTotalPrice: () => {
      const currentState = useActiveOrders.getState();
      const order = currentState.currentOrderId ? currentState.activeOrders.get(currentState.currentOrderId) : null;
      if (!order) return typeof originalGetTotalPrice === 'function' ? originalGetTotalPrice() : 0;
      return orderTotalsForSave(order).total || 0;
    },
    updateOrderItems: (orderId, updater) => { originalUpdateOrderItems(orderId, updater); setOrderTotalsInState(orderId); },
    updateOrder: (orderId, updates) => { originalUpdateOrder(orderId, updates); setOrderTotalsInState(orderId); },
    applyLineDiscount: (lineId, input, orderId = useActiveOrders.getState().currentOrderId) => writeOrder(orderId, (order) => ({ ...order, items: withLineDiscount(order.items, lineId, input) })),
    removeLineDiscount: (lineId, orderId = useActiveOrders.getState().currentOrderId) => writeOrder(orderId, (order) => ({ ...order, items: withoutLineDiscount(order.items, lineId) })),
    applySaleDiscount: (input, orderId = useActiveOrders.getState().currentOrderId) => writeOrder(orderId, (order) => ({ ...order, saleDiscount: makeSaleDiscount(order, input) })),
    removeSaleDiscount: (orderId = useActiveOrders.getState().currentOrderId) => writeOrder(orderId, (order) => ({ ...order, saleDiscount: null })),
    saveOrderAsOpen: async (orderId, snapshot = null) => {
      const order = snapshot || (orderId ? useActiveOrders.getState().activeOrders.get(orderId) : null);
      const normalized = order ? normalizeOrder(order) : snapshot;
      const result = await originalSaveOrderAsOpen(orderId, normalized);
      if (result?.success && (result.id || orderId) && normalized) await db.table(STORES.SALES).update(result.id || orderId, orderTotalsForSave(normalized));
      return result;
    },
    loadOpenOrder: async (orderId) => { const result = await originalLoadOpenOrder(orderId); setOrderTotalsInState(orderId); return result; },
    loadOrdersFromDB: async () => { const result = await originalLoadOrdersFromDB(); useActiveOrders.getState().activeOrders.forEach((_, id) => setOrderTotalsInState(id)); return result; },
    lockOrderForCheckout: async (orderId) => { setOrderTotalsInState(orderId); return originalLockOrderForCheckout(orderId); }
  });
  patched = true;
};

export const useOrderDiscountRuntime = () => { patchActiveOrders(); useEffect(() => { patchActiveOrders(); }, []); };
export const syncOrderTotalsNow = setOrderTotalsInState;
export const ensureOrderDiscountRuntime = patchActiveOrders;
