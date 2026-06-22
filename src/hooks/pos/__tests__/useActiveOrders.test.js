import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  sales: new Map(),
  products: new Map(),
  batches: [],
  batchLoadPromise: null
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
          update: vi.fn(async (id, changes) => {
            const current = dbState.sales.get(id);
            if (!current) return 0;
            dbState.sales.set(id, { ...current, ...changes });
            return 1;
          }),
          where: vi.fn((field) => ({
            equals: vi.fn((value) => ({
              toArray: vi.fn(async () => Array.from(dbState.sales.values())
                .filter((sale) => sale?.[field] === value))
            }))
          }))
        };
      }

      if (storeName === 'menu') {
        return {
          toArray: vi.fn(async () => Array.from(dbState.products.values())),
          bulkPut: vi.fn(async (products) => {
            products.forEach((product) => dbState.products.set(product.id, product));
            return products.map((product) => product.id);
          })
        };
      }

      return {
        toArray: vi.fn(async () => dbState.batches),
        where: vi.fn(() => ({
          equals: vi.fn(() => ({
            filter: vi.fn(() => ({
              toArray: vi.fn(async () => (
                dbState.batchLoadPromise
                  ? await dbState.batchLoadPromise
                  : dbState.batches
              ))
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

import {
  selectCurrentOrder,
  selectCurrentOrderCustomer,
  selectCurrentOrderItems,
  selectCurrentOrderTableData,
  useActiveOrders
} from '../useActiveOrders';

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
    dbState.products.clear();
    dbState.batches = [];
    dbState.batchLoadPromise = null;
    vi.clearAllMocks();
    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false,
      isCurrentOrderLocked: false,
      pendingInventoryResolutions: new Map()
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

  it('keeps focused selector references stable when only checkout lock metadata changes', () => {
    const items = [{ id: 'product-1', quantity: 1, price: 25 }];
    const customer = { id: 'customer-1' };
    const order = {
      ...makeOrder('one', items),
      customer,
      tableData: 'Mesa 1'
    };

    useActiveOrders.setState({
      activeOrders: new Map([['one', order]]),
      currentOrderId: 'one'
    });

    const before = useActiveOrders.getState();
    const selectedItems = selectCurrentOrderItems(before);
    const selectedCustomer = selectCurrentOrderCustomer(before);
    const selectedTableData = selectCurrentOrderTableData(before);

    useActiveOrders.setState({
      activeOrders: new Map([[
        'one',
        { ...order, isLockedForCheckout: true, lockedAt: '2026-06-14T12:00:00.000Z' }
      ]])
    });

    const after = useActiveOrders.getState();
    expect(selectCurrentOrderItems(after)).toBe(selectedItems);
    expect(selectCurrentOrderCustomer(after)).toBe(selectedCustomer);
    expect(selectCurrentOrderTableData(after)).toBe(selectedTableData);
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
    expect(state.activeOrders.get('two')?.revision).toBe(2);
    expect(state.activeOrders.get('two')?.updatedAt).toEqual(expect.any(String));
    expect(state.activeOrders.get('two')?.deviceId).toEqual(expect.any(String));
  });

  it('resolves batch data before mutating the order', async () => {
    let resolveBatches;
    dbState.batchLoadPromise = new Promise((resolve) => {
      resolveBatches = resolve;
    });

    useActiveOrders.setState({
      activeOrders: new Map([['one', makeOrder('one')]]),
      currentOrderId: 'one'
    });

    const addPromise = useActiveOrders.getState().addSmartItem({
      id: 'product-batch',
      name: 'Batch product',
      price: 20,
      cost: 8,
      saleType: 'unit',
      trackStock: true,
      batchManagement: { enabled: true }
    });

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toEqual([]);
    expect(useActiveOrders.getState().pendingInventoryResolutions.get('one')).toBe(1);

    resolveBatches([{
      id: 'batch-1',
      productId: 'product-batch',
      price: 25,
      cost: 10,
      stock: 4,
      committedStock: 1,
      isActive: true,
      sku: 'BATCH-1'
    }]);
    await addPromise;

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toMatchObject([{
      id: 'product-batch',
      batchId: 'batch-1',
      price: 25,
      cost: 10,
      stock: 3,
      quantity: 1,
      isVariant: true,
      skuDetected: 'BATCH-1'
    }]);
    expect(useActiveOrders.getState().pendingInventoryResolutions.has('one')).toBe(false);
  });

  it('updates and removes cart lines by lineId without touching duplicate product ids', () => {
    useActiveOrders.setState({
      activeOrders: new Map([[
        'one',
        makeOrder('one', [
          { id: 'product-1', lineId: 'line-a', name: 'Product', quantity: 1, price: 10, saleType: 'unit' },
          { id: 'product-1', lineId: 'line-b', name: 'Product', quantity: 2, price: 10, saleType: 'unit' }
        ])
      ]]),
      currentOrderId: 'one'
    });

    useActiveOrders.getState().updateItemQuantity('line-b', 4);

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toMatchObject([
      { id: 'product-1', lineId: 'line-a', quantity: 1 },
      { id: 'product-1', lineId: 'line-b', quantity: 4 }
    ]);

    useActiveOrders.getState().removeItem('line-a');

    expect(useActiveOrders.getState().activeOrders.get('one')?.items).toMatchObject([
      { id: 'product-1', lineId: 'line-b', quantity: 4 }
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

  it('restores legacy review orders as visible open orders without releasing reservations', async () => {
    dbState.sales.set('sale-review', {
      id: 'sale-review',
      status: 'requires_review',
      fulfillmentStatus: 'completed',
      timestamp: '2026-06-01T01:00:00.000Z',
      items: [{
        id: 'product-1',
        quantity: 1,
        inventoryReservation: {
          source: 'table',
          committedQuantity: 1,
          committedBatches: []
        }
      }]
    });

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, recovered: 1 });
    expect(dbState.sales.get('sale-review')).toMatchObject({
      status: 'open',
      requiresReview: true
    });
  });

  it('keeps stale orders financially open while flagging them for review', async () => {
    dbState.sales.set('sale-stale', {
      id: 'sale-stale',
      status: 'open',
      fulfillmentStatus: 'completed',
      timestamp: '2020-01-01T00:00:00.000Z',
      items: []
    });

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, count: 1 });
    expect(dbState.sales.get('sale-stale')).toMatchObject({
      status: 'open',
      requiresReview: true
    });
  });

  it('repairs committed stock on batch-managed parent products', async () => {
    dbState.products.set('avocado', {
      id: 'avocado',
      stock: 2.5,
      committedStock: 1,
      batchManagement: { enabled: true }
    });
    dbState.batches = [{
      id: 'batch-avocado',
      productId: 'avocado',
      stock: 2.5,
      committedStock: 0
    }];

    const result = await useActiveOrders.getState().reconcileOrphanedOrders();

    expect(result).toMatchObject({ success: true, repairedBatchParents: 1 });
    expect(dbState.products.get('avocado')).toMatchObject({
      stock: 2.5,
      committedStock: 0
    });
  });
});
