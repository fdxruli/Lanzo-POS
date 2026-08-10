// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('../../../utils/restaurantModifierDisplay', () => ({
  formatSelectedModifiersForDisplay: () => []
}));

vi.mock('../EcommercePosDraftBanner', () => ({
  default: () => <div data-testid="ecommerce-draft-banner" />
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

const setOrderItems = (items) => {
  setOrder(undefined);
  mocks.activeState.activeOrders.get('active-order').items = items;
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

  it('shows commercial sale units for unit, bulk, and fractioned cart lines', () => {
    setOrder(undefined);
    const order = mocks.activeState.activeOrders.get('active-order');
    order.items = [
      { id: 'unit', lineId: 'unit', name: 'Unidad', quantity: 2, price: 18, saleType: 'unit', unit: 'pza' },
      { id: 'bulk', lineId: 'bulk', name: 'Granel', quantity: 0.5, price: 40, saleType: 'bulk', unit: 'kg', bulkData: { purchase: { unit: 'caja' } } },
      { id: 'fractioned', lineId: 'fractioned', name: 'Fraccionado', quantity: 3, price: 15, saleType: 'unit', unit: 'pza', conversionFactor: { enabled: true, purchaseUnit: 'caja', factor: 12 } }
    ];

    render(<OrderSummary {...props} />);

    expect(screen.getByText('2 pza × $18.00/pza')).toBeInTheDocument();
    expect(screen.getByText('0.500 kg × $40.00/kg')).toBeInTheDocument();
    expect(screen.getByText('3 pza × $15.00/pza')).toBeInTheDocument();
    expect(screen.getByText('Fraccionado · Venta por pza')).toBeInTheDocument();
    expect(screen.queryByText(/c\/u/i)).not.toBeInTheDocument();
  });

  it('keeps a decimal bulk quantity when editing a measurement sale', () => {
    setOrderItems([{
      id: 'ft-product',
      lineId: 'ft-line',
      name: 'Manguera',
      quantity: 1,
      price: 12,
      saleType: 'bulk',
      unit: 'ft'
    }]);

    render(<OrderSummary {...props} />);

    const input = screen.getByRole('spinbutton', { name: 'Cantidad de Manguera' });
    expect(input).toHaveAttribute('step', '0.001');
    expect(input).toHaveAttribute('inputmode', 'decimal');

    fireEvent.change(input, { target: { value: '2.5' } });

    expect(mocks.activeState.updateItemQuantity).toHaveBeenCalledWith('ft-line', 2.5);
  });

  it.each([
    ['cm', 'Cadena', 'cm-line', '2.5', 2.5],
    ['ft', 'Manguera legacy', 'ft-legacy-line', '2.5', 2.5],
    ['in', 'Material', 'in-line', '1.25', 1.25]
  ])('uses a decimal input for legacy unit %s measurement sales', (unit, name, lineId, value, expectedQuantity) => {
    setOrderItems([{
      id: `hardware-${unit}`,
      lineId,
      name,
      quantity: 1,
      price: 12,
      saleType: 'unit',
      unit
    }]);

    render(<OrderSummary {...props} />);

    const input = screen.getByRole('spinbutton', { name: `Cantidad de ${name}` });
    expect(input).toHaveAttribute('step', '0.001');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.queryByRole('button', { name: `Agregar una unidad de ${name}` })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value } });

    expect(mocks.activeState.updateItemQuantity).toHaveBeenCalledWith(lineId, expectedQuantity);
  });

  it('keeps piece sales on integer increment and decrement controls', () => {
    setOrderItems([{
      id: 'piece-product',
      lineId: 'piece-line',
      name: 'Tornillo',
      quantity: 1,
      price: 3,
      saleType: 'unit',
      unit: 'pza'
    }]);

    render(<OrderSummary {...props} />);

    expect(screen.queryByRole('spinbutton', { name: 'Cantidad de Tornillo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar una unidad de Tornillo' }));

    expect(mocks.activeState.updateItemQuantity).toHaveBeenCalledWith('piece-line', 2);
  });

  it.each(['g', 'ml'])('uses a direct integer input for bulk %s sales', (unit) => {
    const name = `Venta ${unit}`;
    setOrderItems([{
      id: `bulk-${unit}`,
      lineId: `bulk-${unit}-line`,
      name,
      quantity: 250,
      price: 1,
      saleType: 'bulk',
      unit
    }]);

    render(<OrderSummary {...props} />);

    const input = screen.getByRole('spinbutton', { name: `Cantidad de ${name}` });
    expect(input).toHaveAttribute('step', '1');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('displays the decimal measurement quantity and its unrounded line total', () => {
    setOrderItems([{
      id: 'ft-total',
      lineId: 'ft-total-line',
      name: 'Cable',
      quantity: 2.5,
      price: 12,
      saleType: 'unit',
      unit: 'ft'
    }]);

    render(<OrderSummary {...props} />);

    expect(screen.getByText('2.500 ft × $12.00/ft')).toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
  });
});
