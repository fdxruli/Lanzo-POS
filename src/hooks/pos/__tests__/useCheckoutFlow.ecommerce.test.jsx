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

const setOrder = ({ origin = 'ecommerce', ecommerceDraftStatus } = {}) => {
  mocks.activeState.currentOrderId = 'active-order';
  mocks.activeState.activeOrders = new Map([[
    'active-order',
    {
      id: 'active-order',
      items: [{ id: 'product-1', quantity: 1, price: 20 }],
      total: 20,
      origin,
      ...(ecommerceDraftStatus === undefined ? {} : { ecommerceDraftStatus })
    }
  ]]);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    licenseDetails: { valid: true },
    features: {},
    cajaActual: { estado: 'abierta' },
    abrirCaja: vi.fn().mockResolvedValue(true),
    verifySessionIntegrity: vi.fn().mockResolvedValue(true),
    companyProfile: { name: 'Lanzo' }
  };
  mocks.activeState = {
    currentOrderId: null,
    activeOrders: new Map(),
    removeOrder: vi.fn()
  };
  setOrder({ ecommerceDraftStatus: 'prepared' });
  mocks.processSale.mockResolvedValue({ success: false, message: 'fixture' });
});

const expectBlockedResult = (response) => {
  expect(response).toMatchObject({
    success: false,
    code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED,
    message: ECOMMERCE_POS_CHECKOUT_MESSAGE
  });
};

describe('useCheckoutFlow ecommerce guard', () => {
  it.each([
    ['claimed', 'claimed'],
    ['prepared', 'prepared'],
    ['missing', undefined],
    ['unknown', 'future_state']
  ])('blocks the payment modal for ecommerce status %s', (_label, ecommerceDraftStatus) => {
    setOrder({ ecommerceDraftStatus });
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    let response;
    act(() => { response = result.current.handleInitiateCheckout(); });

    expectBlockedResult(response);
    expect(deps.openModal).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith(ECOMMERCE_POS_CHECKOUT_MESSAGE, null, { type: 'warning' });
  });

  it('blocks handleProcessOrder before session, caja and processSale effects', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    let response;
    await act(async () => {
      response = await result.current.handleProcessOrder({ paymentMethod: 'efectivo' });
    });

    expectBlockedResult(response);
    expect(mocks.appState.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(deps.openModal).not.toHaveBeenCalledWith('quickCaja');
    expect(mocks.processSale).not.toHaveBeenCalled();
  });

  it('blocks quick caja before opening caja or payment', async () => {
    mocks.appState.cajaActual = null;
    const deps = makeDeps();
    const { result } = renderHook(() => useCheckoutFlow(deps));

    let response;
    await act(async () => {
      response = await result.current.handleQuickCajaSubmit({ openingAmount: 100 });
    });

    expectBlockedResult(response);
    expect(mocks.appState.abrirCaja).not.toHaveBeenCalled();
    expect(deps.openModal).not.toHaveBeenCalled();
  });

  it('does not change checkout behavior for a normal POS order', async () => {
    setOrder({ origin: undefined, ecommerceDraftStatus: undefined });
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
