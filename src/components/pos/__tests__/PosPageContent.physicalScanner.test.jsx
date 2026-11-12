// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: { enableMultipleOrders: false },
  resolveWithCacheResult: vi.fn(),
  showMessageModal: vi.fn(),
  playBeep: vi.fn(),
  playErrorBeep: vi.fn()
}));

const createDeterministicScannerClock = (start = 1000, gapMs = 5) => {
  let currentTime = start;
  const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

  return {
    press(target, key, options = {}) {
      fireEvent.keyDown(target, { key, ...options });
      currentTime += gapMs;
    },
    restore() {
      dateNowSpy.mockRestore();
    }
  };
};

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: Object.assign((selector) => selector(mocks.activeState), {
    getState: () => mocks.activeState
  })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../services/barcodeCache', () => ({
  resolveWithCacheResult: mocks.resolveWithCacheResult
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../services/audioBeep', () => ({
  playBeep: mocks.playBeep,
  playErrorBeep: mocks.playErrorBeep
}));

vi.mock('../ProductMenu', () => ({ default: () => <div data-testid="product-menu" /> }));
vi.mock('../OrderSummary', () => ({ default: () => <div data-testid="order-summary" /> }));
vi.mock('../EcommercePosConversionPanel', () => ({ default: () => <div data-testid="ecommerce-conversion-panel" /> }));
vi.mock('../MobilePosCart', () => ({ default: () => <div data-testid="mobile-cart" /> }));
vi.mock('../PosModals', () => ({ default: () => <div data-testid="pos-modals" /> }));
vi.mock('../PosToast', () => ({ default: () => <div data-testid="pos-toast" /> }));
vi.mock('../PosFloatingBar', () => ({ default: () => <div data-testid="floating-bar" /> }));
vi.mock('../OrderTabs', () => ({ default: () => <div data-testid="order-tabs" /> }));

import PosPageContent from '../PosPageContent';

const data = {
  activeTablesCount: 0,
  kitchenRejectedOpenCount: 0,
  totalItemsCount: 0,
  menuVisual: [],
  categories: [],
  activeCategoryId: null,
  searchTerm: '',
  hasOutOfStockItems: false,
  hasExpiredItems: false,
  activeOrderId: 'active-order',
  total: 0,
  toastMsg: '',
  order: [],
  customer: null,
  prescriptionItems: [],
  cajaActual: null,
  aperturaPendiente: false,
  cashActor: null,
  isCloudCash: false,
  isCloudCashReadOnly: false
};

const actions = {
  handleInitiateCheckout: vi.fn(),
  handleOpenSplitBill: vi.fn(),
  handleInitiateLayaway: vi.fn(),
  handleSaveAsOpen: vi.fn(),
  handleProcessOrder: vi.fn(),
  handlePaymentModalClose: vi.fn(),
  handleConfirmSplitBill: vi.fn(),
  handleQuickCajaSubmit: vi.fn(),
  handleQuickCajaClose: vi.fn(),
  handlePrescriptionConfirm: vi.fn(),
  handleConfirmLayaway: vi.fn(),
  handleLoadOpenOrder: vi.fn(),
  handleQuickTableAction: vi.fn(),
  fetchActiveTablesCount: vi.fn(),
  handleAnnulKitchenRejectedOrder: vi.fn()
};

const makeUi = (overrides = {}) => ({
  handleSelectCategory: vi.fn(),
  setSearchTerm: vi.fn(),
  openModal: vi.fn(),
  openMobileCart: vi.fn(),
  closeMobileCart: vi.fn(),
  closeModal: vi.fn(),
  isMobileCartOpen: false,
  activeModal: null,
  ...overrides
});

const renderPos = (ui = makeUi()) => render(
  <PosPageContent data={data} ui={ui} actions={actions} features={{ hasTables: false }} />
);

const waitForPosReady = async () => {
  await screen.findByTestId('order-summary');
  await act(async () => {});
};

const sendScan = (code, target = document.body) => {
  const clock = createDeterministicScannerClock();
  try {
    [...code].forEach((key) => clock.press(target, key));
    clock.press(target, 'Enter');
  } finally {
    clock.restore();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = { enableMultipleOrders: false };
  const order = {
    id: 'active-order',
    items: [],
    origin: 'pos'
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    isCurrentOrderLocked: false,
    createOrder: vi.fn(),
    loadOrdersFromDB: vi.fn().mockResolvedValue(undefined),
    addMultipleScannedProducts: vi.fn(() => ({ success: true, addedCount: 1, incrementedCount: 0, failedCount: 0 }))
  };
  mocks.resolveWithCacheResult.mockResolvedValue({ status: 'RESOLVED', product: { id: 'product-1', name: 'Producto', price: 12 } });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('POS physical scanner integration', () => {
  it.each([
    ['DUPLICATE', 'Este código pertenece a varios productos'],
    ['INACTIVE', 'Producto registrado, pero desactivado'],
    ['NO_SELLABLE_BATCH', 'Producto registrado, sin lote disponible'],
  ])('does not add a %s read to the active order', async (status, message) => {
    mocks.resolveWithCacheResult.mockResolvedValue({
      status, code: '7501400800069',
      product: { id: 'a', name: 'Bicarbonato' },
      matches: [{ id: 'a', name: 'Bicarbonato A' }, { id: 'b', name: 'Bicarbonato B' }],
    });
    renderPos();
    await waitForPosReady();
    sendScan('7501400800069');
    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalled());
    expect(mocks.showMessageModal.mock.calls[0][0]).toContain(message);
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('distinguishes a technical lookup exception from an unknown code', async () => {
    mocks.resolveWithCacheResult.mockRejectedValue(new Error('Dexie failed'));
    renderPos();
    await waitForPosReady();
    sendScan('7501400800069');
    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'No se pudo consultar el catálogo.',
      null,
      { type: 'error', duration: 1500 }
    ));
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('resolves a known physical barcode and uses the existing scanned-product mutation seam', async () => {
    renderPos();
    await waitForPosReady();

    sendScan('7501234567890');

    await waitFor(() => expect(mocks.activeState.addMultipleScannedProducts).toHaveBeenCalledWith([
      { id: 'product-1', name: 'Producto', price: 12 }
    ], 'active-order'));
    expect(mocks.resolveWithCacheResult).toHaveBeenCalledWith('7501234567890');
  });

  it('preserves the existing safe unknown-code semantics', async () => {
    mocks.resolveWithCacheResult.mockResolvedValue({ status: 'NOT_FOUND', code: 'UNKNOWN9' });
    renderPos();
    await waitForPosReady();

    sendScan('UNKNOWN9');

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Producto no registrado: UNKNOWN9',
      null,
      { type: 'error', duration: 2500 }
    ));
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('does not resolve a short rejected burst', async () => {
    renderPos();
    await waitForPosReady();

    sendScan('ABC');

    expect(mocks.resolveWithCacheResult).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it.each([
    ['camera scanner', { activeModal: 'scanner' }],
    ['payment or another blocking modal', { activeModal: 'payment' }],
    ['mobile cart', { isMobileCartOpen: true }]
  ])('pauses physical input while %s is active', async (_label, uiOverrides) => {
    renderPos(makeUi(uiOverrides));
    await waitForPosReady();

    sendScan('7501234567890');

    expect(mocks.resolveWithCacheResult).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('pauses physical input while the active order is confirming checkout', async () => {
    mocks.activeState.isCurrentOrderLocked = true;
    renderPos();
    await waitForPosReady();

    sendScan('7501234567890');

    expect(mocks.resolveWithCacheResult).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });
});
