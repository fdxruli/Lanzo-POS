// @vitest-environment jsdom
// Controlled diagnostic events, no POS operations.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DevConsolePanel } from '../DevConsole';
import { emitDiagnosticConsoleEvent } from '../../../services/diagnostics/consoleEventBus';
import { clearDevConsoleEntries, installDevConsoleCapture, setDevConsoleRecording } from '../../../services/devConsoleCapture';

vi.mock('../../../services/diagnostics/incidentEventCenter', () => ({ captureAsyncIncidentNotice: vi.fn() }));
beforeEach(() => { setDevConsoleRecording(true); });
afterEach(() => { cleanup(); clearDevConsoleEntries(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('previews and copies only the reviewed diagnosis on mobile', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()
  }));
  Element.prototype.scrollTo = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'].forEach((method) => {
    vi.spyOn(console, method).mockImplementation(() => {});
  });
  clearDevConsoleEntries();
  installDevConsoleCapture();
  console.error('Error al crear licencia Lanzo Local:', {
    code: 'FREE_LICENSE_TRANSPORT_ERROR', message: 'ana@example.invalid LNZ-PRIVATE',
    licenseKey: 'LNZ-PRIVATE', token: 'jwt-private', password: 'password-private',
    customer: 'Ana Private', phone: '5551234567', amount: 9876.50,
    body: { rpc: 'rpc-private' }, deviceFingerprint: 'device-private',
    url: 'https://private.invalid/?access_token=private', state: { balance: 'state-private' }
  });
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  expect(screen.getByText(/Conectividad · Diagnóstico técnico · FREE_LICENSE_TRANSPORT_ERROR/)).toBeVisible();
  expect(screen.getByText(/Módulo: Licencias · Operación: Crear licencia FREE/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Revisar diagnóstico técnico' })).toBeVisible();
  const preview = screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' });
  expect(preview.value).toContain('FREE_LICENSE_TRANSPORT_ERROR');
  fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0];
  expect(copied).toContain('LANZO POS — DIAGNÓSTICO TÉCNICO');
  expect(copied).toContain('FREE_LICENSE_TRANSPORT_ERROR');
  expect(copied).toContain('Resultado: No confirmado');
  expect(document.body.textContent + copied).not.toMatch(/PRIVATE|private|Ana|5551234567|9876|access_token/);
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), { target: { value: 'PGRST202' } });
  expect(screen.getByText('No hay registros para este filtro.')).toBeVisible();
});


it.each([390, 1440])('supports filters, inspection, pause/resume and clearing at viewport %s', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: width < 768 }));
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('info', [{ diagnosticOperation: 'sync.status', diagnosticState: 'online' }]);
  emitDiagnosticConsoleEvent('warn', [{ code: 'NETWORK_TIMEOUT' }, { diagnosticOperation: 'sync.pull' }]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  expect(screen.getByRole('region', { name: 'Consola de diagnóstico' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Filtrar por nivel'), { target: { value: 'warn' } });
  expect(screen.getByText(/Tiempo de espera agotado/)).toBeVisible();
  expect(screen.queryByText(/Estado: Conectado/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'indexeddb' } });
  expect(screen.getByText('No hay registros para este filtro.')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'all' } });
  fireEvent.click(screen.getByText('Examinar registro'));
  expect(screen.getByText(/Impacto: recoverable/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Filtrar por nivel'), { target: { value: 'all' } });
  fireEvent.click(screen.getByTitle('Pausar captura visual'));
  emitDiagnosticConsoleEvent('error', [{ code: 'DB_OPEN_TIMEOUT', diagnosticOperation: 'db.open' }]);
  expect(screen.queryByText(/DB_OPEN_TIMEOUT/)).toBeNull();
  fireEvent.click(screen.getByTitle('Reanudar captura visual'));
  expect(screen.getByText(/DB_OPEN_TIMEOUT/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Limpiar consola'));
  expect(screen.getByText('No hay registros para este filtro.')).toBeVisible();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' })).toBeVisible();
});

it('keeps the panel usable when clipboard and launcher persistence fail', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('info', [{ diagnosticOperation: 'sync.status' }]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  expect(await screen.findByText(/No se pudo acceder al portapapeles/)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Consola de diagnóstico' })).toBeVisible();
});

it('batches a large stream without freezing the view and shows repetitions', async () => {
  vi.useFakeTimers(); installDevConsoleCapture();
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  act(() => {
    for (let index = 0; index < 1000; index++) emitDiagnosticConsoleEvent('warn', [
      { code: 'NETWORK_TIMEOUT' }, { diagnosticOperation: 'sync.pull' }
    ]);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByText(/1000 eventos equivalentes/)).toBeVisible();
  expect(document.querySelectorAll('.dev-console-entry')).toHaveLength(1);
});

it('exports original TypeError and stack after explicit review without replacing evidence with classification', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  const error = new TypeError('TECHNICAL_ORIGINAL_ONLY');
  // Real V8 stack, not a manually injected fixture.
  expect(error.stack).toEqual(expect.any(String));
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, error]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  expect(screen.queryByText(/Mensaje original: TECHNICAL_ORIGINAL_ONLY/)).toBeNull();
  fireEvent.click(screen.getByText('Examinar registro'));
  expect(screen.getByText(/Mensaje original: TECHNICAL_ORIGINAL_ONLY/)).toBeVisible();
  expect(screen.getByText(/Stack original:/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  expect(writeText).not.toHaveBeenCalled();
  const textarea = screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' });
  expect(textarea.value).toContain('TECHNICAL_ORIGINAL_ONLY');
  expect(textarea.value).toContain('Stack original');
  expect(textarea.value).toContain('INCIDENT_UNKNOWN');
  fireEvent.change(textarea, { target: { value: textarea.value + '\\nREVISADO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain('TECHNICAL_ORIGINAL_ONLY');
  expect(writeText.mock.calls[0][0]).toContain('REVISADO');
});


it('cancels without copying and respects only the visible level filter', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('warn', [{ code: 'NETWORK_TIMEOUT' }]);
  emitDiagnosticConsoleEvent('error', [new TypeError('LANZO_QA_STAGE2_EXPORT')]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.change(screen.getByLabelText('Filtrar por nivel'), { target: { value: 'error' } });
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  const text = screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' }).value;
  expect(text).toContain('LANZO_QA_STAGE2_EXPORT');
  expect(text).not.toContain('NETWORK_TIMEOUT');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
});

it('revalidates authorization before copy and discards the stale draft', () => {
  let authorized = true;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('error', [new TypeError('actor-private')]);
  render(<DevConsolePanel canCopy={() => authorized} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  expect(screen.getByRole('dialog')).toBeVisible();
  authorized = false;
  fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText(/La autorización cambió/)).toBeVisible();
});
