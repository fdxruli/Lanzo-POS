// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('../../../services/database', () => ({
  loadData: (...args) => mocks.loadData(...args),
  STORES: { CUSTOMERS: 'customers', SALES: 'sales' },
  db: {
    table: () => ({
      where: () => ({
        equals: () => ({ toArray: vi.fn().mockResolvedValue([]) })
      })
    })
  }
}));

vi.mock('../../../services/Logger', () => ({
  default: { error: (...args) => mocks.loggerError(...args) }
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({
    currentOrderId: null,
    activeOrders: new Map()
  })
}));

vi.mock('../QuickAddCustomerModal', () => ({
  default: () => null
}));

import PaymentModal from '../PaymentModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PaymentModal', () => {
  it('leaves processing state when checkout resolves with a failure result', async () => {
    let resolveCheckout;
    const checkoutPromise = new Promise((resolve) => {
      resolveCheckout = resolve;
    });
    const onConfirm = vi.fn(() => checkoutPromise);
    mocks.loadData.mockResolvedValue([]);

    render(
      <PaymentModal
        show
        onClose={vi.fn()}
        onConfirm={onConfirm}
        total={57}
      />
    );

    const confirmButton = await screen.findByRole('button', { name: 'Confirmar Pago' });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    expect(screen.getByRole('button', { name: 'Procesando...' })).toBeDisabled();

    await act(async () => {
      resolveCheckout({ success: false, code: 'ECOMMERCE_STALE_CHECKOUT_ATTEMPT' });
      await checkoutPromise;
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeEnabled();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
