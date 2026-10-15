// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentReportEntry from '../IncidentReportEntry';

const incident = Object.freeze({
  schema_version: 1,
  incident_id: '00000000-0000-4000-8000-000000000001',
  correlation_id: '00000000-0000-4000-8000-000000000002',
  fingerprint: 'v1-0123456789abcdef0123456789abcdef',
  source: 'react_boundary',
  category: 'react_render',
  severity: 'section_failure',
  safe_code: 'INCIDENT_REACT_RENDER',
  module: 'ventas',
  safe_route: '/ventas',
  app_version: '4.0.0',
  build_commit: 'abcdef1234567',
  browser_family: 'Chrome 126',
  platform: 'Linux',
  network_status: 'online',
  recovery_status: 'detected',
  occurred_at: '2026-10-15T12:00:00.000Z'
});

describe('IncidentReportEntry', () => {
  it('loads the report form only after the user opens it', async () => {
    render(<IncidentReportEntry incident={incident} isContextCurrent={() => true} />);

    expect(screen.getByRole('button', { name: 'Reportar problema' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Enviar diagnóstico técnico' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));

    expect(await screen.findByRole('heading', { name: 'Enviar diagnóstico técnico' })).toBeTruthy();
    expect(screen.getByText(/El reporte requiere internet y tu confirmación/)).toBeTruthy();
  });
});
