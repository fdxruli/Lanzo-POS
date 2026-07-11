import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  sales: new Map(),
  products: new Map(),
  batches: []
}));

vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({
  releaseEcommerceOrderPosDraft: vi.fn(async () => ({ success: true }))
}));

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(() => null),
  get length() { return 0; }
};

vi.stubGlobal('window', { localStorage: localStorageMock });
vi.stubGlobal('localStorage', localStorageMock);

vi.mock('../../../services/utils', () => ({
  generateID: vi.fn(() => 'sal-generated'),
  safeLocalStorageSet: vi.fn(),
  showMessageModal: vi.fn(),
  roundCurrency: vi.fn((value) => Math.round(Number(value) * 100) / 100)
}));

vi.mock('../../../services/db/dexie', () => {
  const salesTable = {
    get: vi.fn(async (id) => dbState.sales.get(id) || null),
    put: vi.fn(async (value) => {
      dbState.sales.set(value.id, { ...value });
      return value.id;
    }),
    update: vi.fn(async (id, changes) => {
      const current = dbState.sales.get(id);
      if (!current) return 0;
      dbState.sales.set(id, { ...current, ...changes });
      return 1;
    }),
    where: vi.fn((field) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => Array.from(dbState.sales.values()).filter((sale) => sale?.[field] === value))
      }))
    }))
  };

  return {
    STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches' },
    db: {
      transaction: vi.fn(async (_mode, _table, callback) => callback()),
      table: vi.fn((storeName) => {
        if (storeName === 'sales') return salesTable;
        if (storeName === 'menu') {
          return {
            toArray: vi.fn(async () => Array.from(dbState.products.values())),
            bulkPut: vi.fn(async (products) => products.map((product) => product.id))
          };
        }
        return {
          toArray: vi.fn(async () => dbState.batches),
          where: vi.fn(() => ({
            equals: vi.fn(() => ({
              filter: vi.fn(() => ({ toArray: vi.fn(async () => dbState.batches) }))
            }))
          }))
        };
      })
    }
  };
});

vi.mock('../../../services/sales/inventoryFlow', () => ({
  commitStock: vi.fn(async (items) => items),
  releaseCommittedStock: vi.fn(async () => ({ success: true })),
  getSortedBatchesForProduct: vi.fn((batches) => batches)
}));

import { useActiveOrders } from '../useActiveOrders';

const makeOrder = (id) => ({
  id,
  items: [{ id: 'product-1', quantity: 1, price: 20 }],
  customer: null,
  tableData: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  revision: 0,
  deviceId: 'device-test',
  total: 20,
  isSaved: true,
  isLockedForCheckout: false,
  lockedAt: null
});

beforeEach(() => {
  vi.clearAllMocks();
  dbState.sales.clear();
  const orderA = makeOrder('order-a');
  const orderC = makeOrder('order-c');
  dbState.sales.set(orderA.id, { ...orderA, status: 'open' });
  dbState.sales.set(orderC.id, { ...orderC, status: 'open' });
  useActiveOrders.setState({
    activeOrders: new Map([[orderA.id, orderA], [orderC.id, orderC]]),
    currentOrderId: orderA.id,
    isLoading: false,
    isCurrentOrderLocked: false,
    pendingInventoryResolutions: new Map()
  });
});

describe('useActiveOrders checkout lock persistence', () => {
  it('persists lock A in memory and Dexie', async () => {
    const result = await useActiveOrders.getState().lockOrderForCheckout('order-a');

    expect(result.success).toBe(true);
    expect(useActiveOrders.getState().activeOrders.get('order-a')).toMatchObject({
      isLockedForCheckout: true,
      lockedAt: expect.any(String)
    });
    expect(dbState.sales.get('order-a')).toMatchObject({
      isLockedForCheckout: true,
      lockedAt: expect.any(String)
    });
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(true);
  });

  it('unlocks A in memory and Dexie without changing currentOrderId C', async () => {
    await useActiveOrders.getState().lockOrderForCheckout('order-a');
    useActiveOrders.setState({ currentOrderId: 'order-c', isCurrentOrderLocked: false });

    const result = await useActiveOrders.getState().unlockOrder('order-a');

    expect(result.success).toBe(true);
    expect(useActiveOrders.getState().currentOrderId).toBe('order-c');
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(false);
    expect(useActiveOrders.getState().activeOrders.get('order-a')).toMatchObject({
      isLockedForCheckout: false,
      lockedAt: null
    });
    expect(dbState.sales.get('order-a')).toMatchObject({
      isLockedForCheckout: false,
      lockedAt: null
    });
  });

  it('keeps isCurrentOrderLocked unchanged when unlocking a non-current order', async () => {
    await useActiveOrders.getState().lockOrderForCheckout('order-a');
    useActiveOrders.setState({ currentOrderId: 'order-c', isCurrentOrderLocked: true });

    await useActiveOrders.getState().unlockOrder('order-a');

    expect(useActiveOrders.getState().currentOrderId).toBe('order-c');
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(true);
  });

  it('allows two consecutive unlock calls without affecting another order', async () => {
    await useActiveOrders.getState().lockOrderForCheckout('order-a');
    useActiveOrders.setState({ currentOrderId: 'order-c', isCurrentOrderLocked: false });

    const first = await useActiveOrders.getState().unlockOrder('order-a');
    const second = await useActiveOrders.getState().unlockOrder('order-a');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(useActiveOrders.getState().activeOrders.get('order-c')).toEqual(makeOrder('order-c'));
    expect(dbState.sales.get('order-c')).toMatchObject({ isLockedForCheckout: false, lockedAt: null });
  });
});
