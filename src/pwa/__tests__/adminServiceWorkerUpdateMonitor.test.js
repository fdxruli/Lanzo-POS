// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestAdminServiceWorkerUpdateCheck,
  resetAdminServiceWorkerUpdateMonitorForTests,
  getAdminUpdateCheckState,
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
  const fetchTarget = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    app: 'lanzo-pos', version: '4.0.0', commit: 'abc', builtAt: '2026-11-06T00:00:00Z', buildId: 'published',
  }), { headers: { 'content-type': 'application/json' } }));
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
    fetchTarget,
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
      ...harness,
      now: () => 60_000,
    })).resolves.toMatchObject({ status: 'available' });

    await expect(requestAdminServiceWorkerUpdateCheck({
      ...harness,
      now: () => 90_000,
    })).resolves.toEqual({ status: 'throttled' });

    await expect(requestAdminServiceWorkerUpdateCheck({
      ...harness,
      now: () => 121_000,
    })).resolves.toMatchObject({ status: 'available' });

    expect(harness.registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not attempt a network update while offline', async () => {
    const harness = createHarness();
    harness.navigatorTarget.onLine = false;

    await expect(requestAdminServiceWorkerUpdateCheck({
      ...harness,
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

describe('truthful deployment checks', () => {
  afterEach(() => { resetAdminServiceWorkerUpdateMonitorForTests(); vi.restoreAllMocks(); });

  it('reports current only after network metadata and worker update both succeed', async () => {
    const harness = createHarness();
    const result = await requestAdminServiceWorkerUpdateCheck({ ...harness, runningBuildId: 'published' });
    expect(result.status).toBe('current');
    expect(harness.fetchTarget).toHaveBeenCalledWith(expect.stringContaining('/build-info.json?'), expect.objectContaining({ cache: 'no-store' }));
    expect(harness.registration.update).toHaveBeenCalledOnce();
  });

  it.each(['network', 'worker', 'html', 'invalid-json'])('never reports current after %s failure', async failure => {
    const harness = createHarness();
    if (failure === 'network') harness.fetchTarget.mockRejectedValue(new TypeError('Failed to fetch'));
    if (failure === 'worker') harness.registration.update.mockRejectedValue(new Error('update failed'));
    if (failure === 'html') harness.fetchTarget.mockImplementation(async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
    if (failure === 'invalid-json') harness.fetchTarget.mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(requestAdminServiceWorkerUpdateCheck({ ...harness, runningBuildId: 'published' })).resolves.toMatchObject({ status: 'error' });
  });

  it('shares simultaneous manual and automatic requests', async () => {
    const harness = createHarness();
    const first = requestAdminServiceWorkerUpdateCheck(harness);
    const second = requestAdminServiceWorkerUpdateCheck({ ...harness, force: true });
    expect(first).toBe(second);
    await first;
    expect(harness.registration.update).toHaveBeenCalledOnce();
    expect(harness.fetchTarget).toHaveBeenCalledOnce();
  });

  it('waits for installation and reports an incomplete download as error', async () => {
    const harness = createHarness();
    const installing = new FakeEventTarget();
    installing.state = 'installing';
    harness.registration.installing = installing;
    const check = requestAdminServiceWorkerUpdateCheck(harness);
    await flushPromises();
    expect(getAdminUpdateCheckState().status).toBe('checking');
    installing.state = 'redundant';
    installing.dispatch('statechange');
    await expect(check).resolves.toMatchObject({ status: 'error' });
    expect(installing.listeners.get('statechange')).toEqual([]);
  });

  it('times out and permits a later retry without retaining installation listeners', async () => {
    const harness = createHarness();
    const installing = new FakeEventTarget();
    installing.state = 'installing';
    harness.registration.installing = installing;
    await expect(requestAdminServiceWorkerUpdateCheck({ ...harness, timeoutMs: 15 })).resolves.toMatchObject({ status: 'error' });
    expect(installing.listeners.get('statechange')).toEqual([]);
    harness.registration.installing = null;
    await expect(requestAdminServiceWorkerUpdateCheck({ ...harness, force: true })).resolves.toMatchObject({ status: 'available' });
  });

  it('detects a web update even without Service Worker support', async () => {
    const harness = createHarness();
    await expect(requestAdminServiceWorkerUpdateCheck({ ...harness, navigatorTarget: { onLine: true } })).resolves.toMatchObject({ status: 'available' });
  });
});
