import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveOrders } from '../useActiveOrders';
import { useOrderStore } from '../../../store/useOrderStore';
import { db, STORES } from '../../../services/db/dexie';
import { releaseCommittedStock } from '../../../services/sales/inventoryFlow';

// Mocks
vi.mock('../../../store/useOrderStore', () => ({
  useOrderStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn((callback) => {
      global.mockStoreSubscribe = callback;
    }),
  }
}));

const dbMocks = vi.hoisted(() => {
  const salesMap = new Map();
  const salesTable = {
    get: vi.fn(async (id) => salesMap.get(id) ?? null),
    put: vi.fn(async (record) => {
      salesMap.set(record.id, structuredClone(record));
      return record.id;
    }),
    update: vi.fn(async (id, changes) => {
      const existing = salesMap.get(id);
      if (!existing) return 0;
      salesMap.set(id, { ...existing, ...structuredClone(changes) });
      return 1;
    })
  };

  return {
    salesMap,
    salesTable,
    db: {
      table: vi.fn(() => salesTable)
    },
    STORES: { SALES: 'sales' }
  };
});

vi.mock('../../../services/db/dexie', () => ({
  db: dbMocks.db,
  STORES: dbMocks.STORES
}));

vi.mock('../../../services/sales/inventoryFlow', () => ({
  releaseCommittedStock: vi.fn(async () => ({ success: true }))
}));

let mockIdCounter = 1;
vi.mock('../../../services/utils', () => ({
  generateID: vi.fn(() => `sal-mock${mockIdCounter++}`)
}));

vi.mock('../../../utils/moneyMath', () => ({
  Money: {
    multiply: vi.fn((price, qty) => price * qty),
    add: vi.fn((a, b) => a + b),
    init: vi.fn((val) => val),
    toNumber: vi.fn((val) => val)
  }
}));

describe('useActiveOrders', () => {
  beforeEach(() => {
    mockIdCounter = 1;
    
    // Reset Zustand store state between tests manually
    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false
    });
    dbMocks.salesMap.clear();
    
    vi.clearAllMocks();
    
    useOrderStore.getState.mockReturnValue({
      setOrder: vi.fn(),
      setTableData: vi.fn(),
      clearSession: vi.fn(),
      saveOrderAsOpen: vi.fn().mockResolvedValue({ success: true, id: 'sal-mock1' }),
      addSmartItem: vi.fn(),
      removeItem: vi.fn()
    });
  });

  it('1. createOrder: crea nueva orden y la activa', () => {
    const { result } = renderHook(() => useActiveOrders());
    
    let id;
    act(() => {
      id = result.current.createOrder('cust-1', 'Mesa 1');
    });

    expect(id).toBe('sal-mock1');
    expect(result.current.currentOrderId).toBe('sal-mock1');
    expect(result.current.activeOrders.has('sal-mock1')).toBe(true);
    const order = result.current.activeOrders.get('sal-mock1');
    expect(order.tableData).toBe('Mesa 1');
    expect(order.customer.id).toBe('cust-1');
  });

  it('2. switchOrder: cambia currentOrderId sin perder datos de otras órdenes', () => {
    const { result } = renderHook(() => useActiveOrders());
    
    let id1;
    act(() => { id1 = result.current.createOrder(); });
    
    // By-pass empty validation to create another
    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });

    let id2;
    act(() => { id2 = result.current.createOrder(); });

    expect(result.current.currentOrderId).toBe(id2);
    expect(result.current.activeOrders.size).toBe(2);

    act(() => {
      result.current.switchOrder(id1);
    });

    expect(result.current.currentOrderId).toBe(id1);
    expect(result.current.activeOrders.size).toBe(2); // no data lost
  });

  it('3. addItemToOrder: agrega producto a orden específica', async () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    const mockStore = useOrderStore.getState();

    await act(async () => {
      await result.current.addItemToOrder(id1, { id: 'p1', price: 10 });
    });

    // Como id1 es la currentOrder, debe delegar a addSmartItem
    expect(mockStore.addSmartItem).toHaveBeenCalledWith({ id: 'p1', price: 10 });
  });

  it('4. removeItemFromOrder: quita item correctamente', () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    const mockStore = useOrderStore.getState();

    act(() => {
      result.current.removeItemFromOrder(id1, 'p1');
    });

    expect(mockStore.removeItem).toHaveBeenCalledWith('p1');
  });

  it('5. pauseOrder: si está vacía se elimina silenciosamente, si tiene items se guarda a DB', async () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    // Si está vacía, se elimina silenciosamente en lugar de lanzar error
    await act(async () => {
      await result.current.pauseOrder(id1);
    });
    
    // Debería haberse creado una nueva automáticamente porque era la última
    expect(result.current.activeOrders.has(id1)).toBe(false);
    expect(result.current.activeOrders.size).toBe(1);
    
    // Obtenemos el nuevo ID para continuar el test
    id1 = result.current.currentOrderId;

    // Agregamos item
    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });

    await act(async () => {
      await result.current.pauseOrder(id1);
    });

    // Como era currentOrder, llama a saveOrderAsOpen de useOrderStore
    const mockStore = useOrderStore.getState();
    expect(mockStore.saveOrderAsOpen).toHaveBeenCalled();
    expect(mockStore.clearSession).toHaveBeenCalled();

    // Saca de activeOrders
    expect(result.current.activeOrders.has(id1)).toBe(false);
    // Limpia currentOrderId si no quedan otras (aunque useActiveOrders.createOrder autogenera una nueva si está vacía, 
    // así que habrá una nueva en activeOrders y no será null)
    expect(result.current.currentOrderId).not.toBe(id1);
  });

  it('6. closeOrder: similar a pauseOrder pero con status closed', async () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });

    await act(async () => {
      await result.current.closeOrder(id1, { cash: 100 });
    });

    expect(db.table(STORES.SALES).put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: id1,
        status: 'closed',
        paymentData: { cash: 100 }
      })
    );

    expect(result.current.activeOrders.has(id1)).toBe(false);
  });

  it('7. Sincronización: cambiar currentOrderId refleja cambio en derivado currentOrder', () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    expect(result.current.currentOrder.id).toBe(id1);

    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });

    let id2;
    act(() => { id2 = result.current.createOrder(); });

    expect(result.current.currentOrder.id).toBe(id2);
  });

  it('8. Límite de órdenes: no permitir más de 10 simultáneas', () => {
    const { result } = renderHook(() => useActiveOrders());
    
    // create 10 orders
    for (let i = 0; i < 10; i++) {
      act(() => { 
        const id = result.current.createOrder(); 
        const order = result.current.activeOrders.get(id);
        order.items = [{ id: `p${i}`, quantity: 1, price: 10 }]; // Bypass empty restriction
        const map = new Map(result.current.activeOrders);
        map.set(id, order);
        useActiveOrders.setState({ activeOrders: map });
      });
    }

    expect(result.current.activeOrders.size).toBe(10);
    
    let error;
    try {
      act(() => {
        result.current.createOrder();
      });
    } catch (e) {
      error = e;
    }
    expect(error.message).toMatch(/Límite máximo/);
  });

  it('9. Recuperación de errores: si pauseOrder falla en BD, state se revierte/mantiene', async () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    act(() => { id1 = result.current.createOrder(); });

    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });

    const mockStore = useOrderStore.getState();
    mockStore.saveOrderAsOpen.mockResolvedValueOnce({ success: false, message: 'DB failure' });

    let error;
    try {
      await act(async () => {
        await result.current.pauseOrder(id1);
      });
    } catch (e) {
      error = e;
    }

    expect(error.message).toBe('DB failure');
    // State debe mantenerse inalterado tras el error
    expect(result.current.activeOrders.has(id1)).toBe(true);
  });

  it('10. cancelOrder: cancela solo la orden indicada y no vuelve a cargar como abierta', async () => {
    const { result } = renderHook(() => useActiveOrders());
    let id1;
    let id2;

    act(() => { id1 = result.current.createOrder(); });
    act(() => {
      const order = result.current.activeOrders.get(id1);
      order.items = [{ id: 'p1', quantity: 1, price: 10 }];
      const map = new Map(result.current.activeOrders);
      map.set(id1, order);
      useActiveOrders.setState({ activeOrders: map });
    });
    act(() => { id2 = result.current.createOrder(); });

    dbMocks.salesMap.set(id1, {
      id: id1,
      status: 'open',
      items: [{ id: 'p1', quantity: 1, price: 10 }]
    });

    await act(async () => {
      await result.current.cancelOrder(id1);
    });

    expect(result.current.activeOrders.has(id1)).toBe(false);
    expect(result.current.activeOrders.has(id2)).toBe(true);
    expect(result.current.activeOrders.size).toBe(1);
    expect(dbMocks.salesMap.get(id1).status).toBe('cancelled');
    expect(releaseCommittedStock).toHaveBeenCalledWith(
      [{ id: 'p1', quantity: 1, price: 10 }],
      { db, STORES }
    );
  });
});
