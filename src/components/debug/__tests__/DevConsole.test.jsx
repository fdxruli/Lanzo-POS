// @vitest-environment jsdom
// Controlled diagnostic events, no POS operations.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DevConsolePanel } from '../DevConsole';
import { buildDevConsoleSearchText, matchesDevConsoleFilter } from '../devConsoleSearch';
import { emitDiagnosticConsoleEvent } from '../../../services/diagnostics/consoleEventBus';
import { clearDevConsoleEntries, getDevConsoleEntries, installDevConsoleCapture, setDevConsoleRecording } from '../../../services/devConsoleCapture';

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

it('previews and copies only the individually inspected registry after review', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  ['ALPHA', 'BETA', 'GAMMA'].forEach((suffix) => {
    emitDiagnosticConsoleEvent('error', [
      { diagnosticOperation: 'db.operation' }, new TypeError(`LANZO_QA_SINGLE_${suffix}`),
    ]);
  });

  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Examinar registro' })[1]);
  expect(screen.getByText(/Mensaje original: LANZO_QA_SINGLE_BETA/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar este registro' }));

  const dialog = screen.getByRole('dialog', { name: 'Revisar diagnóstico técnico' });
  expect(within(dialog).getByText('1 registro incluido')).toBeVisible();
  const preview = within(dialog).getByRole('textbox', { name: 'Texto del diagnóstico revisable' });
  expect(preview.value).toContain('LANZO_QA_SINGLE_BETA');
  expect(preview.value).toContain('Stack original');
  expect(preview.value).not.toContain('LANZO_QA_SINGLE_ALPHA');
  expect(preview.value).not.toContain('LANZO_QA_SINGLE_GAMMA');
  expect(writeText).not.toHaveBeenCalled();

  fireEvent.change(preview, { target: { value: 'DIAGNÓSTICO BETA REVISADO' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toBe('DIAGNÓSTICO BETA REVISADO');
});

it('redacts private data from the selected error message and stack', () => {
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('error', [
    { diagnosticOperation: 'db.operation' },
    new TypeError('token=LANZO_PRIVATE_TOKEN_123456 support@example.invalid'),
  ]);

  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.click(screen.getByRole('button', { name: 'Examinar registro' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copiar este registro' }));

  const preview = screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' });
  expect(preview.value).toContain('Stack original');
  expect(preview.value).toContain('[REDACTADO]');
  expect(preview.value).toContain('[CORREO_REDACTADO]');
  expect(preview.value).not.toContain('LANZO_PRIVATE_TOKEN_123456');
  expect(preview.value).not.toContain('support@example.invalid');
});


it('cancels without copying and respects only the visible level filter', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('warn', [{ code: 'NETWORK_TIMEOUT' }, { diagnosticOperation: 'sync.pull' }]);
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, new TypeError('LANZO_QA_STAGE2_EXPORT')]);
  // Verify both events actually passed the registered console bus, before filtering.
  const captured = getDevConsoleEntries();
  expect(captured).toHaveLength(2);
  expect(captured.map(({ level }) => level)).toEqual(['warn', 'error']);
  expect(captured[0].code).toBe('NETWORK_TIMEOUT');
  expect(captured[1].technical.message).toBe('LANZO_QA_STAGE2_EXPORT');
  expect(captured[1].technical.stack).toContain('LANZO_QA_STAGE2_EXPORT');
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
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, new TypeError('actor-private')]);
  expect(getDevConsoleEntries()).toHaveLength(1);
  expect(getDevConsoleEntries()[0].technical.message).toBe('actor-private');
  render(<DevConsolePanel canCopy={() => authorized} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.click(screen.getByRole('button', { name: 'Examinar registro' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copiar este registro' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' }).value).toContain('actor-private');
  const confirm = screen.getByRole('button', { name: 'Copiar diagnóstico revisado' });
  expect(confirm).toBeEnabled();
  // Revocation between rendering the enabled button and its click: handler must
  // revalidate authority, not rely on the button's disabled state.
  authorized = false;
  fireEvent.click(confirm);
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText(/La autorización cambió/)).toBeVisible();
});

it('finds original unknown messages, inspects the original stack, and previews only the filtered export', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  installDevConsoleCapture();
  ['ALPHA', 'BETA', 'GAMMA'].forEach((suffix) => {
    emitDiagnosticConsoleEvent('error', [
      { diagnosticOperation: 'db.operation' }, new TypeError(`LANZO_QA_SEARCH_${suffix}`),
    ]);
  });

  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), {
    target: { value: 'search_beta' },
  });
  fireEvent.change(screen.getByLabelText('Filtrar por nivel'), { target: { value: 'error' } });
  fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'unknown' } });

  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Examinar registro' }));
  expect(screen.getByText(/Mensaje original: LANZO_QA_SEARCH_BETA/)).toBeVisible();
  expect(screen.getByText(/Stack original:/)).toBeVisible();

  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  const preview = screen.getByRole('textbox', { name: 'Texto del diagnóstico revisable' });
  expect(preview.value).toContain('LANZO_QA_SEARCH_BETA');
  expect(preview.value).not.toContain('LANZO_QA_SEARCH_ALPHA');
  expect(preview.value).not.toContain('LANZO_QA_SEARCH_GAMMA');
  expect(writeText).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico revisado' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain('LANZO_QA_SEARCH_BETA');
  expect(writeText.mock.calls[0][0]).not.toContain('LANZO_QA_SEARCH_ALPHA');
  expect(writeText.mock.calls[0][0]).not.toContain('LANZO_QA_SEARCH_GAMMA');

  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), { target: { value: '' } });
  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(3);
});

it('finds a reference present only in the original stack', () => {
  function LANZO_QA_SEARCH_STACK_BETA() {
    throw new TypeError('STACK_MESSAGE_WITHOUT_SEARCH_REFERENCE');
  }

  let error;
  try { LANZO_QA_SEARCH_STACK_BETA(); } catch (caught) { error = caught; }
  expect(error.stack).toContain('LANZO_QA_SEARCH_STACK_BETA');
  expect(error.message).not.toContain('LANZO_QA_SEARCH_STACK_BETA');

  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, error]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), {
    target: { value: 'LANZO_QA_SEARCH_STACK_BETA' },
  });

  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(1);
});

it('combines technical search with level and category filters', () => {
  const codedError = Object.assign(new TypeError('LANZO_QA_FILTER_COMBINED'), { code: 'NETWORK_TIMEOUT' });
  installDevConsoleCapture();
  emitDiagnosticConsoleEvent('error', [{ diagnosticOperation: 'db.operation' }, codedError]);
  emitDiagnosticConsoleEvent('error', [
    { diagnosticOperation: 'db.operation' }, new TypeError('LANZO_QA_FILTER_COMBINED'),
  ]);
  emitDiagnosticConsoleEvent('warn', [
    { diagnosticOperation: 'db.operation' }, new TypeError('LANZO_QA_FILTER_COMBINED'),
  ]);
  render(<DevConsolePanel canCopy={() => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de diagnóstico' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), {
    target: { value: 'LANZO_QA_FILTER_COMBINED' },
  });

  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Filtrar por nivel'), { target: { value: 'error' } });
  fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'unknown' } });
  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'connectivity' } });
  expect(screen.getAllByRole('button', { name: 'Examinar registro' })).toHaveLength(1);
  expect(screen.getByText(/NETWORK_TIMEOUT/)).toBeVisible();
});

it('does not execute getters or inspect arbitrary payloads while building searchable text', () => {
  let getterCalls = 0;
  const technical = Object.defineProperties({}, {
    message: { get() { getterCalls += 1; throw new Error('hostile message getter'); } },
    arbitrary: { get() { getterCalls += 1; throw new Error('arbitrary getter'); } },
  });
  const payload = Object.defineProperty({}, 'secret', {
    get() { getterCalls += 1; throw new Error('payload getter'); },
  });
  const entry = Object.defineProperties({ text: 'Safe diagnostic summary', technical, payload }, {
    evidence: { get() { getterCalls += 1; throw new Error('hostile evidence getter'); } },
    level: { get() { getterCalls += 1; throw new Error('hostile level getter'); } },
    category: { get() { getterCalls += 1; throw new Error('hostile category getter'); } },
  });

  const searchText = buildDevConsoleSearchText(entry);

  expect(searchText).toContain('safe diagnostic summary');
  expect(searchText).not.toContain('hostile');
  expect(searchText).not.toContain('secret');
  expect(matchesDevConsoleFilter(entry, 'level', 'error')).toBe(false);
  expect(matchesDevConsoleFilter(entry, 'category', 'unknown')).toBe(false);
  expect(getterCalls).toBe(0);
});

it('includes classification and original technical references in searchable text', () => {
  const searchText = buildDevConsoleSearchText({
    code: 'INCIDENT_UNKNOWN',
    technical: {
      name: 'TypeError',
      code: 'ORIGINAL_ERROR_CODE',
      message: 'original message',
      stack: 'original stack',
      filename: 'src/debug/worker.js',
      functionName: 'refreshDiagnostics',
    },
  });

  [
    'incident_unknown', 'typeerror', 'original_error_code', 'original message',
    'original stack', 'src/debug/worker.js', 'refreshdiagnostics',
  ].forEach((value) => expect(searchText).toContain(value));
});
