// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import IncidentReportEntry from '../IncidentReportEntry';

const incident = Object.freeze({
  incident_id: '00000000-0000-4000-8000-000000000001',
  safe_code: 'INCIDENT_REACT_RENDER',
  category: 'react_render',
  safe_route: '/ventas'
});

describe('IncidentReportEntry', () => {
  it('is an accessible disclosure trigger and does not mount the technical reporter', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <IncidentReportEntry
        incident={incident}
        controlsId="incident-report-region-test"
        onToggle={onToggle}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Reportar problema' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'incident-report-region-test');
    expect(screen.queryByRole('button', { name: 'Enviar reporte' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <IncidentReportEntry
        incident={incident}
        open
        controlsId="incident-report-region-test"
        onToggle={onToggle}
      />
    );
    expect(screen.getByRole('button', { name: 'Cerrar reporte' })).toHaveAttribute('aria-expanded', 'true');
  });
});
