// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const { submitIncidentReport, formatIncidentDiagnostic, copyTextToClipboard } = vi.hoisted(() => ({
  submitIncidentReport: vi.fn(),
  formatIncidentDiagnostic: vi.fn(),
  copyTextToClipboard: vi.fn()
}));

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return { Check: Icon, Copy: Icon, Send: Icon };
});

vi.mock('../../../services/diagnostics/incidentReporter', () => ({
  INCIDENT_REPORT_STATUS: {
    NOT_STARTED: 'not_started', READY: 'ready', SENDING: 'sending', SENT: 'sent',
    FAILED: 'failed', OFFLINE: 'offline', UNAVAILABLE: 'unavailable'
  },
  formatIncidentDiagnostic,
  submitIncidentReport
}));

vi.mock('../../../services/diagnostics/recoveryContext', () => ({
  createRecoveryContextGuard: () => () => true
}));

vi.mock('../../../services/support/supportContact', () => ({
  copyTextToClipboard
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ licenseDetails: { license_key: 'LANZO-TEST' } }) }
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
      licenseDetails: { license_key: 'LANZO-TEST' }
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
    expect(await screen.findByText(/Diagnóstico copiado/)).toBeInTheDocument();
    expect(formatIncidentDiagnostic).toHaveBeenCalledWith(incident);
    expect(submitIncidentReport).toHaveBeenCalledTimes(1);
  });
});
