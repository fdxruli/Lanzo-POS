// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CajaMovementsList from '../CajaMovementsList';

afterEach(cleanup);

const ecommerceMovement = {
  id: 'mov-1',
  tipo: 'venta',
  monto: '31',
  fecha: '2026-07-27T20:00:00.000Z',
  saleId: 'ecom-order-1',
  primaryReference: 'EC-00000115',
  secondaryReference: 'Venta V-000034 · Ecommerce',
  salesChannel: 'ecommerce',
  ecommerceOrderId: 'order-uuid-1',
  ecommerceOrderCode: 'EC-00000115',
  sale: {
    id: 'ecom-order-1',
    folio: 'V-000034',
    salesChannel: 'ecommerce',
    ecommerceOrderId: 'order-uuid-1',
    ecommerceOrderCode: 'EC-00000115'
  }
};

describe('CajaMovementsList ecommerce traceability', () => {
  it('renders one ecommerce movement with separate EC and V references', () => {
    render(<CajaMovementsList movimientos={[ecommerceMovement]} isCloudCash />);

    expect(screen.getByText('EC-00000115')).toBeVisible();
    expect(screen.getByText('Venta V-000034 · Ecommerce')).toBeVisible();
    expect(screen.getByText('+$31.00')).toBeVisible();
    expect(screen.getByText('Ecommerce')).toBeVisible();
    expect(screen.getByText('1 de 1')).toBeVisible();
  });

  it.each([
    'EC-00000115',
    'V-000034',
    'order-uuid-1',
    'ecom-order-1'
  ])('finds the movement by %s', (query) => {
    render(<CajaMovementsList movimientos={[ecommerceMovement]} isCloudCash />);

    fireEvent.change(screen.getByRole('textbox', { name: /buscar movimientos/i }), {
      target: { value: query }
    });

    expect(screen.getByText('EC-00000115')).toBeVisible();
    expect(screen.getByText('1 de 1')).toBeVisible();
  });

  it('keeps a local sale without an ecommerce badge', () => {
    render(<CajaMovementsList movimientos={[{
      id: 'mov-local',
      tipo: 'venta',
      monto: '50',
      fecha: '2026-07-27T20:00:00.000Z',
      sale: {
        id: 'sale-local-1',
        folio: 'V-000035'
      },
      secondaryReference: 'Venta local'
    }]} />);

    expect(screen.getByText('V-000035')).toBeVisible();
    expect(screen.getByText('Venta local')).toBeVisible();
    expect(screen.queryByText('Ecommerce')).not.toBeInTheDocument();
  });

  it('keeps technical movement traceability behind Detalles', () => {
    render(<CajaMovementsList movimientos={[{
      id: 'mov-traceable',
      tipo: 'entrada',
      monto: '10',
      concepto: 'Fondo de cambio',
      fecha: '2026-07-27T20:00:00.000Z',
      staffUserId: 'staff-123456789',
      actorKey: 'staff:traceable',
      origen: 'cash_rpc'
    }]} />);

    expect(screen.getByText('Actor key: staff:traceable')).not.toBeVisible();
    fireEvent.click(screen.getByText('Detalles'));
    expect(screen.getByText('Actor key: staff:traceable')).toBeVisible();
    expect(screen.getByText('Origen: cash_rpc')).toBeVisible();
  });
});
