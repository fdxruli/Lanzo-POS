import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEcommerceOrders = vi.fn();
const getEcommerceOrder = vi.fn();
const markEcommerceOrderSeen = vi.fn();
const acceptEcommerceOrder = vi.fn();
const rejectEcommerceOrder = vi.fn();

vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({
  listEcommerceOrders,
  getEcommerceOrder,
  markEcommerceOrderSeen,
  acceptEcommerceOrder,
  rejectEcommerceOrder,
  getEcommerceOrderErrorMessage: () => 'Error seguro'
}));

import { createEcommerceOrderSlice } from '../createEcommerceOrderSlice';

const successList = {
  success: true,
  orders: [{ id: 'order-1', status: 'new', code: 'EC-1' }],
  counts: { new: 1, seen: 0, pending: 1, accepted: 0, rejected: 0, total: 1 },
  pagination: { limit: 50, offset: 0, hasMore: false }
};

const createHarness = () => {
  let state = {
    licenseDetails: {
      license_key: 'license-a',
      features: { ecommerce_order_inbox: true }
    },
    currentDeviceRole: 'admin',
    currentStaffUser: null
  };

  const set = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;
  state = { ...state, ...createEcommerceOrderSlice(set, get) };

  return { get, set };
};

beforeEach(() => {
  vi.clearAllMocks();
  listEcommerceOrders.mockResolvedValue(successList);
  getEcommerceOrder.mockResolvedValue({
    success: true,
    order: { id: 'order-1', code: 'EC-1', status: 'seen', items: [], events: [] }
  });
  markEcommerceOrderSeen.mockResolvedValue({ success: true, changed: false });
  acceptEcommerceOrder.mockResolvedValue({ success: true, changed: true, order: { id: 'order-1', status: 'accepted' } });
  rejectEcommerceOrder.mockResolvedValue({ success: true, changed: true, order: { id: 'order-1', status: 'rejected' } });
});

describe('createEcommerceOrderSlice', () => {
  it('deduplicates concurrent list requests and respects the list TTL', async () => {
    let resolveRequest;
    listEcommerceOrders.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { get } = createHarness();

    const first = get().loadEcommerceOrders();
    const second = get().loadEcommerceOrders();
    expect(listEcommerceOrders).toHaveBeenCalledTimes(1);

    resolveRequest(successList);
    await Promise.all([first, second]);
    await get().loadEcommerceOrders();

    expect(listEcommerceOrders).toHaveBeenCalledTimes(1);
    expect(get().ecommerceOrders).toHaveLength(1);
  });

  it('forces refresh after realtime invalidation', async () => {
    const { get } = createHarness();

    await get().loadEcommerceOrders();
    get().invalidateEcommerceOrdersCache();
    await get().loadEcommerceOrders();

    expect(listEcommerceOrders).toHaveBeenCalledTimes(2);
    expect(get().ecommerceOrdersStale).toBe(false);
  });

  it('keeps the previous list when a background refresh fails', async () => {
    const { get } = createHarness();
    await get().loadEcommerceOrders();

    listEcommerceOrders.mockResolvedValueOnce({
      success: false,
      code: 'ECOMMERCE_ORDER_ACTION_FAILED',
      message: 'No se pudo actualizar'
    });
    await get().refreshEcommerceOrders({ background: true });

    expect(get().ecommerceOrders).toEqual(successList.orders);
    expect(get().ecommerceOrdersError).toBe('No se pudo actualizar');
    expect(get().ecommerceOrdersStale).toBe(true);
  });

  it('clears order data and PII when the state resets', async () => {
    const { get } = createHarness();
    await get().loadEcommerceOrders();
    await get().openEcommerceOrder('order-1', { markSeen: false });

    expect(get().selectedEcommerceOrder?.id).toBe('order-1');
    get().resetEcommerceOrdersState();

    expect(get().ecommerceOrders).toEqual([]);
    expect(get().selectedEcommerceOrder).toBeNull();
    expect(get().ecommerceOrderCounts.total).toBe(0);
  });

  it('does not call an RPC when the local capability blocks staff', async () => {
    const { get, set } = createHarness();
    set({
      currentDeviceRole: 'staff',
      currentStaffUser: { permissions: { ecommerce: false, settings: true } }
    });

    const result = await get().loadEcommerceOrders();

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
    expect(listEcommerceOrders).not.toHaveBeenCalled();
  });
});
