// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  saveDataSafe: vi.fn(),
  saveCustomer: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('../../../services/database', () => ({
  loadData: (...args) => mocks.loadData(...args),
  saveDataSafe: (...args) => mocks.saveDataSafe(...args),
  DB_ERROR_CODES: { CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION' },
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

vi.mock('../../../services/utils', () => ({ generateID: () => 'cust-quick' }));
vi.mock('../../../services/customers/customerRepository', () => ({ customerRepository: { saveCustomer: (...args) => mocks.saveCustomer(...args) } }));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));

import PaymentModal from '../PaymentModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PaymentModal', () => {
  it('opens from a hydrated remote table total without starting a sale', async () => {
    const hydratedShadow = {
      restaurantCloudHydrated: true,
      total: 300,
      items: [{ id: 'pizza-qa', quantity: 1, price: 300 }]
    };
    const onConfirm = vi.fn();
    mocks.loadData.mockResolvedValue([]);

    render(<PaymentModal show onClose={vi.fn()} onConfirm={onConfirm} total={hydratedShadow.total} />);

    expect(await screen.findByRole('button', { name: 'Confirmar Pago' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

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
    expect(confirmButton).toHaveClass('ui-button--success');
    expect(confirmButton).not.toHaveClass('ui-button--primary');
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

  it('envía el efectivo recibido y el cambio al confirmar', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ success: true });
    mocks.loadData.mockResolvedValue([]);

    render(
      <PaymentModal
        show
        onClose={vi.fn()}
        onConfirm={onConfirm}
        total={57}
      />
    );

    const amountInput = await screen.findByLabelText('Monto Recibido:');
    fireEvent.change(amountInput, { target: { value: '100' } });
    const confirmButton = await screen.findByRole('button', { name: 'Confirmar Pago' });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const paymentData = onConfirm.mock.calls[0][0];
    expect(Number(paymentData.amountPaid)).toBe(100);
    expect(Number(paymentData.receivedAmount)).toBe(100);
    expect(Number(paymentData.changeAmount)).toBe(43);
  });

  it('permite vaciar y pegar efectivo con coma sin cambiar la precisión del cambio', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ success: true });
    mocks.loadData.mockResolvedValue([]);
    render(<PaymentModal show onClose={vi.fn()} onConfirm={onConfirm} total={57} />);
    const amount = await screen.findByLabelText('Monto Recibido:');
    await waitFor(() => expect(amount).toHaveValue('57.00'));
    await user.clear(amount);
    expect(amount).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeDisabled();
    await user.paste('100,50');
    expect(amount).toHaveValue('100,50');
    amount.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    expect(amount).toHaveValue('100,50');
    await user.click(screen.getByRole('button', { name: 'Confirmar Pago' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ amountPaid: '100.5', receivedAmount: '100.5', changeAmount: '43.5' })));
  });

  it('preserva deuda acumulada y reglas del abono para un cliente Fiado existente', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ success: true });
    mocks.loadData.mockResolvedValue([{ id: 'cust-existing', name: 'Cliente existente', phone: '5551112222', creditLimit: 200, debt: 50 }]);
    render(<PaymentModal show onClose={vi.fn()} onConfirm={onConfirm} total={250} />);
    await user.click(screen.getByRole('button', { name: 'Fiado' }));
    await user.type(screen.getByLabelText('Asignar a Cliente (Obligatorio):'), 'existente');
    await user.click(await screen.findByText('Cliente existente (5551112222)'));
    expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeDisabled();
    const amount = screen.getByLabelText('Abono (Opcional):');
    await user.type(amount, '100,00');
    expect(amount).toHaveValue('100,00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Método del abono inicial:'), 'transferencia');
    await user.click(screen.getByRole('button', { name: 'Confirmar Pago' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cust-existing', paymentMethod: 'fiado', amountPaid: '100', initialPaymentMethod: 'transferencia', receivedAmount: null, saldoPendiente: '150', changeAmount: '0' })));
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
    expect(mocks.saveCustomer).not.toHaveBeenCalled();
  });

  it('crea y selecciona un cliente Fiado con límite explícito para el saldo después del abono', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ success: true });
    mocks.loadData.mockResolvedValue([]);
    mocks.saveCustomer.mockResolvedValue({ success: true });
    render(<PaymentModal show onClose={vi.fn()} onConfirm={onConfirm} total={400} />);
    await user.click(screen.getByRole('button', { name: 'Fiado' }));
    await user.type(screen.getByLabelText('Abono (Opcional):'), '250');
    await user.click(screen.getByRole('button', { name: '+ Nuevo Cliente' }));
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Nuevo para Fiado');
    await user.type(screen.getByLabelText('Telefono *'), '5553334444');
    const credit = screen.getByLabelText('Límite de crédito *');
    expect(credit).toHaveValue('');
    await user.type(credit, '100');
    expect(screen.getByRole('alert')).toHaveTextContent('debe ser al menos $150.00');
    expect(screen.getByRole('button', { name: 'Guardar Cliente' })).toBeDisabled();
    await user.clear(credit);
    await user.type(credit, '150');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo cliente' })).not.toBeInTheDocument());
    expect(mocks.saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 'cust-quick', creditLimit: 150, debt: 0 }), { existingCustomer: null });
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Asignar a Cliente (Obligatorio):')).toHaveValue('Nuevo para Fiado - 5553334444');
    expect(screen.getByLabelText('Abono (Opcional):')).toHaveValue('250.00');
    expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Confirmar Pago' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cust-quick', amountPaid: '250', saldoPendiente: '150' })));
  });

  it('mantiene cliente existente y abono al cancelar el alta rápida', async () => {
    const user = userEvent.setup();
    mocks.loadData.mockResolvedValue([{ id: 'cust-existing', name: 'Cliente existente', phone: '5551112222', creditLimit: 500, debt: 0 }]);
    render(<PaymentModal show onClose={vi.fn()} onConfirm={vi.fn()} total={250} />);
    await user.click(screen.getByRole('button', { name: 'Fiado' }));
    await user.type(screen.getByLabelText('Asignar a Cliente (Obligatorio):'), 'existente');
    await user.click(await screen.findByText('Cliente existente (5551112222)'));
    await user.type(screen.getByLabelText('Abono (Opcional):'), '100');
    await user.click(screen.getByRole('button', { name: '+ Nuevo Cliente' }));
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Descartado');
    await user.click(screen.getAllByRole('button', { name: 'Cancelar' })[1]);
    expect(screen.queryByRole('dialog', { name: 'Nuevo cliente' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Asignar a Cliente (Obligatorio):')).toHaveValue('Cliente existente - 5551112222');
    expect(screen.getByLabelText('Abono (Opcional):')).toHaveValue('100.00');
    expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeEnabled();
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('mantiene el alta normal opcional sin crédito y bloquea un abono mayor al total', async () => {
    const user = userEvent.setup();
    mocks.loadData.mockResolvedValue([]);
    mocks.saveDataSafe.mockResolvedValue({ success: true });
    render(<PaymentModal show onClose={vi.fn()} onConfirm={vi.fn()} total={100} />);
    await user.click(screen.getByRole('button', { name: '+ Nuevo Cliente' }));
    expect(screen.queryByLabelText('Límite de crédito *')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente sin crédito');
    await user.type(screen.getByLabelText('Telefono *'), '5554445555');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(mocks.saveDataSafe).toHaveBeenCalledWith('customers', expect.objectContaining({ creditLimit: 0 })));
    await user.click(screen.getByRole('button', { name: 'Fiado' }));
    await user.type(screen.getByLabelText('Abono (Opcional):'), '101');
    expect(screen.getByText('El abono inicial no puede ser mayor al total.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar Pago' })).toBeDisabled();
  });
});
