// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SalesHistory from '../SalesHistory';

afterEach(cleanup);

describe('SalesHistory ecommerce references', () => {
  it('renders EC as the primary reference and V as a separate secondary line', () => {
    window.innerWidth = 320;
    render(
      <SalesHistory
        sales={[{
          id: 'sale-1',
          folio: 'V-000034',
          salesChannel: 'ecommerce',
          ecommerceOrderId: '11111111-1111-4111-8111-111111111111',
          ecommerceOrderCode: 'EC-00000115',
          timestamp: '2026-07-27T20:00:00.000Z',
          status: 'closed',
          total: 31,
          items: []
        }]}
      />
    );

    const primary = screen.getByText('EC-00000115');
    const secondary = screen.getByText('Venta V-000034 · Ecommerce');
    expect(primary).toHaveClass('sale-folio-tag');
    expect(secondary).toHaveClass('sale-reference-secondary');
    expect(primary).not.toContainElement(secondary);
    expect(screen.getByText('$31.00')).toBeVisible();
    expect(screen.getByText('Ecommerce')).toBeVisible();
  });

  it('keeps report rows readable while hiding cancellation actions without refunds', () => {
    render(
      <SalesHistory
        sales={[{
          id: 'sale-report-only',
          folio: 'V-000036',
          timestamp: '2026-07-27T20:00:00.000Z',
          status: 'closed',
          total: 31,
          items: []
        }]}
        canManageRefunds={false}
      />
    );

    expect(screen.getByText('V-000036')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Cancelar venta/i })).not.toBeInTheDocument();
  });

  it('shows the existing cancellation action when refunds authority is explicit', () => {
    render(
      <SalesHistory
        sales={[{
          id: 'sale-refunds',
          folio: 'V-000037',
          timestamp: '2026-07-27T20:00:00.000Z',
          status: 'closed',
          total: 31,
          items: []
        }]}
        canManageRefunds
      />
    );

    expect(screen.getByRole('button', { name: /Cancelar venta/i })).toBeEnabled();
  });

  it('keeps a local V folio as the only sale reference', () => {
    render(
      <SalesHistory
        sales={[{
          id: 'sale-2',
          folio: 'V-000035',
          timestamp: '2026-07-27T20:00:00.000Z',
          status: 'closed',
          total: 31,
          items: []
        }]}
      />
    );

    expect(screen.getByText('V-000035')).toBeVisible();
    expect(screen.queryByText(/Venta V-000035/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ecommerce')).not.toBeInTheDocument();
  });
});
