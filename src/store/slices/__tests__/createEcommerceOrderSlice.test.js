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

const listResult = (
  licenseKey,
  orderId = `order-${licenseKey}`,
  status = 'new',
  pagination = { limit: 50, offset: 0, hasMore: false }
) => ({
  success: true,
  orders: [{ id: orderId, status, code: `EC-${licenseKey}-${orderId}` }],
  counts: counts({
    [status]: 1,
    pending: ['new', 'seen'].includes(status) ? 1 : 0,
    total: 1
  }),
  pagination
});

const detailResult = (orderId, customer = {}, status = 'seen') => ({
  success: true,
  order: {
    id: orderId,
    code: `EC-${orderId}`,
    status,
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
  let reject;
  const promise = new Promise((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, resolve, reject };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
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
  mocks.acceptEcommerceOrder.mockResolvedValue({
    success: true,
    changed: true,
    order: { id: 'order-1', status: 'accepted' }
  });
  mocks.rejectEcommerceOrder.mockResolvedValue({
    success: true,
    changed: true,
    order: { id: 'order-1', status: 'rejected' }
  });
});

describe('createEcommerceOrderSlice', () => {
  it('deduplicates concurrent identical list requests and respects the list TTL', async () => {
    const pending = createDeferred();
    mocks.listEcommerceOrders.mockReturnValueOnce(pending.promise);
    const { get } = createHarness();

    const first = get().loadEcommerceOrders({ filter: 'all', limit: 50, offset: 0 });
    const second = get().loadEcommerceOrders({ filter: 'all', limit: 50, offset: 0 });
    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(1);

    pending.resolve(listResult('license-a', 'order-1'));
    await Promise.all([first, second]);
    await get().loadEcommerceOrders({ filter: 'all', limit: 50, offset: 0 });

    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(1);
    expect(get().ecommerceOrders).toHaveLength(1);
  });

  it('keeps accepted visible when the second filter responds before the first', async () => {
    const pending = createDeferred();
    const accepted = createDeferred();
    mocks.listEcommerceOrders
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(accepted.promise);
    const { get } = createHarness();

    const pendingPromise = get().loadEcommerceOrders({ filter: 'pending', force: true });
    const acceptedPromise = get().loadEcommerceOrders({ filter: 'accepted', force: true });

    accepted.resolve(listResult('license-a', 'accepted-1', 'accepted'));
    await acceptedPromise;
    pending.resolve(listResult('license-a', 'pending-1', 'seen'));

    await expect(pendingPromise).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDERS_STALE_RESPONSE'
    });
    expect(get().ecommerceOrdersFilter).toBe('accepted');
    expect(get().ecommerceOrders.map((order) => order.id)).toEqual(['accepted-1']);
  });

  it('never exposes the first filter after a newer filter was selected', async () => {
    const pending = createDeferred();
    const accepted = createDeferred();
    mocks.listEcommerceOrders
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(accepted.promise);
    const { get } = createHarness();

    const pendingPromise = get().loadEcommerceOrders({ filter: 'pending', force: true });
    const acceptedPromise = get().loadEcommerceOrders({ filter: 'accepted', force: true });

    pending.resolve(listResult('license-a', 'pending-1', 'seen'));
    await expect(pendingPromise).resolves.toMatchObject({ stale: true });
    expect(get().ecommerceOrders).toEqual([]);
    expect(get().ecommerceOrdersFilter).toBe('accepted');
    expect(get().ecommerceOrdersLoading).toBe(true);

    accepted.resolve(listResult('license-a', 'accepted-1', 'accepted'));
    await acceptedPromise;
    expect(get().ecommerceOrders.map((order) => order.id)).toEqual(['accepted-1']);
  });

  it('ignores an error from an obsolete filter', async () => {
    const pending = createDeferred();
    const accepted = createDeferred();
    mocks.listEcommerceOrders
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(accepted.promise);
    const { get } = createHarness();

    const pendingPromise = get().loadEcommerceOrders({ filter: 'pending', force: true });
    const acceptedPromise = get().loadEcommerceOrders({ filter: 'accepted', force: true });

    accepted.resolve(listResult('license-a', 'accepted-1', 'accepted'));
    await acceptedPromise;
    pending.resolve({
      success: false,
      code: 'ECOMMERCE_ORDER_ACTION_FAILED',
      message: 'Error antiguo'
    });
    await expect(pendingPromise).resolves.toMatchObject({ stale: true });

    expect(get().ecommerceOrders.map((order) => order.id)).toEqual(['accepted-1']);
    expect(get().ecommerceOrdersError).toBeNull();
    expect(get().ecommerceOrdersLoading).toBe(false);
    expect(get().ecommerceOrdersRefreshing).toBe(false);
  });

  it('prevents offset zero from overwriting a newer page intent', async () => {
    const firstPage = createDeferred();
    const secondPage = createDeferred();
    mocks.listEcommerceOrders
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);
    const { get } = createHarness();

    const first = get().loadEcommerceOrders({ filter: 'all', limit: 50, offset: 0, force: true });
    const second = get().loadEcommerceOrders({ filter: 'all', limit: 50, offset: 50, force: true });

    secondPage.resolve(listResult('license-a', 'page-2', 'new', {
      limit: 50,
      offset: 50,
      hasMore: false
    }));
    await second;
    firstPage.resolve(listResult('license-a', 'page-1', 'new', {
      limit: 50,
      offset: 0,
      hasMore: true
    }));
    await expect(first).resolves.toMatchObject({ stale: true });

    expect(get().ecommerceOrders.map((order) => order.id)).toEqual(['page-2']);
    expect(get().ecommerceOrdersPagination.offset).toBe(50);
  });

  it('forces refresh after realtime invalidation', async () => {
    const { get } = createHarness();

    await get().loadEcommerceOrders();
    get().invalidateEcommerceOrdersCache();
    await get().loadEcommerceOrders();

    expect(mocks.listEcommerceOrders).toHaveBeenCalledTimes(2);
    expect(get().ecommerceOrdersStale).toBe(false);
  });

  it('keeps the previous list when a current background refresh fails', async () => {
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

  it('keeps B selected when B responds before A', async () => {
    const detailA = createDeferred();
    const detailB = createDeferred();
    mocks.getEcommerceOrder
      .mockReturnValueOnce(detailA.promise)
      .mockReturnValueOnce(detailB.promise);
    const { get } = createHarness();

    const openA = get().openEcommerceOrder('order-a', { markSeen: false });
    const openB = get().openEcommerceOrder('order-b', { markSeen: false });

    detailB.resolve(detailResult('order-b'));
    await openB;
    detailA.resolve(detailResult('order-a'));
    await expect(openA).resolves.toMatchObject({ stale: true });

    expect(get().selectedEcommerceOrder?.id).toBe('order-b');
  });

  it('does not expose A when A responds before the selected B', async () => {
    const detailA = createDeferred();
    const detailB = createDeferred();
    mocks.getEcommerceOrder
      .mockReturnValueOnce(detailA.promise)
      .mockReturnValueOnce(detailB.promise);
    const { get } = createHarness();

    const openA = get().openEcommerceOrder('order-a', { markSeen: false });
    const openB = get().openEcommerceOrder('order-b', { markSeen: false });

    detailA.resolve(detailResult('order-a'));
    await expect(openA).resolves.toMatchObject({ stale: true });
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().selectedEcommerceOrderRequestId).toBe('order-b');
    expect(get().selectedEcommerceOrderLoading).toBe(true);

    detailB.resolve(detailResult('order-b'));
    await openB;
    expect(get().selectedEcommerceOrder?.id).toBe('order-b');
  });

  it('does not reopen a detail after it was closed', async () => {
    const detailA = createDeferred();
    mocks.getEcommerceOrder.mockReturnValueOnce(detailA.promise);
    const { get } = createHarness();

    const openA = get().openEcommerceOrder('order-a', { markSeen: false });
    get().clearSelectedEcommerceOrder();
    detailA.resolve(detailResult('order-a'));

    await expect(openA).resolves.toMatchObject({ stale: true });
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().selectedEcommerceOrderLoading).toBe(false);
    expect(get().selectedEcommerceOrderRequestId).toBeNull();
  });

  it('ignores an obsolete detail error after B succeeds', async () => {
    const detailA = createDeferred();
    const detailB = createDeferred();
    mocks.getEcommerceOrder
      .mockReturnValueOnce(detailA.promise)
      .mockReturnValueOnce(detailB.promise);
    const { get } = createHarness();

    const openA = get().openEcommerceOrder('order-a', { markSeen: false });
    const openB = get().openEcommerceOrder('order-b', { markSeen: false });

    detailB.resolve(detailResult('order-b'));
    await openB;
    detailA.resolve({ success: false, code: 'FAILED', message: 'Error de A' });
    await expect(openA).resolves.toMatchObject({ stale: true });

    expect(get().selectedEcommerceOrder?.id).toBe('order-b');
    expect(get().selectedEcommerceOrderError).toBeNull();
  });

  it('ignores late mark-seen effects after B becomes the active detail', async () => {
    const markSeenA = createDeferred();
    mocks.getEcommerceOrder
      .mockResolvedValueOnce(detailResult('order-a', {}, 'new'))
      .mockResolvedValueOnce(detailResult('order-b', {}, 'seen'));
    mocks.markEcommerceOrderSeen.mockReturnValueOnce(markSeenA.promise);
    const { get, set } = createHarness();
    set({ ecommerceOrderCounts: counts({ new: 1, pending: 1, total: 1 }) });

    const openA = get().openEcommerceOrder('order-a', { markSeen: true });
    await flushPromises();
    expect(mocks.markEcommerceOrderSeen).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-a'
    }));

    await get().openEcommerceOrder('order-b', { markSeen: false });
    markSeenA.resolve({ success: true, changed: true });
    await expect(openA).resolves.toMatchObject({ stale: true });

    expect(get().selectedEcommerceOrder?.id).toBe('order-b');
    expect(get().ecommerceOrderCounts).toEqual(counts({ new: 1, pending: 1, total: 1 }));
  });

  it('keeps B selected when acceptance of A resolves late', async () => {
    const pendingAction = createDeferred();
    mocks.getEcommerceOrder
      .mockResolvedValueOnce(detailResult('order-a'))
      .mockResolvedValueOnce(detailResult('order-b'));
    mocks.acceptEcommerceOrder.mockReturnValueOnce(pendingAction.promise);
    const { get } = createHarness();

    await get().openEcommerceOrder('order-a', { markSeen: false });
    const action = get().acceptEcommerceOrder('order-a');
    await get().openEcommerceOrder('order-b', { markSeen: false });
    pendingAction.resolve({
      success: true,
      changed: true,
      order: { id: 'order-a', status: 'accepted' }
    });

    await expect(action).resolves.toMatchObject({ stale: true });
    expect(get().selectedEcommerceOrder?.id).toBe('order-b');
    expect(get().selectedEcommerceOrderError).toBeNull();
    expect(mocks.listEcommerceOrders).not.toHaveBeenCalled();
    expect(mocks.getEcommerceOrder).toHaveBeenCalledTimes(2);
  });

  it('deduplicates identical concurrent detail requests', async () => {
    const detail = createDeferred();
    mocks.getEcommerceOrder.mockReturnValueOnce(detail.promise);
    const { get } = createHarness();

    const first = get().openEcommerceOrder('order-a', { markSeen: false });
    const second = get().openEcommerceOrder('order-a', { markSeen: false });
    expect(mocks.getEcommerceOrder).toHaveBeenCalledTimes(1);

    detail.resolve(detailResult('order-a'));
    await Promise.all([first, second]);
    expect(get().selectedEcommerceOrder?.id).toBe('order-a');
  });

  it('versions refresh requests only for the currently selected order', async () => {
    mocks.getEcommerceOrder.mockResolvedValueOnce(detailResult('order-a'));
    const { get } = createHarness();
    await get().openEcommerceOrder('order-a', { markSeen: false });

    const initialRevision = get().ecommerceSelectedOrderRefreshRevision;
    expect(get().markSelectedEcommerceOrderStale('order-b')).toMatchObject({
      success: false,
      changed: false
    });
    expect(get().requestSelectedEcommerceOrderRefresh('order-b')).toMatchObject({
      success: false,
      changed: false
    });
    expect(get().ecommerceSelectedOrderRefreshRevision).toBe(initialRevision);

    expect(get().markSelectedEcommerceOrderStale('order-a')).toMatchObject({ success: true });
    expect(get().ecommerceSelectedOrderStale).toBe(true);
    expect(get().requestSelectedEcommerceOrderRefresh('order-a')).toMatchObject({
      success: true,
      changed: true
    });
    expect(get().ecommerceSelectedOrderRefreshRevision).toBe(initialRevision + 1);
    expect(get().ecommerceSelectedOrderRefreshOrderId).toBe('order-a');

    expect(get().markSelectedEcommerceOrderFresh('order-a')).toBe(true);
    expect(get().ecommerceSelectedOrderStale).toBe(false);
  });

  it('keeps the selected detail visible during a silent forced refresh', async () => {
    const pendingRefresh = createDeferred();
    mocks.getEcommerceOrder
      .mockResolvedValueOnce(detailResult('order-a'))
      .mockReturnValueOnce(pendingRefresh.promise);
    const { get } = createHarness();
    await get().openEcommerceOrder('order-a', { markSeen: false });

    const refresh = get().openEcommerceOrder('order-a', {
      force: true,
      markSeen: false,
      background: true
    });

    expect(get().selectedEcommerceOrder?.id).toBe('order-a');
    expect(get().selectedEcommerceOrderLoading).toBe(false);
    expect(get().selectedEcommerceOrderRefreshing).toBe(true);

    pendingRefresh.resolve(detailResult('order-a', {}, 'accepted'));
    await refresh;

    expect(get().selectedEcommerceOrder?.status).toBe('accepted');
    expect(get().selectedEcommerceOrderLoading).toBe(false);
    expect(get().selectedEcommerceOrderRefreshing).toBe(false);
    expect(mocks.markEcommerceOrderSeen).not.toHaveBeenCalled();
  });

  it('clears order data, PII and both active intents when the state resets', async () => {
    const { get } = createHarness();
    await get().loadEcommerceOrders();
    await get().openEcommerceOrder('order-1', { markSeen: false });

    expect(get().selectedEcommerceOrder?.customer?.phone).toBe('9610000000');
    get().resetEcommerceOrdersState();

    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().ecommerceOrderCounts.total).toBe(0);
    expect(get().ecommerceOrdersLicenseIdentity).toBeNull();
    expect(get().ecommerceOrdersActiveRequestKey).toBeNull();
    expect(get().selectedEcommerceOrderRequestId).toBeNull();
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
    await expect(promiseA).resolves.toMatchObject({ stale: true });
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

    await expect(detailPromise).resolves.toMatchObject({ stale: true });
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

    await expect(request).resolves.toMatchObject({ stale: true });
    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
  });

  it('does not refresh or reopen an order after a late acceptance across licenses', async () => {
    const pendingAction = createDeferred();
    mocks.acceptEcommerceOrder.mockReturnValueOnce(pendingAction.promise);
    const { get, set } = createHarness();

    await get().openEcommerceOrder('order-1', { markSeen: false });
    const action = get().acceptEcommerceOrder('order-1');
    set({ licenseDetails: license('license-b') });
    get().resetEcommerceOrdersState();
    pendingAction.resolve({
      success: true,
      changed: true,
      order: { id: 'order-1', status: 'accepted' }
    });

    await expect(action).resolves.toMatchObject({ stale: true });
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

    await expect(request).resolves.toMatchObject({ stale: true });
    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
  });
});
