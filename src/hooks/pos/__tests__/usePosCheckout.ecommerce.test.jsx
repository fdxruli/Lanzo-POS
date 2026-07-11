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
  processSale: vi.fn()
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
    table: vi.fn(() => ({ get: mocks.dbGet }))
  }
}));

vi.mock('../useActiveOrders', () => ({
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    { getState: () => mocks.activeState }
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

const makeOrder = ({
  id = 'active-order',
  origin,
  ecommerceDraftStatus,
  isSaved = true
} = {}) => ({
  id,
  origin,
  ...(ecommerceDraftStatus === undefined ? {} : { ecommerceDraftStatus }),
  isSaved,
  items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 20 }],
  total: 20,
  tableData: 'Mesa 1'
});

const setActiveOrder = (order) => {
  mocks.activeState.currentOrderId = order.id;
  mocks.activeState.activeOrders = new Map([[order.id, order]]);
};

const makeDeps = (featureOverrides = {}) => {
  const pos = {
    activeOrderId: 'active-order',
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
    hasTables: true,
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

const expectBlocked = (result) => {
  expect(result).toMatchObject({
    success: false,
    code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
    message: ECOMMERCE_POS_CHECKOUT_MESSAGE
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    licenseDetails: { valid: true },
    companyProfile: { name: 'Lanzo' }
  };
  mocks.activeState = {
    currentOrderId: null,
    activeOrders: new Map(),
    pendingInventoryResolutions: new Map(),
    updateOrderItems: vi.fn(),
    saveOrderAsOpen: vi.fn().mockResolvedValue({ success: true }),
    lockOrderForCheckout: vi.fn().mockResolvedValue({ success: true }),
    unlockOrder: vi.fn().mockResolvedValue({ success: true }),
    removeOrder: vi.fn().mockResolvedValue({ success: true })
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
  mocks.dbGet.mockResolvedValue(null);
});

describe('usePosCheckout ecommerce defense in depth', () => {
  it.each([
    ['claimed', 'claimed'],
    ['prepared', 'prepared'],
    ['error_releasing', 'error_releasing'],
    ['missing', undefined],
    ['unknown', 'future_state']
  ])('blocks checkout initiation before every effect for status %s', async (_label, ecommerceDraftStatus) => {
    setActiveOrder(makeOrder({ origin: 'ecommerce', ecommerceDraftStatus }));
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    let response;
    await act(async () => {
      response = await result.current.handleInitiateCheckout();
    });

    expectBlocked(response);
    expect(mocks.cloudStatus).not.toHaveBeenCalled();
    expect(mocks.activeState.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.fefo).not.toHaveBeenCalled();
    expect(mocks.activeState.lockOrderForCheckout).not.toHaveBeenCalled();
    expect(deps.mobileCart.closeCart).not.toHaveBeenCalled();
    expect(deps.prescription.setTempPrescriptionData).not.toHaveBeenCalled();
    expect(deps.prescription.setPrescriptionItems).not.toHaveBeenCalled();
    expect(deps.modal.openModal).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      ECOMMERCE_POS_CHECKOUT_MESSAGE,
      null,
      { type: 'warning' }
    );
  });

  it('blocks payment processing before session, caja, sale, kitchen and inventory effects', async () => {
    setActiveOrder(makeOrder({ origin: 'ecommerce', ecommerceDraftStatus: 'prepared' }));
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'efectivo' });
    });

    expectBlocked(response);
    expect(deps.pos.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(deps.pos.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(mocks.processSale).not.toHaveBeenCalled();
    expect(mocks.closeCloud).not.toHaveBeenCalled();
    expect(mocks.broadcastDBChange).not.toHaveBeenCalled();
    expect(mocks.activeState.removeOrder).not.toHaveBeenCalled();
  });

  it('blocks quick caja before opening or changing modals', async () => {
    setActiveOrder(makeOrder({ origin: 'ecommerce', ecommerceDraftStatus: 'prepared' }));
    const deps = makeDeps();
    const { result } = renderHook(() => usePosCheckout(deps.args));

    let response;
    await act(async () => {
      response = await result.current.handleQuickCajaSubmit({ openingAmount: 100 });
    });

    expectBlocked(response);
    expect(deps.pos.abrirCaja).not.toHaveBeenCalled();
    expect(deps.pos.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(deps.modal.closeModal).not.toHaveBeenCalledWith('quickCaja');
    expect(deps.modal.openModal).not.toHaveBeenCalledWith('payment');
  });

  it('blocks a late payment confirmation when the live order changed from POS to ecommerce', async () => {
    const normalOrder = makeOrder({ origin: undefined, ecommerceDraftStatus: undefined });
    setActiveOrder(normalOrder);
    const deps = makeDeps({ hasTables: false });
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await act(async () => {
      await result.current.handleInitiateCheckout();
    });
    expect(deps.modal.openModal).toHaveBeenCalledWith('payment');

    const ecommerceOrder = makeOrder({
      id: 'ecommerce-order',
      origin: 'ecommerce',
      ecommerceDraftStatus: 'prepared'
    });
    mocks.activeState.activeOrders.set(ecommerceOrder.id, ecommerceOrder);
    mocks.activeState.currentOrderId = ecommerceOrder.id;

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expectBlocked(response);
    expect(deps.pos.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(mocks.processSale).not.toHaveBeenCalled();
    expect(mocks.activeState.removeOrder).not.toHaveBeenCalled();
  });

  it('preserves checkout and sale processing for a normal POS order', async () => {
    setActiveOrder(makeOrder({ origin: undefined, ecommerceDraftStatus: undefined }));
    const deps = makeDeps({ hasTables: false });
    const { result } = renderHook(() => usePosCheckout(deps.args));

    let initiateResponse;
    await act(async () => {
      initiateResponse = await result.current.handleInitiateCheckout();
    });

    expect(initiateResponse).toMatchObject({ success: true, orderId: 'active-order' });
    expect(mocks.activeState.lockOrderForCheckout).toHaveBeenCalledWith('active-order');
    expect(mocks.fefo).toHaveBeenCalledTimes(1);
    expect(deps.mobileCart.closeCart).toHaveBeenCalledTimes(1);
    expect(deps.modal.openModal).toHaveBeenCalledWith('payment');

    let processResponse;
    await act(async () => {
      processResponse = await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });

    expect(processResponse).toMatchObject({ success: true, saleId: 'sale-1' });
    expect(deps.pos.verifySessionIntegrity).toHaveBeenCalledTimes(1);
    expect(mocks.processSale).toHaveBeenCalledTimes(1);
    expect(mocks.activeState.removeOrder).toHaveBeenCalledWith('active-order');
    expect(mocks.broadcastDBChange).toHaveBeenCalledWith({ action: 'sale-completed', saleId: 'sale-1' });
  });

  it('preserves quick caja for the same live normal order', async () => {
    setActiveOrder(makeOrder({ origin: undefined, ecommerceDraftStatus: undefined }));
    const deps = makeDeps({ hasTables: false });
    const { result } = renderHook(() => usePosCheckout(deps.args));

    await act(async () => {
      await result.current.handleInitiateCheckout();
    });

    let response;
    await act(async () => {
      response = await result.current.handleQuickCajaSubmit({ openingAmount: 100 });
    });

    expect(response).toBe(true);
    expect(deps.pos.abrirCaja).toHaveBeenCalledWith({ openingAmount: 100 });
    expect(deps.pos.asegurarCajaAbierta).toHaveBeenCalledTimes(1);
    expect(deps.modal.closeModal).toHaveBeenCalledWith('quickCaja');
    expect(deps.modal.openModal).toHaveBeenCalledWith('payment');
  });
});
