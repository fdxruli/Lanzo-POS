import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { db, STORES } from '../../services/db/dexie';
import { hasSameFinancialTotals, makeSaleDiscount, orderTotalsForSave, withLineDiscount, withoutLineDiscount, withOrderTotals } from '../../services/sales/orderTotals';
import { useActiveOrders } from './useActiveOrders';

let patched = false;
const normalizeOrder = (order = {}) => withOrderTotals({ ...order, saleDiscount: order.saleDiscount || order.metadata?.discount || null });
const saleDiscountOf = (sale = {}) => sale.saleDiscount || sale.metadata?.discount || null;

const assertDiscountPermission = () => {
  const canAccessDiscounts = useAppStore.getState().canAccess?.('discounts') === true;
  if (!canAccessDiscounts) {
    throw new Error('Tu usuario no tiene permiso para modificar descuentos.');
  }
};

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

  const normalized = normalizeOrder(order);
  if (hasSameFinancialTotals(order, normalized)) return;

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const writeOrder = (orderId, builder) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;

  const normalized = normalizeOrder(builder(order));
  if (hasSameFinancialTotals(order, normalized)) return;

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const refreshLoadedOrderFromDb = async (orderId) => {
  if (!orderId) return;
  const sale = await db.table(STORES.SALES).get(orderId);
  if (!sale) { setOrderTotalsInState(orderId); return; }

  const state = useActiveOrders.getState();
  const current = state.activeOrders.get(orderId);
  if (current?.isLockedForCheckout) return;

  const normalized = normalizeLoadedSale(sale, current || {});
  if (current && hasSameFinancialTotals(current, normalized)) return;

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const persistOrderFinancials = async (orderId, order) => {
  if (!orderId || !order) return;
  await db.table(STORES.SALES).update(orderId, orderTotalsForSave(normalizeOrder(order)));
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
  const originalPauseOrder = state.pauseOrder;
  const originalCloseOrder = state.closeOrder;

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
    applyLineDiscount: (lineId, input, orderId = useActiveOrders.getState().currentOrderId) => {
      assertDiscountPermission();
      writeOrder(orderId, (order) => ({ ...order, items: withLineDiscount(order.items, lineId, input) }));
    },
    removeLineDiscount: (lineId, orderId = useActiveOrders.getState().currentOrderId) => {
      assertDiscountPermission();
      writeOrder(orderId, (order) => ({ ...order, items: withoutLineDiscount(order.items, lineId) }));
    },
    applySaleDiscount: (input, orderId = useActiveOrders.getState().currentOrderId) => {
      assertDiscountPermission();
      writeOrder(orderId, (order) => ({ ...order, saleDiscount: makeSaleDiscount(order, input) }));
    },
    removeSaleDiscount: (orderId = useActiveOrders.getState().currentOrderId) => {
      assertDiscountPermission();
      writeOrder(orderId, (order) => ({ ...order, saleDiscount: null }));
    },
    saveOrderAsOpen: async (orderId, snapshot = null) => {
      const order = snapshot || (orderId ? useActiveOrders.getState().activeOrders.get(orderId) : null);
      const normalized = order ? normalizeOrder(order) : snapshot;
      const result = await originalSaveOrderAsOpen(orderId, normalized);
      if (result?.success) await persistOrderFinancials(result.id || orderId, normalized);
      return result;
    },
    pauseOrder: async (orderId) => {
      const snapshot = normalizeOrder(useActiveOrders.getState().activeOrders.get(orderId) || {});
      const result = await originalPauseOrder(orderId);
      await persistOrderFinancials(orderId, snapshot);
      return result;
    },
    closeOrder: async (orderId, paymentData) => originalCloseOrder(orderId, { ...paymentData, ...orderTotalsForSave(useActiveOrders.getState().activeOrders.get(orderId) || {}) }),
    loadOpenOrder: async (orderId) => { const result = await originalLoadOpenOrder(orderId); if (result?.success) await refreshLoadedOrderFromDb(orderId); return result; },
    loadOrdersFromDB: async () => { const result = await originalLoadOrdersFromDB(); await Promise.all(Array.from(useActiveOrders.getState().activeOrders.keys()).map(refreshLoadedOrderFromDb)); return result; },
    lockOrderForCheckout: async (orderId) => { setOrderTotalsInState(orderId); return originalLockOrderForCheckout(orderId); }
  });
  patched = true;
};

export const useOrderDiscountRuntime = () => {
  useEffect(() => {
    patchActiveOrders();
  }, []);
};
export const syncOrderTotalsNow = setOrderTotalsInState;
export const ensureOrderDiscountRuntime = patchActiveOrders;
