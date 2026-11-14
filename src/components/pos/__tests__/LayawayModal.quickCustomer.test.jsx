// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadData: vi.fn(), saveDataSafe: vi.fn(), showMessageModal: vi.fn(), timezone: 'America/Merida', isAdmin: false, cloud: false }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    licenseDetails: { license_key: 'A', features: { cloud_pos_sync: mocks.cloud, cloud_cash_sync: mocks.cloud } },
    companyProfile: { license_key: 'A', timezone: mocks.timezone }
  })
}));
vi.mock('../../../services/auth/useActorAccess', () => ({ useActorAccess: () => ({ isAdmin: mocks.isAdmin }) }));
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

beforeEach(() => { mocks.timezone = 'America/Merida'; mocks.isAdmin = false; mocks.cloud = false; mocks.loadData.mockResolvedValue([]); mocks.saveDataSafe.mockResolvedValue({ success: true }); });
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
    expect(originalDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await user.click(screen.getByRole('button', { name: 'Nuevo' }));
    expect(screen.queryByLabelText('Límite de crédito *')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente apartado');
    await user.type(screen.getByLabelText('Teléfono *'), '5559876543');
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

  it('preserves the Cloud create flow without a timezone in the local profile', async () => {
    mocks.cloud = true;
    mocks.timezone = null;
    const onConfirm = vi.fn();
    const { container } = render(<LayawayModal show onClose={vi.fn()} onConfirm={onConfirm} total={250}
      customer={{ id: 'legacy-customer', name: 'Legacy', creditLimit: 0, debt: 0 }} />);
    const deadline = container.querySelector('input[type="date"]');
    expect(deadline.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The pre-existing POS form requires an explicit initial payment, even when it is zero.
    const user = userEvent.setup();
    await user.type(screen.getByRole('spinbutton'), '50');
    await user.click(screen.getByRole('button', { name: 'CONFIRMAR APARTADO' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      initialPayment: 50,
      deadline: deadline.value,
      expectedCashSessionId: 'cash-open'
    }));
    expect(mocks.showMessageModal).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks Free creation and offers settings only to Admin (%s)', (isAdmin) => {
    mocks.timezone = null;
    mocks.isAdmin = isAdmin;
    const onConfirm = vi.fn();
    render(<MemoryRouter><LayawayModal show onClose={vi.fn()} onConfirm={onConfirm} total={250} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent(/Configura la zona horaria/);
    expect(screen.getByRole('button', { name: 'CONFIRMAR APARTADO' })).toBeDisabled();
    if (isAdmin) {
      expect(screen.getByRole('link', { name: 'Ir a Configuración' })).toHaveAttribute('href', '/configuracion?tab=general');
    } else {
      expect(screen.queryByRole('link', { name: 'Ir a Configuración' })).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/Solicita al administrador/);
    }
    expect(onConfirm).not.toHaveBeenCalled();
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
