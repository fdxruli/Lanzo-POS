// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabLoadBoundary from '../LabLoadBoundary';
import IncidentRecoveryQaGallery from '../../components/common/IncidentRecoveryQaGallery';
import { createIncidentLabAdapters, createLabFault, QA_LABEL } from '../incidentLabAdapters';
import { normalizeBackendError } from '../../services/diagnostics/incidentCapture';

// These are tripwires, not replacement implementations. Any production
// dependency being loaded by a scenario is an immediate architecture failure.
vi.mock('../../services/supabase', () => { throw new Error('QA imported commercial Supabase'); });
vi.mock('../../store/useAppStore', () => { throw new Error('QA imported commercial store'); });
vi.mock('../../services/sync/posSyncClient', () => { throw new Error('QA imported commercial auth'); });
const tripwires = {};
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  tripwires.fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Remote transport forbidden'));
  tripwires.storage = vi.spyOn(Storage.prototype, 'setItem');
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs intentional fixture exceptions.
});
afterEach(() => {
  cleanup();
  expect(tripwires.fetch).not.toHaveBeenCalled();
  expect(tripwires.storage).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
const mount = () => render(<IncidentRecoveryQaGallery/>, { container: document.getElementById('root') });
const selectScenario = (id) => fireEvent.change(screen.getByLabelText('Tipo de incidencia'), { target: { value: id } });
const provoke = () => fireEvent.click(screen.getByRole('button', { name: /Provocar error de componente|Generar incidencia controlada/ }));
const openForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
  return screen.findByRole('heading', { name: 'Reportar un problema' });
};
const useMemory = () => fireEvent.change(screen.getByLabelText('Portapapeles'), { target: { value: 'memory' } });

describe('QA-ERROR / QA-UX real components', () => {
  it('preserves critical isolation under development StrictMode lifecycle replay', () => {
    render(<StrictMode><IncidentRecoveryQaGallery/></StrictMode>, { container: document.getElementById('root') });
    selectScenario('QA-03'); provoke();
    expect(screen.getByRole('alertdialog', { name: 'Necesitamos verificar esta operación' })).toBeVisible();
    expect(document.getElementById('root').inert).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salir de la prueba' }));
    expect(document.getElementById('root').inert).toBe(false);
  });
  it('keeps a visible QA load failure instead of silently navigating away', () => {
    function FailedDependency() { throw new Error('Dynamic QA dependency unavailable'); }
    render(<LabLoadBoundary><FailedDependency/></LabLoadBoundary>);
    expect(screen.getByRole('heading', { name: 'No se pudo cargar el laboratorio QA' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Volver a cargar el laboratorio' })).toBeEnabled();
  });
  it('throws a real render exception, captures and classifies it, preserves shell, sanitizes and deduplicates', async () => {
    mount(); provoke();
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar Ventas' })).toBeVisible();
    expect(screen.getByLabelText('Tipo de incidencia')).toBeEnabled();
    expect(screen.getByText(/INCIDENT_REACT_RENDER · react_render · recoverable/)).toBeVisible();
    expect(document.body.textContent).not.toContain('detalle privado omitido');
    fireEvent.click(screen.getByRole('button', { name: 'Detalles del problema' }));
    expect(screen.getByRole('button', { name: 'Ocultar detalles del problema' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Área funcional').parentElement).toHaveTextContent('Ventas');
    expect(screen.getByText('Pantalla afectada').parentElement).toHaveTextContent('Panel de Ventas');
    expect(screen.getByText('Ruta de navegación').parentElement).toHaveTextContent('/ventas');
    provoke();
    fireEvent.click(screen.getByText('Acciones observadas (máximo 30)'));
    expect(screen.getByText('Captura deduplicada')).toBeVisible();
    expect(screen.getByLabelText('Resultado de QA-01')).toHaveValue('NOT RUN');
  });
  it('recovers a component when the fault is removed, without reloading', async () => {
    mount(); provoke();
    fireEvent.change(screen.getByLabelText('Recuperación del fixture'), { target: { value: 'recover' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Ventas ficticias disponibles' })).toBeVisible();
    expect(screen.getByText('La sección volvió a mostrarse correctamente.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tema oscuro' }));
    expect(screen.getByRole('heading', { name: 'Ventas ficticias disponibles' })).toBeVisible();
  });
  it('distinguishes section recovery and exhausts its real retry budget', () => {
    mount(); selectScenario('QA-02'); provoke();
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta sección' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar sección' }));
    expect(screen.getByRole('button', { name: 'Reintento utilizado' })).toBeDisabled();
    expect(screen.getByLabelText('Tenant ficticio')).toBeEnabled();
  });
  it('exits a real critical portal, restores root and focus, then runs level 1', async () => {
    mount(); selectScenario('QA-03'); provoke();
    expect(screen.getByRole('alertdialog', { name: 'Necesitamos verificar esta operación' })).toBeVisible();
    expect(document.getElementById('root').inert).toBe(true);
    expect(screen.getByRole('button', { name: 'Reintentar operación' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salir de la prueba' }));
    expect(document.getElementById('root').inert).toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Tipo de incidencia')).toHaveFocus());
    selectScenario('QA-01'); provoke();
    expect(screen.getByRole('button', { name: 'Reintentar', exact: true })).toBeEnabled();
  });
  it('supports Escape and cycles focus within the QA critical portal', () => {
    mount(); selectScenario('QA-03'); provoke();
    screen.getByRole('button', { name: 'Salir de la prueba' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement.closest('.incident-qa__portal')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(document.getElementById('root').getAttribute('aria-hidden')).toBeNull();
  });
  it('records results only after a manual decision and exports synthetic session data', async () => {
    mount(); useMemory(); provoke();
    fireEvent.change(screen.getByLabelText('Resultado de QA-01'), { target: { value: 'PASS' } });
    fireEvent.change(screen.getByLabelText('Observaciones opcionales (solo datos QA)'), { target: { value: 'Fixture recuperado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumen QA' }));
    expect(await screen.findByText('Resumen QA copiado.')).toBeVisible();
    fireEvent.click(screen.getByText('Inspeccionar última copia local'));
    expect(screen.getByText(/HEAD:.*ENVIRONMENT:.*QA-01: PASS/)).toBeVisible();
    selectScenario('QA-02');
    expect(screen.getByLabelText('Resultado de QA-02')).toHaveValue('NOT RUN');
  });
});

describe('QA-CONTACT / QA-COMMUNICATION', () => {
  it('opens only the manual contact flow and copies a readable QA-labelled message', async () => {
    mount(); useMemory(); provoke(); await openForm();
    expect(screen.queryByRole('button', { name: 'Enviar reporte' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Confirmo que quiero compartir/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const message = screen.getByLabelText('Mensaje preparado para revisar');
    expect(message.value).toContain(QA_LABEL);
    expect(message.value).toContain('Código del problema:');
    expect(message.value).toContain('Área funcional: Ventas');
    expect(message.value).toContain('Pantalla afectada: Panel de Ventas');
    expect(message.value).toContain('Ruta de navegación: /ventas');
    expect(message.value).not.toMatch(/\{|\}|IR-[A-F0-9]{16}|Enviar reporte|RPC no disponible/);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    expect(await screen.findByText(/Mensaje copiado.*Todavía no se ha enviado/)).toBeVisible();
    expect(screen.getByText(/Transporte QA en memoria: 0 llamadas/)).toBeVisible();
  });

  it('allows local preparation and copying offline without contacting a transport', async () => {
    mount(); useMemory(); fireEvent.change(screen.getByLabelText('Conectividad simulada'), { target: { value: 'offline' } });
    provoke(); await openForm();
    expect(screen.getByRole('note')).toHaveTextContent(/Sin conexión.*preparar y copiar/i);
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensaje' }));
    expect(await screen.findByText(/Mensaje copiado/)).toBeVisible();
    expect(screen.getByText(/Transporte QA en memoria: 0 llamadas/)).toBeVisible();
  });

  it('uses the verified channel reference fallback and keeps email draft inspection under test control', async () => {
    mount(); selectScenario('QA-08'); useMemory(); provoke(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const message = screen.getByLabelText('Mensaje preparado para revisar');
    expect(message.value).toContain('PRUEBA QA');
    const telegram = screen.getByRole('link', { name: 'Abrir canal oficial' });
    const telegramUrl = new URL(telegram.href);
    expect(telegramUrl.href).toBe('https://t.me/LanzoPOS_Oficial');
    expect(telegramUrl.pathname).not.toBe('/share/url');
    expect(telegramUrl.search).toBe('');
    expect(screen.getByText(/no se ha verificado un chat privado de soporte/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Correo electrónico/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    const draft = screen.getByRole('link', { name: 'Inspeccionar borrador local' });
    expect(draft.href).toContain('example.invalid');
    fireEvent.click(draft);
    expect(screen.getByText(/Borrador inspeccionado localmente/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Abrir borrador de prueba en correo' }).href).toContain('example.invalid');
    expect(screen.getByText(/Transporte QA en memoria: 0 llamadas/)).toBeVisible();
  });

  it.each(['Tenant ficticio', 'Actor ficticio'])('invalidates prepared contact after changing %s', async (label) => {
    mount(); useMemory(); provoke(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Preparar mensaje' }));
    expect(screen.getByRole('link', { name: 'Abrir canal oficial' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(label), { target: { value: label === 'Tenant ficticio' ? 'QA-B' : 'QA-STAFF' } });
    expect(screen.queryByRole('link', { name: 'Abrir canal oficial' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Reportar un problema' })).getByRole('status')).toHaveTextContent(/negocio o la sesión cambió/i);
    expect(screen.queryByRole('button', { name: 'Enviar reporte' })).not.toBeInTheDocument();
    expect(screen.getByText(/Transporte QA en memoria: 0 llamadas/)).toBeVisible();
  });

  it('does not expose simulated receipts, report statuses or folios in the current support flow', async () => {
    mount(); selectScenario('QA-08'); provoke(); await openForm();
    const contact = screen.getByRole('region', { name: 'Reportar un problema' });
    expect(within(contact).queryByText(/Confirmación ficticia|Backend no disponible|No se confirmó recepción/)).not.toBeInTheDocument();
    expect(contact.textContent).not.toMatch(/IR-[A-F0-9]{16}/);
    expect(within(contact).queryByRole('button', { name: 'Enviar reporte' })).not.toBeInTheDocument();
  });
  it.each(['DB_UNAVAILABLE', 'DB_OPEN_REJECTED', 'DB_SCHEMA_INCOMPATIBLE', 'IDB_ACCESS_ERROR'])('simulates %s without opening storage', (code) => {
    const open = vi.fn(); vi.stubGlobal('indexedDB', { open });
    try {
      mount(); selectScenario('QA-06'); fireEvent.change(screen.getByLabelText('Error de almacenamiento'), { target: { value: code } });
      provoke(); expect(screen.getByRole('heading', { name: 'Necesitamos revisar el almacenamiento local' })).toBeVisible();
      expect(open).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('isolated adapter and real normalizers', () => {
  it.each([
    ['PGRST202', 'supabase_rpc', 'service_failure'], ['SUPABASE_TEMPORARY', 'supabase_rpc', 'service_failure'],
    ['AUTH_DENIED', 'authorization_session', 'authorization'], ['SUPABASE_UNEXPECTED', 'supabase_rpc', 'service_failure']
  ])('normalizes %s without publishing global incidents', (code, category, failureKind) => {
    const result = normalizeBackendError(createLabFault('rpc', code));
    expect(result).toMatchObject({ category, failureKind });
    expect(result.severity).not.toBe('critical_blocker');
  });
  it('deduplicates only identical safe incident keys', () => {
    const lab = createIncidentLabAdapters();
    const a = lab.reporter.capture(createLabFault('network'));
    const duplicate = lab.reporter.capture(createLabFault('network'));
    const different = lab.reporter.capture(createLabFault('rpc'));
    expect(duplicate).toMatchObject({ incident_id: a.incident_id, deduplicated: true });
    expect(different.incident_id).not.toBe(a.incident_id);
  });
  it('requires consent, checks receipt format and blocks stale context in the adapter', async () => {
    const lab = createIncidentLabAdapters(); lab.configure({ outcome: 'invalid', copyMode: 'memory' });
    const incident = lab.reporter.capture(createLabFault('react'), { source: 'react' });
    const guard = lab.guard();
    expect(await lab.services.submit(incident, { consent: false, isContextCurrent: guard })).toMatchObject({ code: 'INCIDENT_REPORT_CONSENT_REQUIRED' });
    await act(async () => {});
    expect(lab.metrics().transportCalls).toBe(0);
    expect(await lab.services.submit(incident, { consent: true, isContextCurrent: guard })).toMatchObject({ status: 'failed' });
    lab.changeContext('QA-B', 'QA-STAFF');
    expect(await lab.services.submit(incident, { consent: true, isContextCurrent: guard })).toMatchObject({ code: 'INCIDENT_REPORT_CONTEXT_CHANGED' });
  });
});
