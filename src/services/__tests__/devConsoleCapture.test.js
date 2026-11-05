// @vitest-environment jsdom
/* eslint-disable no-console -- this suite verifies the console capture hook */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'];
const STATE_KEY = '__LANZO_DEV_CONSOLE_STATE__';
let originalConsoleMethods;
let previousStateDescriptor;
let installedListeners;

vi.mock('../diagnostics/incidentEventCenter', () => ({ captureAsyncIncidentNotice: vi.fn() }));

beforeEach(() => {
  originalConsoleMethods = Object.fromEntries(
    CONSOLE_METHODS.map((method) => [method, console[method]])
  );
  previousStateDescriptor = Object.getOwnPropertyDescriptor(window, STATE_KEY);
  delete window[STATE_KEY];
  installedListeners = [];
  const addListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    installedListeners.push([type, listener, options]);
    addListener(type, listener, options);
  });
});

afterEach(() => {
  installedListeners.forEach((args) => window.removeEventListener(...args));
  CONSOLE_METHODS.forEach((method) => { console[method] = originalConsoleMethods[method]; });
  if (previousStateDescriptor) Object.defineProperty(window, STATE_KEY, previousStateDescriptor);
  else delete window[STATE_KEY];
  vi.restoreAllMocks();
});

describe('development console capture privacy', () => {
  it('stores only safe classifications from console, window errors, and rejected promises', async () => {
    CONSOLE_METHODS.forEach((method) => { console[method] = vi.fn(); });
    vi.resetModules();
    const { getDevConsoleEntries, installDevConsoleCapture } = await import('../devConsoleCapture');
    installDevConsoleCapture();

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
    expect(entries).toHaveLength(3);
    expect(entries[0].text).toContain('Almacenamiento local');
    expect(entries[0].text).toContain('DB_OPEN_TIMEOUT');
    expect(entries[1].source).toBe('window.error');
    expect(entries[2].source).toBe('unhandledrejection');
    expect(entries.every(({ timestamp }) => !Number.isNaN(Date.parse(timestamp)))).toBe(true);
    expect(serialized).not.toContain('Ana Lopez');
    expect(serialized).not.toContain('private-name');
    expect(serialized).not.toContain('full-license-secret');
    expect(serialized).not.toContain('9876.5');
    expect(serialized).not.toContain('jwt-secret');
    expect(serialized).not.toContain('event-secret');
    expect(serialized).not.toContain('url-secret');
    expect(serialized).not.toContain('rejection-secret');
  });

  it('installs once, forwards original arguments once, and keeps global capture working', async () => {
    const originals = Object.fromEntries(CONSOLE_METHODS.map((method) => [method, vi.fn()]));
    Object.assign(console, originals);
    vi.resetModules();
    const { installDevConsoleCapture, getDevConsoleEntries, subscribeDevConsole } = await import('../devConsoleCapture');
    const { captureAsyncIncidentNotice } = await import('../diagnostics/incidentEventCenter');
    captureAsyncIncidentNotice.mockClear();
    installDevConsoleCapture();
    installDevConsoleCapture();
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
});
