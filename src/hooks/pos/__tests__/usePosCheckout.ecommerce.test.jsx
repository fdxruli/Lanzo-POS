// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  activeState: null,
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn(),
  broadcastDBChange: vi.fn(),
  dbGet: vi.fn(),
  fefo: vi.fn(),
  cloudStatus: vi.fn(),
  reconcile: vi.fn(),
  closeCloud: vi.fn(),
  retryCloudCloses: vi.fn(),
  processSale: vi.fn(),
  sales: new Map()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.appState),
    { getState: () => mocks.appState }
  )
}));

vi.mock('../../../store/useProductStore', () => ({
  broadcastDBChange: mocks.broadcastDBChange
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales' },
  db: {
    transaction: vi.fn(async (...args) => args.at(-1)()),
    table: vi.fn(() => ({
      get: vi.fn(async (id) => mocks.sales.get(id) || null),
      update: vi.fn(async (id, changes) => {
        const current = mocks.sales.get(id);
        if (!current) return 0;
        mocks.sales.set(id, { ...current, ...changes });
        return 1;
      })
    }))
  }
}));

vi.mock('../useActiveOrders', () => ({
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    {
      getState: () => mocks.activeState,
      setState: (partial) => {
        mocks.activeState = { ...mocks.activeState, ...partial };
      }
    }
  )
}));

vi.mock('../../../services/sales/fefoSaleValidation', () => ({
  validateFefoSelectionBeforeCheckout: mocks.fefo
}));

vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: mocks.cloudStatus
}));

vi.mock('../../../services/restaurant/restaurantOrderReconciliation', () => ({
  reconcileCartWithCancelledRestaurantItems: mocks.reconcile
}));

vi.mock('../../../services/restaurant/restaurantOrderCheckoutClose', () => ({
  closeRestaurantCloudOrderAfterSuccessfulPayment: mocks.closeCloud,
  retryPendingRestaurantCloudOrderCloses: mocks.retryCloudCloses
}));

vi.mock('../../../services/sync/syncConstants', () => ({
  isCloudSalesCashierEnabled: () => false,
  isCloudSalesCreditEnabled: () => false,
  isRestaurantOrdersCloudEnabled: () => true
}));

vi.mock('../../../services/salesService', () => ({
  processSale: mocks.processSale
}));

import { usePosCheckout } from '../usePosCheckout';
import {
  ECOMMERCE_POS_CHECKOUT_MESSAGE,
  ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
} from '../../../services/ecommerce/ecommercePosDraftGuards';

const STALE_CODE = 'POS_CHECKOUT_SNAPSHOT_STALE';

const makeOrder = ({
  id = 'order-a',
  origin,
  ecommerceDraftStatus,
  isSaved = true,
  isLockedForCheckout = false
} = {}) => ({
  id,
  origin,
  ...(ecommerceDraftStatus === undefined ? {} : { ecommerceDraftStatus }),
  isSaved,
  isLockedForCheckout,
  lockedAt: isLockedForCheckout ? '2026-07-11T12:00:00.000Z' : null,
  items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 20 }],
  total: 20,
  tableData: 'Mesa 1'
});

const setOrders = (orders, currentOrderId = orders[0]?.id || null) => {
  mocks.activeState.activeOrders = new Map(orders.map((order) => [order.id, order]));
  mocks.activeState.currentOrderId = currentOrderId;
  mocks.activeState.isCurrentOrderLocked = Boolean(
    currentOrderId && mocks.activeState.activeOrders.get(currentOrderId)?.isLockedForCheckout
  );
};

const switchToOrder = (order) => {
  mocks.activeState.activeOrders.set(order.id, order);
  mocks.activeState.currentOrderId = order.id;
  mocks.activeState.isCurrentOrderLocked = Boolean(order.isLockedForCheckout);
};

const makeDeps = (featureOverrides = {}) => {
  const pos = {
    activeOrderId: 'order-a',
    order: [{ id: 'product-1', quantity: 1, price: 20 }],
    cajaActual: { estado: 'abierta' },
    verifySessionIntegrity: vi.fn().mockResolvedValue(true),
    abrirCaja: vi.fn().mockResolvedValue(true),
    asegurarCajaAbierta: vi.fn().mockResolvedValue({ estado: 'abierta' })
  };
  const posSearch = {
    menuVisual: [],
    refreshOutOfStock: vi.fn().mockResolvedValue(undefined)
  };
  const modal = {
    openModal: vi.fn(),
    closeModal: vi.fn()
  };
  const mobileCart = {
    closeCart: vi.fn()
  };
  const prescription = {
    tempPrescriptionData: null,
    setTempPrescriptionData: vi.fn(),
    setPrescriptionItems: vi.fn()
  };
  const features = {
    hasTables: false,
    hasLabFields: false,
    ...featureOverrides
  };
  const fetchActiveTablesCount = vi.fn().mockResolvedValue(undefined);

  return {
    args: {
      pos,
      posSearch,
      modal,
      mobileCart,
      prescription,
      features,
      fetchActiveTablesCount
    },
    pos,
    posSearch,
    modal,
    mobileCart,
    prescription,
    fetchActiveTablesCount
  };
};

const expectEcommerceBlocked = (result) => {
  expect(result).toMatchObject({
    success: false,
    code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
    message: ECOMMERCE_POS_CHECKOUT_MESSAGE
  });
};

const initiateCheckout = async (hookResult) => {
  let response;
  await act(async () => {
    response = await hookResult.current.handleInitiateCheckout();
  });
  return response;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sales.clear();
  mocks.appState = {
    licenseDetails: { valid: true },
    companyProfile: { name: 'Lanzo' }
  };
  mocks.activeState = {
    currentOrderId: null,
    activeOrders: new Map(),
    pendingInventoryResolutions: new Map(),
    isCurrentOrderLocked: false,
    updateOrderItems: vi.fn(),
    saveOrderAsOpen: vi.fn().mockResolvedValue({ success: true }),
    lockOrderForCheckout: vi.fn(async (orderId) => {
      const order = mocks.activeState.activeOrders.get(orderId);
      if (!order || order.isLockedForCheckout) {
        return { success: false, reason: 'La orden ya está siendo cobrada desde otro dispositivo.' };
      }
      const lockedOrder = {
        ...order,
        isLockedForCheckout: true,
        lockedAt: '2026-07-11T12:00:00.000Z'
      };
      mocks.activeState.activeOrders.set(orderId, lockedOrder);
      mocks.sales.set(orderId, { ...lockedOrder, status: 'open' });
      if (mocks.activeState.currentOrderId === orderId) {
        mocks.activeState.isCurrentOrderLocked = true;
      }
      return { success: true };
    }),
    unlockOrder: vi.fn(async (orderId) => {
      const order = mocks.activeState.activeOrders.get(orderId);
      if (order) {
        mocks.activeState.activeOrders.set(orderId, {
          ...order,
          isLockedForCheckout: false,
          lockedAt: null
        });
      }
      const persisted = mocks.sales.get(orderId);
      if (persisted) {
        mocks.sales.set(orderId, {
          ...persisted,
          isLockedForCheckout: false,
          lockedAt: null
        });
      }
      if (mocks.activeState.currentOrderId === orderId) {
        mocks.activeState.isCurrentOrderLocked = false;
      }
      return { success: true };
    }),
    removeOrder: vi.fn(async (orderId) => {
      mocks.activeState.activeOrders.delete(orderId);
      return { success: true };
    })
  };
  mocks.showConfirmModal.mockResolvedValue(true);
  mocks.fefo.mockResolvedValue({ blocked: false, warnings: [] });
  mocks.cloudStatus.mockResolvedValue({ skipped: true });
  mocks.reconcile.mockReturnValue({
    hasUnmatchedCancelledItems: false,
    hasRemovableCancelledItems: false,
    kept: [],
    removed: [],
    removedCount: 0
  });
  mocks.closeCloud.mockResolvedValue({ success: true, skipped: true });
  mocks.retryCloudCloses.mockResolvedValue({ success: true, skipped: true });
  mocks.processSale.mockResolvedValue({ success: true, saleId: 'sale-1' });
});

describe('usePosCheckout ecommerce and stale lock ownership', () => {
  it.each([
    ['claimed', 'claimed'],
    ['prepared', 'prepared'],
    ['error_releasing', 'error_releasing'],
    ['missing', undefined],
    ['unknown', 'future_state']
  ])('blocks checkout initiation before every effect for status %s', async (_label, ecommerceDraftStatus) => {
    setOrders([makeOrder({ origin: 'ecommerce', ecommerceDraftStatus })]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    const response = await initiateCheckout(result);

    expectEcommerceBlocked(response);
    expect(mocks.cloudStatus).not.toHaveBeenCalled();
    expect(mocks.activeState.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.fefo).not.toHaveBeenCalled();
    expect(mocks.activeState.lockOrderForCheckout).not.toHaveBeenCalled();
    expect(deps.mobileCart.closeCart).not.toHaveBeenCalled();
    expect(deps.modal.openModal).not.toHaveBeenCalled();
  });

  it('releases A exactly once when the live order changes from normal A to ecommerce B', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    const orderB = makeOrder({ id: 'order-b', origin: 'ecommerce', ecommerceDraftStatus: 'prepared' });
    setOrders([orderA]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    expect(mocks.activeState.activeOrders.get('order-a').isLockedForCheckout).toBe(true);
    switchToOrder(orderB);

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expectEcommerceBlocked(response);
    expect(mocks.processSale).not.toHaveBeenCalled();
    expect(deps.pos.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.activeOrders.get('order-a').isLockedForCheckout).toBe(false);
    expect(mocks.activeState.activeOrders.get('order-b')).toEqual(orderB);
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalledWith('order-b');
  });

  it('returns stale and releases A once when the live order changes from normal A to normal C', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    const orderC = makeOrder({ id: 'order-c' });
    setOrders([orderA]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    switchToOrder(orderC);

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(response).toMatchObject({ success: false, code: STALE_CODE });
    expect(mocks.processSale).not.toHaveBeenCalled();
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalledWith('order-c');
  });

  it('does not repeat unlock when the payment modal closes after invalidation already released A', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    const orderC = makeOrder({ id: 'order-c' });
    setOrders([orderA]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    switchToOrder(orderC);
    await act(async () => {
      await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });
    await act(async () => {
      await result.current.handlePaymentModalClose();
    });

    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(deps.modal.closeModal).toHaveBeenCalledWith('payment');
  });

  it('blocks stale quick caja submit, releases A once and never unlocks B', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    const orderB = makeOrder({ id: 'order-b', origin: 'ecommerce', ecommerceDraftStatus: 'prepared' });
    setOrders([orderA]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    switchToOrder(orderB);

    let response;
    await act(async () => {
      response = await result.current.handleQuickCajaSubmit({ openingAmount: 100 });
    });

    expectEcommerceBlocked(response);
    expect(deps.pos.abrirCaja).not.toHaveBeenCalled();
    expect(deps.modal.openModal).not.toHaveBeenCalledWith('payment');
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalledWith('order-b');
  });

  it('keeps its lock during stock warning and Vender Igual reuses it without reacquiring', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    setOrders([orderA]);
    const deps = makeDeps();
    mocks.processSale
      .mockResolvedValueOnce({ success: false, errorType: 'STOCK_WARNING', message: 'Stock cambió' })
      .mockResolvedValueOnce({ success: true, saleId: 'sale-force' });
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    let firstResponse;
    await act(async () => {
      firstResponse = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(firstResponse).toMatchObject({ success: false, errorType: 'STOCK_WARNING' });
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalled();
    expect(mocks.activeState.activeOrders.get('order-a').isLockedForCheckout).toBe(true);
    expect(mocks.activeState.lockOrderForCheckout).toHaveBeenCalledTimes(1);

    const warningCall = mocks.showMessageModal.mock.calls.find(([message]) => message === 'Stock cambió');
    expect(warningCall?.[1]).toEqual(expect.any(Function));

    await act(async () => {
      await warningCall[1]();
    });

    expect(mocks.activeState.lockOrderForCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.processSale).toHaveBeenCalledTimes(2);
    expect(mocks.processSale.mock.calls[1][0]).toMatchObject({ ignoreStock: true, activeOrderId: 'order-a' });
    expect(mocks.activeState.removeOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalled();
  });

  it('releases A exactly once when the user cancels the normal payment modal', async () => {
    setOrders([makeOrder({ id: 'order-a' })]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    await act(async () => {
      await result.current.handlePaymentModalClose();
    });

    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.activeOrders.get('order-a').isLockedForCheckout).toBe(false);
  });

  it('releases A once after processSale returns an error and does not retry automatically', async () => {
    setOrders([makeOrder({ id: 'order-a' })]);
    const deps = makeDeps();
    mocks.processSale.mockResolvedValue({ success: false, errorType: 'VALIDATION', message: 'No se pudo vender' });
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(response).toMatchObject({ success: false, errorType: 'VALIDATION' });
    expect(mocks.processSale).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.activeOrders.get('order-a').isLockedForCheckout).toBe(false);
  });

  it('consumes a successful sale without a later unlock rollback', async () => {
    setOrders([makeOrder({ id: 'order-a' })]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(response).toMatchObject({ success: true, saleId: 'sale-1' });
    expect(mocks.activeState.removeOrder).toHaveBeenCalledWith('order-a');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalled();
    expect(mocks.broadcastDBChange).toHaveBeenCalledWith({ action: 'sale-completed', saleId: 'sale-1' });
  });

  it('keeps a failed unlock recoverable and retries only A when the modal closes', async () => {
    const orderA = makeOrder({ id: 'order-a' });
    const orderC = makeOrder({ id: 'order-c' });
    setOrders([orderA]);
    const deps = makeDeps();
    mocks.activeState.unlockOrder
      .mockResolvedValueOnce({ success: false, reason: 'dexie_failed' })
      .mockImplementationOnce(async (orderId) => {
        const order = mocks.activeState.activeOrders.get(orderId);
        mocks.activeState.activeOrders.set(orderId, { ...order, isLockedForCheckout: false, lockedAt: null });
        const persisted = mocks.sales.get(orderId);
        if (persisted) mocks.sales.set(orderId, { ...persisted, isLockedForCheckout: false, lockedAt: null });
        return { success: true };
      });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    switchToOrder(orderC);

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(response).toMatchObject({ success: false, code: STALE_CODE });
    expect(mocks.processSale).not.toHaveBeenCalled();
    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.unlockOrder).toHaveBeenNthCalledWith(1, 'order-a');

    await act(async () => {
      await result.current.handlePaymentModalClose();
    });

    expect(mocks.activeState.unlockOrder).toHaveBeenCalledTimes(2);
    expect(mocks.activeState.unlockOrder).toHaveBeenNthCalledWith(2, 'order-a');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalledWith('order-c');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('preserves normal quick caja for the same live order', async () => {
    setOrders([makeOrder({ id: 'order-a' })]);
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await initiateCheckout(result);
    let response;
    await act(async () => {
      response = await result.current.handleQuickCajaSubmit({ openingAmount: 100 });
    });

    expect(response).toBe(true);
    expect(deps.pos.abrirCaja).toHaveBeenCalledWith({ openingAmount: 100 });
    expect(deps.pos.asegurarCajaAbierta).toHaveBeenCalledTimes(1);
    expect(deps.modal.closeModal).toHaveBeenCalledWith('quickCaja');
    expect(deps.modal.openModal).toHaveBeenCalledWith('payment');
    expect(mocks.activeState.unlockOrder).not.toHaveBeenCalled();
  });
});
