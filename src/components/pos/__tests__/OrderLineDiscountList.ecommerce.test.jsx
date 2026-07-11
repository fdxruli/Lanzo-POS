// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: null,
  showMessageModal: vi.fn()
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

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../services/sales/orderTotals', () => ({
  getLineKey: (item, index) => item.lineId || item.id || String(index)
}));

import OrderLineDiscountList from '../OrderLineDiscountList';

const setOrder = ({ origin, discountAmount = 0 } = {}) => {
  const order = {
    id: 'active-order',
    origin,
    items: [{
      id: 'product-1',
      lineId: 'line-1',
      name: 'Producto',
      quantity: 1,
      price: 20,
      discountAmount,
      discount: discountAmount > 0 ? { amount: discountAmount, reason: 'Promoción' } : null
    }]
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    applyLineDiscount: vi.fn(),
    removeLineDiscount: vi.fn()
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    canAccess: vi.fn(() => true),
    currentDeviceRole: 'admin',
    currentStaffUser: null
  };
  setOrder({ origin: 'ecommerce' });
});

afterEach(() => cleanup());

describe('OrderLineDiscountList ecommerce guard', () => {
  it('returns null and cannot expose line discount mutations for ecommerce', () => {
    const { container } = render(<OrderLineDiscountList />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.activeState.applyLineDiscount).not.toHaveBeenCalled();
    expect(mocks.activeState.removeLineDiscount).not.toHaveBeenCalled();
  });

  it('keeps applying a line discount for a normal POS order', () => {
    setOrder({ origin: undefined });
    render(<OrderLineDiscountList />);

    fireEvent.click(screen.getByRole('button', { name: 'Descuento' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByPlaceholderText('Valor'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Motivo del descuento'), { target: { value: 'Cliente frecuente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(mocks.activeState.applyLineDiscount).toHaveBeenCalledWith('line-1', {
      type: 'percent',
      value: '10',
      reason: 'Cliente frecuente'
    });
  });

  it('keeps removing a line discount for a normal POS order', () => {
    setOrder({ origin: undefined, discountAmount: 5 });
    render(<OrderLineDiscountList />);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(mocks.activeState.removeLineDiscount).toHaveBeenCalledWith('line-1');
  });
});
