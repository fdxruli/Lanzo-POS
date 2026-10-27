// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saveDataSafe: vi.fn(), saveCustomer: vi.fn(), getCustomerById: vi.fn() }));

vi.mock('../../../services/database', () => ({
  saveDataSafe: (...args) => mocks.saveDataSafe(...args),
  STORES: { CUSTOMERS: 'customers' },
  DB_ERROR_CODES: { CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION' }
}));
vi.mock('../../../services/utils', () => ({ generateID: () => 'cust-new' }));
vi.mock('../../../services/customers/customerRepository', () => ({
  customerRepository: { saveCustomer: (...args) => mocks.saveCustomer(...args), getCustomerById: (...args) => mocks.getCustomerById(...args) }
}));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));

import QuickAddCustomerModal from '../QuickAddCustomerModal';

beforeEach(() => {
  mocks.saveDataSafe.mockResolvedValue({ success: true });
  mocks.saveCustomer.mockResolvedValue({ success: true });
  mocks.getCustomerById.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function fillIdentity(user) {
  await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente QA 3C');
  await user.type(screen.getByLabelText('Telefono *'), '5551234567');
}

describe('QuickAddCustomerModal', () => {
  it('keeps the legacy customer creation without a credit field or authorization', async () => {
    const user = userEvent.setup();
    const onCustomerSaved = vi.fn();
    render(<QuickAddCustomerModal show onClose={vi.fn()} onCustomerSaved={onCustomerSaved} />);
    expect(screen.queryByLabelText('Límite de crédito *')).not.toBeInTheDocument();
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(onCustomerSaved).toHaveBeenCalledWith(expect.objectContaining({ debt: 0, creditLimit: 0 })));
    expect(mocks.saveDataSafe).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit positive credit limit that covers the remaining debt', async () => {
    const user = userEvent.setup();
    render(<QuickAddCustomerModal show creditMode minimumCreditLimit={150} onClose={vi.fn()} onCustomerSaved={vi.fn()} />);
    await fillIdentity(user);
    const credit = screen.getByLabelText('Límite de crédito *');
    const save = screen.getByRole('button', { name: 'Guardar Cliente' });
    expect(credit).toHaveValue('');
    expect(save).toBeDisabled();
    await user.type(credit, '0');
    expect(screen.getByRole('alert')).toHaveTextContent('mayor a $0.00');
    expect(save).toBeDisabled();
    await user.clear(credit);
    await user.type(credit, '100');
    expect(screen.getByRole('alert')).toHaveTextContent('Para este Fiado el límite de crédito debe ser al menos $150.00.');
    expect(credit).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
    expect(mocks.saveCustomer).not.toHaveBeenCalled();
    await user.clear(credit);
    await user.type(credit, '150');
    expect(save).toBeEnabled();
  });

  it('persists comma cents through Money and reports the saved customer', async () => {
    const user = userEvent.setup();
    const onCustomerSaved = vi.fn();
    mocks.saveCustomer.mockImplementation(async (customer) => ({ success: true, data: { ...customer, id: 'cust-cloud', serverVersion: 3, syncStatus: 'synced' } }));
    render(<QuickAddCustomerModal show creditMode minimumCreditLimit={150.99} onClose={vi.fn()} onCustomerSaved={onCustomerSaved} />);
    await fillIdentity(user);
    await user.type(screen.getByLabelText('Límite de crédito *'), '500,50');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(mocks.saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ creditLimit: 500.5 }), { existingCustomer: null }));
    await waitFor(() => expect(onCustomerSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'cust-cloud', creditLimit: 500.5, debt: 0, serverVersion: 3 })));
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('preserves typing, a trailing decimal, backspace, paste and wheel without introducing zeros', async () => {
    const user = userEvent.setup();
    render(<QuickAddCustomerModal show creditMode onClose={vi.fn()} onCustomerSaved={vi.fn()} />);
    const credit = screen.getByLabelText('Límite de crédito *');
    expect(credit).toHaveAttribute('type', 'text');
    expect(credit).toHaveAttribute('inputmode', 'decimal');
    await user.type(credit, '1');
    expect(credit).toHaveValue('1');
    await user.type(credit, '50.');
    expect(credit).toHaveValue('150.');
    expect(credit).toHaveFocus();
    await user.tab();
    expect(credit).toHaveValue('150.00');
    await user.click(credit);
    await user.keyboard('{End}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(credit).toHaveValue('');
    await user.paste('99,95');
    expect(credit).toHaveValue('99,95');
    credit.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    expect(credit).toHaveValue('99,95');
    await user.tab();
    expect(credit).toHaveValue('99.95');
  });

  it('rejects a third decimal and nonmonetary pasted content without saving', async () => {
    const user = userEvent.setup();
    render(<QuickAddCustomerModal show creditMode onClose={vi.fn()} onCustomerSaved={vi.fn()} />);
    const credit = screen.getByLabelText('Límite de crédito *');
    await user.type(credit, '150.999');
    expect(credit).toHaveValue('150.99');
    await user.clear(credit);
    for (const invalid of ['abc', '-150', '+150', '1e3', '150.999', '..', ',,']) {
      await user.paste(invalid);
      expect(credit).toHaveValue('');
    }
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the duplicate telephone error without reporting a saved customer', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCustomerSaved = vi.fn();
    mocks.saveCustomer.mockResolvedValue({ success: false, error: { code: 'CONSTRAINT_VIOLATION', details: { field: 'phone' }, message: 'El teléfono ya está registrado para otro cliente.' } });
    render(<QuickAddCustomerModal show creditMode minimumCreditLimit={150} onClose={onClose} onCustomerSaved={onCustomerSaved} />);
    await fillIdentity(user);
    await user.type(screen.getByLabelText('Límite de crédito *'), '500');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    expect(await screen.findByText('El teléfono ya está registrado para otro cliente.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Límite de crédito *')).toHaveValue('500.00');
    expect(onClose).not.toHaveBeenCalled();
    expect(onCustomerSaved).not.toHaveBeenCalled();
    expect(mocks.saveCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('keeps a pending Cloud customer open and retries its existing identity before selecting the synchronized record', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCustomerSaved = vi.fn();
    const pending = { id: 'cust-new', name: 'Cliente QA 3C', phone: '5551234567', creditLimit: 500, debt: 0, syncStatus: 'pending' };
    const synchronized = { ...pending, syncStatus: 'synced', serverVersion: 2 };
    mocks.saveCustomer.mockResolvedValueOnce({ success: true, pending: true, data: pending }).mockResolvedValueOnce({ success: true, data: synchronized });
    mocks.getCustomerById.mockResolvedValue(synchronized);
    render(<QuickAddCustomerModal show creditMode minimumCreditLimit={150} onClose={onClose} onCustomerSaved={onCustomerSaved} />);
    await fillIdentity(user);
    await user.type(screen.getByLabelText('Límite de crédito *'), '500');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('aún necesita sincronizarse');
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(onCustomerSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    await waitFor(() => expect(onCustomerSaved).toHaveBeenCalledWith(synchronized));
    expect(mocks.getCustomerById).toHaveBeenCalledWith('cust-new');
    expect(mocks.saveCustomer).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'cust-new' }), { existingCustomer: synchronized });
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('traps keyboard focus, cancels without saving, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Abrir cliente</button>{open && <QuickAddCustomerModal show creditMode onClose={() => setOpen(false)} onCustomerSaved={vi.fn()} />}</>;
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Abrir cliente' });
    await user.click(opener);
    expect(screen.getByLabelText('Nombre Completo *')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Nombre Completo *')).toHaveFocus();
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });

  it('consumes Escape for the top dialog without bubbling to its parent', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const parentEscape = vi.fn();
    render(<div onKeyDown={parentEscape}><QuickAddCustomerModal show onClose={onClose} onCustomerSaved={vi.fn()} /></div>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentEscape).not.toHaveBeenCalled();
    expect(mocks.saveDataSafe).not.toHaveBeenCalled();
  });
});
