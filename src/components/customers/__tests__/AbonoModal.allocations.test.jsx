// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
const dbRead = vi.hoisted(() => vi.fn());
vi.mock('../../../services/db/dexie', () => ({ db: { sales: { where: dbRead } } }));
vi.mock(
  '../../../services/customerMessaging',
  () => import('../../../services/customerMessaging/normalizers')
);
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));
import AbonoModal from '../AbonoModal';
const customer = { id: 'c', name: 'Cliente controlado', debt: '30' };
const notes = ['A', 'B'].map((id) => ({
  id,
  customer_id: 'c',
  folio: id,
  status: 'closed',
  total: 20,
  original_balance_due: 20,
  balance_due: 20,
  current_balance_due: 15,
  credit_allocation_status: 'reconciled',
  saldoPendiente: '20',
  timestamp: '2026-01-01',
  payment_method: 'credit'
}));
let confirm, close;
const open = (extra = {}) =>
  render(
    <AbonoModal
      show
      customer={customer}
      onClose={close}
      onConfirmAbono={confirm}
      isCloudCredit
      authoritativePendingSales={notes}
      cloudAllocationStatus="reconciled"
      {...extra}
    />
  );
const specific = () => fireEvent.click(screen.getByRole('radio', { name: 'Abonar por venta / nota' }));
const general = () => fireEvent.click(screen.getByRole('radio', { name: 'Abono general' }));
const setNote = (folio, value) => {
  const summary = screen.getByText(`Nota ${folio}`).closest('summary');
  if (!summary.parentElement.open) fireEvent.click(summary);
  fireEvent.change(screen.getByLabelText(`Abono a la nota ${folio}`), { target: { value } });
};
const submit = () => screen.getByRole('button', { name: 'Confirmar abono' });
beforeEach(() => {
  confirm = vi.fn().mockResolvedValue({ success: true });
  close = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('payment modalities and financial UI boundaries', () => {
  it('defaults to a general payment and preserves the existing callback contract', async () => {
    open();
    expect(screen.getByRole('radio', { name: 'Abono general' }).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '5' } });
    expect(screen.getByLabelText('Total a confirmar').textContent).toBe('$5.00');
    fireEvent.click(submit());
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(customer, '5', true, null));
  });
  it('assigns only the chosen verified note and shows original/live amounts and totals', async () => {
    open();
    specific();
    setNote('B', '5');
    expect(screen.getAllByText('Importe original')).toHaveLength(2);
    const values = screen.getByText('Nota B').closest('details').querySelector('dl');
    expect(values.textContent).toContain('Importe original$20.00');
    expect(values.textContent).toContain('Saldo vigente$15.00');
    expect(screen.getByText('Total asignado · 1 nota')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Usar $15.00' })).toHaveLength(2);
    expect(screen.getByLabelText('Total a confirmar').textContent).toBe('$5.00');
    fireEvent.click(submit());
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(customer, '5', true, [{ saleId: 'B', amountApplied: '5' }])
    );
  });
  it('supports multiple selected notes without changing their original amounts', async () => {
    open();
    specific();
    setNote('A', '5');
    setNote('B', '10');
    expect(screen.getByText('Total asignado · 2 notas')).toBeTruthy();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(customer, '15', true, [
        { saleId: 'A', amountApplied: '5' },
        { saleId: 'B', amountApplied: '10' }
      ])
    );
  });
  it('clears note assignments when returning to general while preserving its typed amount', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '7' } });
    specific();
    setNote('A', '5');
    general();
    fireEvent.click(submit());
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(customer, '7', true, null));
  });
  it('lets the user select the historical modality and explains its financial block', () => {
    open({ cloudAllocationStatus: 'historical_unallocated', authoritativePendingSales: [] });
    expect(screen.getByRole('radio', { name: 'Abonar por venta / nota' }).disabled).toBe(false);
    specific();
    expect(screen.getByText('Estas notas aún no están conciliadas')).toBeTruthy();
    expect(screen.getByText(/no tienen una asignación verificable por venta/)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    expect(screen.queryByText('No hay notas pendientes')).toBeNull();
    expect(dbRead).not.toHaveBeenCalled();
    general();
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '5' } });
    expect(submit().disabled).toBe(false);
  });
  it('distinguishes a loading summary from a confirmed empty list', () => {
    open({ cloudAllocationStatus: 'loading', authoritativePendingSales: null });
    specific();
    expect(screen.getByText('Consultando notas en Cloud…')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    expect(screen.queryByText('No hay notas pendientes')).toBeNull();
    expect(dbRead).not.toHaveBeenCalled();
  });
  it('treats a verified empty list as empty without consulting stale local notes', () => {
    open({ authoritativePendingSales: [] });
    specific();
    expect(screen.getByText('No hay notas pendientes')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    expect(dbRead).not.toHaveBeenCalled();
  });
  it('shows a query error and offers a read-only retry', () => {
    const retry = vi.fn();
    open({ cloudAllocationStatus: 'error', authoritativePendingSales: [], onReloadPendingSales: retry });
    specific();
    expect(screen.getByText('No pudimos cargar las notas')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a consultar notas' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not accept a cached balance or a null Cloud live balance as verified', () => {
    open({ authoritativePendingSales: [{ ...notes[0], current_balance_due: null, saldoPendiente: '20' }] });
    specific();
    expect(screen.getByText('No hay saldos por nota verificados')).toBeTruthy();
    expect(screen.queryByLabelText('Abono a la nota A')).toBeNull();
    expect(submit().disabled).toBe(true);
  });
  it('rejects an amount above a note balance instead of silently changing it', () => {
    open();
    specific();
    setNote('A', '21');
    expect(screen.getByLabelText('Abono a la nota A').value).toBe('21');
    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest('form'));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('rejects a total above a refreshed customer debt even when each note permits the amount', () => {
    open({ customer: { ...customer, debt: '20' } });
    specific();
    setNote('A', '15');
    setNote('B', '15');
    expect(screen.getByText(/El total asignado supera la deuda/)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest('form'));
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '31', '0.001'])('does not confirm invalid general amount %s', (value) => {
    open();
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value } });
    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest('form'));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('prevents two confirmations and freezes close/mode changes while pending', async () => {
    let finish;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    open();
    specific();
    setNote('A', '5');
    const form = submit().closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Confirmando el abono/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar abono' }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: 'Abono general' }).matches(':disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish({ success: true }));
    expect(screen.getByRole('radio', { name: 'Abono general' }).disabled).toBe(false);
  });
  it('keeps the pending lock across a parent-driven close and reopen', async () => {
    let finish;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = open();
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '5' } });
    fireEvent.submit(submit().closest('form'));
    view.rerender(
      <AbonoModal show={false} customer={customer} onClose={close} onConfirmAbono={confirm} isCloudCredit />
    );
    view.rerender(
      <AbonoModal show customer={customer} onClose={close} onConfirmAbono={confirm} isCloudCredit />
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Registrando abono…' }).closest('form'));
    expect(confirm).toHaveBeenCalledOnce();
    await act(async () => finish({ success: true }));
  });
  it('preserves the receipt choice and existing cash/permission block', async () => {
    const view = open({ isBlocked: true, blockedReason: 'Abre tu caja para continuar.' });
    expect(screen.getByRole('alert').textContent).toContain('Abre tu caja');
    expect(submit().disabled).toBe(true);
    view.rerender(
      <AbonoModal show customer={customer} onClose={close} onConfirmAbono={confirm} isCloudCredit />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ofrecer comprobante como imagen al terminar' }));
    fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '5' } });
    fireEvent.click(submit());
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(customer, '5', false, null));
  });
  it('keeps Local note reads local without requiring Cloud markers', async () => {
    dbRead.mockReturnValue({
      equals: () => ({
        and: () => ({
          sortBy: () =>
            Promise.resolve([
              {
                id: 'L',
                customerId: 'c',
                folio: 'L',
                total: 20,
                saldoPendiente: '20',
                paymentMethod: 'fiado',
                timestamp: '2026-01-01'
              }
            ])
        })
      })
    });
    open({ isCloudCredit: false, authoritativePendingSales: null });
    specific();
    await screen.findByText('Nota L');
    setNote('L', '5');
    fireEvent.click(submit());
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(customer, '5', true, [{ saleId: 'L', amountApplied: '5' }])
    );
  });
});
