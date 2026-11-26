// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaHistoryList from '../CajaHistoryList';

afterEach(cleanup);

const baseSession = {
  id: 'closed-cash',
  fecha_apertura: '2026-08-14T10:00:00.000Z',
  fecha_cierre: '2026-08-14T11:00:00.000Z',
  estado: 'cerrada',
  responsable_apertura: 'Administradora',
  cloudCash: true
};

describe('CajaHistoryList', () => {
  it('distinguishes local and Cloud history and navigates past 100 cuts', async () => {
    const rows = Array.from({ length: 102 }, (_, index) => ({
      ...baseSession, id: `cut-${index}`, responsable_apertura: `Responsable ${index}`
    }));
    const readCashHistory = vi.fn().mockResolvedValue({ success: true, cashSessions: rows });
    render(<CajaHistoryList historial={rows.slice(0, 50)} isCloudCash readCashHistory={readCashHistory} />);
    expect(screen.getByText(/vista local de los cortes/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar historial Cloud' }));
    await screen.findByText('Historial Cloud consultado.');
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    }
    expect(screen.getByText('Página 11 de 11')).toBeVisible();
    expect(screen.getByText('Responsable 101')).toBeVisible();
  });

  it('does not present a deferred empty Cloud history as absence of cuts', async () => {
    const readCashHistory = vi.fn().mockResolvedValue({ success: true, cashSessions: [], syncDeferred: true });
    render(<CajaHistoryList historial={[]} isCloudCash readCashHistory={readCashHistory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar historial Cloud' }));
    expect(await screen.findByText('No se pudo confirmar si existen más cortes.')).toBeVisible();
    expect(screen.queryByText('No hay historial de cortes registrados.')).not.toBeInTheDocument();
  });

  it('does not offer a Cloud query when read only', () => {
    const readCashHistory = vi.fn();
    render(<CajaHistoryList historial={[]} isCloudCash isReadOnly readCashHistory={readCashHistory} />);
    expect(screen.getByRole('button', { name: 'Cloud no disponible' })).toBeDisabled();
    expect(screen.getByText('No hay cortes en la vista local.')).toBeVisible();
    expect(readCashHistory).not.toHaveBeenCalled();
  });

  it('does not present an unverified closure as a zero-difference closure', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      monto_cierre: null,
      diferencia: null,
      closingMode: 'admin_unverified'
    }]} />);

    expect(screen.getByText('Sin conteo')).toBeVisible();
    expect(screen.getByText('Cierre: No contado')).toBeVisible();
    expect(screen.getByText('Dif: No calculada')).toBeVisible();
    expect(screen.queryByText('Cuadrada')).not.toBeInTheDocument();
  });

  it('keeps zero as a valid audited physical count', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      monto_cierre: '0',
      diferencia: '0',
      closingMode: 'admin_audited'
    }]} />);

    expect(screen.getByText('Cuadrada')).toBeVisible();
    expect(screen.getByText('Cierre: $0.00')).toBeVisible();
    const difference = screen.getByText('Dif: $0.00');
    expect(difference).toHaveClass('history-difference', 'neutral');
    expect(difference).not.toHaveClass('positive', 'negative');
  });

  it('keeps opening confirmation and next-shift fund separate in the session detail', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      monto_inicial: '1000',
      monto_conteo_inicial: '1000',
      monto_fondo_sugerido: 0,
      diferencia_apertura: '1000',
      monto_cierre: '140',
      diferencia: '0',
      monto_fondo_siguiente_turno: '50'
    }]} />);

    fireEvent.click(screen.getByText('Detalles'));
    expect(screen.getByText('Contado al abrir: $1000.00')).toBeVisible();
    expect(screen.getByText('Fondo de referencia al abrir: $0.00')).toBeVisible();
    expect(screen.getByText('Diferencia de apertura respecto al fondo de referencia: $1000.00')).toBeVisible();
    expect(screen.getByText('Cierre: $140.00')).toBeVisible();
    expect(screen.getByText('Fondo declarado para el siguiente turno: $50.00')).toBeVisible();
  });

  it.each([
    ['one-cent shortage', '-0.01', '99.99', '-$0.01', 'negative'],
    ['fifty-cent shortage', '-0.50', '99.50', '-$0.50', 'negative'],
    ['one-cent surplus', '0.01', '100.01', '+$0.01', 'positive'],
    ['fifty-cent surplus', '0.50', '100.50', '+$0.50', 'positive']
  ])('flags a %s as a real discrepancy', (_label, difference, counted, formattedDifference, tone) => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      monto_cierre: counted,
      diferencia: difference,
      closingMode: 'admin_audited'
    }]} />);

    expect(screen.getByText('Descuadre')).toBeVisible();
    expect(screen.getByText(`Dif: ${formattedDifference}`)).toHaveClass('history-difference', tone);
  });

  it('keeps real positive and negative differences toned by direction', () => {
    const { rerender } = render(<CajaHistoryList historial={[{
      ...baseSession,
      id: 'positive-difference',
      monto_cierre: '102',
      diferencia: '2',
      closingMode: 'admin_audited'
    }]} />);

    expect(screen.getByText('Descuadre')).toBeVisible();
    expect(screen.getByText('Dif: +$2.00')).toHaveClass('history-difference', 'positive');

    rerender(<CajaHistoryList historial={[{
      ...baseSession,
      id: 'negative-difference',
      monto_cierre: '98',
      diferencia: '-2',
      closingMode: 'admin_audited'
    }]} />);

    expect(screen.getByText('Descuadre')).toBeVisible();
    expect(screen.getByText('Dif: -$2.00')).toHaveClass('history-difference', 'negative');
  });
  it('shows a safe station label without exposing technical identifiers', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      opening_device_name: 'Caja mostrador',
      staffUserId: 'staff-123456789',
      actorKey: 'staff:traceable'
    }]} />);

    expect(screen.getByText('Estación: Caja mostrador')).toBeVisible();
    expect(screen.queryByText('Actor: staff:traceable')).not.toBeInTheDocument();
    expect(screen.queryByText('Staff ID: staff-12')).not.toBeInTheDocument();
    expect(screen.getByText('Detalles')).toBeVisible();
    fireEvent.click(screen.getByText('Detalles'));
    expect(screen.queryByText('staff-123456789')).not.toBeInTheDocument();
    expect(screen.queryByText('staff:traceable')).not.toBeInTheDocument();
  });
});
