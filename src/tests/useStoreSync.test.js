import { renderHook, act } from '@testing-library/react-hooks';
import { useOrderStore } from '../store/useOrderStore';
import { useActiveOrders } from '../hooks/pos/useActiveOrders';

describe('Sincronización Bidireccional Zustand (useActiveOrders <-> useOrderStore)', () => {
  beforeEach(() => {
    useOrderStore.getState().clearSession();
    useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null });
    // Linkear stores para los tests
    useOrderStore.getState().linkWithActiveOrders(useActiveOrders);
  });

  it('createOrder -> currentOrder se refleja en useOrderStore.order', () => {
    const { result } = renderHook(() => useActiveOrders());
    
    act(() => {
      result.current.createOrder('cust-123', 'Mesa 5');
    });

    const activeOrderState = useActiveOrders.getState();
    const orderStoreState = useOrderStore.getState();

    expect(activeOrderState.activeOrders.size).toBe(1);
    expect(activeOrderState.currentOrderId).not.toBeNull();
    
    // Validar que se sincronizó
    expect(orderStoreState.activeOrderId).toBe(activeOrderState.currentOrderId);
    expect(orderStoreState.tableData).toBe('Mesa 5');
  });

  it('addItem en useOrderStore -> se refleja en activeOrders', () => {
    const { result: activeHook } = renderHook(() => useActiveOrders());
    
    act(() => {
      activeHook.current.createOrder();
    });

    const product = { id: 'p1', name: 'Café', price: 20 };
    
    act(() => {
      useOrderStore.getState().addItem(product);
    });

    const orderStoreState = useOrderStore.getState();
    const activeOrderState = useActiveOrders.getState();
    const currentActiveOrder = activeOrderState.activeOrders.get(activeOrderState.currentOrderId);

    // useOrderStore tiene 1 item
    expect(orderStoreState.order.length).toBe(1);
    expect(orderStoreState.order[0].id).toBe('p1');

    // useActiveOrders también tiene 1 item
    expect(currentActiveOrder.items.length).toBe(1);
    expect(currentActiveOrder.items[0].id).toBe('p1');
  });

  it('switchOrder -> order cambia en useOrderStore', () => {
    const { result: activeHook } = renderHook(() => useActiveOrders());
    
    let order1, order2;
    act(() => {
      order1 = activeHook.current.createOrder('cust-1', 'Mesa 1');
      order2 = activeHook.current.createOrder('cust-2', 'Mesa 2');
    });

    act(() => {
      activeHook.current.switchOrder(order1);
    });

    expect(useOrderStore.getState().tableData).toBe('Mesa 1');
    expect(useOrderStore.getState().activeOrderId).toBe(order1);

    act(() => {
      activeHook.current.switchOrder(order2);
    });

    expect(useOrderStore.getState().tableData).toBe('Mesa 2');
    expect(useOrderStore.getState().activeOrderId).toBe(order2);
  });
});
