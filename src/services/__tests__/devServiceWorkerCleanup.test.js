// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDevelopmentServiceWorkers } from '../devServiceWorkerCleanup';

let originalCachesDescriptor;
let originalServiceWorkerDescriptor;

beforeEach(() => {
  originalCachesDescriptor = Object.getOwnPropertyDescriptor(window, 'caches');
  originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
});

afterEach(() => {
  if (originalCachesDescriptor) Object.defineProperty(window, 'caches', originalCachesDescriptor);
  else delete window.caches;
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorkerDescriptor);
  } else {
    delete navigator.serviceWorker;
  }
  window.sessionStorage.removeItem('lanzo_dev_sw_cleanup_reloaded');
  vi.restoreAllMocks();
});

describe('development service worker cleanup scope', () => {
  it('touches only the root Lanzo development worker and its own cache names', async () => {
    const origin = window.location.origin;
    const rootWorker = {
      scriptURL: `${origin}/sw.js`,
      unregister: vi.fn().mockResolvedValue(true),
    };
    const nestedWorker = {
      scriptURL: `${origin}/sw.js`,
      unregister: vi.fn().mockResolvedValue(true),
    };
    const foreignWorker = {
      scriptURL: 'https://other.example/sw.js',
      unregister: vi.fn().mockResolvedValue(true),
    };
    const wrongScriptWorker = {
      scriptURL: `${origin}/other.js`,
      unregister: vi.fn().mockResolvedValue(true),
    };
    const rootRegistration = { scope: `${origin}/`, active: rootWorker, unregister: vi.fn().mockResolvedValue(true) };
    const nestedRegistration = { scope: `${origin}/nested/`, active: nestedWorker, unregister: vi.fn().mockResolvedValue(true) };
    const foreignRegistration = { scope: 'https://other.example/', active: foreignWorker, unregister: vi.fn().mockResolvedValue(true) };
    const wrongScriptRegistration = { scope: `${origin}/`, active: wrongScriptWorker, unregister: vi.fn().mockResolvedValue(true) };
    const registrations = [
      rootRegistration,
      nestedRegistration,
      foreignRegistration,
      wrongScriptRegistration,
    ];
    const cacheNames = [
      `workbox-precache-v2-${origin}/`,
      'lanzo-admin-static-v1',
      'customer-images',
    ];
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(cacheNames),
      delete: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(window, 'caches', { configurable: true, value: cacheStorage });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: null,
        getRegistrations: vi.fn().mockResolvedValue(registrations),
      },
    });
    window.sessionStorage.setItem('lanzo:authorized-session', 'preserve-session');

    await expect(cleanupDevelopmentServiceWorkers()).resolves.toBe(true);

    expect(rootRegistration.unregister).toHaveBeenCalledOnce();
    expect(nestedRegistration.unregister).not.toHaveBeenCalled();
    expect(foreignRegistration.unregister).not.toHaveBeenCalled();
    expect(wrongScriptRegistration.unregister).not.toHaveBeenCalled();
    expect(cacheStorage.delete.mock.calls.map(([name]) => name)).toEqual([
      `workbox-precache-v2-${origin}/`,
      'lanzo-admin-static-v1',
    ]);
    expect(window.sessionStorage.getItem('lanzo:authorized-session')).toBe('preserve-session');
  });
});
