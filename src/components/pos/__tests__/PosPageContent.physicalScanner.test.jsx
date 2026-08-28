// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: { enableMultipleOrders: false },
  resolveWithCache: vi.fn(),
  showMessageModal: vi.fn(),
  playBeep: vi.fn(),
  playErrorBeep: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector(mocks.activeState)
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../services/barcodeCache', () => ({
  resolveWithCache: mocks.resolveWithCache
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

const sendScan = (code, target = document.body) => {
  [...code].forEach((key) => fireEvent.keyDown(target, { key }));
  fireEvent.keyDown(target, { key: 'Enter' });
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
  mocks.resolveWithCache.mockResolvedValue({ id: 'product-1', name: 'Producto', price: 12 });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('POS physical scanner integration', () => {
  it('resolves a known physical barcode and uses the existing scanned-product mutation seam', async () => {
    renderPos();
    await screen.findByTestId('order-summary');

    sendScan('7501234567890');

    await waitFor(() => expect(mocks.activeState.addMultipleScannedProducts).toHaveBeenCalledWith([
      { id: 'product-1', name: 'Producto', price: 12 }
    ]));
    expect(mocks.resolveWithCache).toHaveBeenCalledWith('7501234567890');
  });

  it('preserves the existing safe unknown-code semantics', async () => {
    mocks.resolveWithCache.mockResolvedValue(null);
    renderPos();
    await screen.findByTestId('order-summary');

    sendScan('UNKNOWN9');

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      '⚠️ Producto no encontrado: UNKNOWN9',
      null,
      { type: 'error', duration: 1500 }
    ));
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('does not resolve a short rejected burst', async () => {
    renderPos();
    await screen.findByTestId('order-summary');

    sendScan('ABC');

    expect(mocks.resolveWithCache).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it.each([
    ['camera scanner', { activeModal: 'scanner' }],
    ['payment or another blocking modal', { activeModal: 'payment' }],
    ['mobile cart', { isMobileCartOpen: true }]
  ])('pauses physical input while %s is active', async (_label, uiOverrides) => {
    renderPos(makeUi(uiOverrides));
    await screen.findByTestId('order-summary');

    sendScan('7501234567890');

    expect(mocks.resolveWithCache).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });

  it('pauses physical input while the active order is confirming checkout', async () => {
    mocks.activeState.isCurrentOrderLocked = true;
    renderPos();
    await screen.findByTestId('order-summary');

    sendScan('7501234567890');

    expect(mocks.resolveWithCache).not.toHaveBeenCalled();
    expect(mocks.activeState.addMultipleScannedProducts).not.toHaveBeenCalled();
  });
});
