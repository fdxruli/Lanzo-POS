import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const storage = new Map();
  const localStorageMock = {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });

  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });
  }

  return { localStorageMock, storage };
});

const dbState = vi.hoisted(() => {
  const STORES = {
    SALES: 'sales',
    MENU: 'menu',
    PRODUCT_BATCHES: 'product_batches',
  };

  const salesMap = new Map();
  const salesTable = {
    get: vi.fn(async (id) => salesMap.get(id) ?? null),
    put: vi.fn(async (record) => {
      salesMap.set(record.id, structuredClone(record));
      return record.id;
    }),
  };

  const db = {
    table: vi.fn((storeName) => {
      if (storeName !== STORES.SALES) {
        throw new Error(`Store no mockeado: ${storeName}`);
      }
      return salesTable;
    }),
  };

  return { STORES, salesMap, salesTable, db };
});

const inventoryFlowMocks = vi.hoisted(() => ({
  commitStock: vi.fn(async (items) => (
    items.map((item) => ({
      ...item,
      inventoryReservation: {
        source: 'table',
        committedQuantity: Number(item.quantity) || 0,
        committedBatches: [],
      },
    }))
  )),
  releaseCommittedStock: vi.fn(async () => ({ success: true })),
}));

const utilsMocks = vi.hoisted(() => ({
  generateID: vi.fn((prefix = '') => `${prefix}_generated_id`),
  showMessageModal: vi.fn(),
}));

vi.mock('../../services/db/dexie', () => ({
  db: dbState.db,
  STORES: dbState.STORES,
}));

vi.mock('../../services/sales/inventoryFlow', () => ({
  commitStock: inventoryFlowMocks.commitStock,
  releaseCommittedStock: inventoryFlowMocks.releaseCommittedStock,
}));

vi.mock('../../services/utils', () => ({
  safeLocalStorageSet: (name, value) => testState.localStorageMock.setItem(name, value),
  showMessageModal: utilsMocks.showMessageModal,
  generateID: utilsMocks.generateID,
}));

vi.mock('../../services/database', () => ({
  queryBatchesByProductIdAndActive: vi.fn(async () => []),
}));

import { SALE_STATUS } from '../../services/sales/financialStats';
import { useOrderStore } from '../useOrderStore';

const resetStore = () => {
  useOrderStore.setState({
    order: [],
    activeOrderId: null,
    tableData: null,
  });
};

describe('useOrderStore - mesas abiertas', () => {
  beforeEach(() => {
    dbState.salesMap.clear();
    testState.localStorageMock.clear();
    vi.clearAllMocks();
    resetStore();
  });

  it('loadOpenOrder carga solo ventas con status open', async () => {
    dbState.salesMap.set('sale-open-1', {
      id: 'sale-open-1',
      status: SALE_STATUS.OPEN,
      items: [{ id: 'prod-1', quantity: 2, price: 10 }],
      tableData: 'Mesa 7',
    });

    const result = await useOrderStore.getState().loadOpenOrder('sale-open-1');
    const state = useOrderStore.getState();

    expect(result).toEqual({ success: true });
    expect(state.order).toEqual([{ id: 'prod-1', quantity: 2, price: 10 }]);
    expect(state.activeOrderId).toBe('sale-open-1');
    expect(state.tableData).toBe('Mesa 7');
  });

  it('loadOpenOrder no muta sesión cuando la venta no está open', async () => {
    dbState.salesMap.set('sale-closed-1', {
      id: 'sale-closed-1',
      status: SALE_STATUS.CLOSED,
      items: [{ id: 'prod-closed', quantity: 1, price: 5 }],
      tableData: 'Mesa X',
    });

    useOrderStore.setState({
      order: [{ id: 'existing', quantity: 1, price: 1 }],
      activeOrderId: 'active-existing',
      tableData: 'Mesa Actual',
    });

    const result = await useOrderStore.getState().loadOpenOrder('sale-closed-1');
    const state = useOrderStore.getState();

    expect(result.success).toBe(false);
    expect(state.order).toEqual([{ id: 'existing', quantity: 1, price: 1 }]);
    expect(state.activeOrderId).toBe('active-existing');
    expect(state.tableData).toBe('Mesa Actual');
  });

  it('saveOrderAsOpen inserta nueva orden abierta y limpia la sesión', async () => {
    useOrderStore.setState({
      order: [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 10 }],
      activeOrderId: null,
      tableData: 'Mesa 7',
    });

    const result = await useOrderStore.getState().saveOrderAsOpen();
    const savedSale = dbState.salesMap.get('sal_generated_id');
    const state = useOrderStore.getState();

    expect(result).toEqual({ success: true, id: 'sal_generated_id' });
    expect(inventoryFlowMocks.releaseCommittedStock).not.toHaveBeenCalled();
    expect(inventoryFlowMocks.commitStock).toHaveBeenCalledTimes(1);
    expect(savedSale).toMatchObject({
      id: 'sal_generated_id',
      status: SALE_STATUS.OPEN,
      orderType: 'table',
      fulfillmentStatus: 'open',
      tableData: 'Mesa 7',
    });
    expect(savedSale.items).toHaveLength(1);
    expect(Number(savedSale.total)).toBe(20);
    expect(state.order).toEqual([]);
    expect(state.activeOrderId).toBeNull();
    expect(state.tableData).toBeNull();
  });

  it('saveOrderAsOpen actualiza orden activa liberando y re-reservando stock', async () => {
    dbState.salesMap.set('sale-open-2', {
      id: 'sale-open-2',
      timestamp: '2026-03-18T12:00:00.000Z',
      status: SALE_STATUS.OPEN,
      tableData: 'Mesa Vieja',
      items: [{ id: 'old-item', quantity: 1, price: 5, inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] } }],
    });

    useOrderStore.setState({
      order: [{ id: 'new-item', quantity: 3, price: 7 }],
      activeOrderId: 'sale-open-2',
      tableData: 'Mesa 9',
    });

    const result = await useOrderStore.getState().saveOrderAsOpen();
    const updatedSale = dbState.salesMap.get('sale-open-2');

    expect(result).toEqual({ success: true, id: 'sale-open-2' });
    expect(inventoryFlowMocks.releaseCommittedStock).toHaveBeenCalledTimes(1);
    expect(inventoryFlowMocks.releaseCommittedStock).toHaveBeenCalledWith(
      [{ id: 'old-item', quantity: 1, price: 5, inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] } }],
      { db: dbState.db, STORES: dbState.STORES }
    );
    expect(inventoryFlowMocks.commitStock).toHaveBeenCalledTimes(1);
    expect(updatedSale.timestamp).toBe('2026-03-18T12:00:00.000Z');
    expect(updatedSale.tableData).toBe('Mesa 9');
    expect(updatedSale.status).toBe(SALE_STATUS.OPEN);
  });

  it('saveOrderAsOpen hace rollback best-effort si falla el upsert', async () => {
    const oldReservedItems = [
      { id: 'old-item', quantity: 2, price: 3, inventoryReservation: { source: 'table', committedQuantity: 2, committedBatches: [] } },
    ];
    const newCommittedItems = [
      { id: 'new-item', quantity: 1, price: 9, inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] } },
    ];

    dbState.salesMap.set('sale-open-rollback', {
      id: 'sale-open-rollback',
      timestamp: '2026-03-18T13:00:00.000Z',
      status: SALE_STATUS.OPEN,
      items: oldReservedItems,
      tableData: 'Mesa 10',
    });

    inventoryFlowMocks.commitStock
      .mockResolvedValueOnce(newCommittedItems)
      .mockResolvedValueOnce(oldReservedItems);

    inventoryFlowMocks.releaseCommittedStock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    dbState.salesTable.put.mockRejectedValueOnce(new Error('put failed'));

    useOrderStore.setState({
      order: [{ id: 'new-item', quantity: 1, price: 9 }],
      activeOrderId: 'sale-open-rollback',
      tableData: 'Mesa 10',
    });

    const result = await useOrderStore.getState().saveOrderAsOpen();
    const state = useOrderStore.getState();

    expect(result.success).toBe(false);
    expect(result.message).toContain('put failed');
    expect(inventoryFlowMocks.releaseCommittedStock).toHaveBeenCalledTimes(2);
    expect(inventoryFlowMocks.releaseCommittedStock.mock.calls[0][0]).toEqual(oldReservedItems);
    expect(inventoryFlowMocks.releaseCommittedStock.mock.calls[1][0]).toEqual(newCommittedItems);
    expect(inventoryFlowMocks.commitStock).toHaveBeenCalledTimes(2);
    expect(inventoryFlowMocks.commitStock.mock.calls[0][0]).toEqual([{ id: 'new-item', quantity: 1, price: 9 }]);
    expect(inventoryFlowMocks.commitStock.mock.calls[1][0]).toEqual(oldReservedItems);
    expect(state.activeOrderId).toBe('sale-open-rollback');
    expect(state.order).toEqual([{ id: 'new-item', quantity: 1, price: 9 }]);
  });

  it('clearSession limpia order, activeOrderId y tableData', () => {
    useOrderStore.setState({
      order: [{ id: 'prod', quantity: 1, price: 2 }],
      activeOrderId: 'sale-open-3',
      tableData: 'Mesa 3',
    });

    useOrderStore.getState().clearSession();
    const state = useOrderStore.getState();

    expect(state.order).toEqual([]);
    expect(state.activeOrderId).toBeNull();
    expect(state.tableData).toBeNull();
  });
});
