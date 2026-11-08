// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CajaMovementsList from '../CajaMovementsList';

afterEach(cleanup);

const movements = [
  { id: 'cash-sale', tipo: 'venta_efectivo', monto: '20', concepto: 'Venta en efectivo' },
  { id: 'cash-payment', tipo: 'abono_cliente', monto: '10', concepto: 'Abono recibido en efectivo' },
  { id: 'card-sale', tipo: 'venta_tarjeta', monto: '30', concepto: 'Venta con tarjeta' },
  { id: 'cash-refund', tipo: 'cancelacion_venta', monto: '20', concepto: 'Cancelación de venta' },
  { id: 'credit-refund', tipo: 'cancelacion_abono_inicial', monto: '5', concepto: 'Cancelación de abono inicial' },
  { id: 'deleted-sale', tipo: 'venta_eliminada', monto: '6', concepto: 'Venta eliminada' },
  { id: 'waste', tipo: 'merma', monto: '2', concepto: 'Merma de producto' }
];

const setFilter = (value) => fireEvent.change(
  screen.getByRole('combobox', { name: 'Filtrar por tipo de movimiento' }),
  { target: { value } }
);

describe('CajaMovementsList cash movement semantics', () => {
  it('filters only real cash inflows as entradas', () => {
    render(<CajaMovementsList movimientos={movements} isCloudCash />);

    setFilter('entrada');

    expect(screen.getByText('2 de 7')).toBeVisible();
    expect(screen.getByText('cash-sale')).toBeVisible();
    expect(screen.getByText('Abono recibido en efectivo')).toBeVisible();
    expect(screen.queryByText('card-sale')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelación de venta')).not.toBeInTheDocument();
  });

  it('shows PRO cash reversals as negative salida movements', () => {
    render(<CajaMovementsList movimientos={movements} isCloudCash />);

    setFilter('salida');

    expect(screen.getByText('2 de 7')).toBeVisible();
    expect(screen.getByText('Devolución en efectivo')).toBeVisible();
    expect(screen.getByText('Devolución de abono')).toBeVisible();
    expect(screen.getByText('-$20.00')).toBeVisible();
    expect(screen.getByText('-$5.00')).toBeVisible();
    expect(screen.queryByText('Venta con tarjeta')).not.toBeInTheDocument();
  });

  it('keeps non-cash sales and informational records out of cash totals', () => {
    render(<CajaMovementsList movimientos={movements} isCloudCash />);

    setFilter('sin_efecto_efectivo');

    expect(screen.getByText('3 de 7')).toBeVisible();
    expect(screen.getByText('$30.00')).toBeVisible();
    expect(screen.queryByText('+$30.00')).not.toBeInTheDocument();
    expect(screen.getByText('Tarjeta/Transf.')).toBeVisible();
    expect(screen.getAllByText('Venta eliminada')).toHaveLength(2);
    expect(screen.getByText('Merma')).toBeVisible();
  });
});
