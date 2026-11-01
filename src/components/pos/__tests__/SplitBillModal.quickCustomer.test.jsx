// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SplitBillModal from '../SplitBillModal';

const { loadData, saveDataSafe, saveCustomer, getCustomerById, tenantStorage } = vi.hoisted(() => ({
  loadData: vi.fn(),
  saveDataSafe: vi.fn(),
  saveCustomer: vi.fn(),
  getCustomerById: vi.fn(),
  tenantStorage: new Map()
}));
vi.mock('../../../services/customers/customerRepository', () => ({
  customerRepository: { saveCustomer, getCustomerById }
}));

vi.mock('../../../services/database', () => ({
  loadData,
  saveDataSafe,
  STORES: { CUSTOMERS: 'customers' },
  DB_ERROR_CODES: { CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION' }
}));
vi.mock('../../../services/utils', () => ({ generateID: () => 'customer-3c' }));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));
vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ ready: true, opaqueId: 'tenant-3c' }),
  getTenantStorageItem: (key) => tenantStorage.get(key) ?? null,
  setTenantStorageItem: (key, value) => tenantStorage.set(key, value),
  removeTenantStorageItem: (key) => tenantStorage.delete(key)
}));

const order = [{ id: 'pizza', lineId: 'pizza-line', name: 'Pizza', price: 400, quantity: 1 }];
const customerCard = (index) => screen.getByRole('heading', {
  name: `Comensal ${index} · Comensal ${index}`
}).closest('.split-payment-card');
const input = (id) => document.getElementById(id);
const quickDialog = () => screen.getByRole('dialog', { name: /Nuevo cliente/i });

const setup = async () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn(async () => ({ success: true }));
  const props = { show: true, order, total: 400, orderId: 'quick-add-3c', onClose, onConfirm };
  const view = render(<SplitBillModal {...props} />);
  fireEvent.click(screen.getByRole('radio', { name: /Ingresar montos personalizados/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
  fireEvent.change(input('splitCustomAmount-T1'), { target: { value: '250' } });
  fireEvent.change(input('splitCustomAmount-T2'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: 'Configurar cobro' }));
  fireEvent.change(input('splitPaymentMethod-T1'), { target: { value: 'fiado' } });
  fireEvent.change(input('splitPaid-T1'), { target: { value: '100.' } });
  fireEvent.change(input('splitCreditReceived-T1'), { target: { value: '120,' } });
  fireEvent.change(input('splitPaymentMethod-T2'), { target: { value: 'transferencia' } });
  fireEvent.change(input('splitReference-T2'), { target: { value: 'transfer-3c' } });
  await waitFor(() => expect(loadData).toHaveBeenCalled());
  return { ...view, props, onClose, onConfirm };
};
const openQuick = () => fireEvent.click(within(customerCard(1)).getByRole('button', { name: '+ Nuevo cliente' }));
const fillCustomer = (limit = '500') => {
  const dialog = quickDialog();
  fireEvent.change(within(dialog).getByLabelText(/Nombre Completo/i), { target: { value: 'Cliente QA 3C' } });
  fireEvent.change(within(dialog).getByLabelText(/Tel[eé]fono/i), { target: { value: '5551234567' } });
  fireEvent.change(within(dialog).getByLabelText(/Límite de crédito/i), { target: { value: limit } });
  return dialog;
};
const expectPaymentsIntact = () => {
  expect(screen.getByRole('heading', { name: 'Configura el cobro' })).toBeInTheDocument();
  expect(input('splitPaid-T1')).toHaveValue('100.');
  expect(input('splitCreditReceived-T1')).toHaveValue('120,');
  expect(input('splitPaymentMethod-T1')).toHaveValue('fiado');
  expect(input('splitPaymentMethod-T2')).toHaveValue('transferencia');
  expect(input('splitReference-T2')).toHaveValue('transfer-3c');
  expect(within(customerCard(1)).getByText('$250.00')).toBeInTheDocument();
  expect(within(customerCard(2)).getByText('$150.00')).toBeInTheDocument();
};

describe('Split Bill quick customer credit flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantStorage.clear();
    loadData.mockResolvedValue([]);
    saveDataSafe.mockResolvedValue({ success: true });
    saveCustomer.mockResolvedValue({ success: true });
    getCustomerById.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it('creates usable explicit credit, selects only the initiating payer and preserves drafts/distribution/references', async () => {
    const { onConfirm } = await setup();
    expect(within(customerCard(2)).queryByRole('button', { name: '+ Nuevo cliente' })).not.toBeInTheDocument();
    openQuick();
    expect(within(quickDialog()).getByText(/150\.00/)).toBeInTheDocument();
    expect(within(quickDialog()).getByLabelText(/Límite de crédito/i)).toHaveValue('');
    const dialog = fillCustomer('500,50');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar Cliente/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Nuevo cliente/i })).not.toBeInTheDocument());
    expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'customer-3c', name: 'Cliente QA 3C', debt: 0, creditLimit: 500.5
    }), expect.anything());
    expect(saveDataSafe).not.toHaveBeenCalled();
    expect(input('splitCustomer-T1')).toHaveValue('customer-3c');
    expect(within(input('splitCustomer-T1')).getAllByRole('option', { name: /Cliente QA 3C/ })).toHaveLength(1);
    expectPaymentsIntact();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.splitIntent).toBe('custom_payment');
    expect(payload.tickets[0]).toMatchObject({
      label: 'T1', amountCents: 25000,
      paymentData: { paymentMethod: 'fiado', amountPaid: '100', receivedAmount: '120', customerId: 'customer-3c' }
    });
    expect(payload.tickets[1]).toMatchObject({
      label: 'T2', amountCents: 15000,
      paymentData: { paymentMethod: 'transferencia', amountPaid: '150', paymentReference: 'transfer-3c', customerId: null }
    });
  });

  it('blocks an insufficient limit before saving and retains the split state', async () => {
    await setup();
    openQuick();
    const dialog = fillCustomer('100');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar Cliente/i }));
    expect(await within(dialog).findByText(/al menos \$150\.00/i)).toBeInTheDocument();
    expect(saveDataSafe).not.toHaveBeenCalled();
    expect(saveCustomer).not.toHaveBeenCalled();
    expect(input('splitCustomer-T1')).toHaveValue('');
    expectPaymentsIntact();
  });

  it('cancels without creating or selecting a customer and returns focus to the same payer', async () => {
    const { onClose } = await setup();
    const button = within(customerCard(1)).getByRole('button', { name: '+ Nuevo cliente' });
    button.focus();
    openQuick();
    const dialog = fillCustomer();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Nuevo cliente/i })).not.toBeInTheDocument());
    expect(saveDataSafe).not.toHaveBeenCalled();
    expect(saveCustomer).not.toHaveBeenCalled();
    expect(input('splitCustomer-T1')).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    expectPaymentsIntact();
    expect(button).toHaveFocus();
    openQuick();
    expect(within(quickDialog()).getByLabelText(/Nombre Completo/i)).toHaveValue('');
  });

  it('keeps duplicate-phone errors in QuickAdd without losing split data', async () => {
    saveCustomer.mockResolvedValue({ success: false, error: {
      code: 'CONSTRAINT_VIOLATION', details: { field: 'phone' }, message: 'El teléfono ya está registrado para otro cliente.'
    } });
    await setup();
    openQuick();
    const dialog = fillCustomer();
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar Cliente/i }));
    expect(await within(dialog).findByText(/El teléfono ya está registrado/)).toBeInTheDocument();
    expect(input('splitCustomer-T1')).toHaveValue('');
    expect(within(input('splitCustomer-T1')).queryByRole('option', { name: /Cliente QA 3C/ })).not.toBeInTheDocument();
    expectPaymentsIntact();
  });

  it('Escape closes only QuickAdd and preserves the parent wizard', async () => {
    const { onClose } = await setup();
    openQuick();
    fireEvent.keyDown(within(quickDialog()).getByLabelText(/Nombre Completo/i), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Nuevo cliente/i })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expectPaymentsIntact();
  });

  it('retains the newly created customer when the initial customer load completes late', async () => {
    let resolveCustomers;
    loadData.mockImplementation(() => new Promise((resolve) => { resolveCustomers = resolve; }));
    await setup();
    openQuick();
    fireEvent.click(within(fillCustomer()).getByRole('button', { name: /Guardar Cliente/i }));
    await waitFor(() => expect(input('splitCustomer-T1')).toHaveValue('customer-3c'));
    resolveCustomers([{ id: 'existing', name: 'Existente', creditLimit: 1000, debt: 0 }]);
    await waitFor(() => expect(within(input('splitCustomer-T1')).getByRole('option', { name: 'Existente' })).toBeInTheDocument());
    expect(input('splitCustomer-T1')).toHaveValue('customer-3c');
    expect(within(input('splitCustomer-T1')).getAllByRole('option', { name: /Cliente QA 3C/ })).toHaveLength(1);
  });

  it('assigns the async result to the second payer when that payer opened QuickAdd', async () => {
    await setup();
    fireEvent.change(input('splitPaymentMethod-T2'), { target: { value: 'fiado' } });
    fireEvent.click(within(customerCard(2)).getByRole('button', { name: '+ Nuevo cliente' }));
    fireEvent.click(within(fillCustomer()).getByRole('button', { name: /Guardar Cliente/i }));
    await waitFor(() => expect(input('splitCustomer-T2')).toHaveValue('customer-3c'));
    expect(input('splitCustomer-T1')).toHaveValue('');
    expect(input('splitPaid-T1')).toHaveValue('100.');
    expect(input('splitCreditReceived-T1')).toHaveValue('120,');
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeDisabled();
    expect(screen.getByText(/Selecciona el cliente registrado que recibirá el fiado de Comensal 1/)).toBeInTheDocument();
  });

  it('explains pending synchronization and retries the same customer without resetting the split', async () => {
    const customer = { id: 'customer-3c', name: 'Cliente QA 3C', phone: '5551234567', debt: 0, creditLimit: 500 };
    saveCustomer.mockResolvedValueOnce({ success: true, pending: true, data: customer })
      .mockResolvedValueOnce({ success: true, data: { ...customer, serverVersion: 1, syncStatus: 'SYNCED' } });
    await setup();
    openQuick();
    const dialog = fillCustomer();
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar Cliente/i }));
    expect(await within(dialog).findByText(/guardado en este dispositivo/i)).toBeInTheDocument();
    expect(input('splitCustomer-T1')).toHaveValue('');
    expectPaymentsIntact();
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar Cliente/i }));
    await waitFor(() => expect(input('splitCustomer-T1')).toHaveValue('customer-3c'));
    expect(saveCustomer).toHaveBeenCalledTimes(2);
    expect(saveCustomer.mock.calls[0][0].id).toBe(saveCustomer.mock.calls[1][0].id);
    expect(saveCustomer.mock.calls[1][1]).toMatchObject({ existingCustomer: { id: 'customer-3c' } });
    expectPaymentsIntact();
  });

  it('does not revive a previous customer selection when an async save finishes after closing and reopening the same order', async () => {
    let resolveSave;
    saveCustomer.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { rerender, props } = await setup();
    openQuick();
    fireEvent.click(within(fillCustomer()).getByRole('button', { name: /Guardar Cliente/i }));
    await waitFor(() => expect(saveCustomer).toHaveBeenCalledOnce());
    rerender(<SplitBillModal {...props} show={false} />);
    rerender(<SplitBillModal {...props} show />);
    await waitFor(() => expect(input('splitCustomer-T1')).toHaveValue(''));
    await act(async () => resolveSave({ success: true, data: { id: 'customer-3c', name: 'Cliente QA 3C', creditLimit: 500, debt: 0 } }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Nuevo cliente/i })).not.toBeInTheDocument());
    expect(input('splitCustomer-T1')).toHaveValue('');
    expect(within(input('splitCustomer-T1')).queryByRole('option', { name: /Cliente QA 3C/ })).not.toBeInTheDocument();
    expect(input('splitPaid-T1')).toHaveValue('0');
  });
});
