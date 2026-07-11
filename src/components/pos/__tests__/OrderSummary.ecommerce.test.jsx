// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: null,
  navigate: vi.fn(),
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasLayaway: true })
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    { getState: () => mocks.activeState }
  )
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../hooks/pos/useOrderDiscountRuntime', () => ({
  useOrderDiscountRuntime: vi.fn()
}));

vi.mock('../../../hooks/restaurant/useRestaurantOrderCloudStatus', () => ({
  RESTAURANT_CLOUD_STATUS_EVENT: 'restaurant-status',
  buildRestaurantCloudStatusSummary: () => ({ hasCancelledItems: false, items: [] }),
  useRestaurantOrderCloudStatus: () => ({
    items: [],
    hasCancelledItems: false,
    hasPendingItems: false,
    hasPreparingItems: false,
    isReady: false,
    isCancelled: false,
    getItemStatusLabel: vi.fn(),
    refresh: vi.fn().mockResolvedValue({ skipped: true }),
    cloudOrder: null
  })
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: { SEQUENCES: 'sequences', COMPANY: 'company', SALES: 'sales' },
  db: {
    table: vi.fn((name) => ({
      get: vi.fn().mockResolvedValue(name === 'sequences' ? null : null),
      toArray: vi.fn().mockResolvedValue([])
    }))
  }
}));

vi.mock('../../../services/restaurant/restaurantOrderReconciliation', () => ({
  getRestaurantCloudItemLocalLineId: () => null,
  isCartItemCancelledByKitchen: () => false
}));

vi.mock('../../../services/restaurant/restaurantOrderAccountAdjustment', () => ({
  applyKitchenCancelledItemsAdjustment: () => ({
    success: true,
    changed: false,
    kept: [],
    removedCount: 0,
    audit: null
  }),
  persistKitchenCancelledItemsAdjustment: vi.fn()
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../utils/cartLineIdentity', () => ({
  getCartLineId: (item, index) => item.lineId || item.id || String(index)
}));

vi.mock('../../../utils/quantityInputStep', () => ({
  getOrderQuantityInputProps: () => ({ step: '1', inputMode: 'numeric', unit: 'pz' })
}));

vi.mock('../../../utils/restaurantModifierDisplay', () => ({
  formatSelectedModifiersForDisplay: () => []
}));

vi.mock('../../../services/sales/orderTotals', () => ({
  getLineKey: (item, index) => item.lineId || item.id || String(index),
  makeSaleDiscount: vi.fn(),
  withOrderTotals: (order) => order,
  orderTotals: (order = {}) => {
    const subtotal = (Array.isArray(order.items) ? order.items : []).reduce(
      (sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)),
      0
    );
    return {
      subtotal,
      total: subtotal,
      discountTotal: 0,
      saleDiscountAmount: 0,
      saleDiscount: null
    };
  }
}));

import OrderSummary from '../OrderSummary';

const setOrder = (origin) => {
  const order = {
    id: 'active-order',
    origin,
    ecommerceOrderId: 'ecommerce-order-1',
    items: [{
      id: 'product-1',
      lineId: 'line-1',
      name: 'Producto',
      quantity: 1,
      price: 20,
      saleType: 'unit'
    }],
    total: 20,
    tableData: '',
    isSaved: false
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    updateItemQuantity: vi.fn(),
    removeItem: vi.fn(),
    getTotalPrice: vi.fn(() => 20),
    setTableData: vi.fn(),
    updateCurrentOrder: vi.fn(),
    applyLineDiscount: vi.fn(),
    removeLineDiscount: vi.fn(),
    releaseEcommerceDraft: vi.fn(),
    cancelCurrentOrder: vi.fn()
  };
};

const props = {
  onOpenPayment: vi.fn(),
  onOpenSplit: vi.fn(),
  onOpenLayaway: vi.fn(),
  showRestaurantActions: true,
  canSplitOrder: false,
  onSaveOpenOrder: vi.fn(),
  onOpenTables: vi.fn(),
  activeTablesCount: 0,
  kitchenRejectedOpenCount: 0
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    canAccess: vi.fn(() => true),
    currentDeviceRole: 'admin',
    currentStaffUser: null
  };
  mocks.showConfirmModal.mockResolvedValue(true);
  setOrder('ecommerce');
});

afterEach(() => cleanup());

describe('OrderSummary ecommerce discount slots', () => {
  it('does not expose restaurant discount triggers or panels for ecommerce', () => {
    render(<OrderSummary {...props} />);

    expect(screen.queryByText('Descuentos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descuento general' })).not.toBeInTheDocument();
  });

  it('keeps restaurant discount surfaces for a normal POS order', () => {
    setOrder(undefined);
    render(<OrderSummary {...props} />);

    expect(screen.getAllByText('Descuentos').length).toBeGreaterThan(0);
  });
});
