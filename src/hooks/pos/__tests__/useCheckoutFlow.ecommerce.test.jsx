// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  activeState: null,
  processSale: vi.fn(),
  showMessageModal: vi.fn(),
  broadcastDBChange: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.appState),
    { getState: () => mocks.appState }
  )
}));

vi.mock('../../../store/useProductStore', () => ({
  useProductStore: { getState: () => ({ menu: [] }) },
  broadcastDBChange: mocks.broadcastDBChange
}));

vi.mock('../useActiveOrders', () => ({
  selectCurrentOrder: (state) => state.activeOrders.get(state.currentOrderId) || null,
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    { getState: () => mocks.activeState }
  )
}));

vi.mock('../../../services/salesService', () => ({ processSale: mocks.processSale }));
vi.mock('../../../services/Logger', () => ({ default: { error: vi.fn() } }));
vi.mock('../../../services/utils', () => ({ showMessageModal: mocks.showMessageModal }));

import {
  ECOMMERCE_POS_CHECKOUT_MESSAGE,
  ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
  useCheckoutFlow
} from '../useCheckoutFlow';

const makeDeps = () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  closeMobileCart: vi.fn(),
  refreshData: vi.fn(),
  fetchActiveTablesCount: vi.fn()
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    licenseDetails: { valid: true },
    features: {},
    cajaActual: { estado: 'abierta' },
    abrirCaja: vi.fn(),
    verifySessionIntegrity: vi.fn().mockResolvedValue(true),
    companyProfile: { name: 'Lanzo' }
  };
  mocks.activeState = {
    currentOrderId: 'ecom-order',
    activeOrders: new Map([[
      'ecom-order',
      {
        id: 'ecom-order',
        items: [{ id: 'product-1', quantity: 1, price: 20 }],
        total: 20,
        origin: 'ecommerce',
        ecommerceDraftStatus: 'prepared'
      }
    ]]),
    removeOrder: vi.fn()
  };
  mocks.processSale.mockResolvedValue({ success: false, message: 'fixture' });
});

describe('useCheckoutFlow ecommerce guard', () => {
  it('blocks the payment modal for a prepared ecommerce draft', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    let response;
    act(() => { response = result.current.handleInitiateCheckout(); });

    expect(response).toEqual({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(deps.openModal).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith(ECOMMERCE_POS_CHECKOUT_MESSAGE, null, { type: 'warning' });
  });

  it('also blocks handleProcessOrder before session, caja and processSale effects', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'efectivo' });
    });

    expect(response).toEqual({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(mocks.appState.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(deps.openModal).not.toHaveBeenCalledWith('quickCaja');
    expect(mocks.processSale).not.toHaveBeenCalled();
  });

  it('does not change checkout behavior for a normal POS order', async () => {
    mocks.activeState.currentOrderId = 'normal';
    mocks.activeState.activeOrders = new Map([[
      'normal',
      { id: 'normal', items: [{ id: 'product-1', quantity: 1, price: 20 }], total: 20 }
    ]]);
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    act(() => { result.current.handleInitiateCheckout(); });
    expect(deps.openModal).toHaveBeenCalledWith('payment');

    await act(async () => {
      await result.current.handleProcessOrder({ paymentMethod: 'tarjeta' });
    });
    expect(mocks.appState.verifySessionIntegrity).toHaveBeenCalled();
    expect(mocks.processSale).toHaveBeenCalledTimes(1);
  });
});
