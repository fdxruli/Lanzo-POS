import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  setState: vi.fn(),
  updateOrderItems: vi.fn(),
  saveOrderAsOpen: vi.fn(),
  pauseOrder: vi.fn(),
  closeOrder: vi.fn(),
  lockOrderForCheckout: vi.fn(),
  unlockOrder: vi.fn(),
  removeOrder: vi.fn(),
  cancelRemote: vi.fn(),
  updateConversion: vi.fn((orderId, status, patch = {}) => {
    const current = mocks.state?.activeOrders?.get(orderId);
    if (!current) return null;
    const updated = {
      ...current,
      ecommerceConversionStatus: status,
      ...patch
    };
    const activeOrders = new Map(mocks.state.activeOrders);
    activeOrders.set(orderId, updated);
    mocks.state = { ...mocks.state, activeOrders };
    return updated;
  })
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state,
    setState: (updates) => {
      mocks.setState(updates);
      mocks.state = { ...mocks.state, ...updates };
    }
  }
}));

vi.mock('../ecommercePosConversionService', async () => {
  const actual = await vi.importActual('../ecommercePosConversionService');
  return {
    ...actual,
    cancelEcommercePosConversionRemote: (...args) => mocks.cancelRemote(...args),
    updateEcommerceConversionState: (...args) => mocks.updateConversion(...args)
  };
});

import {
  ecommercePosActiveOrderGuardsInternals,
  installEcommercePosActiveOrderGuards
} from '../installEcommercePosActiveOrderGuards';
import {
  ECOMMERCE_CONVERSION_STATUS
} from '../ecommercePosCheckoutConversion';
import {
  ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
} from '../ecommercePosDraftGuards';

const ecommerceOrder = {
  id: 'ecom-order',
  origin: 'ecommerce',
  items: [{ id: 'product-1', quantity: 1, price: 20 }]
};

const setEcommerceOrder = (patch = {}) => {
  const order = { ...ecommerceOrder, ...patch };
  mocks.state.currentOrderId = order.id;
  mocks.state.activeOrders = new Map([[order.id, order]]);
  return order;
};

beforeEach(() => {
  vi.clearAllMocks();
  ecommercePosActiveOrderGuardsInternals.resetForTests();
  mocks.updateOrderItems.mockReturnValue(true);
  mocks.saveOrderAsOpen.mockResolvedValue({ success: true, id: 'normal' });
  mocks.pauseOrder.mockResolvedValue({ success: true });
  mocks.closeOrder.mockResolvedValue({ success: true });
  mocks.lockOrderForCheckout.mockResolvedValue({ success: true });
  mocks.unlockOrder.mockResolvedValue({ success: true });
  mocks.removeOrder.mockResolvedValue({ success: true });
  mocks.cancelRemote.mockResolvedValue({ success: true });
  mocks.state = {
    currentOrderId: ecommerceOrder.id,
    activeOrders: new Map([[ecommerceOrder.id, ecommerceOrder]]),
    updateOrderItems: mocks.updateOrderItems,
    saveOrderAsOpen: mocks.saveOrderAsOpen,
    pauseOrder: mocks.pauseOrder,
    closeOrder: mocks.closeOrder,
    lockOrderForCheckout: mocks.lockOrderForCheckout,
    unlockOrder: mocks.unlockOrder,
    removeOrder: mocks.removeOrder
  };
});

describe('installEcommercePosActiveOrderGuards', () => {
  it('blocks item editing, open-sale persistence, pause, close and unauthorized checkout for ecommerce orders', async () => {
    installEcommercePosActiveOrderGuards();

    const edit = mocks.state.updateOrderItems(ecommerceOrder.id, vi.fn());
    const save = await mocks.state.saveOrderAsOpen(ecommerceOrder.id, ecommerceOrder);
    const pause = await mocks.state.pauseOrder(ecommerceOrder.id);
    const close = await mocks.state.closeOrder(ecommerceOrder.id, { paymentMethod: 'efectivo' });
    const lock = await mocks.state.lockOrderForCheckout(ecommerceOrder.id);

    expect(edit).toBe(false);
    expect(save).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(pause).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(close).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(lock).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(mocks.updateOrderItems).not.toHaveBeenCalled();
    expect(mocks.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.pauseOrder).not.toHaveBeenCalled();
    expect(mocks.closeOrder).not.toHaveBeenCalled();
    expect(mocks.lockOrderForCheckout).not.toHaveBeenCalled();
  });

  it.each([
    [ECOMMERCE_CONVERSION_STATUS.VALIDATING, 'validating'],
    [ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, 'payment_pending']
  ])('rejects removeOrder while ecommerce checkout is %s', async (status) => {
    setEcommerceOrder({
      ecommerceConversionStatus: status,
      isLockedForCheckout: true,
      ecommerceCanonicalCheckoutAttemptId: 'canonical-attempt-a',
      ecommerceRemoteConversionStatus: 'reserved'
    });
    installEcommercePosActiveOrderGuards();

    const result = await mocks.state.removeOrder(ecommerceOrder.id);

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_CHECKOUT_ACTIVE'
    });
    expect(mocks.removeOrder).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.has(ecommerceOrder.id)).toBe(true);
  });

  it.each([
    ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
    ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
    ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
  ])('preserves ecommerce order in terminal recovery state %s', async (status) => {
    setEcommerceOrder({
      ecommerceConversionStatus: status,
      ecommerceRemoteConversionStatus: 'reserved'
    });
    installEcommercePosActiveOrderGuards();

    const result = await mocks.state.removeOrder(ecommerceOrder.id);

    expect(result).toEqual({
      success: true,
      preservedForEcommerceConfirmation: true
    });
    expect(mocks.removeOrder).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.has(ecommerceOrder.id)).toBe(true);
  });

  it('releases only the immutable reservation and local attempt of A after selection changes to B', async () => {
    const orderA = {
      ...ecommerceOrder,
      id: 'ecom-order-a',
      ecommerceOrderId: 'online-order-a',
      ecommerceClaimToken: 'claim-a',
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.VALIDATING,
      ecommerceConversionAttemptId: 'attempt-a',
      ecommerceConversionActorIdentity: 'actor-a',
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceCheckoutSnapshot: {
        ecommerceConversionKey: 'conversion-key-a'
      },
      isLockedForCheckout: true
    };
    const orderB = {
      ...ecommerceOrder,
      id: 'ecom-order-b',
      ecommerceOrderId: 'online-order-b',
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
      ecommerceConversionAttemptId: 'attempt-b',
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceCheckoutSnapshot: {
        ecommerceConversionKey: 'conversion-key-b'
      },
      isLockedForCheckout: true
    };
    mocks.state.currentOrderId = orderB.id;
    mocks.state.activeOrders = new Map([
      [orderA.id, orderA],
      [orderB.id, orderB]
    ]);
    installEcommercePosActiveOrderGuards();

    const result = await mocks.state.unlockOrder(orderA.id);

    expect(result).toMatchObject({
      success: true,
      ecommerceCleanup: {
        success: true
      }
    });
    expect(mocks.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.unlockOrder).toHaveBeenCalledWith(orderA.id);
    expect(mocks.cancelRemote).toHaveBeenCalledTimes(1);
    expect(mocks.cancelRemote).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ id: orderA.id }),
      attemptId: 'attempt-a',
      saleId: orderA.id,
      conversionKey: 'conversion-key-a',
      reason: 'checkout_target_changed'
    }));
    expect(mocks.state.activeOrders.get(orderA.id)).toMatchObject({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
      ecommerceConversionAttemptId: null,
      ecommerceConversionActorIdentity: null,
      ecommerceRemoteConversionStatus: 'idle',
      ecommerceCheckoutSnapshot: null
    });
    expect(mocks.state.activeOrders.get(orderB.id)).toEqual(orderB);
  });

  it('delegates all operations for a normal POS order', async () => {
    const normalOrder = { ...ecommerceOrder, id: 'normal', origin: undefined };
    mocks.state.currentOrderId = normalOrder.id;
    mocks.state.activeOrders = new Map([[normalOrder.id, normalOrder]]);
    installEcommercePosActiveOrderGuards();

    const updater = vi.fn();
    mocks.state.updateOrderItems(normalOrder.id, updater);
    await mocks.state.saveOrderAsOpen(normalOrder.id, normalOrder);
    await mocks.state.pauseOrder(normalOrder.id);
    await mocks.state.closeOrder(normalOrder.id, { paymentMethod: 'tarjeta' });
    await mocks.state.lockOrderForCheckout(normalOrder.id);
    await mocks.state.removeOrder(normalOrder.id);

    expect(mocks.updateOrderItems).toHaveBeenCalledWith(normalOrder.id, updater);
    expect(mocks.saveOrderAsOpen).toHaveBeenCalledWith(normalOrder.id, normalOrder);
    expect(mocks.pauseOrder).toHaveBeenCalledWith(normalOrder.id);
    expect(mocks.closeOrder).toHaveBeenCalledWith(normalOrder.id, { paymentMethod: 'tarjeta' });
    expect(mocks.lockOrderForCheckout).toHaveBeenCalledWith(normalOrder.id);
    expect(mocks.removeOrder).toHaveBeenCalledWith(normalOrder.id);
  });
});
