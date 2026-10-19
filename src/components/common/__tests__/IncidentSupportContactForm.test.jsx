// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import IncidentSupportContactForm from '../IncidentSupportContactForm';

const initialOnline = navigator.onLine;

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return { CheckCheck: Icon, Copy: Icon, Mail: Icon, MessageCircle: Icon, X: Icon };
});

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
  safe_route: '/ventas?token=route-secret',
  app_version: '4.0.0',
  build_commit: 'abcdef1234567',
  browser_family: 'Chrome 126',
  platform: 'Linux',
  network_status: 'online',
  recovery_status: 'detected',
  occurred_at: '2026-10-15T12:00:00.000Z',
  incident_id_internal: '00000000-0000-4000-8000-000000000099',
  customer_name: 'Cliente privado',
  total: 99123.45,
  stack: 'stack-secret',
  message: 'token=message-secret',
  license_key: 'license-secret',
  tenant_id: 'tenant-secret'
});

const openAndPrepare = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
  return screen.findByLabelText('Mensaje preparado para revisar');
};

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: initialOnline });
});

describe('IncidentSupportContactForm', () => {
  it('CONTACT-04/05: offers only manual channels and has no remote submission controls or transport imports', () => {
    const { container } = render(
      <IncidentSupportContactForm incident={incident} isContextCurrent={() => true} />
    );
    const source = readFileSync(
      `${process.cwd()}/src/components/common/IncidentSupportContactForm.jsx`,
      'utf8'
    );

    expect(screen.getByRole('radio', { name: /Telegram/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Correo electrónico/ })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Enviar reporte|Enviar diagnóstico|Registrar incidencia/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /consentimiento|Supabase|registrar/i })).not.toBeInTheDocument();
    expect(source).not.toMatch(/submitIncidentReport|submit_technical_incident_report|INCIDENT_REPORT_STATUS|supabaseClient|\.rpc\(/);
    expect(container.querySelector('form')).toBeNull();
  });

  it('CONTACT-06/10/23: previews a readable allowlisted message without private incident properties', async () => {
    render(<IncidentSupportContactForm incident={incident} isContextCurrent={() => true} />);

    const preview = await openAndPrepare();
    expect(preview.value).toContain('Hola, soporte de Lanzo POS.');
    expect(preview.value).toContain('Código del problema: INCIDENT_REACT_RENDER');
    expect(preview.value).toContain('Sección: /ventas');
    expect(preview.value).toContain('Categoría: Render de interfaz');
    expect(preview.value).toContain('Versión de Lanzo: 4.0.0');
    expect(preview.value).toContain('Conexión: En línea');
    expect(preview.value).not.toMatch(/\{|\}|"schema_version"|00000000-0000|Cliente privado|99123\.45|stack-secret|message-secret|license-secret|tenant-secret|route-secret/);
    expect(preview).toHaveAttribute('readonly');
  });

  it('CONTACT-08/09: excludes the description by default and requires a separate opt-in', async () => {
    render(<IncidentSupportContactForm incident={incident} isContextCurrent={() => true} />);
    const description = 'Estaba abriendo Ventas cuando apareció el error.';
    fireEvent.change(screen.getByLabelText('Describe qué ocurrió'), { target: { value: description } });
    const includeDescription = screen.getByRole('checkbox', { name: 'Incluir esta descripción en el borrador' });
    expect(includeDescription).not.toBeChecked();

    const firstPreview = await openAndPrepare();
    expect(firstPreview.value).not.toContain(description);

    fireEvent.click(includeDescription);
    expect(screen.queryByLabelText('Mensaje preparado para revisar')).not.toBeInTheDocument();
    const secondPreview = await openAndPrepare();
    expect(secondPreview.value).toContain(`Descripción:\n${description}`);
  });

  it('CONTACT-11/12/24: opens user-controlled Telegram options or an email draft without claiming delivery', async () => {
    render(<IncidentSupportContactForm incident={incident} isContextCurrent={() => true} />);
    await openAndPrepare();
    const telegram = screen.getByRole('link', { name: 'Abrir opciones de Telegram' });
    const telegramUrl = new URL(telegram.href);
    expect(telegramUrl.pathname).toBe('/share/url');
    expect(telegramUrl.searchParams.get('text')).toContain('INCIDENT_REACT_RENDER');
    fireEvent.click(telegram);
    expect(await screen.findByRole('status')).toHaveTextContent(/elige el destinatario.*abrirla no confirma el envío/i);

    fireEvent.click(screen.getByRole('radio', { name: /Correo electrónico/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const email = screen.getByRole('link', { name: 'Abrir correo' });
    const emailHref = email.getAttribute('href');
    const emailParams = new URLSearchParams(emailHref.slice(emailHref.indexOf('?') + 1));
    expect(emailHref).toMatch(/^mailto:lanzocontacto@gmail\.com\?/);
    expect(emailParams.get('subject')).toMatch(/Ayuda con un problema en Lanzo POS/);
    expect(emailParams.get('body')).toContain('Código del problema: INCIDENT_REACT_RENDER');
    fireEvent.click(email);
    expect(await screen.findByRole('status')).toHaveTextContent(/abrirlo no confirma el envío/i);
  });

  it('CONTACT-13/14: reports real clipboard success and keeps a selectable manual fallback', async () => {
    const copyText = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(
      <IncidentSupportContactForm
        incident={incident}
        isContextCurrent={() => true}
        services={{ copyText }}
      />
    );

    const preview = await openAndPrepare();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Mensaje copiado.*Todavía no se ha enviado/i);
    expect(copyText).toHaveBeenCalledWith(preview.value);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    await waitFor(() => expect(preview).toHaveFocus());
    expect(preview.selectionStart).toBe(0);
    expect(preview.selectionEnd).toBe(preview.value.length);
    expect(screen.getByRole('status')).toHaveTextContent(/cópialo manualmente/i);
  });

  it('CONTACT-15/16: invalidates stale context and remains usable offline without a persistent queue', async () => {
    let current = true;
    const guard = () => current;
    const { rerender } = render(
      <IncidentSupportContactForm incident={incident} isContextCurrent={guard} />
    );
    await openAndPrepare();

    current = false;
    rerender(<IncidentSupportContactForm incident={incident} isContextCurrent={guard} />);
    await waitFor(() => expect(screen.queryByLabelText('Mensaje preparado para revisar')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/negocio o la sesión cambió/i);

    cleanup();
    const previousOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const offlineView = render(
      <IncidentSupportContactForm incident={incident} isContextCurrent={() => true} />
    );
    expect(screen.getByRole('note')).toHaveTextContent(/Sin conexión.*preparar y copiar/i);
    await openAndPrepare();
    expect(screen.getByRole('button', { name: 'Copiar mensaje' })).toBeEnabled();
    expect(screen.queryByText(/Mensaje enviado|Enviando reporte|cola pendiente/i)).not.toBeInTheDocument();
    offlineView.unmount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: previousOnline });
  });
});
