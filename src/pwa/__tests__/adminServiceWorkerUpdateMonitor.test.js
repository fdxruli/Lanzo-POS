// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestAdminServiceWorkerUpdateCheck,
  resetAdminServiceWorkerUpdateMonitorForTests,
  startAdminServiceWorkerUpdateMonitor,
} from '../adminServiceWorkerUpdateMonitor';

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

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function createHarness() {
  const registration = { update: vi.fn().mockResolvedValue(undefined) };
  const serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(registration),
  };
  const windowTarget = new FakeEventTarget();
  windowTarget.setInterval = vi.fn(() => 17);
  windowTarget.clearInterval = vi.fn();
  const documentTarget = new FakeEventTarget();
  documentTarget.visibilityState = 'visible';

  return {
    documentTarget,
    navigatorTarget: { serviceWorker, onLine: true },
    registration,
    serviceWorker,
    windowTarget,
  };
}

describe('administrative Service Worker update monitor', () => {
  afterEach(() => resetAdminServiceWorkerUpdateMonitorForTests());

  it('throttles route-triggered update checks to one request per minute', async () => {
    const harness = createHarness();

    await expect(requestAdminServiceWorkerUpdateCheck({
      navigatorTarget: harness.navigatorTarget,
      now: () => 60_000,
    })).resolves.toEqual({ status: 'checked' });

    await expect(requestAdminServiceWorkerUpdateCheck({
      navigatorTarget: harness.navigatorTarget,
      now: () => 90_000,
    })).resolves.toEqual({ status: 'throttled' });

    await expect(requestAdminServiceWorkerUpdateCheck({
      navigatorTarget: harness.navigatorTarget,
      now: () => 121_000,
    })).resolves.toEqual({ status: 'checked' });

    expect(harness.registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not attempt a network update while offline', async () => {
    const harness = createHarness();
    harness.navigatorTarget.onLine = false;

    await expect(requestAdminServiceWorkerUpdateCheck({
      navigatorTarget: harness.navigatorTarget,
    })).resolves.toEqual({ status: 'offline' });

    expect(harness.serviceWorker.getRegistration).not.toHaveBeenCalled();
  });

  it('checks on startup and registers focus, resume, visibility, online, and pageshow triggers', async () => {
    const harness = createHarness();
    let currentTime = 60_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    const stop = startAdminServiceWorkerUpdateMonitor(harness);
    await flushPromises();
    expect(harness.registration.update).toHaveBeenCalledOnce();
    expect(harness.windowTarget.setInterval).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);

    currentTime = 121_000;
    harness.windowTarget.dispatch('focus');
    await flushPromises();
    expect(harness.registration.update).toHaveBeenCalledTimes(2);

    stop();
    expect(harness.windowTarget.clearInterval).toHaveBeenCalledWith(17);
    dateNow.mockRestore();
  });
});
