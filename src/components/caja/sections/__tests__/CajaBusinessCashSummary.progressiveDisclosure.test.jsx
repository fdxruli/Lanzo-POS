// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CajaBusinessCashSummary from '../CajaBusinessCashSummary';

afterEach(cleanup);

describe('CajaBusinessCashSummary progressive disclosure', () => {
  it('keeps each station amount and safe operational labels separate', () => {
    render(
      <CajaBusinessCashSummary
        cajaActual={{ id: 'cash-admin', actor_key: 'admin:one', device_name: 'Caja mostrador' }}
        adminOpenSessions={[
          {
            id: 'cash-admin',
            status: 'open',
            actor_key: 'admin:one',
            responsible_name: 'Ana',
            device_name: 'Caja mostrador',
            expected_cash_total: '150'
          },
          {
            id: 'cash-admin-2',
            status: 'open',
            actor_key: 'admin:one',
            responsible_name: 'Ana',
            device_name: 'Terminal 2',
            expected_cash_total: '275'
          }
        ]}
      />
    );

    expect(screen.getByText('Cajas abiertas por estación')).toBeVisible();
    expect(screen.getByText('2 estaciones abiertas')).toBeVisible();
    expect(screen.getByText('Caja mostrador')).toBeVisible();
    expect(screen.getByText('Terminal 2')).toBeVisible();
    expect(screen.getByText('$150.00')).toBeVisible();
    expect(screen.getByText('$275.00')).toBeVisible();
    expect(screen.getByText(/Cada caja mantiene su monto separado/)).toBeVisible();
    expect(screen.queryByText('$425.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Resumen consolidado')).not.toBeInTheDocument();
  });
});
