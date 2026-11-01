import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { db, STORES } from '../../services/db/dexie';
import { hasSameFinancialTotals, makeSaleDiscount, orderTotalsForSave, withLineDiscount, withoutLineDiscount, withOrderTotals } from '../../services/sales/orderTotals';
import { useActiveOrders } from './useActiveOrders';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { registerActorOperationalActiveOrders } from '../../services/auth/actorOperationalHandoff';
import {
  assertRestaurantCloudTableEditable,
  isRestaurantCloudTableShadow,
  isRestaurantCloudTableTerminal
} from '../../services/restaurant/restaurantCloudTableGuards';

let patched = false;
const normalizeOrder = (order = {}) => (isRestaurantCloudTableShadow(order) || isRestaurantCloudTableTerminal(order))
  ? order
  : withOrderTotals({ ...order, saleDiscount: order.saleDiscount || order.metadata?.discount || null });
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

const setOrderTotalsInState = (orderId, actorHandle = null) => {
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout || isRestaurantCloudTableShadow(order) || isRestaurantCloudTableTerminal(order)) return;

  const normalized = normalizeOrder(order);
  if (hasSameFinancialTotals(order, normalized)) return;

  (actorHandle || actorRuntimeController.capture()).assertCurrent();

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const writeOrder = (orderId, builder) => {
  const actorHandle = actorRuntimeController.capture();
  const state = useActiveOrders.getState();
  const order = orderId ? state.activeOrders.get(orderId) : null;
  if (!order || order.isLockedForCheckout) return;

  assertRestaurantCloudTableEditable(order);
  const normalized = normalizeOrder(builder(order));
  if (hasSameFinancialTotals(order, normalized)) return;
  actorHandle.assertCurrent();

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const refreshLoadedOrderFromDb = async (orderId, actorHandle) => {
  if (!orderId) return;
  actorHandle.assertCurrent();
  const sale = await db.table(STORES.SALES).get(orderId);
  actorHandle.assertCurrent();
  if (!sale) { setOrderTotalsInState(orderId, actorHandle); return; }
  if (isRestaurantCloudTableShadow(sale) || isRestaurantCloudTableTerminal(sale)) return;

  const state = useActiveOrders.getState();
  const current = state.activeOrders.get(orderId);
  if (current?.isLockedForCheckout) return;

  const normalized = normalizeLoadedSale(sale, current || {});
  if (current && hasSameFinancialTotals(current, normalized)) return;

  const nextOrders = new Map(state.activeOrders);
  nextOrders.set(orderId, normalized);
  useActiveOrders.setState({ activeOrders: nextOrders });
};

const persistOrderFinancials = async (orderId, order, actorHandle) => {
  if (!orderId || !order || isRestaurantCloudTableShadow(order) || isRestaurantCloudTableTerminal(order)) return;
  actorHandle.assertCurrent();
  await db.table(STORES.SALES).update(orderId, orderTotalsForSave(normalizeOrder(order)));
  actorHandle.assertCurrent();
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
      if (isRestaurantCloudTableShadow(order)) return Number(order.total);
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
    saveOrderAsOpen: async (orderId, snapshot = null, options = {}) => {
      const actorHandle = actorRuntimeController.capture();
      const order = snapshot || (orderId ? useActiveOrders.getState().activeOrders.get(orderId) : null);
      const normalized = order ? normalizeOrder(order) : snapshot;
      const result = await originalSaveOrderAsOpen(orderId, normalized, options);
      actorHandle.assertCurrent();
      if (result?.success) await persistOrderFinancials(result.id || orderId, normalized, actorHandle);
      return result;
    },
    pauseOrder: async (orderId) => {
      const actorHandle = actorRuntimeController.capture();
      const snapshot = normalizeOrder(useActiveOrders.getState().activeOrders.get(orderId) || {});
      const result = await originalPauseOrder(orderId);
      actorHandle.assertCurrent();
      await persistOrderFinancials(orderId, snapshot, actorHandle);
      return result;
    },
    closeOrder: async (orderId, paymentData) => {
      const actorHandle = actorRuntimeController.capture();
      const result = await originalCloseOrder(orderId, { ...paymentData, ...orderTotalsForSave(useActiveOrders.getState().activeOrders.get(orderId) || {}) });
      actorHandle.assertCurrent();
      return result;
    },
    loadOpenOrder: async (orderId) => {
      const actorHandle = actorRuntimeController.capture();
      const result = await originalLoadOpenOrder(orderId);
      actorHandle.assertCurrent();
      if (result?.success) await refreshLoadedOrderFromDb(orderId, actorHandle);
      return result;
    },
    loadOrdersFromDB: async () => {
      const actorHandle = actorRuntimeController.capture();
      const result = await originalLoadOrdersFromDB();
      actorHandle.assertCurrent();
      await Promise.all(Array.from(useActiveOrders.getState().activeOrders.keys()).map((orderId) => refreshLoadedOrderFromDb(orderId, actorHandle)));
      return result;
    },
    lockOrderForCheckout: async (orderId) => {
      const actorHandle = actorRuntimeController.capture();
      setOrderTotalsInState(orderId, actorHandle);
      const result = await originalLockOrderForCheckout(orderId);
      actorHandle.assertCurrent();
      return result;
    }
  });
  // This patch runs after login mounted the POS. Register the completed
  // wrappers again so handoff also tracks their post-save async work.
  registerActorOperationalActiveOrders({ useActiveOrders, db, STORES });
  patched = true;
};

export const useOrderDiscountRuntime = () => {
  useEffect(() => {
    patchActiveOrders();
  }, []);
};
export const syncOrderTotalsNow = setOrderTotalsInState;
export const ensureOrderDiscountRuntime = patchActiveOrders;
