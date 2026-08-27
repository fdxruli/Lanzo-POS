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
  device_id: 'Caja Samsung',
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

    expect(screen.getByRole('article').querySelector('.staff-audit-item-header strong')).toHaveTextContent('Ana García');
    expect(screen.getByText('abierta')).toBeVisible();
    expect(screen.getByText('Apertura')).toBeVisible();
    expect(screen.getByText('$3450.00')).toBeVisible();
    expect(screen.getByText('Diferencia')).toBeVisible();
    expect(screen.getByText('$0.00')).toBeVisible();
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
    expect(screen.getByText('Caja Samsung')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(onReviewSession).toHaveBeenCalledWith(staffSession);
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