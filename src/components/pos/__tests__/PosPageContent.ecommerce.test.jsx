// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: null
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector(mocks.activeState)
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: vi.fn()
}));

vi.mock('../ProductMenu', () => ({
  default: () => <div data-testid="product-menu" />
}));
vi.mock('../OrderSummary', () => ({
  default: () => <div data-testid="order-summary" />
}));
vi.mock('../OrderDiscountPanel', () => ({
  default: () => <div data-testid="discount-panel" />
}));
vi.mock('../MobilePosCart', () => ({
  default: () => <div data-testid="mobile-cart" />
}));
vi.mock('../PosModals', () => ({
  default: () => <div data-testid="pos-modals" />
}));
vi.mock('../PosToast', () => ({
  default: () => <div data-testid="pos-toast" />
}));
vi.mock('../PosFloatingBar', () => ({
  default: () => <div data-testid="floating-bar" />
}));
vi.mock('../OrderTabs', () => ({
  default: () => <div data-testid="order-tabs" />
}));

import PosPageContent from '../PosPageContent';

const data = {
  activeTablesCount: 0,
  kitchenRejectedOpenCount: 0,
  totalItemsCount: 1,
  menuVisual: [],
  categories: [],
  activeCategoryId: null,
  searchTerm: '',
  hasOutOfStockItems: false,
  hasExpiredItems: false,
  activeOrderId: 'active-order',
  total: 20,
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

const ui = {
  handleSelectCategory: vi.fn(),
  setSearchTerm: vi.fn(),
  openModal: vi.fn(),
  openMobileCart: vi.fn(),
  closeMobileCart: vi.fn(),
  closeModal: vi.fn(),
  isMobileCartOpen: false,
  activeModal: null
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

const setOrder = (origin) => {
  const order = {
    id: 'active-order',
    origin,
    items: [{ id: 'product-1', quantity: 1, price: 20 }]
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    createOrder: vi.fn(),
    loadOrdersFromDB: vi.fn().mockResolvedValue(undefined),
    switchOrder: vi.fn(),
    cancelOrder: vi.fn()
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = { enableMultipleOrders: false };
  setOrder('ecommerce');
});

afterEach(() => cleanup());

describe('PosPageContent ecommerce discount surface', () => {
  it('does not mount the desktop discount panel for an ecommerce order without tables', async () => {
    render(
      <PosPageContent
        data={data}
        ui={ui}
        actions={actions}
        features={{ hasTables: false }}
      />
    );

    expect(await screen.findByTestId('order-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('discount-panel')).not.toBeInTheDocument();
  });

  it('keeps the desktop discount panel for a normal POS order', async () => {
    setOrder(undefined);

    render(
      <PosPageContent
        data={data}
        ui={ui}
        actions={actions}
        features={{ hasTables: false }}
      />
    );

    expect(await screen.findByTestId('order-summary')).toBeInTheDocument();
    expect(screen.getByTestId('discount-panel')).toBeInTheDocument();
  });
});
