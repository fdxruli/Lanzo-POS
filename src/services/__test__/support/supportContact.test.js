import { describe, expect, it, vi } from 'vitest';
import {
  buildSupportEmailPayload,
  buildSupportMailtoUrl
} from '../../support/supportContact';

describe('supportContact', () => {
  it('construye payload de soporte por correo con contexto comercial', () => {
    vi.setSystemTime(new Date('2026-07-09T12:30:00'));

    const payload = buildSupportEmailPayload({
      licenseDetails: {
        plan_code: 'free_trial',
        plan_name: 'Lanzo Local',
        license_key: 'LZ-123'
      },
      companyProfile: {
        name: 'Abarrotes Centro'
      },
      appVersion: '4.0.0',
      issueType: 'Respaldo local',
      description: 'No encuentro mi carpeta de respaldo.'
    });

    expect(payload.subject).toContain('Respaldo local');
    expect(payload.body).toContain('Plan comercial: Lanzo Local');
    expect(payload.body).toContain('Codigo interno del plan: free_trial');
    expect(payload.body).toContain('Licencia: LZ-123');
    expect(payload.body).toContain('Nombre del negocio: Abarrotes Centro');
    expect(payload.body).toContain('Version de app: 4.0.0');
    expect(payload.body).toContain('Tipo de problema: Respaldo local');
    expect(payload.body).toContain('No encuentro mi carpeta de respaldo.');
  });

  it('construye URL mailto codificada sin abrir canales externos', () => {
    const url = buildSupportMailtoUrl({
      to: 'soporte@example.com',
      subject: 'Ayuda con Lanzo',
      body: 'Linea 1\nLinea 2'
    });

    expect(url).toBe('mailto:soporte@example.com?subject=Ayuda%20con%20Lanzo&body=Linea%201%0ALinea%202');
  });
});
