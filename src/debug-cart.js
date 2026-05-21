const { create } = require('zustand');
const { persist } = require('zustand/middleware');

let activeState = { currentOrderId: null, activeOrders: new Map() };
let orderState = { order: [], activeOrderId: null, _isSyncing: false };

const activeListeners = [];
const orderListeners = [];

const useActiveOrders = {
  getState: () => activeState,
  setState: (fnOrObj) => {
    const nextState = typeof fnOrObj === 'function' ? fnOrObj(activeState) : fnOrObj;
    const prevState = { ...activeState };
    activeState = { ...activeState, ...nextState };
    activeListeners.forEach(listener => listener(activeState, prevState));
  },
  subscribe: (listener) => {
    activeListeners.push(listener);
    return () => {};
  }
};

const useOrderStore = {
  getState: () => orderState,
  setState: (fnOrObj) => {
    const nextState = typeof fnOrObj === 'function' ? fnOrObj(orderState) : fnOrObj;
    const prevState = { ...orderState };
    orderState = { ...orderState, ...nextState };
    orderListeners.forEach(listener => listener(orderState, prevState));
  },
  subscribe: (listener) => {
    orderListeners.push(listener);
    return () => {};
  }
};

const getOrderStore = () => useOrderStore.getState();
const setOrderStore = useOrderStore.setState;
const getActiveOrders = () => useActiveOrders.getState();
const setActiveOrders = useActiveOrders.setState;

// 1. LinkWithActiveOrders
const syncActiveOrderToStore = (activeState) => {
  const currentOrder = activeState.activeOrders.get(activeState.currentOrderId);
  setOrderStore({ _isSyncing: true });

  if (currentOrder) {
    const incomingItems = currentOrder.items || [];
    setOrderStore({
      order: incomingItems,
      activeOrderId: currentOrder.id,
      isSavedOrder: false,
      isCartLocked: false,
    });
  }
  setOrderStore({ _isSyncing: false });
};

useActiveOrders.subscribe((active, prev) => {
  if (getOrderStore()._isSyncing) return;
  if (active.currentOrderId !== prev.currentOrderId) {
    syncActiveOrderToStore(active);
  }
});

useOrderStore.subscribe((store, prevStore) => {
  if (getOrderStore()._isSyncing) return;
  if (store.order !== prevStore.order) {
    const hookState = getActiveOrders();
    const { currentOrderId, activeOrders } = hookState;
    if (!currentOrderId) return;
    const currentOrder = activeOrders.get(currentOrderId);
    if (!currentOrder) return;
    setOrderStore({ _isSyncing: true });
    const nextOrders = new Map(activeOrders);
    nextOrders.set(currentOrderId, {
      ...currentOrder,
      items: store.order,
      total: store.order.length * 20
    });
    setActiveOrders({ activeOrders: nextOrders });
    setOrderStore({ _isSyncing: false });
  }
});

const switchOrder = (orderId) => {
  const state = getActiveOrders();
  const order = state.activeOrders.get(orderId);
  setActiveOrders({ currentOrderId: orderId });
  const cartState = getOrderStore();
  const isSameOrder = cartState.activeOrderId === orderId;
  const cartHasItems = cartState.order.length > 0;
  const tabIsEmpty = order.items.length === 0;

  if (isSameOrder && cartHasItems && tabIsEmpty) {
    const nextOrders = new Map(getActiveOrders().activeOrders);
    nextOrders.set(orderId, {
      ...order,
      items: cartState.order,
    });
    setActiveOrders({ activeOrders: nextOrders });
    return;
  }

  setOrderStore({
    order: order.items || [],
    activeOrderId: orderId,
    _isSyncing: true
  });
  
  setTimeout(() => {
    setOrderStore({ _isSyncing: false });
    console.log("FINAL STATE:", JSON.stringify({ activeOrders: Array.from(getActiveOrders().activeOrders.entries()), orderStore: getOrderStore().order }, null, 2));
  }, 0);
};

// Simulation
console.log("--- Initial Load ---");
activeState.activeOrders.set('sal_1', { id: 'sal_1', items: [] });
activeState.currentOrderId = 'sal_1';
syncActiveOrderToStore(activeState);

console.log("--- User adds item ---");
setOrderStore({ order: [{ id: 1, name: 'product', price: 20 }] });
console.log("activeOrders after add:", Array.from(getActiveOrders().activeOrders.entries()));

console.log("--- User creates new order ---");
const newOrder = { id: 'sal_2', items: [], total: 0 };
const nextOrders = new Map(getActiveOrders().activeOrders);
nextOrders.set('sal_2', newOrder);
setActiveOrders({ activeOrders: nextOrders });
switchOrder('sal_2');

