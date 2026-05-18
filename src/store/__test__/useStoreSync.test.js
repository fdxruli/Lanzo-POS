import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useOrderStore } from '../useOrderStore';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';

// Mock dependencies to avoid real DB interactions
vi.mock('../../services/db/dexie', () => ({
  db: {
    table: vi.fn(() => ({
      put: vi.fn(),
      get: vi.fn()
    }))
  },
  STORES: { SALES: 'sales' }
}));

let mockIdCounter = 1;
vi.mock('../../services/utils', () => ({
  generateID: vi.fn(() => `sal-mock${mockIdCounter++}`),
  safeLocalStorageSet: vi.fn()
}));

describe('Bidirectional Syncing: useOrderStore <-> useActiveOrders', () => {
  beforeEach(() => {
    mockIdCounter = 1;

    // Reset both stores manually for isolated tests
    useOrderStore.setState({
      order: [],
      activeOrderId: null,
      tableData: null,
      _activeOrdersHook: null,
      _isSyncing: false
    });
    
    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false
    });
    
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('1. debería enlazar correctamente ambos stores', () => {
    act(() => {
      useOrderStore.getState().linkWithActiveOrders(useActiveOrders);
    });
    expect(useOrderStore.getState()._activeOrdersHook).toBe(useActiveOrders);
  });

  it('2. debería volcar datos a useOrderStore cuando se hace switchOrder', () => {
    act(() => {
      useOrderStore.getState().linkWithActiveOrders(useActiveOrders);
    });

    let id1;
    act(() => {
      id1 = useActiveOrders.getState().createOrder('cust-sync', 'Mesa Sync');
      vi.runAllTimers();
    });

    // Validar que al crear orden, se sincronizó al useOrderStore
    let storeState = useOrderStore.getState();
    expect(storeState.activeOrderId).toBe(id1);
    expect(storeState.tableData).toBe('Mesa Sync');
    expect(storeState.order).toEqual([]);

    // Creamos una segunda orden (trigger switch)
    let id2;
    act(() => {
      // By-pass empty limits to create second order
      const activeState = useActiveOrders.getState();
      const order = activeState.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(activeState.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });

      id2 = useActiveOrders.getState().createOrder();
      vi.runAllTimers();
    });

    // Ahora el store debe apuntar a la orden 2 (vacía)
    storeState = useOrderStore.getState();
    expect(storeState.activeOrderId).toBe(id2);
    expect(storeState.order).toEqual([]);

    // Cambiamos de regreso a la orden 1
    act(() => {
      useActiveOrders.getState().switchOrder(id1);
      vi.runAllTimers();
    });

    // El store debe haber recuperado los items de la orden 1 automáticamente
    const refreshedStore = useOrderStore.getState();
    expect(refreshedStore.activeOrderId).toBe(id1);
    expect(refreshedStore.order).toEqual([{ id: 'p1', quantity: 1, price: 10 }]);
  });

  it('3. debería actualizar useActiveOrders cuando useOrderStore es modificado', () => {
    act(() => {
      useOrderStore.getState().linkWithActiveOrders(useActiveOrders);
    });

    let id1;
    act(() => {
      id1 = useActiveOrders.getState().createOrder('cust-test');
      vi.runAllTimers();
    });

    // Modificamos useOrderStore directamente (simulando que el usuario escaneó un producto)
    act(() => {
      useOrderStore.setState({
        order: [{ id: 'prod1', quantity: 2, price: 15 }]
      });
      vi.runAllTimers();
    });

    // El cambio debe reflejarse en useActiveOrders
    const activeState = useActiveOrders.getState();
    const order = activeState.activeOrders.get(id1);
    
    expect(order.items).toEqual([{ id: 'prod1', quantity: 2, price: 15 }]);
    expect(order.total).toBe(30);
  });

  it('4. el getter currentOrder en useOrderStore debe retornar la orden actual', () => {
    act(() => {
      useOrderStore.getState().linkWithActiveOrders(useActiveOrders);
    });

    let id1;
    act(() => {
      id1 = useActiveOrders.getState().createOrder();
      vi.runAllTimers();
    });

    const currentFromStore = useOrderStore.getState().currentOrder;
    expect(currentFromStore).toBeTruthy();
    expect(currentFromStore.id).toBe(id1);
    expect(currentFromStore.total).toBe(0);
  });
});
