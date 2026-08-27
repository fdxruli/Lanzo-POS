// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('keeps a small Cuadrada difference neutral', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      monto_cierre: '100.50',
      diferencia: '0.50',
      closingMode: 'admin_audited'
    }]} />);

    const difference = screen.getByText('Dif: +$0.50');
    expect(screen.getByText('Cuadrada')).toBeVisible();
    expect(difference).toHaveClass('history-difference', 'neutral');
    expect(difference).not.toHaveClass('positive', 'negative');
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
    expect(screen.getByText('Dif: $-2.00')).toHaveClass('history-difference', 'negative');
  });
  it('keeps technical history traceability behind Detalles', () => {
    render(<CajaHistoryList historial={[{
      ...baseSession,
      staffUserId: 'staff-123456789',
      actorKey: 'staff:traceable'
    }]} />);

    expect(screen.getByText('Actor: staff:traceable')).not.toBeVisible();
    fireEvent.click(screen.getByText('Detalles'));
    expect(screen.getByText('Actor: staff:traceable')).toBeVisible();
    expect(screen.getByText('Staff ID: staff-12')).toBeVisible();
  });
});
