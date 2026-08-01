// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  isLanzoAdminCacheName,
  isRecoverableAdminStartupError,
  recoverAdminStartup,
} from '../adminStartupRecovery';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type) {
    (this.listeners.get(type) || []).forEach((listener) => listener());
  }
}

function createSessionStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  };
}

function createWindowTarget() {
  return {
    location: {
      href: 'https://lanzo-pos.vercel.app/ventas',
      replace: vi.fn(),
    },
    history: {
      state: null,
      replaceState: vi.fn(),
    },
    sessionStorage: createSessionStorage(),
    setTimeout: vi.fn((callback) => {
      queueMicrotask(callback);
      return 1;
    }),
    clearTimeout: vi.fn(),
  };
}

function createRestrictedStorageWindowTarget() {
  const windowTarget = createWindowTarget();
  Object.defineProperty(windowTarget, 'sessionStorage', {
    configurable: true,
    get() {
      throw new DOMException('Storage is restricted', 'SecurityError');
    },
  });
  return windowTarget;
}

function createCacheStorage(cacheNames = []) {
  return {
    keys: vi.fn().mockResolvedValue(cacheNames),
    delete: vi.fn().mockResolvedValue(true),
  };
}

const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://lanzo-pos.vercel.app/assets/databaseRuntime-old.js'
);

describe('administrative startup version recovery', () => {
  it('recognizes version-skew module failures without classifying arbitrary startup errors', () => {
    expect(isRecoverableAdminStartupError(chunkError)).toBe(true);
    expect(isRecoverableAdminStartupError(new Error('Database is blocked'))).toBe(false);
    expect(isRecoverableAdminStartupError(new Error('MIME type text/html is not executable'))).toBe(true);
  });

  it('identifies only Lanzo shell caches', () => {
    expect(isLanzoAdminCacheName('workbox-precache-v2-https://lanzo-pos.vercel.app/')).toBe(true);
    expect(isLanzoAdminCacheName('lanzo-admin-static-v1')).toBe(true);
    expect(isLanzoAdminCacheName('lanzo-admin-media-v12')).toBe(true);
    expect(isLanzoAdminCacheName('customer-images')).toBe(false);
  });

  it('activates a waiting worker and reloads without unregistering or deleting caches', async () => {
    const serviceWorker = new FakeEventTarget();
    const waitingWorker = {
      postMessage: vi.fn(() => serviceWorker.dispatch('controllerchange')),
    };
    const registration = new FakeEventTarget();
    registration.scope = 'https://lanzo-pos.vercel.app/';
    registration.waiting = waitingWorker;
    registration.installing = null;
    registration.update = vi.fn().mockResolvedValue(undefined);
    registration.unregister = vi.fn().mockResolvedValue(true);
    serviceWorker.getRegistration = vi.fn().mockResolvedValue(registration);
    serviceWorker.getRegistrations = vi.fn().mockResolvedValue([registration]);

    const windowTarget = createWindowTarget();
    const cacheStorage = createCacheStorage(['workbox-precache-v2-fixture']);
    const result = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      status: 'reloading',
      strategy: 'activate-waiting-worker',
    });
    expect(registration.update).toHaveBeenCalledOnce();
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(cacheStorage.keys).not.toHaveBeenCalled();
    expect(windowTarget.location.replace).toHaveBeenCalledOnce();
    expect(windowTarget.location.replace.mock.calls[0][0]).toContain('__lanzo_recovery=');
  });

  it('falls back to unregistering only the root Lanzo worker and clearing only Lanzo caches', async () => {
    const serviceWorker = new FakeEventTarget();
    const registration = new FakeEventTarget();
    registration.scope = 'https://lanzo-pos.vercel.app/';
    registration.waiting = null;
    registration.installing = null;
    registration.update = vi.fn().mockResolvedValue(undefined);
    registration.unregister = vi.fn().mockResolvedValue(true);

    const unrelatedRegistration = {
      scope: 'https://lanzo-pos.vercel.app/other/',
      unregister: vi.fn().mockResolvedValue(true),
    };
    serviceWorker.getRegistration = vi.fn().mockResolvedValue(registration);
    serviceWorker.getRegistrations = vi.fn().mockResolvedValue([
      registration,
      unrelatedRegistration,
    ]);

    const windowTarget = createWindowTarget();
    const cacheStorage = createCacheStorage([
      'workbox-precache-v2-fixture',
      'lanzo-admin-static-v1',
      'lanzo-admin-media-v2',
      'customer-images',
    ]);
    const result = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: 'reloading',
      strategy: 'reset-lanzo-shell',
      unregisteredWorkers: 1,
    });
    expect(registration.unregister).toHaveBeenCalledOnce();
    expect(unrelatedRegistration.unregister).not.toHaveBeenCalled();
    expect(cacheStorage.delete.mock.calls.map(([cacheName]) => cacheName)).toEqual([
      'workbox-precache-v2-fixture',
      'lanzo-admin-static-v1',
      'lanzo-admin-media-v2',
    ]);
    expect(windowTarget.location.replace).toHaveBeenCalledOnce();
  });

  it('allows only one automatic recovery attempt per build', async () => {
    const serviceWorker = {
      getRegistration: vi.fn().mockResolvedValue(null),
      getRegistrations: vi.fn().mockResolvedValue([]),
    };
    const windowTarget = createWindowTarget();
    const cacheStorage = createCacheStorage([]);

    const first = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
    });
    const second = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
    });

    expect(first.status).toBe('reloading');
    expect(second).toEqual({ status: 'already-attempted' });
    expect(windowTarget.location.replace).toHaveBeenCalledOnce();
  });

  it('still performs recovery when reading sessionStorage throws', async () => {
    const serviceWorker = {
      getRegistration: vi.fn().mockResolvedValue(null),
      getRegistrations: vi.fn().mockResolvedValue([]),
    };
    const windowTarget = createRestrictedStorageWindowTarget();
    const cacheStorage = createCacheStorage(['lanzo-admin-static-v1']);

    const result = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
    });

    expect(result.status).toBe('reloading');
    expect(cacheStorage.delete).toHaveBeenCalledWith('lanzo-admin-static-v1');
    expect(windowTarget.location.replace).toHaveBeenCalledOnce();
  });

  it('uses the recovery query as the one-shot guard when storage is unavailable', async () => {
    const serviceWorker = {
      getRegistration: vi.fn().mockResolvedValue(null),
      getRegistrations: vi.fn().mockResolvedValue([]),
    };
    const windowTarget = createRestrictedStorageWindowTarget();
    const cacheStorage = createCacheStorage([]);

    const first = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
    });
    windowTarget.location.href = first.url;

    const second = await recoverAdminStartup({
      error: chunkError,
      navigatorTarget: { serviceWorker },
      windowTarget,
      cacheStorage,
    });

    expect(first.status).toBe('reloading');
    expect(second).toEqual({ status: 'already-attempted' });
    expect(windowTarget.location.replace).toHaveBeenCalledOnce();
  });
});
