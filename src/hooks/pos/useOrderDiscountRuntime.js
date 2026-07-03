import { useEffect } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { makeSaleDiscount, orderTotalsForSave, withLineDiscount, withoutLineDiscount, withOrderTotals } from '../../services/sales/orderTotals';
import { useActiveOrders } from './useActiveOrders';

let patched = false;
const normalizeOrder = (order = {}) => withOrderTotals({ ...order, saleDiscount: order.saleDiscount || order.metadata?.discount || null });
const saleDiscountOf = (sale = {}) => sale.saleDiscount || sale.metadata?.discount || null;

const normalizeLoadedSale = (sale = {}, current = {}) => normalizeOrder({
  ...current,
  id: sale.id || current.id,
  items: sale.items || current.items || [],
  customer: sale.customerId ? { id: sale.customerId } : current.customer || null,
  tableData: sale.tableData ?? current.tableData ?? null,
  createdAt: sale.timestamp || current.createdAt || new Date().toISOString(),
  isSaved: true,
  folio: sale.folio ?? current.folio ?? null,
  fulfillmentStatus: sale.fulfillmentStatus || current.fulfillmentStatus || 'open',
  revision: sale.revision ?? current.revision ?? 0,
  updatedAt: sale.updatedAt || current.updatedAt || sale.timestamp || null,
  deviceId: sale.deviceId || current.deviceId || null,
  subtotal: sale.subtotal,
  grossSubtotal: sale.grossSubtotal ?? sale.subtotal,
  subtotalAfterLineDiscounts: sale.subtotalAfterLineDiscounts,
  lineDiscountTotal: sale.lineDiscountTotal,
  discountTotal: sale.discountTotal ?? sale.discount_total ?? 0,
  discount_total: sale.discount_total ?? sale.discountTotal ?? 0,
  saleDiscount: saleDiscountOf(sale),
  total: sale.total
});

const setOrderTotalsInState = (orderId) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;
  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalizeOrder(order));
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

const refreshLoadedOrderFromDb = async (orderId) => {
  if (!orderId) return;
  const sale = await db.table(STORES.SALES).get(orderId);
  if (!sale) { setOrderTotalsInState(orderId); return; }
  const state = useActiveOrders.getState();
  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalizeLoadedSale(sale, state.activeOrders.get(orderId)));
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
    loadOpenOrder: async (orderId) => { const result = await originalLoadOpenOrder(orderId); if (result?.success) await refreshLoadedOrderFromDb(orderId); return result; },
    loadOrdersFromDB: async () => { const result = await originalLoadOrdersFromDB(); await Promise.all(Array.from(useActiveOrders.getState().activeOrders.keys()).map(refreshLoadedOrderFromDb)); return result; },
    lockOrderForCheckout: async (orderId) => { setOrderTotalsInState(orderId); return originalLockOrderForCheckout(orderId); }
  });
  patched = true;
};

export const useOrderDiscountRuntime = () => { patchActiveOrders(); useEffect(() => { patchActiveOrders(); }, []); };
export const syncOrderTotalsNow = setOrderTotalsInState;
export const ensureOrderDiscountRuntime = patchActiveOrders;
