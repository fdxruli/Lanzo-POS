// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadData: vi.fn(), saveDataSafe: vi.fn(), showMessageModal: vi.fn() }));
vi.mock('../../../services/database', () => ({
  loadData: (...args) => mocks.loadData(...args),
  saveDataSafe: (...args) => mocks.saveDataSafe(...args),
  STORES: { CUSTOMERS: 'customers' },
  DB_ERROR_CODES: { CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION' }
}));
vi.mock('../../../services/utils', () => ({ generateID: () => 'cust-layaway', showMessageModal: (...args) => mocks.showMessageModal(...args) }));
vi.mock('../../../hooks/useCaja', () => ({ useCaja: () => ({ cajaActual: { id: 'cash-open', estado: 'abierta' } }) }));
vi.mock('../../../services/Logger', () => ({ default: { error: vi.fn() } }));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({ useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss }));

import LayawayModal from '../LayawayModal';

beforeEach(() => { mocks.loadData.mockResolvedValue([]); mocks.saveDataSafe.mockResolvedValue({ success: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LayawayModal shared QuickAdd compatibility', () => {
  it('creates its legacy customer with creditLimit zero and preserves the initial payment and deadline', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { container } = render(<LayawayModal show onClose={vi.fn()} onConfirm={onConfirm} total={250} />);
    const initialPayment = screen.getByRole('spinbutton');
    const deadline = container.querySelector('input[type="date"]');
    await user.type(initialPayment, '50');
    const originalDeadline = deadline.value;
    await user.click(screen.getByRole('button', { name: 'Nuevo' }));
    expect(screen.queryByLabelText('Límite de crédito *')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente apartado');
    await user.type(screen.getByLabelText('Telefono *'), '5559876543');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo cliente' })).not.toBeInTheDocument());
    expect(mocks.saveDataSafe).toHaveBeenCalledWith('customers', expect.objectContaining({ creditLimit: 0, debt: 0 }));
    expect(screen.getByText('Cliente apartado')).toBeInTheDocument();
    expect(initialPayment).toHaveValue(50);
    expect(deadline).toHaveValue(originalDeadline);
    await user.click(screen.getByRole('button', { name: 'CONFIRMAR APARTADO' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ initialPayment: 50, deadline: originalDeadline, expectedCashSessionId: 'cash-open', customer: expect.objectContaining({ id: 'cust-layaway', creditLimit: 0 }) }));
    expect(mocks.showMessageModal).not.toHaveBeenCalled();
  });

  it('cancels QuickAdd without changing the layaway payment or creating a customer', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LayawayModal show onClose={onClose} onConfirm={vi.fn()} total={250} />);
    await user.type(screen.getByRole('spinbutton'), '100');
    await user.click(screen.getByRole('button', { name: 'Nuevo' }));
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Descartado');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Nuevo cliente' })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(100);
    expect(screen.getByRole('button', { name: 'CONFIRMAR APARTADO' })).toBeDisabled();
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
