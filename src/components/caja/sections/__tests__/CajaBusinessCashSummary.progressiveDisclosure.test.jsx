// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CajaBusinessCashSummary from '../CajaBusinessCashSummary';

afterEach(cleanup);

describe('CajaBusinessCashSummary progressive disclosure', () => {
  it('keeps the total and distribution visible while collapsing component detail', () => {
    render(
      <CajaBusinessCashSummary
        cajaActual={{ id: 'cash-admin', actor_key: 'admin:one' }}
        adminOpenSessions={[
          {
            id: 'cash-admin',
            status: 'open',
            actor_key: 'admin:one',
            responsible_name: 'Ana',
            expected_cash_total: '150',
            opening_amount: '100',
            cash_sales_total: '40',
            customer_payments_total: '20',
            cash_entries_total: '10',
            cash_exits_total: '20'
          }
        ]}
      />
    );

    expect(screen.getByText('Efectivo del negocio')).toBeVisible();
    screen.getAllByText('$150.00').forEach((element) => expect(element).toBeVisible());
    expect(screen.getByText('Mi caja')).toBeVisible();
    expect(screen.getByText('1 abiertas')).toBeVisible();
    expect(screen.getByText('Fondo inicial')).not.toBeVisible();

    fireEvent.click(screen.getByText(/Ver composici.n del efectivo/));
    expect(screen.getByText('Fondo inicial')).toBeVisible();
    expect(screen.getByText('$100.00')).toBeVisible();
  });
});
