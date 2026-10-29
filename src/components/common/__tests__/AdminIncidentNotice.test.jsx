// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const contextMocks = vi.hoisted(() => ({ isCurrent: true }));

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return {
    AlertTriangle: Icon,
    X: Icon,
    Send: Icon,
    Check: Icon,
    CheckCheck: Icon,
    Copy: Icon,
    Mail: Icon,
    MessageCircle: Icon
  };
});

vi.mock('../../../services/diagnostics/recoveryContext', () => ({
  createRecoveryContextGuard: () => () => contextMocks.isCurrent
}));

import AdminIncidentNotice from '../AdminIncidentNotice';
import {
  captureAsyncIncidentNotice,
  resetAsyncIncidentNoticesForTests
} from '../../../services/diagnostics/incidentEventCenter';

const initialOnline = navigator.onLine;
const initialClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const captureLocalIncident = () => captureAsyncIncidentNotice(
  Object.assign(new Error('license_key=secret-value'), { code: 'DB_OPEN_TIMEOUT' }),
  { source: 'window.error', pathname: '/ventas', now: 10 }
);

const openReport = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Detalles del problema' }));
  const reportTrigger = screen.getByRole('button', { name: 'Reportar problema' });
  fireEvent.click(reportTrigger);
  await screen.findByRole('region', { name: 'Reportar un problema' });
  return reportTrigger;
};

const openAndPrepareMessage = async () => {
  await openReport();
  fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
  return screen.findByLabelText('Mensaje preparado para revisar');
};

describe('AdminIncidentNotice', () => {
  afterEach(() => {
    cleanup();
    resetAsyncIncidentNoticesForTests();
    contextMocks.isCurrent = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: initialOnline });
    if (initialClipboard) {
      Object.defineProperty(navigator, 'clipboard', initialClipboard);
    } else {
      delete navigator.clipboard;
    }
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

  it('opens, prepares and copies manual support offline, then closes and restores focus', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    captureLocalIncident();
    render(<AdminIncidentNotice />);

    const reportTrigger = await openReport();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Reportar un problema' })).toHaveFocus());
    expect(screen.getByRole('radio', { name: /telegram/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /correo electrónico/i })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/sin conexión.*preparar y copiar/i);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enviar reporte|registrar incidencia/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const preview = await screen.findByLabelText('Mensaje preparado para revisar');
    expect(preview.value).toContain('Código del problema: DB_OPEN_TIMEOUT');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.value));
    expect(screen.getByText(/mensaje copiado.*todavía no se ha enviado/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /correo electrónico/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const emailDraft = await screen.findByRole('link', { name: 'Abrir correo' });
    expect(emailDraft.getAttribute('href')).toMatch(/^mailto:lanzocontacto@gmail\.com\?/);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar reporte' }));
    expect(document.getElementById(reportTrigger.getAttribute('aria-controls'))).toHaveAttribute('hidden');
    await waitFor(() => expect(reportTrigger).toHaveFocus());
  });

  it('rejects a prepared message after the actor or tenant context changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    captureLocalIncident();
    render(<AdminIncidentNotice />);
    await openAndPrepareMessage();

    contextMocks.isCurrent = false;
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));

    expect(await screen.findByText(/el negocio o la sesión cambió/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Mensaje preparado para revisar')).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('uses an assertive notice only for an explicitly ambiguous financial result and keeps reporting unavailable', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Detalles del problema' }));
    expect(screen.queryByRole('button', { name: /reportar problema/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reportar un problema' })).not.toBeInTheDocument();
  });
});
