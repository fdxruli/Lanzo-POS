import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  sales: new Map(),
  batches: []
}));

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(() => null),
  get length() {
    return 0;
  }
};

vi.stubGlobal('window', { localStorage: localStorageMock });
vi.stubGlobal('localStorage', localStorageMock);

vi.mock('../../../services/utils', () => ({
  generateID: vi.fn(() => 'sal-generated'),
  safeLocalStorageSet: vi.fn(),
  showMessageModal: vi.fn(),
  roundCurrency: vi.fn((value) => Math.round(Number(value) * 100) / 100)
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: {
    SALES: 'sales',
    MENU: 'menu',
    PRODUCT_BATCHES: 'product_batches'
  },
  db: {
    table: vi.fn((storeName) => {
      if (storeName === 'sales') {
        return {
          get: vi.fn(async (id) => dbState.sales.get(id) || null),
          where: vi.fn(() => ({
            equals: vi.fn(() => ({
              toArray: vi.fn(async () => Array.from(dbState.sales.values()))
            }))
          }))
        };
      }

      return {
        where: vi.fn(() => ({
          equals: vi.fn(() => ({
            filter: vi.fn(() => ({
              toArray: vi.fn(async () => dbState.batches)
            }))
          }))
        }))
      };
    })
  }
}));

vi.mock('../../../services/sales/inventoryFlow', () => ({
  commitStock: vi.fn(async (items) => items),
  releaseCommittedStock: vi.fn(async () => ({ success: true })),
  getSortedBatchesForProduct: vi.fn((batches) => batches)
}));

import { selectCurrentOrder, useActiveOrders } from '../useActiveOrders';

const makeOrder = (id, items = []) => ({
  id,
  items,
  customer: null,
  tableData: null,
  createdAt: '2026-06-09T00:00:00.000Z',
  total: 0,
  isSaved: false
});

describe('useActiveOrders unified store', () => {
  beforeEach(() => {
    dbState.sales.clear();
    dbState.batches = [];
    vi.clearAllMocks();
    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false,
      isCurrentOrderLocked: false
    });
  });

  it('derives the current order after every state update', () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['one', makeOrder('one')],
        ['two', makeOrder('two')]
      ]),
      currentOrderId: 'one'
    });

    expect(selectCurrentOrder(useActiveOrders.getState())?.id).toBe('one');

    useActiveOrders.getState().switchOrder('two');

    expect(selectCurrentOrder(useActiveOrders.getState())?.id).toBe('two');
    expect(useActiveOrders.getState()).not.toHaveProperty('order');
    expect(useActiveOrders.getState()).not.toHaveProperty('activeOrderId');
  });

  it('applies the same cart rules to a non-current order', async () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['one', makeOrder('one')],
        ['two', makeOrder('two')]
      ]),
      currentOrderId: 'one'
    });

    const product = {
      id: 'product-1',
      name: 'Product',
      price: 25,
      saleType: 'unit',
      trackStock: false
    };

    await useActiveOrders.getState().addItemToOrder('two', product);
    await useActiveOrders.getState().addItemToOrder('two', product);

    const state = useActiveOrders.getState();
    expect(state.currentOrderId).toBe('one');
    expect(state.activeOrders.get('one')?.items).toEqual([]);
    expect(state.activeOrders.get('two')?.items).toMatchObject([
      { id: 'product-1', quantity: 2, price: 25 }
    ]);
  });

  it('loads an open sale into the unified session', async () => {
    dbState.sales.set('sale-open', {
      id: 'sale-open',
      status: 'open',
      items: [{ id: 'product-1', quantity: 2, price: 10 }],
      tableData: 'Mesa 3',
      timestamp: '2026-06-09T01:00:00.000Z',
      total: 20
    });

    const result = await useActiveOrders.getState().loadOpenOrder('sale-open');
    const state = useActiveOrders.getState();

    expect(result).toEqual({ success: true });
    expect(state.currentOrderId).toBe('sale-open');
    expect(selectCurrentOrder(state)).toMatchObject({
      id: 'sale-open',
      tableData: 'Mesa 3',
      isSaved: true
    });
  });
});
