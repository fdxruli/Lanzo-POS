// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
  });
});
