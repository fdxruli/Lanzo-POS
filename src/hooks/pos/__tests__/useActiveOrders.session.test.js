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
let useOrderStore;

beforeAll(async () => {
  ({ useActiveOrders } = await import('../useActiveOrders'));
  ({ useOrderStore } = await import('../../../store/useOrderStore'));
});

describe('useActiveOrders session recovery', () => {
  beforeEach(() => {
    mockIdCounter = 1;
    dbState.openSales = [];
    localStorageMock.clear();
    vi.clearAllMocks();

    useOrderStore.setState({
      activeOrderId: null,
      tableData: null
    });

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


});
