const { create } = require('zustand');

let activeState = { currentOrderId: null, activeOrders: new Map() };
let orderState = { order: [], activeOrderId: null, _isSyncing: false };

const getActiveOrders = () => activeState;
const getOrderStore = () => orderState;
const setOrderStore = (obj) => {
  orderState = { ...orderState, ...obj };
  // simulate order listeners if any...
};
const setActiveOrders = (obj) => {
  const prevState = { ...activeState };
  activeState = { ...activeState, ...obj };
  if (activeState.currentOrderId !== prevState.currentOrderId) {
    syncActiveOrderToStore(activeState);
  }
};

const syncActiveOrderToStore = (activeState) => {
  const currentOrder = activeState.activeOrders.get(activeState.currentOrderId);
  setOrderStore({ _isSyncing: true });

  if (currentOrder) {
    const incomingItems = currentOrder.items || [];
    setOrderStore({
      order: incomingItems,
      activeOrderId: currentOrder.id,
    });
  }
  setOrderStore({ _isSyncing: false });
};

const switchOrder = (orderId) => {
  const order = getActiveOrders().activeOrders.get(orderId);
  setActiveOrders({ currentOrderId: orderId });
  const cartState = getOrderStore();
  const isSameOrder = cartState.activeOrderId === orderId;
  const cartHasItems = cartState.order.length > 0;
  const tabIsEmpty = order.items.length === 0;

  if (isSameOrder && cartHasItems && tabIsEmpty) {
    console.log("RESCUE BLOCK TRIGGERED FOR", orderId);
    const nextOrders = new Map(getActiveOrders().activeOrders);
    nextOrders.set(orderId, {
      ...order,
      items: cartState.order,
      total: cartState.order.length * 20
    });
    // setActiveOrders({ activeOrders: nextOrders }); // simplified
    activeState.activeOrders = nextOrders;
    return;
  }

  setOrderStore({
    order: order.items || [],
    activeOrderId: orderId,
    _isSyncing: true
  });
  
  setOrderStore({ _isSyncing: false });
};

// Simulate Reload
console.log("=== RELOAD ===");
// lanzo-cart-storage has product
orderState = { order: [{id: 1, price: 20}], activeOrderId: 'sal_1', _isSyncing: false };
// lanzo-active-orders-storage is EMPTY
activeState = { currentOrderId: null, activeOrders: new Map() };

console.log("1. linkWithActiveOrders");
if (activeState.currentOrderId === null) {
  const currentStoreOrder = orderState.order || [];
  if (currentStoreOrder.length > 0) {
    const newOrderId = orderState.activeOrderId || 'sal_old';
    const nextOrders = new Map(activeState.activeOrders);
    nextOrders.set(newOrderId, {
      id: newOrderId,
      items: currentStoreOrder,
      total: 20
    });
    activeState.activeOrders = nextOrders;
    activeState.currentOrderId = newOrderId;
    orderState.activeOrderId = newOrderId;
  }
}

console.log("2. loadOrdersFromDB");
const persistedOrdersMap = new Map(activeState.activeOrders);
const ordersMap = new Map();
persistedOrdersMap.forEach((draftOrder, orderId) => {
  ordersMap.set(orderId, {
    ...draftOrder,
    items: draftOrder.items
  });
});
if (ordersMap.size === 0) {
  ordersMap.set('sal_new', { id: 'sal_new', items: [], total: 0 });
}
activeState.activeOrders = ordersMap;
switchOrder(Array.from(ordersMap.keys())[0]);

console.log("AFTER RELOAD:", { activeOrders: Array.from(getActiveOrders().activeOrders.entries()), orderStore: getOrderStore().order });

console.log("=== USER CLICKS NUEVA ORDEN ===");
const nextOrders = new Map(getActiveOrders().activeOrders);
nextOrders.set('sal_2', { id: 'sal_2', items: [], total: 0 });
activeState.activeOrders = nextOrders; // Note: setting activeOrders directly does not trigger currentOrderId listener
switchOrder('sal_2');

console.log("AFTER NUEVA ORDEN:", { activeOrders: Array.from(getActiveOrders().activeOrders.entries()), orderStore: getOrderStore().order });
