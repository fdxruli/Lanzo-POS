// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: null,
  showMessageModal: vi.fn(),
  makeSaleDiscount: vi.fn()
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

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../services/sales/orderTotals', () => ({
  makeSaleDiscount: mocks.makeSaleDiscount,
  orderTotals: (order = {}) => {
    const subtotal = (Array.isArray(order.items) ? order.items : []).reduce(
      (sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)),
      0
    );
    const saleDiscountAmount = Number(order.saleDiscount?.amount || 0);
    return {
      subtotal,
      total: subtotal - saleDiscountAmount,
      discountTotal: saleDiscountAmount,
      saleDiscountAmount,
      saleDiscount: order.saleDiscount || null
    };
  },
  withOrderTotals: (order) => order
}));

vi.mock('../OrderLineDiscountList', () => ({
  default: () => <div data-testid="line-discounts" />
}));

import OrderDiscountPanel from '../OrderDiscountPanel';

const setOrder = ({ origin, saleDiscount = null } = {}) => {
  const order = {
    id: 'active-order',
    origin,
    items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 20 }],
    saleDiscount
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    updateCurrentOrder: vi.fn()
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    canAccess: vi.fn(() => true),
    currentDeviceRole: 'admin',
    currentStaffUser: null
  };
  mocks.makeSaleDiscount.mockImplementation((_order, payload) => ({
    type: payload.type,
    value: Number(payload.value),
    amount: Number(payload.value),
    reason: payload.reason
  }));
  setOrder({ origin: 'ecommerce' });
});

afterEach(() => cleanup());

describe('OrderDiscountPanel ecommerce guard', () => {
  it('returns null and never exposes mutations for an ecommerce order', () => {
    const { container } = render(<OrderDiscountPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Descuento general' })).not.toBeInTheDocument();
    expect(mocks.activeState.updateCurrentOrder).not.toHaveBeenCalled();
  });

  it('keeps applying a general discount for a normal POS order', () => {
    setOrder({ origin: undefined });
    render(<OrderDiscountPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Descuento general' }));
    fireEvent.change(screen.getByLabelText('Tipo de descuento'), { target: { value: 'amount' } });
    fireEvent.change(screen.getByPlaceholderText('Valor'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Motivo del descuento'), { target: { value: 'Promoción' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar descuento' }));

    expect(mocks.activeState.updateCurrentOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        saleDiscount: expect.objectContaining({ amount: 5, reason: 'Promoción' })
      })
    );
  });

  it('keeps removing a general discount for a normal POS order', () => {
    setOrder({
      origin: undefined,
      saleDiscount: { type: 'amount', amount: 5, reason: 'Promoción' }
    });
    render(<OrderDiscountPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar descuento general' }));

    expect(mocks.activeState.updateCurrentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ saleDiscount: null })
    );
  });
});
