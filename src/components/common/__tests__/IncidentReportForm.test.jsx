// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const {
  submitIncidentReport,
  formatIncidentDiagnostic,
  copyTextToClipboard,
  createSupportTicket,
  requestAdminUpdate
} = vi.hoisted(() => ({
  submitIncidentReport: vi.fn(),
  formatIncidentDiagnostic: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createSupportTicket: vi.fn(),
  requestAdminUpdate: vi.fn()
}));

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return { Check: Icon, Copy: Icon, Send: Icon, Mail: Icon, MessageCircle: Icon };
});

vi.mock('../../../services/diagnostics/incidentReporter', () => ({
  INCIDENT_REPORT_STATUS: {
    NOT_STARTED: 'not_started', READY: 'ready', SENDING: 'sending', SENT: 'sent',
    FAILED: 'failed', OFFLINE: 'offline', UNAVAILABLE: 'unavailable'
  },
  formatIncidentDiagnostic,
  formatIncidentChannelSummary: ({ incident: record, reportReference, receiptConfirmed }) => (
    `Lanzo POS · ${receiptConfirmed ? reportReference : 'diagnóstico local no registrado'} · ${record?.safe_code || 'INCIDENT_UNKNOWN'} · ${record?.category || 'unknown'} · /caja`
  ),
  submitIncidentReport
}));

vi.mock('../../../services/diagnostics/recoveryContext', () => ({
  createRecoveryContextGuard: () => () => true
}));

vi.mock('../../../services/support/supportContact', () => ({
  copyTextToClipboard,
  getSupportEmail: () => 'lanzocontacto@gmail.com',
  buildSupportMailtoUrl: ({ to, subject, body }) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}));

vi.mock('../../../services/support/telegramContact', () => ({
  TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS: 'unverified',
  TELEGRAM_USERNAME: 'LanzoPOS_Oficial',
  buildTelegramSupportTarget: () => ({
    kind: 'channel_reference',
    status: 'DIRECT_TELEGRAM_SUPPORT_UNVERIFIED',
    username: 'LanzoPOS_Oficial',
    url: 'https://t.me/LanzoPOS_Oficial',
    preparedMessageIncluded: false
  })
}));

vi.mock('../../../services/support/supportTicketService', () => ({
  createSupportTicket
}));

vi.mock('../../../pwa/adminServiceWorker', () => ({
  requestAdminUpdate
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ licenseDetails: { license_key: 'LANZO-TEST', plan_code: 'free_trial' } }) }
}));

import IncidentReportForm from '../IncidentReportForm';

const incident = {
  incident_id: '00000000-0000-4000-8000-000000000001',
  correlation_id: '00000000-0000-4000-8000-000000000002',
  safe_code: 'DB_BLOCKED',
  category: 'indexeddb'
};

describe('IncidentReportForm', () => {
  beforeEach(() => {
    submitIncidentReport.mockReset();
    formatIncidentDiagnostic.mockReset().mockReturnValue('safe local diagnosis');
    copyTextToClipboard.mockReset().mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('explains the fields and requires voluntary consent before sending', async () => {
    submitIncidentReport.mockResolvedValue({ status: 'sent', reportReference: 'IR-0011223344556677' });
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));

    const submitButton = await screen.findByRole('button', { name: 'Enviar reporte' });
    expect(screen.getByText(/no se sanitiza automáticamente/i)).toBeInTheDocument();
    expect(screen.getByText(/No se incluyen licencias, tokens, cookies/i)).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Describe qué ocurrió (opcional)'), {
      target: { value: 'Sección no abrió después de iniciar sesión' }
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Lanzo recibió el reporte\. Folio: IR-0011223344556677/)).toBeInTheDocument();
    expect(submitIncidentReport).toHaveBeenCalledWith(incident, expect.objectContaining({
      consent: true,
      userDescription: 'Sección no abrió después de iniciar sesión',
      licenseDetails: { license_key: 'LANZO-TEST', plan_code: 'free_trial' }
    }));
  });

  it('offers a local copy path even if the server has no receipt', async () => {
    submitIncidentReport.mockResolvedValue({ status: 'unavailable', code: 'INCIDENT_REPORTING_UNAVAILABLE' });
    render(<IncidentReportForm incident={incident} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    const copyButton = await screen.findByRole('button', { name: 'Copiar diagnóstico' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(await screen.findByText(/servicio para recibir reportes todavía no está disponible/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/Lanzo recibió el reporte/i)).not.toBeInTheDocument();
    fireEvent.click(copyButton);
    expect(await screen.findByText(/Diagnóstico local copiado/)).toBeInTheDocument();
    expect(formatIncidentDiagnostic).toHaveBeenCalledWith(incident);
    expect(submitIncidentReport).toHaveBeenCalledTimes(1);
  });

  it('TG-07: confirms the message copy only after the clipboard helper succeeds', async () => {
    copyTextToClipboard.mockResolvedValueOnce(true);
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar mensaje' }));

    expect(screen.queryByText(/Mensaje copiado\./)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    expect(await screen.findByText(/Mensaje copiado\. Revísalo y compártelo manualmente/)).toBeInTheDocument();
  });

  it('TG-08: keeps a selectable text alternative when clipboard access fails', async () => {
    copyTextToClipboard.mockResolvedValueOnce(false);
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar mensaje' }));
    const messageField = screen.getByLabelText('Mensaje preparado para revisar y copiar');

    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    expect(await screen.findByText(/Selecciona el texto del campo y cópialo manualmente/)).toBeInTheDocument();
    expect(messageField).toHaveFocus();
    expect(messageField.selectionStart).toBe(0);
    expect(messageField.selectionEnd).toBe(messageField.value.length);
  });

  it('TG-09/11/13/16/17: channel reference opening never confirms delivery or sends a report', async () => {
    const previousOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
      fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
      const prepareButton = await screen.findByRole('button', { name: 'Preparar mensaje' });
      fireEvent.click(prepareButton);
      fireEvent.click(prepareButton);

      const telegramLink = screen.getByRole('link', { name: 'Abrir canal oficial' });
      expect(telegramLink.href).toBe('https://t.me/LanzoPOS_Oficial');
      expect(new URL(telegramLink.href).pathname).not.toBe('/share/url');
      fireEvent.click(telegramLink);
      expect(await screen.findByText(/Sin conexión\. No se envió el reporte/)).toBeInTheDocument();
      expect(screen.getByText(/Se abrirá el canal público de Lanzo.*usa correo electrónico para contactar a soporte/)).toBeInTheDocument();
      expect(screen.getByText(/mensajes directos están no verificados/i)).toBeInTheDocument();
      expect(submitIncidentReport).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: previousOnline });
    }
  });

  it('TG-10 and TG-11: labels the channel as unverified and offers the existing email fallback', async () => {
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar mensaje' }));

    expect(screen.getByText(/mensajes directos están no verificados/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir canal oficial' }))
      .toHaveAttribute('href', 'https://t.me/LanzoPOS_Oficial');
    expect(screen.getByRole('link', { name: 'Abrir correo de soporte' }).getAttribute('href'))
      .toMatch(/^mailto:lanzocontacto@gmail\.com\?/);
    expect(submitIncidentReport).not.toHaveBeenCalled();
  });

  it('TG-12: invalidates a confirmed folio when the actor context changes', async () => {
    let contextCurrent = true;
    const guard = () => contextCurrent;
    submitIncidentReport.mockResolvedValueOnce({ status: 'sent', reportReference: 'IR-0011223344556677' });
    render(<IncidentReportForm incident={incident} isContextCurrent={guard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(await screen.findByText(/Folio: IR-0011223344556677/)).toBeInTheDocument();

    contextCurrent = false;
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    expect(screen.getByText(/No se preparó el mensaje/)).toBeInTheDocument();
    expect(screen.getByText(/Este folio ya no se comparte/)).toBeInTheDocument();
    expect(screen.queryByText(/Folio: IR-0011223344556677/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mensaje preparado para revisar y copiar')).not.toBeInTheDocument();
  });

  it('TG-14: clipboard failures are isolated from the recovery form', async () => {
    copyTextToClipboard.mockRejectedValueOnce(new Error('token=synthetic-secret'));
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar diagnóstico' }));

    expect(await screen.findByText(/No se pudo copiar automáticamente/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar mensaje' })).toBeInTheDocument();
    expect(screen.queryByText(/synthetic-secret/)).not.toBeInTheDocument();
  });

  it('TG-15: keeps the form theme-token based and responsive', () => {
    const css = readFileSync(`${process.cwd()}/src/components/common/IncidentReportForm.css`, 'utf8');
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} openOnMount />);

    expect(screen.getByRole('region', { name: 'Reporte técnico de incidencia' })).toBeInTheDocument();
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('var(--text-color)');
    expect(css).toContain('var(--card-background-color)');
  });

  it('TG-16 and TG-18: Local users get technical communication without tickets, payment, or PWA actions', async () => {
    const componentSource = readFileSync(`${process.cwd()}/src/components/common/IncidentReportForm.jsx`, 'utf8');
    const communicationSource = readFileSync(`${process.cwd()}/src/services/diagnostics/incidentCommunication.js`, 'utf8');
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar mensaje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));

    expect(await screen.findByText(/Mensaje copiado/)).toBeInTheDocument();
    expect(createSupportTicket).not.toHaveBeenCalled();
    expect(submitIncidentReport).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /reintentar pago|actualizar aplicación/i })).not.toBeInTheDocument();
    expect(requestAdminUpdate).not.toHaveBeenCalled();
    expect(componentSource + communicationSource).not.toMatch(/processPayment|createSale|confirmPayment|requestAdminUpdate|skipWaiting/);
  });

  it('TG-17: exposes status and communication errors to assistive technology', async () => {
    copyTextToClipboard.mockResolvedValueOnce(false);
    render(<IncidentReportForm incident={incident} isContextCurrent={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar mensaje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));

    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(await screen.findByText(/Selecciona el texto del campo y cópialo manualmente/))
      .toHaveAttribute('aria-live', 'polite');
    expect(screen.getByLabelText('Mensaje preparado para revisar y copiar')).toHaveAttribute('readonly');
  });
});
