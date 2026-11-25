// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaStaffAuditPanel from '../CajaStaffAuditPanel';

afterEach(cleanup);

const staffSession = {
  id: 'staff-session-1',
  status: 'open',
  fecha_apertura: '2026-08-26T08:02:00.000Z',
  fecha_cierre: null,
  responsible_name: 'Ana García',
  staff_display_name: 'Ana García',
  opened_by_device_name: 'Caja Samsung',
  monto_inicial: '500',
  entradas_efectivo: '300',
  salidas_efectivo: '150',
  abonos_fiado: '200',
  expected_cash_total: '3450',
  diferencia: '0',
  movements_count: 18
};

describe('CajaStaffAuditPanel progressive disclosure', () => {
  it('keeps primary audit fields visible and secondary metrics behind Detalles', async () => {
    const listCashSessionsForAudit = vi.fn().mockResolvedValue({ cashSessions: [staffSession] });
    const onReviewSession = vi.fn();

    render(
      <CajaStaffAuditPanel
        adminCashSessions={[staffSession]}
        listCashSessionsForAudit={listCashSessionsForAudit}
        onReviewSession={onReviewSession}
      />
    );

    await waitFor(() => expect(listCashSessionsForAudit).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('article').querySelector('.staff-audit-item-header strong')).toHaveTextContent('Caja Samsung');
    expect(screen.getByText('abierta')).toBeVisible();
    expect(screen.getByText('Apertura')).toBeVisible();
    expect(screen.getByText('$3,450.00')).toBeVisible();
    expect(screen.getByText('Diferencia de cierre')).toBeVisible();
    expect(screen.getByText('No calculada')).toBeVisible();
    expect(screen.getByText('Pendiente de conteo físico')).toBeVisible();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByText('18')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeVisible();

    expect(screen.getByText('Cierre')).not.toBeVisible();
    expect(screen.getByText('Monto inicial')).not.toBeVisible();
    expect(screen.getByText('Dispositivo')).not.toBeVisible();

    fireEvent.click(screen.getByText('Detalles'));

    expect(screen.getByText('Cierre')).toBeVisible();
    expect(screen.getByText('Monto inicial')).toBeVisible();
    expect(screen.getByText('$500.00')).toBeVisible();
    expect(screen.getByText('Entradas')).toBeVisible();
    expect(screen.getByText('$300.00')).toBeVisible();
    expect(screen.getByText('Salidas')).toBeVisible();
    expect(screen.getByText('$150.00')).toBeVisible();
    expect(screen.getByText('Abonos/clientes')).toBeVisible();
    expect(screen.getByText('Dispositivo')).toBeVisible();
    expect(screen.getAllByText('Caja Samsung')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(onReviewSession).toHaveBeenCalledWith(staffSession);
  });

  it('shows net cash sales alongside the existing totals for an open admin session', async () => {
    const adminSession = {
      ...staffSession,
      id: 'admin-open-session',
      staff_display_name: undefined,
      responsible_name: 'Administradora',
      opened_by_device_name: 'Chrome en Linux',
      monto_inicial: '1000',
      ventas_efectivo: 65,
      entradas_efectivo: '0',
      salidas_efectivo: '0',
      abonos_fiado: '70',
      expected_cash_total: undefined
    };
    const listCashSessionsForAudit = vi.fn().mockResolvedValue({ cashSessions: [adminSession] });
    const onReviewSession = vi.fn();

    render(<CajaStaffAuditPanel
      adminCashSessions={[adminSession]}
      listCashSessionsForAudit={listCashSessionsForAudit}
      onReviewSession={onReviewSession}
    />);

    await screen.findByText(/^Actualizado:/);
    expect(screen.getByRole('article').querySelector('.staff-audit-item-header strong')).toHaveTextContent('Chrome en Linux');
    expect(screen.getByText('Responsable: Administradora')).toBeVisible();
    expect(screen.getByText('No calculada')).toBeVisible();
    expect(screen.getByText('Efectivo esperado').parentElement).toHaveTextContent('$1,135.00');

    const details = screen.getByText('Detalles');
    fireEvent.click(details);

    for (const [label, value] of [
      ['Monto inicial', '$1,000.00'],
      ['Ventas en efectivo netas', '$65.00'],
      ['Entradas', '$0.00'],
      ['Salidas', '$0.00'],
      ['Abonos/clientes', '$70.00']
    ]) {
      const field = screen.getByText(label).parentElement;
      expect(field).toBeVisible();
      expect(field).toHaveTextContent(value);
    }

    fireEvent.click(details);
    expect(screen.getByText('Ventas en efectivo netas')).not.toBeVisible();
    expect(screen.getByText('Efectivo esperado').parentElement).toHaveTextContent('$1,135.00');
    expect(listCashSessionsForAudit).toHaveBeenCalledTimes(1);
    expect(onReviewSession).not.toHaveBeenCalled();
  });

  it.each([
    ['a real zero', { ventas_efectivo: 0 }, '$0.00'],
    ['a null value', { ventas_efectivo: null }, 'No disponible'],
    ['an absent value', {}, 'No disponible'],
    ['a negative canonical total', { cash_sales_total: '-25.50' }, '-$25.50']
  ])('shows %s in the net cash sales detail', (_case, salesFields, expectedValue) => {
    render(<CajaStaffAuditPanel adminCashSessions={[{ ...staffSession, ...salesFields }]} />);

    fireEvent.click(screen.getByText('Detalles'));

    const label = screen.getByText('Ventas en efectivo netas');
    expect(label).toBeVisible();
    expect(label.parentElement.querySelector('strong').textContent).toBe(expectedValue);
  });

  it('distinguishes missing audit values from a real zero count and difference', () => {
    render(<CajaStaffAuditPanel adminCashSessions={[
      { ...staffSession, diferencia: null, movements_count: undefined },
      {
        ...staffSession,
        id: 'admin-session',
        staff_display_name: undefined,
        responsible_name: 'Administradora',
        status: 'closed',
        monto_cierre: '0',
        diferencia: 0,
        cash_difference: '50',
        movements_count: 0
      }
    ]} />);

    expect(screen.getByText('No calculada')).toBeVisible();
    expect(screen.getByText('Movimientos').parentElement).toHaveTextContent('No disponible');
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar auditoria por estado'), { target: { value: 'closed' } });
    expect(screen.getByText('Responsable: Administradora')).toBeVisible();
    expect(screen.getByText('$0.00')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText(/según el resumen de la sesión/i)).toBeVisible();
  });

  it('loads more than 100 sessions with the same query and rejects overlap', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ ...staffSession, id: `session-${index}` }));
    const second = [{ ...staffSession, id: 'session-100' }, { ...staffSession, id: 'session-101' }];
    const listCashSessionsForAudit = vi.fn()
      .mockResolvedValueOnce({ success: true, cashSessions: first, source: 'cloud', nextOffset: 100 })
      .mockResolvedValueOnce({ success: true, cashSessions: second, source: 'cloud', nextOffset: 102 })
      .mockResolvedValueOnce({ success: true, cashSessions: [second[0]], source: 'cloud', nextOffset: null });
    render(<CajaStaffAuditPanel listCashSessionsForAudit={listCashSessionsForAudit} />);
    const more = await screen.findByRole('button', { name: 'Cargar más cajas' });
    expect(screen.getAllByRole('article')).toHaveLength(100);
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(102));
    const [firstCall, secondCall] = listCashSessionsForAudit.mock.calls.map(([query]) => query);
    expect(secondCall).toEqual({ ...firstCall, offset: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más cajas' }));
    await screen.findByText(/la lista cambió/i);
    expect(screen.getAllByRole('article')).toHaveLength(102);
    expect(screen.queryByRole('button', { name: 'Cargar más cajas' })).not.toBeInTheDocument();
  });

  it('preserves the manual refresh and read-only review behavior', async () => {
    const listCashSessionsForAudit = vi.fn().mockResolvedValue({ cashSessions: [staffSession] });
    const onReviewSession = vi.fn();

    const { unmount } = render(
      <CajaStaffAuditPanel
        adminCashSessions={[staffSession]}
        listCashSessionsForAudit={listCashSessionsForAudit}
      />
    );

    await waitFor(() => expect(listCashSessionsForAudit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(listCashSessionsForAudit).toHaveBeenCalledTimes(2));
    unmount();

    render(
      <CajaStaffAuditPanel
        adminCashSessions={[staffSession]}
        listCashSessionsForAudit={listCashSessionsForAudit}
        isReadOnly
        onReviewSession={onReviewSession}
      />
    );

    expect(screen.getByRole('button', { name: 'Sin conexion' })).toBeDisabled();
    expect(onReviewSession).not.toHaveBeenCalled();
  });
});
