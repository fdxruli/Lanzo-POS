// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaAdminCashAuditModal from '../CajaAdminCashAuditModal';

afterEach(cleanup);

const detail = {
  success: true,
  cashSession: {
    id: 'cash-1196',
    status: 'open',
    responsible_name: 'Caja sintetica',
    opened_at: '2026-08-14T10:00:00.000Z',
    opening_amount: '100',
    cash_sales_total: '1000',
    customer_payments_total: '96',
    cash_entries_total: '0',
    cash_exits_total: '0',
    expected_cash_total: '1196',
    server_version: 4,
    sales_count: 2
  },
  movements: [{ id: 'move-1', type: 'venta_efectivo', amount: '1000', concept: 'Venta sintetica', created_at: '2026-08-14T10:10:00.000Z' }],
  auditEvents: [{ id: 'audit-1', event_type: 'OPENED', actor_name: 'Administrador', created_at: '2026-08-14T10:00:00.000Z' }]
};

const renderModal = (overrides = {}) => {
  const getDetail = vi.fn().mockResolvedValue(detail);
  const closeAdmin = vi.fn().mockResolvedValue({ success: true });
  render(<CajaAdminCashAuditModal cashSessionId="cash-1196" onClose={vi.fn()} getCashSessionDetailForAudit={getDetail} cerrarCajaAdministrativamente={closeAdmin} {...overrides} />);
  return { getDetail, closeAdmin };
};

describe('CajaAdminCashAuditModal', () => {
  it('loads one selected session on demand and renders movements/events', async () => {
    const { getDetail } = renderModal();
    await screen.findByText('Caja sintetica');
    expect(getDetail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(/movimientos \(1\)/i));
    expect(screen.getByText(/Venta sintetica/)).toBeVisible();
    expect(screen.getByText(/OPENED/)).toBeVisible();
  });

  it('requires a physical count for audited close and previews the correct difference', async () => {
    renderModal();
    await screen.findByText('Caja sintetica');
    fireEvent.click(screen.getByText(/conte fisicamente/i));
    expect(screen.getByRole('button', { name: /revisar confirmacion/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/efectivo contado/i), { target: { value: '1180' } });
    expect(screen.getByText(/\$-16\.00/)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: 'operational_error' } });
    expect(screen.getByRole('button', { name: /revisar confirmacion/i })).toBeEnabled();
  });

  it('represents unverified close with unavailable count and undetermined difference', async () => {
    renderModal();
    await screen.findByText('Caja sintetica');
    fireEvent.click(screen.getByText(/no existe un conteo/i));
    expect(screen.getByText(/Conteo: No disponible/i)).toBeVisible();
    expect(screen.getByText(/Diferencia: No determinada/i)).toBeVisible();
    expect(screen.queryByLabelText(/efectivo contado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$-1196\.00/)).not.toBeInTheDocument();
  });

  it('requires a reason/comment for unverified and sends null money fields', async () => {
    const { closeAdmin } = renderModal();
    await screen.findByText('Caja sintetica');
    fireEvent.click(screen.getByText(/no existe un conteo/i));
    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: 'historical_test' } });
    expect(screen.getByRole('button', { name: /revisar confirmacion/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/comentarios/i), { target: { value: 'No existe conteo fisico verificable.' } });
    fireEvent.click(screen.getByRole('button', { name: /revisar confirmacion/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar cierre administrativo/i }));
    await waitFor(() => expect(closeAdmin).toHaveBeenCalledWith(expect.objectContaining({ closingMode: 'admin_unverified', countedAmount: null, nextShiftFund: null })));
  });

  it('uses a new idempotency key and refreshed version after a confirmed conflict', async () => {
    const onClose = vi.fn();
    const closeAdmin = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        code: 'VERSION_CONFLICT',
        response: {
          cash_session: {
            ...detail.cashSession,
            server_version: 5,
            expected_cash_total: '1200'
          }
        }
      })
      .mockResolvedValueOnce({ success: true });
    renderModal({ onClose, cerrarCajaAdministrativamente: closeAdmin });

    await screen.findByText('Caja sintetica');
    fireEvent.click(screen.getByText(/conte fisicamente/i));
    fireEvent.change(screen.getByLabelText(/efectivo contado/i), { target: { value: '1180' } });
    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: 'operational_error' } });
    fireEvent.click(screen.getByRole('button', { name: /revisar confirmacion/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar cierre administrativo/i }));

    await waitFor(() => expect(closeAdmin).toHaveBeenCalledTimes(1));
    const firstAttempt = closeAdmin.mock.calls[0][0];
    expect(firstAttempt).toMatchObject({ expectedVersion: 4 });
    expect(screen.getByText(/actualizamos los datos/i)).toBeVisible();
    expect(screen.getByText(/\$1200\.00/)).toBeVisible();
    expect(screen.getByText(/\$-20\.00/)).toBeVisible();
    expect(screen.getByRole('button', { name: /revisar confirmacion/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /revisar confirmacion/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar cierre administrativo/i }));

    await waitFor(() => expect(closeAdmin).toHaveBeenCalledTimes(2));
    const secondAttempt = closeAdmin.mock.calls[1][0];
    expect(secondAttempt).toMatchObject({ expectedVersion: 5 });
    expect(secondAttempt.idempotencyKey).not.toBe(firstAttempt.idempotencyKey);
    expect(onClose).toHaveBeenCalledWith({ closed: true });
  });
});
