// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return { AlertTriangle: Icon, X: Icon, Send: Icon, Check: Icon, Copy: Icon };
});

import AdminIncidentNotice from '../AdminIncidentNotice';
import {
  captureAsyncIncidentNotice,
  resetAsyncIncidentNoticesForTests
} from '../../../services/diagnostics/incidentEventCenter';

describe('AdminIncidentNotice', () => {
  afterEach(() => {
    cleanup();
    resetAsyncIncidentNoticesForTests();
  });

  it('keeps unknown async errors out of the admin shell', () => {
    captureAsyncIncidentNotice(new Error('browser extension warning'), {
      source: 'unhandledrejection',
      now: 1
    });
    render(<AdminIncidentNotice />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a quiet, dismissible message with safe details for a relevant async failure', () => {
    captureAsyncIncidentNotice(
      Object.assign(new Error('license_key=secret-value'), { code: 'DB_OPEN_TIMEOUT' }),
      {
        source: 'window.error',
        pathname: '/configuracion?token=secret',
        now: 10
      }
    );
    render(<AdminIncidentNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('El almacenamiento local requiere revisión');
    const detailsId = screen.getByRole('button', { name: 'Detalles del problema' }).getAttribute('aria-controls');
    expect(document.getElementById(detailsId)).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Detalles del problema' }));
    expect(screen.getByText('DB_OPEN_TIMEOUT')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-value');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso de incidencia' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses an assertive notice only for an explicitly ambiguous financial result', () => {
    captureAsyncIncidentNotice(
      Object.assign(new Error('payment outcome unknown'), { code: 'PAYMENT_OUTCOME_UNKNOWN' }),
      {
        source: 'unhandledrejection',
        pathname: '/caja',
        now: 1
      }
    );
    render(<AdminIncidentNotice />);
    expect(screen.getByRole('alert')).toHaveTextContent('Necesitamos verificar una operación');
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa el recibo antes de volver a intentarla');
  });
});
