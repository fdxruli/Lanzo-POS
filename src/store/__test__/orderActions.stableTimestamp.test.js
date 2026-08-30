import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ sales: new Map() }));

vi.mock('../../services/db/dexie', () => ({
  STORES: {
    SALES: 'sales',
    MENU: 'menu',
    PRODUCT_BATCHES: 'product_batches'
  },
  db: {
    table: vi.fn((storeName) => {
      if (storeName === 'sales') {
        return {
          get: vi.fn(async (id) => runtime.sales.get(id) || null),
          put: vi.fn(async (value) => {
            runtime.sales.set(value.id, structuredClone(value));
            return value.id;
          })
        };
      }
      return {
        toArray: vi.fn(async () => [])
      };
    }),
    transaction: vi.fn(async (_mode, _tables, callback) => callback())
  }
}));

vi.mock('../../services/db/utils', () => ({
  getAvailableStock: () => 0,
  getCommittedStock: () => 0,
  normalizeStock: (value) => Number(value || 0)
}));

vi.mock('../../services/sales/inventoryFlow', () => ({
  commitStock: vi.fn(async (items) => items),
  releaseCommittedStock: vi.fn(async () => ({ success: true })),
  getSortedBatchesForProduct: (batches) => batches
}));

vi.mock('../../services/sales/financialStats', () => ({ SALE_STATUS: { OPEN: 'open' } }));

vi.mock('../../services/utils', () => ({
  generateID: vi.fn(() => 'generated-sale-id'),
  showMessageModal: vi.fn()
}));

import { createOrderActions } from '../orderActions';

const makeState = (order) => ({
  activeOrders: new Map([[order.id, order]]),
  currentOrderId: order.id
});

const makeOrder = (changes = {}) => ({
  id: 'order-X',
  items: [{ id: 'product-1', price: 10, quantity: 1 }],
  tableData: null,
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
  revision: 0,
  isSaved: false,
  ...changes
});

describe('saveOrderAsOpen immutable timestamp authority', () => {
  beforeEach(() => {
    runtime.sales.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T10:05:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inherits the active order timestamp for a new SALES row and keeps it on later saves', async () => {
    const firstOrder = makeOrder();
    let state = makeState(firstOrder);
    const set = (next) => {
      state = { ...state, ...(typeof next === 'function' ? next(state) : next) };
    };
    const get = () => state;
    const actions = createOrderActions(set, get);

    await expect(actions.saveOrderAsOpen(firstOrder.id, firstOrder)).resolves.toMatchObject({
      success: true,
      id: firstOrder.id
    });
    expect(runtime.sales.get(firstOrder.id)).toMatchObject({
      id: firstOrder.id,
      timestamp: firstOrder.createdAt,
      status: 'open'
    });

    vi.setSystemTime(new Date('2026-08-30T10:20:00.000Z'));
    const laterOrder = makeOrder({
      isSaved: true,
      revision: 1,
      updatedAt: '2026-08-30T10:20:00.000Z',
      items: [{ id: 'product-1', price: 12, quantity: 1 }]
    });

    await expect(actions.saveOrderAsOpen(laterOrder.id, laterOrder)).resolves.toMatchObject({
      success: true,
      id: laterOrder.id
    });
    expect(runtime.sales.get(firstOrder.id).timestamp).toBe(firstOrder.createdAt);
  });
});
