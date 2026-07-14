// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateAdminServiceWorkerUpdate,
  getAdminServiceWorkerState,
  resetAdminServiceWorkerForTests,
  startAdminServiceWorker,
  subscribeAdminServiceWorker,
} from '../adminServiceWorker';

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

function createHarness({ controlled = false } = {}) {
  const serviceWorker = new FakeEventTarget();
  serviceWorker.controller = controlled ? {} : null;
  const registration = new FakeEventTarget();
  registration.active = { scriptURL: '/sw.js' };
  registration.installing = null;
  registration.waiting = null;
  registration.update = vi.fn().mockResolvedValue(undefined);
  serviceWorker.register = vi.fn().mockResolvedValue(registration);

  const windowTarget = {
    location: { reload: vi.fn() },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(() => 2),
    clearTimeout: vi.fn(),
  };

  return {
    navigatorTarget: { serviceWorker, onLine: true },
    registration,
    serviceWorker,
    windowTarget,
  };
}

describe('administrative Service Worker coordinator', () => {
  afterEach(() => resetAdminServiceWorkerForTests());

  it('registers /sw.js once with scope / and updateViaCache disabled', async () => {
    const harness = createHarness();

    const first = startAdminServiceWorker(harness);
    const second = startAdminServiceWorker(harness);
    await Promise.all([first, second]);

    expect(harness.serviceWorker.register).toHaveBeenCalledOnce();
    expect(harness.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    expect(getAdminServiceWorkerState()).toMatchObject({ registered: true, active: true, error: false });
  });

  it('publishes a waiting update without activating it', async () => {
    const harness = createHarness({ controlled: true });
    const listener = vi.fn();
    subscribeAdminServiceWorker(listener);
    await startAdminServiceWorker(harness);
    const installing = new FakeEventTarget();
    installing.state = 'installing';
    installing.postMessage = vi.fn();
    harness.registration.installing = installing;
    harness.registration.waiting = installing;

    harness.registration.dispatch('updatefound');
    installing.state = 'installed';
    installing.dispatch('statechange');

    expect(getAdminServiceWorkerState().waiting).toBe(true);
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
  });

  it('sends SKIP_WAITING once and reloads at most once after controllerchange', async () => {
    const harness = createHarness({ controlled: true });
    const waiting = { postMessage: vi.fn() };
    harness.registration.waiting = waiting;
    await startAdminServiceWorker(harness);

    const activation = activateAdminServiceWorkerUpdate();
    const sameActivation = activateAdminServiceWorkerUpdate();
    expect(activation).toBe(sameActivation);
    expect(waiting.postMessage).toHaveBeenCalledOnce();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    harness.serviceWorker.dispatch('controllerchange');
    harness.serviceWorker.dispatch('controllerchange');

    await expect(activation).resolves.toBe(true);
    expect(harness.windowTarget.location.reload).toHaveBeenCalledOnce();
  });

  it('does not reload for a controller change that was not user-confirmed', async () => {
    const harness = createHarness();
    await startAdminServiceWorker(harness);

    harness.serviceWorker.dispatch('controllerchange');

    expect(harness.windowTarget.location.reload).not.toHaveBeenCalled();
  });

  it('rejects activation when no worker is waiting', async () => {
    const harness = createHarness();
    await startAdminServiceWorker(harness);

    await expect(activateAdminServiceWorkerUpdate()).rejects.toThrow('No hay un Service Worker en espera.');
  });

  it('records a sanitized registration failure state', async () => {
    const harness = createHarness();
    harness.serviceWorker.register.mockRejectedValue(new Error('synthetic secret detail'));

    await expect(startAdminServiceWorker(harness)).resolves.toBeNull();
    expect(getAdminServiceWorkerState()).toMatchObject({ registered: false, error: true });
  });
});
