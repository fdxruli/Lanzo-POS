import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    currentOrderId: 'ecom-order-a',
    activeOrders: new Map(),
    updateOrder: vi.fn((orderId, patch) => {
      const order = state.activeOrders.get(orderId);
      if (!order) return;
      state.activeOrders.set(orderId, { ...order, ...patch });
    })
  };

  return { state };
});

vi.mock('../useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

import { ECOMMERCE_CONVERSION_STATUS } from '../../../services/ecommerce/ecommercePosCheckoutConversion';
import { ecommerceCheckoutInitiationSingleFlightInternals } from '../ecommerceCheckoutInitiationSingleFlight';
import { useEcommercePosCheckoutSingleFlight } from '../useEcommercePosCheckoutSingleFlight';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeOrder = (id, patch = {}) => ({
  id,
  origin: 'ecommerce',
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
  ecommerceCheckoutInitiationStatus: null,
  isLockedForCheckout: false,
  ecommerceConvertedSaleId: null,
  ...patch
});

const setOrder = (patch = {}) => {
  const order = makeOrder('ecom-order-a', patch);
  mocks.state.currentOrderId = order.id;
  mocks.state.activeOrders = new Map([[order.id, order]]);
};

beforeEach(() => {
  vi.clearAllMocks();
  ecommerceCheckoutInitiationSingleFlightInternals.resetEcommerceCheckoutInitiations();
  setOrder();
});

describe('useEcommercePosCheckoutSingleFlight', () => {
  it('absorbs twenty rapid clicks, exposes starting and pins the ecommerce target', async () => {
    const deferred = createDeferred();
    const checkoutResult = { success: true, modalOpened: true };
    const checkout = {
      handleInitiateCheckout: vi.fn(() => deferred.promise),
      handleProcessOrder: vi.fn()
    };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    let calls;
    act(() => {
      calls = Array.from({ length: 20 }, () => result.current.handleInitiateCheckout());
    });

    expect(calls.every((promise) => promise === calls[0])).toBe(true);
    expect(
      mocks.state.activeOrders.get('ecom-order-a').ecommerceCheckoutInitiationStatus
    ).toBe('starting');

    await Promise.resolve();
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledWith({
      expectedOrderId: 'ecom-order-a',
      expectedOrigin: 'ecommerce'
    });

    await act(async () => {
      deferred.resolve(checkoutResult);
      await expect(Promise.all(calls)).resolves.toEqual(
        Array.from({ length: 20 }, () => checkoutResult)
      );
    });

    expect(
      mocks.state.activeOrders.get('ecom-order-a').ecommerceCheckoutInitiationStatus
    ).toBeNull();
    expect(result.current.handleProcessOrder).toBe(checkout.handleProcessOrder);
  });

  it('keeps A as the expected target when selection changes to B before the deferred run', async () => {
    const deferred = createDeferred();
    const orderA = makeOrder('ecom-order-a');
    const orderB = makeOrder('ecom-order-b');
    mocks.state.activeOrders = new Map([
      [orderA.id, orderA],
      [orderB.id, orderB]
    ]);
    mocks.state.currentOrderId = orderA.id;

    const checkout = {
      handleInitiateCheckout: vi.fn(() => deferred.promise)
    };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    const call = result.current.handleInitiateCheckout();
    mocks.state.currentOrderId = orderB.id;

    await Promise.resolve();
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledWith({
      expectedOrderId: orderA.id,
      expectedOrigin: 'ecommerce'
    });
    expect(mocks.state.activeOrders.get(orderB.id).ecommerceCheckoutInitiationStatus).toBeNull();

    deferred.resolve({ success: false, code: 'ECOMMERCE_CHECKOUT_TARGET_CHANGED' });
    await expect(call).resolves.toMatchObject({
      success: false,
      code: 'ECOMMERCE_CHECKOUT_TARGET_CHANGED'
    });
  });

  it('ignores clicks silently while payment is already pending', async () => {
    setOrder({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
      isLockedForCheckout: true
    });
    const checkout = { handleInitiateCheckout: vi.fn() };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    await expect(result.current.handleInitiateCheckout()).resolves.toEqual({
      success: true,
      ignored: true,
      code: 'ECOMMERCE_CHECKOUT_ALREADY_ACTIVE'
    });

    expect(checkout.handleInitiateCheckout).not.toHaveBeenCalled();
    expect(mocks.state.updateOrder).not.toHaveBeenCalled();
  });

  it('preserves the canonical contention path for a lock owned elsewhere', async () => {
    setOrder({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
      isLockedForCheckout: true
    });
    const contention = {
      success: false,
      reason: 'La orden ya está siendo cobrada desde otro dispositivo.'
    };
    const checkout = {
      handleInitiateCheckout: vi.fn(() => Promise.resolve(contention))
    };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    await expect(result.current.handleInitiateCheckout()).resolves.toBe(contention);

    expect(checkout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledWith({
      expectedOrderId: 'ecom-order-a',
      expectedOrigin: 'ecommerce'
    });
  });

  it('clears stale starting and validating state and allows a real retry', async () => {
    setOrder({
      ecommerceCheckoutInitiationStatus: 'starting',
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.VALIDATING
    });
    const checkout = {
      handleInitiateCheckout: vi.fn(() => Promise.resolve({ success: true }))
    };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    await expect(result.current.handleInitiateCheckout()).resolves.toEqual({ success: true });

    expect(checkout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.state.updateOrder).toHaveBeenNthCalledWith(1, 'ecom-order-a', {
      ecommerceCheckoutInitiationStatus: null
    });
    expect(mocks.state.updateOrder).toHaveBeenNthCalledWith(2, 'ecom-order-a', {
      ecommerceCheckoutInitiationStatus: 'starting'
    });
    expect(
      mocks.state.activeOrders.get('ecom-order-a').ecommerceCheckoutInitiationStatus
    ).toBeNull();
  });

  it('does not change normal POS checkout behavior or pass ecommerce arguments', async () => {
    setOrder({ origin: 'pos' });
    const checkout = {
      handleInitiateCheckout: vi.fn(() => Promise.resolve({ success: true, normalPos: true }))
    };
    const { result } = renderHook(() => useEcommercePosCheckoutSingleFlight({ checkout }));

    await expect(result.current.handleInitiateCheckout()).resolves.toEqual({
      success: true,
      normalPos: true
    });

    expect(checkout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(checkout.handleInitiateCheckout).toHaveBeenCalledWith();
    expect(mocks.state.updateOrder).not.toHaveBeenCalled();
  });
});
