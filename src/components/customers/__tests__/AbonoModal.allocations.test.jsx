// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const dbRead = vi.hoisted(() => vi.fn());
vi.mock('../../../services/db/dexie', () => ({ db: { sales: { where: dbRead } } }));
vi.mock('../../../services/customerMessaging', () => import('../../../services/customerMessaging/normalizers'));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({ useDismissibleHistoryLayer: () => vi.fn() }));
import AbonoModal from '../AbonoModal';
afterEach(() => { cleanup(); dbRead.mockClear(); });
const props = { show: true, customer: { id: 'c', name: 'Synthetic', debt: 20 },
  onClose: vi.fn(), onConfirmAbono: vi.fn(), isCloudCredit: true };
describe('Cloud payment allocation authority', () => {
  it('blocks specific assignment while server balances are unavailable and never reads local sales', () => {
    render(<AbonoModal {...props} />);
    expect(screen.getByRole('checkbox', { name: /Asignar a notas/ }).disabled).toBe(true);
    expect(dbRead).not.toHaveBeenCalled();
  });
  it('treats an authoritative empty pending list as empty, even with a local cache', () => {
    render(<AbonoModal {...props} authoritativePendingSales={[]} cloudAllocationStatus="reconciled" />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Asignar a notas/ }));
    expect(screen.getByText('No hay notas pendientes.')).toBeTruthy();
    expect(dbRead).not.toHaveBeenCalled();
  });
  it('explains that historical payments cannot be assigned to notes', () => {
    render(<AbonoModal {...props} authoritativePendingSales={[]} cloudAllocationStatus="historical_unallocated" />);
    expect(screen.getByRole('checkbox', { name: /Asignar a notas/ }).disabled).toBe(true);
    expect(screen.getByText(/Hay abonos históricos sin conciliar/)).toBeTruthy();
  });
  it('submits only the selected trusted sale and its amount', async () => {
    const confirm = vi.fn().mockResolvedValue({ success: true });
    render(<AbonoModal {...props} onConfirmAbono={confirm} cloudAllocationStatus="reconciled"
      authoritativePendingSales={[{id:'sale-b',folio:'B',saldoPendiente:'15',timestamp:'2026-01-01'}]} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Asignar a notas/ }));
    fireEvent.change(document.querySelector('.allocation-input'), {target:{value:'5'}});
    fireEvent.submit(screen.getByRole('button', { name: /Registrar|Confirmar|Abonar/ }).closest('form'));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][3]).toEqual([{saleId:'sale-b',amountApplied:'5'}]);
  });
});
