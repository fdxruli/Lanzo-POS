// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector(mocks.activeState)
}));

vi.mock('../OrderSummary', () => ({
  default: () => <div data-testid="order-summary">Resumen</div>
}));

vi.mock('../OrderDiscountPanel', () => ({
  default: () => <div data-testid="discount-panel">Descuentos</div>
}));

import MobilePosCart from '../MobilePosCart';

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onOpenPayment: vi.fn(),
  onOpenSplit: vi.fn(),
  onOpenLayaway: vi.fn(),
  onSaveOpenOrder: vi.fn(),
  onOpenTables: vi.fn(),
  showRestaurantActions: false,
  canSplitOrder: true,
  activeTablesCount: 0,
  kitchenRejectedOpenCount: 0
};

const setOrder = (origin) => {
  mocks.activeState = {
    currentOrderId: 'active-order',
    activeOrders: new Map([[
      'active-order',
      { id: 'active-order', origin, items: [{ id: 'product-1', quantity: 1 }] }
    ]])
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  setOrder('ecommerce');
});

afterEach(() => cleanup());

describe('MobilePosCart ecommerce guard', () => {
  it('keeps the order review but hides the separate discount panel for ecommerce drafts', () => {
    render(<MobilePosCart {...props} />);

    expect(screen.getByTestId('order-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('discount-panel')).not.toBeInTheDocument();
  });

  it('preserves the discount panel for normal POS orders', () => {
    setOrder(undefined);
    render(<MobilePosCart {...props} />);

    expect(screen.getByTestId('order-summary')).toBeInTheDocument();
    expect(screen.getByTestId('discount-panel')).toBeInTheDocument();
  });
});
