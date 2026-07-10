import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listEcommerceOrders: vi.fn(),
  getEcommerceOrder: vi.fn(),
  markEcommerceOrderSeen: vi.fn(),
  acceptEcommerceOrder: vi.fn(),
  rejectEcommerceOrder: vi.fn()
}));

vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({
  listEcommerceOrders: mocks.listEcommerceOrders,
  getEcommerceOrder: mocks.getEcommerceOrder,
  markEcommerceOrderSeen: mocks.markEcommerceOrderSeen,
  acceptEcommerceOrder: mocks.acceptEcommerceOrder,
  rejectEcommerceOrder: mocks.rejectEcommerceOrder,
  getEcommerceOrderErrorMessage: () => 'Error seguro'
}));

import { createEcommerceOrderSlice } from '../createEcommerceOrderSlice';

const license = (licenseKey) => ({
  license_key: licenseKey,
  features: { ecommerce_order_inbox: true }
});

const counts = (overrides = {}) => ({
  new: 0,
  seen: 0,
  pending: 0,
  accepted: 0,
  rejected: 0,
  total: 0,
  ...overrides
});

const listResult = (licenseKey, orderId = `order-${licenseKey}`) => ({
  success: true,
  orders: [{ id: orderId, status: 'new', code: `EC-${licenseKey}` }],
  counts: counts({ new: 1, pending: 1, total: 1 }),
  pagination: { limit: 50, offset: 0, hasMore: false }
});

const detailResult = (orderId, customer = {}) => ({
  success: true,
  order: {
    id: orderId,
    code: `EC-${orderId}`,
    status: 'seen',
    customer: {
      name: customer.name || 'Cliente',
      phone: customer.phone || '9610000000',
      address: customer.address || 'Dirección privada',
      notes: customer.notes || 'Notas privadas'
    },
    items: [],
    events: []
  }
});

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

const createHarness = ({
  licenseKey = 'license-a',
  currentDeviceRole = 'admin',
  currentStaffUser = null
} = {}) => {
  let state = {
    licenseDetails: license(licenseKey),
    currentDeviceRole,
    currentStaffUser
  };

  const set = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;
  state = { ...state, ...createEcommerceOrderSlice(set, get) };
  state.resetEcommerceOrdersState();

  return { get, set };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listEcommerceOrders.mockResolvedValue(listResult('license-a', 'order-1'));
  mocks.getEcommerceOrder.mockResolvedValue(detailResult('order-1'));
  mocks.markEcommerceOrderSeen.mockResolvedValue({ success: true, changed: false });
  mocks.acceptEcommerceOrder.mockResolvedValue({ success: true, changed: true, order: { id: 'order-1', status: 'accepted' } });
  mocks.rejectEcommerceOrder.mockResolvedValue({ success: true, changed: true, order: { id: 'order-1', status: 'rejected' } });
});

describe('createEcommerceOrderSlice', () => {
  it('deduplicates concurrent list requests and respects the list TTL', async () => {
    const pending = createDeferred();
    mocks.listEcommerceOrders.mockReturnValueOnce(pending.promise);
    const { get } = createHarness();

    const first = get().loadEcommerceOrders();
    const second = get().loadEcommerceOrders();
    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(1);

    pending.resolve(listResult('license-a', 'order-1'));
    await Promise.all([first, second]);
    await get().loadEcommerceOrders();

    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(1);
    expect(get().ecommerceOrders).toHaveLength(1);
  });

  it('forces refresh after realtime invalidation', async () => {
    const { get } = createHarness();

    await get().loadEcommerceOrders();
    get().invalidateEcommerceOrdersCache();
    await get().loadEcommerceOrders();

    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(2);
    expect(get().ecommerceOrdersStale).toBe(false);
  });

  it('keeps the previous list when a background refresh fails', async () => {
    const { get } = createHarness();
    await get().loadEcommerceOrders();

    mocks.listEcommerceOrders.mockResolvedValueOnce({
      success: false,
      code: 'ECOMMERCE_ORDER_ACTION_FAILED',
      message: 'No se pudo actualizar'
    });
    await get().refreshEcommerceOrders({ background: true });

    expect(get().ecommerceOrders).toEqual(listResult('license-a', 'order-1').orders);
    expect(get().ecommerceOrdersError).toBe('No se pudo actualizar');
    expect(get().ecommerceOrdersStale).toBe(true);
  });

  it('clears order data and PII when the state resets', async () => {
    const { get } = createHarness();
    await get().loadEcommerceOrders();
    await get().openEcommerceOrder('order-1', { markSeen: false });

    expect(get().selectedEcommerceOrder?.customer?.phone).toBe('9610000000');
    get().resetEcommerceOrdersState();

    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().ecommerceOrderCounts.total).toBe(0);
    expect(get().ecommerceOrdersLicenseIdentity).toBeNull();
  });

  it('does not call an RPC when staff lacks ecommerce permission', async () => {
    const { get } = createHarness({
      currentDeviceRole: 'staff',
      currentStaffUser: { permissions: { ecommerce: false, settings: true } }
    });

    const result = await get().loadEcommerceOrders();

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
    expect(mocks.listEcommerceOrders).not.toHaveBeenCalled();
  });

  it('does not call an RPC while the device role is unresolved', async () => {
    const { get } = createHarness({ currentDeviceRole: null });

    const result = await get().loadEcommerceOrders();

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
    expect(mocks.listEcommerceOrders).not.toHaveBeenCalled();
  });

  it('ignores a late list from license A and keeps only license B data', async () => {
    const requestA = createDeferred();
    const requestB = createDeferred();
    mocks.listEcommerceOrders
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);
    const { get, set } = createHarness();

    const promiseA = get().loadEcommerceOrders();
    set({ licenseDetails: license('license-b') });
    get().resetEcommerceOrdersState();
    const promiseB = get().loadEcommerceOrders();

    requestA.resolve(listResult('license-a', 'order-a'));
    await expect(promiseA).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE',
      stale: true
    });
    expect(get().ecommerceOrders).toEqual([]);

    requestB.resolve(listResult('license-b', 'order-b'));
    await promiseB;

    expect(get().ecommerceOrders.map((order) => order.id)).toEqual(['order-b']);
    expect(get().ecommerceOrdersLicenseIdentity).toBe('license-b');
  });

  it('does not repopulate PII from a late detail after changing license', async () => {
    const pendingDetail = createDeferred();
    mocks.getEcommerceOrder.mockReturnValueOnce(pendingDetail.promise);
    const { get, set } = createHarness();

    const detailPromise = get().openEcommerceOrder('order-a', { markSeen: false });
    set({ licenseDetails: license('license-b') });
    get().resetEcommerceOrdersState();

    pendingDetail.resolve(detailResult('order-a', {
      phone: '9619999999',
      address: 'Dirección licencia A',
      notes: 'Notas licencia A'
    }));

    await expect(detailPromise).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE'
    });
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(JSON.stringify(get())).not.toContain('9619999999');
    expect(JSON.stringify(get())).not.toContain('Dirección licencia A');
  });

  it('invalidates a late list after logout', async () => {
    const pending = createDeferred();
    mocks.listEcommerceOrders.mockReturnValueOnce(pending.promise);
    const { get, set } = createHarness();

    const request = get().loadEcommerceOrders();
    set({ licenseDetails: null, currentDeviceRole: null, currentStaffUser: null });
    get().resetEcommerceOrdersState();
    pending.resolve(listResult('license-a', 'order-a'));

    await expect(request).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE'
    });
    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
  });

  it('does not refresh or reopen an order after a late acceptance', async () => {
    const pendingAction = createDeferred();
    mocks.acceptEcommerceOrder.mockReturnValueOnce(pendingAction.promise);
    const { get, set } = createHarness();

    const action = get().acceptEcommerceOrder('order-a');
    set({ licenseDetails: license('license-b') });
    get().resetEcommerceOrdersState();
    pendingAction.resolve({ success: true, changed: true, order: { id: 'order-a', status: 'accepted' } });

    await expect(action).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE'
    });
    expect(mocks.getEcommerceOrder).not.toHaveBeenCalled();
    expect(mocks.listEcommerceOrders).not.toHaveBeenCalled();
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().ecommerceOrderActionLoading).toBeNull();
  });

  it('ignores a late response after ecommerce permission is revoked', async () => {
    const pending = createDeferred();
    mocks.listEcommerceOrders.mockReturnValueOnce(pending.promise);
    const { get, set } = createHarness({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-1',
        permissions: { ecommerce: true, settings: false }
      }
    });

    const request = get().loadEcommerceOrders();
    set({
      currentStaffUser: {
        id: 'staff-1',
        permissions: { ecommerce: false, settings: false }
      }
    });
    get().resetEcommerceOrdersState();
    pending.resolve(listResult('license-a', 'order-a'));

    await expect(request).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE'
    });
    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
  });
});
