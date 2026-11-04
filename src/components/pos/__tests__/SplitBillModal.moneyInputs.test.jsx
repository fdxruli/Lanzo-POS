// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SplitBillModal from '../SplitBillModal';

const { loadData, tenantStorage } = vi.hoisted(() => ({
  loadData: vi.fn(async () => []),
  tenantStorage: new Map()
}));

vi.mock('../../../services/database', () => ({
  loadData: (...args) => loadData(...args),
  saveDataSafe: vi.fn(),
  DB_ERROR_CODES: { DUPLICATE_CUSTOMER_PHONE: 'DUPLICATE_CUSTOMER_PHONE' },
  STORES: { CUSTOMERS: 'customers' }
}));
vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ ready: true, opaqueId: 'tenant-money-test' }),
  getTenantStorageItem: (key) => tenantStorage.get(key) ?? null,
  setTenantStorageItem: (key, value) => tenantStorage.set(key, value),
  removeTenantStorageItem: (key) => tenantStorage.delete(key)
}));

const renderModal = (total = 300, overrides = {}) => {
  const onConfirm = vi.fn(async () => ({ success: true }));
  const view = render(<SplitBillModal
    show
    order={[{ lineId: 'money-order', id: 'shared', name: 'Cuenta compartida', quantity: 1, price: total }]}
    total={total}
    orderId="money-drafts"
    onClose={vi.fn()}
    onConfirm={onConfirm}
    {...overrides}
  />);
  return { ...view, onConfirm };
};
const startCustom = () => {
  fireEvent.click(screen.getByRole('radio', { name: /Ingresar montos personalizados/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
  return document.getElementById('splitCustomAmount-T1');
};
const startEqualPayment = () => {
  fireEvent.click(screen.getByRole('radio', { name: /Dividir el total en partes iguales/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Distribuir importe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Configurar cobro' }));
};

describe('SplitBillModal monetary text editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantStorage.clear();
    loadData.mockResolvedValue([{ id: 'customer-1', name: 'Cliente registrado', creditLimit: 1000, debt: 0 }]);
  });
  afterEach(() => cleanup());

  it('keeps each typed character, trailing decimal, caret and every backspace through an empty draft', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = startCustom();
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'decimal');
    await user.clear(input);
    for (const [key, expected] of [['1', '1'], ['5', '15'], ['0', '150'], ['.', '150.'], ['9', '150.9'], ['9', '150.99']]) {
      await user.type(input, key);
      expect(input).toHaveValue(expected);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(expected.length);
    }
    await user.type(input, '9');
    expect(input).toHaveValue('150.99');
    for (const expected of ['150.9', '150.', '150', '15', '1', '']) {
      await user.keyboard('{Backspace}');
      expect(input).toHaveValue(expected);
    }
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeDisabled();
    await user.type(input, '120');
    expect(input).toHaveValue('120');
  });

  it('accepts paste in either decimal format, ignores invalid paste and wheel, and normalizes only on blur', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = startCustom();
    for (const draft of ['99.95', '99,95']) {
      await user.clear(input);
      await user.paste(draft);
      expect(input).toHaveValue(draft);
      fireEvent.wheel(input, { deltaY: 100 });
      expect(input).toHaveValue(draft);
      fireEvent.blur(input);
      expect(input).toHaveValue('99.95');
    }
    await user.clear(input);
    await user.paste('150.999');
    expect(input).toHaveValue('');
    for (const invalid of ['-', '+', 'e', 'E', 'abc', '..', ',,']) {
      await user.paste(invalid);
      expect(input).toHaveValue('');
    }
    await user.type(input, '150.');
    expect(input).toHaveValue('150.');
    fireEvent.blur(input);
    expect(input).toHaveValue('150.00');
  });

  it('preserves the selected guest drafts when adding and removing another person', () => {
    renderModal();
    const first = startCustom();
    fireEvent.change(first, { target: { value: '150,' } });
    fireEvent.change(document.getElementById('splitCustomAmount-T2'), { target: { value: '150' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.change(screen.getByLabelText('¿Cuántas personas?'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('150,');
    expect(document.getElementById('splitCustomAmount-T2')).toHaveValue('150');
    expect(document.getElementById('splitCustomAmount-T3')).toHaveValue('0.00');
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.change(screen.getByLabelText('¿Cuántas personas?'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('150,');
    expect(document.getElementById('splitCustomAmount-T2')).toHaveValue('150');
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeEnabled();
  });

  it('retains the strategy confirmation, then clears old monetary drafts on switching strategies', () => {
    renderModal();
    const first = startCustom();
    fireEvent.change(first, { target: { value: '150.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.click(screen.getByRole('radio', { name: /Dividir el total en partes iguales/ }));
    const confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /Conservar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('150.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.click(screen.getByRole('radio', { name: /Dividir el total en partes iguales/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Cambiar/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Ingresar montos personalizados/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('0.00');
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeDisabled();
  });

  it('keeps the cash contract and exact change after comma editing, and blocks a required empty amount', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal(200);
    startEqualPayment();
    const input = document.getElementById('splitPaid-T1');
    expect(input).toHaveValue('100.00');
    await user.clear(input);
    expect(input).toHaveValue('');
    fireEvent.blur(input);
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeDisabled();
    await user.type(input, '120,50');
    expect(input).toHaveValue('120,50');
    expect(input.closest('.split-payment-card')).toHaveTextContent('Aplicado a caja: $100.00 · Cambio: $20.50');
    fireEvent.wheel(input, { deltaY: -100 });
    expect(input).toHaveValue('120,50');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0][0].tickets[0].paymentData).toMatchObject({
      paymentMethod: 'efectivo', amountPaid: '120.5', receivedAmount: '120.5'
    });
  });

  it('resolves Fiado drafts to exact abono, balance and cash received while blocking insufficient cash', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal(500);
    startEqualPayment();
    fireEvent.change(document.getElementById('splitPaymentMethod-T1'), { target: { value: 'fiado' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cliente registrado' })).toBeInTheDocument());
    fireEvent.change(document.getElementById('splitCustomer-T1'), { target: { value: 'customer-1' } });
    const paid = document.getElementById('splitPaid-T1');
    expect(paid).toHaveAttribute('type', 'text');
    expect(paid).toHaveAttribute('inputMode', 'decimal');
    await user.clear(paid);
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeEnabled();
    await user.type(paid, '100,');
    expect(paid).toHaveValue('100,');
    const received = document.getElementById('splitCreditReceived-T1');
    expect(received).toHaveAttribute('type', 'text');
    expect(received).toHaveAttribute('inputMode', 'decimal');
    await user.clear(received);
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeDisabled();
    await user.type(received, '99');
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeDisabled();
    await user.clear(received);
    await user.type(received, '120');
    expect(received).toHaveValue('120');
    expect(received.closest('.split-payment-card')).toHaveTextContent('Cambio del abono: $20.00');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
    expect(document.querySelector('.split-review-card')).toHaveTextContent('Abono $100.00 mediante efectivo · Saldo pendiente $150.00');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0][0].tickets[0]).toMatchObject({
      amountCents: 25000,
      paymentData: { paymentMethod: 'fiado', amountPaid: '100', receivedAmount: '120', customerId: 'customer-1' }
    });
  });

  it('persists only safe canonical distribution and never transient payment drafts', async () => {
    renderModal(200);
    startEqualPayment();
    fireEvent.change(document.getElementById('splitPaid-T1'), { target: { value: '150,' } });
    await waitFor(() => expect(tenantStorage.size).toBeGreaterThan(0));
    const draft = [...tenantStorage.values()][0];
    expect(draft).toContain('equal_payment');
    expect(draft).not.toContain('150,');
    expect(draft).not.toContain('amountPaid');
    expect(draft).not.toContain('receivedAmount');
    expect(draft).not.toContain('customAmountDrafts');
  });

  it('does not revive a custom share that was cleared before closing', async () => {
    const props = {
      order: [{ lineId: 'cleared-draft', id: 'shared', name: 'Cuenta compartida', quantity: 1, price: 300 }],
      total: 300, orderId: 'cleared-draft', onClose: vi.fn(), onConfirm: vi.fn()
    };
    const view = render(<SplitBillModal show {...props} />);
    const input = startCustom();
    fireEvent.change(input, { target: { value: '150.99' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    await waitFor(() => expect([...tenantStorage.values()][0]).toContain('"customAmountsCents":[0,0]'));
    view.rerender(<SplitBillModal show={false} {...props} />);
    view.rerender(<SplitBillModal show {...props} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Se restauró el borrador local'));
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('0.00');
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeDisabled();
  });

  it('explicitly treats an empty optional Fiado abono as zero in the payload', async () => {
    const { onConfirm } = renderModal(500);
    startEqualPayment();
    fireEvent.change(document.getElementById('splitPaymentMethod-T1'), { target: { value: 'fiado' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cliente registrado' })).toBeInTheDocument());
    fireEvent.change(document.getElementById('splitCustomer-T1'), { target: { value: 'customer-1' } });
    fireEvent.change(document.getElementById('splitPaid-T1'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0][0].tickets[0].paymentData).toMatchObject({ amountPaid: '0', receivedAmount: '0' });
  });

  it('discards an unresolved cash received draft when clearing the Fiado abono makes it inapplicable', async () => {
    const { onConfirm } = renderModal(500);
    startEqualPayment();
    fireEvent.change(document.getElementById('splitPaymentMethod-T1'), { target: { value: 'fiado' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cliente registrado' })).toBeInTheDocument());
    fireEvent.change(document.getElementById('splitCustomer-T1'), { target: { value: 'customer-1' } });
    fireEvent.change(document.getElementById('splitPaid-T1'), { target: { value: '100' } });
    fireEvent.change(document.getElementById('splitCreditReceived-T1'), { target: { value: '.' } });
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeDisabled();
    fireEvent.change(document.getElementById('splitPaid-T1'), { target: { value: '' } });
    expect(document.getElementById('splitCreditReceived-T1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0][0].tickets[0].paymentData).toMatchObject({ amountPaid: '0', receivedAmount: '0' });
  });
});
