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

it('renders and copies the same useful sanitized diagnosis on mobile', async () => {
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
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0];
  expect(copied).toMatch(/^\[\d{4}-\d\d-\d\dT[^\]]+Z\] ERROR console:/);
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
  expect(await screen.findByText('No se pudo copiar. Puedes seleccionar el texto.')).toBeVisible();
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

it('shows a TypeError original and stack only when inspected, never in clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  const error = new TypeError('TECHNICAL_ORIGINAL_ONLY');
  Object.defineProperty(error, 'stack', { value: 'TypeError: TECHNICAL_ORIGINAL_ONLY\\n at bundle.js:4:2' });
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, error]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  expect(screen.queryByText(/Mensaje original: TECHNICAL_ORIGINAL_ONLY/)).toBeNull();
  fireEvent.click(screen.getByText('Examinar registro'));
  expect(screen.getByText(/Mensaje original: TECHNICAL_ORIGINAL_ONLY/)).toBeVisible();
  expect(screen.getByText(/Stack original:/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain('INCIDENT_UNKNOWN');
  expect(writeText.mock.calls[0][0]).not.toContain('TECHNICAL_ORIGINAL_ONLY');
});
