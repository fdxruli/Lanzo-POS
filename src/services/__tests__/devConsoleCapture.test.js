// @vitest-environment jsdom
/* eslint-disable no-console -- this suite verifies the console capture hook */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'];
const STATE_KEY = '__LANZO_DEV_CONSOLE_STATE__';
let originalConsoleMethods;
let previousStateDescriptor;

beforeEach(() => {
  originalConsoleMethods = Object.fromEntries(
    CONSOLE_METHODS.map((method) => [method, console[method]])
  );
  previousStateDescriptor = Object.getOwnPropertyDescriptor(window, STATE_KEY);
  delete window[STATE_KEY];
});

afterEach(() => {
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
    expect(entries[0].text).toContain('indexeddb');
    expect(entries[0].text).toContain('DB_OPEN_TIMEOUT');
    expect(entries[1].source).toBe('window.error');
    expect(entries[2].source).toBe('unhandledrejection');
    expect(entries.every(({ text }) => text.includes('Detalle omitido por privacidad'))).toBe(true);
    expect(serialized).not.toContain('Ana Lopez');
    expect(serialized).not.toContain('private-name');
    expect(serialized).not.toContain('full-license-secret');
    expect(serialized).not.toContain('9876.5');
    expect(serialized).not.toContain('jwt-secret');
    expect(serialized).not.toContain('event-secret');
    expect(serialized).not.toContain('url-secret');
    expect(serialized).not.toContain('rejection-secret');
  });
});
