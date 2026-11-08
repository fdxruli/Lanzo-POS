// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
            opened_by_device_name: 'Terminal 2',
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

  it('highlights the requested aged session and keeps the existing review action', () => {
    const session = {
      id: 'cash-target',
      status: 'open',
      actor_key: 'admin:one',
      opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      device_name: 'Caja objetivo'
    };
    const onReviewSession = vi.fn();

    render(
      <CajaBusinessCashSummary
        adminOpenSessions={[session]}
        attentionSessionId="cash-target"
        onReviewSession={onReviewSession}
      />
    );

    const row = screen.getByText('Caja objetivo').closest('article');
    expect(row).toHaveClass('business-cash-session--needs-review');
    expect(row).toHaveClass('business-cash-session--attention-target');
    expect(screen.getByText(/Requiere revisión/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(onReviewSession).toHaveBeenCalledWith(session);
  });
});
