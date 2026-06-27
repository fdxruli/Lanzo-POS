import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  openSales: []
}));

const storageState = vi.hoisted(() => ({
  values: new Map()
}));

const localStorageMock = {
  getItem: vi.fn((key) => storageState.values.get(key) ?? null),
  setItem: vi.fn((key, value) => {
    storageState.values.set(key, value);
  }),
  removeItem: vi.fn((key) => {
    storageState.values.delete(key);
  }),
  clear: vi.fn(() => {
    storageState.values.clear();
  }),
  key: vi.fn((index) => Array.from(storageState.values.keys())[index] ?? null),
  get length() {
    return storageState.values.size;
  }
};

vi.stubGlobal('window', { localStorage: localStorageMock });
vi.stubGlobal('localStorage', localStorageMock);

let mockIdCounter = 1;

vi.mock('../../../services/utils', () => ({
  generateID: vi.fn(() => `sal-draft-${mockIdCounter++}`),
  safeLocalStorageSet: vi.fn((key, value) => {
    localStorageMock.setItem(key, value);
  }),
  showMessageModal: vi.fn()
}));

vi.mock('../../../services/db/dexie', () => ({
  db: {
    table: vi.fn(() => ({
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn(async () => dbState.openSales)
        }))
      })),
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
      update: vi.fn(async () => 0)
    }))
  },
  STORES: { SALES: 'sales' }
}));

let useActiveOrders;

beforeAll(async () => {
  ({ useActiveOrders } = await import('../useActiveOrders'));
});

describe('useActiveOrders session recovery', () => {
  beforeEach(() => {
    mockIdCounter = 1;
    dbState.openSales = [];
    localStorageMock.clear();
    vi.clearAllMocks();

    useActiveOrders.setState({
      activeOrders: new Map(),
      currentOrderId: null,
      isLoading: false
    });
  });

  it('reuses an in-session draft instead of creating a duplicate order', async () => {
    useActiveOrders.setState({
      activeOrders: new Map([
        ['sal-draft-local', {
          id: 'sal-draft-local',
          items: [],
          customer: null,
          tableData: 'Mesa draft',
          createdAt: '2026-05-12T00:00:00.000Z',
          total: 0
        }]
      ]),
      currentOrderId: 'sal-draft-local'
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    const state = useActiveOrders.getState();
    expect(state.activeOrders.size).toBe(1);
    expect(state.currentOrderId).toBe('sal-draft-local');
    expect(state.activeOrders.get('sal-draft-local')?.tableData).toBe('Mesa draft');
  });

  it('merges open DB orders with local drafts and preserves the active draft', async () => {
    dbState.openSales = [{
      id: 'sal-db-1',
      items: [{ id: 'p1', quantity: 1, price: 35 }],
      customerId: null,
      tableData: 'Mesa guardada',
      timestamp: '2026-05-12T01:00:00.000Z',
      total: 35,
      status: 'open'
    }];

    useActiveOrders.setState({
      activeOrders: new Map([
        ['sal-draft-local', {
          id: 'sal-draft-local',
          items: [],
          customer: null,
          tableData: 'Juan',
          createdAt: '2026-05-12T02:00:00.000Z',
          total: 0
        }]
      ]),
      currentOrderId: 'sal-draft-local'
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    const state = useActiveOrders.getState();
    expect(state.activeOrders.size).toBe(2);
    expect(state.activeOrders.has('sal-db-1')).toBe(true);
    expect(state.activeOrders.has('sal-draft-local')).toBe(true);
    expect(state.currentOrderId).toBe('sal-draft-local');
  });

  it('keeps the newer DB version even when the stale local draft has more items', async () => {
    dbState.openSales = [{
      id: 'sal-shared',
      items: [{ id: 'db-product', quantity: 1, price: 50 }],
      tableData: 'Mesa DB',
      timestamp: '2026-05-12T01:00:00.000Z',
      updatedAt: '2026-05-12T03:00:00.000Z',
      revision: 7,
      deviceId: 'device-b',
      total: 50,
      status: 'open'
    }];

    useActiveOrders.setState({
      activeOrders: new Map([
        ['sal-shared', {
          id: 'sal-shared',
          items: [
            { id: 'old-1', quantity: 1, price: 10 },
            { id: 'old-2', quantity: 1, price: 20 }
          ],
          tableData: 'Mesa local vieja',
          createdAt: '2026-05-12T01:00:00.000Z',
          updatedAt: '2026-05-12T02:00:00.000Z',
          revision: 6,
          deviceId: 'device-a',
          total: 30
        }]
      ]),
      currentOrderId: 'sal-shared'
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    expect(useActiveOrders.getState().activeOrders.get('sal-shared')).toMatchObject({
      items: [{ id: 'db-product', quantity: 1, price: 50 }],
      tableData: 'Mesa DB',
      revision: 7,
      deviceId: 'device-b',
      isSaved: true
    });
  });

  it('keeps the local draft when its revision is newer than DB', async () => {
    dbState.openSales = [{
      id: 'sal-shared',
      items: [{ id: 'db-product', quantity: 1, price: 50 }],
      tableData: 'Mesa DB',
      timestamp: '2026-05-12T01:00:00.000Z',
      updatedAt: '2026-05-12T03:00:00.000Z',
      revision: 4,
      deviceId: 'device-b',
      total: 50,
      status: 'open'
    }];

    useActiveOrders.setState({
      activeOrders: new Map([
        ['sal-shared', {
          id: 'sal-shared',
          items: [{ id: 'local-product', quantity: 2, price: 25 }],
          tableData: 'Mesa local nueva',
          createdAt: '2026-05-12T01:00:00.000Z',
          updatedAt: '2026-05-12T02:00:00.000Z',
          revision: 5,
          deviceId: 'device-a',
          total: 50
        }]
      ]),
      currentOrderId: 'sal-shared'
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    expect(useActiveOrders.getState().activeOrders.get('sal-shared')).toMatchObject({
      items: [{ id: 'local-product', quantity: 2, price: 25 }],
      tableData: 'Mesa local nueva',
      revision: 5,
      deviceId: 'device-a',
      isSaved: true
    });
  });

  it('uses DB checkout lock metadata instead of stale local lock metadata', async () => {
    dbState.openSales = [{
      id: 'sal-shared',
      items: [{ id: 'db-product', quantity: 1, price: 50 }],
      tableData: 'Mesa DB',
      timestamp: '2026-05-12T01:00:00.000Z',
      updatedAt: '2026-05-12T03:00:00.000Z',
      revision: 4,
      deviceId: 'device-b',
      total: 50,
      status: 'open',
      isLockedForCheckout: false,
      lockedAt: null
    }];

    useActiveOrders.setState({
      activeOrders: new Map([
        ['sal-shared', {
          id: 'sal-shared',
          items: [{ id: 'local-product', quantity: 2, price: 25 }],
          tableData: 'Mesa local nueva',
          createdAt: '2026-05-12T01:00:00.000Z',
          updatedAt: '2026-05-12T02:00:00.000Z',
          revision: 5,
          deviceId: 'device-a',
          total: 50,
          isLockedForCheckout: true,
          lockedAt: '2026-05-12T02:30:00.000Z'
        }]
      ]),
      currentOrderId: 'sal-shared'
    });

    await useActiveOrders.getState().loadOrdersFromDB();

    expect(useActiveOrders.getState().activeOrders.get('sal-shared')).toMatchObject({
      items: [{ id: 'local-product', quantity: 2, price: 25 }],
      isLockedForCheckout: false,
      lockedAt: null
    });
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(false);
  });

});
