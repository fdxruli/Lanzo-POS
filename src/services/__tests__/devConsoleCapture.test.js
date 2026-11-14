// @vitest-environment jsdom
/* eslint-disable no-console -- this suite verifies the console capture hook */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'];
let originalConsoleMethods;
let installedListeners;

vi.mock('../diagnostics/incidentEventCenter', () => ({ captureAsyncIncidentNotice: vi.fn() }));

beforeEach(() => {
  originalConsoleMethods = Object.fromEntries(
    CONSOLE_METHODS.map((method) => [method, console[method]])
  );
  installedListeners = [];
  const addListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    installedListeners.push([type, listener, options]);
    addListener(type, listener, options);
  });
});

afterEach(async () => {
  (await import('../devConsoleCapture')).clearDevConsoleEntries();
  installedListeners.forEach((args) => window.removeEventListener(...args));
  CONSOLE_METHODS.forEach((method) => { console[method] = originalConsoleMethods[method]; });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('development console capture privacy', () => {
  it('preserves technical details for local inspection but copies restricted classifications', async () => {
    CONSOLE_METHODS.forEach((method) => { console[method] = vi.fn(); });
    vi.resetModules();
    const { getDevConsoleEntries, installDevConsoleCapture, setDevConsoleRecording } = await import('../devConsoleCapture');
    installDevConsoleCapture(); setDevConsoleRecording(true);

    console.error(
      'payment failed customer=Ana Lopez',
      { licenseKey: 'full-license-secret', amount: 9876.5 },
      Object.assign(new Error('token=jwt-secret'), { code: 'DB_OPEN_TIMEOUT' })
    );

    const errorEvent = new ErrorEvent('error', {
      message: 'customer=private-name token=event-secret',
      filename: 'https://lanzo.test/caja?access_token=url-secret',
    });
    window.dispatchEvent(errorEvent);

    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', {
      value: new Error('license_key=rejection-secret customer=Ana Lopez'),
    });
    window.dispatchEvent(rejection);

    const entries = getDevConsoleEntries();
    const serialized = JSON.stringify(entries);
    const copied = (await import('../devConsoleCapture')).formatDevConsoleEntries(entries);
    expect(entries).toHaveLength(3);
    expect(entries[0].text).toContain('Almacenamiento local');
    expect(entries[0].text).toContain('DB_OPEN_TIMEOUT');
    expect(entries[1].source).toBe('window.error');
    expect(entries[2].source).toBe('unhandledrejection');
    expect(entries.every(({ timestamp }) => !Number.isNaN(Date.parse(timestamp)))).toBe(true);
    expect(entries[0].technical.message).toBe('token=jwt-secret');
    expect(entries[1].technical.message).toContain('event-secret');
    expect(entries[2].technical.message).toContain('rejection-secret');
    expect(serialized).not.toContain('full-license-secret');
    expect(serialized).not.toContain('9876.5');
    expect(serialized).not.toContain('url-secret');
    expect(copied).not.toMatch(/Ana Lopez|private-name|full-license-secret|9876|jwt-secret|event-secret|url-secret|rejection-secret/);
  });

  it('installs once, forwards original arguments once, and keeps global capture working', async () => {
    const originals = Object.fromEntries(CONSOLE_METHODS.map((method) => [method, vi.fn()]));
    Object.assign(console, originals);
    vi.resetModules();
    const { installDevConsoleCapture, getDevConsoleEntries, subscribeDevConsole, setDevConsoleRecording } = await import('../devConsoleCapture');
    const { captureAsyncIncidentNotice } = await import('../diagnostics/incidentEventCenter');
    captureAsyncIncidentNotice.mockClear();
    installDevConsoleCapture(); setDevConsoleRecording(true);
    installDevConsoleCapture(); setDevConsoleRecording(true);
    expect(installedListeners.map(([type]) => type)).toEqual(['error', 'unhandledrejection']);
    const error = Object.freeze(Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_REQUEST_FAILED' }));
    const before = Object.getOwnPropertyDescriptors(error);
    const unsubscribe = subscribeDevConsole(() => { throw new Error('broken diagnostic subscriber'); });
    CONSOLE_METHODS.forEach((method) => {
      expect(() => console[method]('private prefix', error)).not.toThrow();
      expect(originals[method]).toHaveBeenCalledExactlyOnceWith('private prefix', error);
    });
    unsubscribe();
    window.dispatchEvent(new ErrorEvent('error', { error }));
    // The message-only global path is also useful when event.error is absent.
    window.dispatchEvent(new ErrorEvent('error', { message: 'Failed to fetch' }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: Object.freeze({ code: 'PGRST202', details: null, hint: '' }) });
    window.dispatchEvent(rejection);
    const entries = getDevConsoleEntries();
    expect(entries).toHaveLength(CONSOLE_METHODS.length + 3);
    expect(entries.slice(-3).map(({ source }) => source)).toEqual(['window.error', 'window.error', 'unhandledrejection']);
    expect(entries.at(-2).text).toContain('NETWORK_REQUEST_FAILED');
    expect(entries.at(-1).text).toContain('PGRST202');
    expect(captureAsyncIncidentNotice).toHaveBeenCalledTimes(3);
    expect(captureAsyncIncidentNotice.mock.calls[0][0]).toBe(error);
    expect(Object.getOwnPropertyDescriptors(error)).toEqual(before);
  });

  it('groups only adjacent known-code operations and retains distinct unknown events and first/last times', async () => {
    CONSOLE_METHODS.forEach(method => { console[method] = vi.fn(); });
    vi.resetModules(); vi.useFakeTimers();
    const { installDevConsoleCapture, getDevConsoleEntries, formatDevConsoleEntries, setDevConsoleRecording } = await import('../devConsoleCapture');
    installDevConsoleCapture(); setDevConsoleRecording(true);
    const operation = { diagnosticOperation: 'sync.pull' };
    console.warn(operation, { code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    console.warn(operation, { code: 'NETWORK_TIMEOUT' });
    console.warn(operation, { code: 'PGRST202' });
    console.warn({ diagnosticOperation: 'sync.outbox' }, { code: 'PGRST202' });
    console.error(new Error('unknown one'));
    console.error(new Error('unknown two'));
    const entries = getDevConsoleEntries();
    expect(entries).toHaveLength(5);
    expect(entries[0].count).toBe(2);
    expect(Date.parse(entries[0].timestamp) - Date.parse(entries[0].firstTimestamp)).toBe(1000);
    expect(entries.slice(1).every(entry => entry.count === 1)).toBe(true);
    const copied = formatDevConsoleEntries(entries);
    expect(copied).toContain('Eventos equivalentes: 2');
    expect(copied).not.toMatch(/unknown one|unknown two/);
    expect(Object.isFrozen(entries[0])).toBe(true);
    await vi.advanceTimersByTimeAsync(31_000);
    console.warn(operation, { code: 'NETWORK_TIMEOUT' });
    expect(getDevConsoleEntries().at(-1).count).toBe(1);
  });

  it('bounds storage, batches visual updates and isolates reentrant subscribers', async () => {
    CONSOLE_METHODS.forEach(method => { console[method] = vi.fn(); });
    vi.resetModules(); vi.useFakeTimers();
    const { installDevConsoleCapture, getDevConsoleEntries, subscribeDevConsole, setDevConsoleRecording } = await import('../devConsoleCapture');
    installDevConsoleCapture(); setDevConsoleRecording(true);
    const listener = vi.fn(() => { console.warn('subscriber feedback'); });
    const unsubscribe = subscribeDevConsole(listener);
    for (let index = 0; index < 1000; index++) console.info('private unclassified input');
    expect(getDevConsoleEntries()).toHaveLength(300);
    expect(getDevConsoleEntries().every(entry => entry.level === 'info' && entry.errorType === null)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('retains production Logger info safely without raw console output or duplicate events', async () => {
    const originals = Object.fromEntries(CONSOLE_METHODS.map(method => [method, vi.fn()]));
    Object.assign(console, originals);
    vi.resetModules(); vi.stubEnv('PROD', true);
    const { installDevConsoleCapture, getDevConsoleEntries, setDevConsoleRecording } = await import('../devConsoleCapture');
    const { default: Logger } = await import('../Logger');
    installDevConsoleCapture(); setDevConsoleRecording(true);
    Logger.info({ diagnosticOperation: 'sync.status', diagnosticState: 'online', token: 'private-token' });
    Logger.debug('unstructured production noise');
    expect(originals.info).not.toHaveBeenCalled();
    expect(getDevConsoleEntries()).toHaveLength(1);
    expect(getDevConsoleEntries()[0].text).toContain('Estado: Conectado');
    expect(JSON.stringify(getDevConsoleEntries())).not.toContain('private-token');
    Logger.warn({ code: 'DB_OPEN_TIMEOUT' });
    expect(getDevConsoleEntries()).toHaveLength(2);
    expect(originals.warn).toHaveBeenCalledTimes(1);
  });

  it('preserves operational recovery while the visual recording is suspended', async () => {
    CONSOLE_METHODS.forEach(method => { console[method] = vi.fn(); });
    vi.resetModules();
    const { installDevConsoleCapture, getDevConsoleEntries, setDevConsoleRecording } = await import('../devConsoleCapture');
    const { captureAsyncIncidentNotice } = await import('../diagnostics/incidentEventCenter');
    captureAsyncIncidentNotice.mockReset();
    installDevConsoleCapture(); setDevConsoleRecording(true); setDevConsoleRecording(false);
    const error = Object.assign(new Error('private'), { code: 'FINANCIAL_RESULT_UNKNOWN' });
    window.dispatchEvent(new ErrorEvent('error', { error }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: error });
    window.dispatchEvent(rejection);
    expect(getDevConsoleEntries()).toEqual([]);
    expect(captureAsyncIncidentNotice).toHaveBeenCalledTimes(2);
    expect(captureAsyncIncidentNotice.mock.calls[0][0]).toBe(error);
  });
  it('never exposes original entries through window and clears them on recording revoke', async () => {
    CONSOLE_METHODS.forEach(method => { console[method] = vi.fn(); });
    vi.resetModules();
    const { installDevConsoleCapture, getDevConsoleEntries, setDevConsoleRecording, formatDevConsoleEntries } =
      await import('../devConsoleCapture');
    installDevConsoleCapture();
    expect(window.__LANZO_DEV_CONSOLE_STATE__).toBeUndefined();
    expect(window.__LANZO_DEV_CONSOLE__).toBeUndefined();
    console.error(new Error('disabled-secret'));
    expect(getDevConsoleEntries()).toEqual([]);
    setDevConsoleRecording(true);
    console.error(new TypeError('enabled original'));
    expect(getDevConsoleEntries()[0].technical.message).toBe('enabled original');
    expect(formatDevConsoleEntries(getDevConsoleEntries())).not.toContain('enabled original');
    setDevConsoleRecording(false);
    expect(getDevConsoleEntries()).toEqual([]);
    setDevConsoleRecording(true);
    expect(getDevConsoleEntries()).toEqual([]);
  });

  it('keeps browser source locations and string rejections in memory only', async () => {
    CONSOLE_METHODS.forEach(method => { console[method] = vi.fn(); });
    vi.resetModules();
    const { installDevConsoleCapture, getDevConsoleEntries, setDevConsoleRecording } =
      await import('../devConsoleCapture');
    installDevConsoleCapture(); setDevConsoleRecording(true);
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'original browser message', filename: 'https://test.invalid/main.js?token=DO_NOT_COPY',
      lineno: 15, colno: 6
    }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: 'rejected-string-original' });
    window.dispatchEvent(rejection);
    const entries = getDevConsoleEntries();
    expect(entries[0].technical).toMatchObject({
      message: 'original browser message', filename: 'https://test.invalid/main.js', line: 15, column: 6
    });
    expect(entries[1].technical.message).toBe('rejected-string-original');
    expect(JSON.stringify(entries)).not.toContain('DO_NOT_COPY');
  });
});
