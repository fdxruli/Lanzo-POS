/* @vitest-environment jsdom */
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ tenant: null, session: 'session-a', device: 'device-a', authorize: vi.fn(), ready: true }));
vi.mock('../../licenseService', () => ({ renewLicenseService: vi.fn() }));
vi.mock('../../licenseStorage', () => ({ saveLicenseToStorage: vi.fn() }));
vi.mock('../../tenant/localTenantGuard', () => ({ assertLocalTenantSyncAccess: vi.fn() }));
vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: fixture.ready, runtime: fixture.tenant }),
  db: { table: (name) => {
    if (name === 'sync_cache') return { get: async (key) => ({ value: {
      admin_session_token: 'synthetic-admin-token', admin_session_id: fixture.session
    }[key] ?? null }) };
    if (name === 'sales') return { filter: () => ({ toArray: async () => [] }) };
    throw new Error(`Unexpected fixture table: ${name}`);
  } }
}));
vi.mock('../../supabase', () => ({
  getAdminOfflineAuthorization: (...args) => fixture.authorize(...args),
  getStableDeviceId: async () => fixture.device
}));

import { getPendingActorOperations, runTrackedActorOperationWithHandle } from '../actorOperationalHandoff';
import { startAdminServiceWorker, resetAdminServiceWorkerForTests, setAdminServiceWorkerReloadGuard, getAdminServiceWorkerState } from '../../../pwa/adminServiceWorker';
import { startAdminResumeChecks } from '../../../pwa/adminResumeChecks';
import { createLicenseMaintenanceActions } from '../../../store/slices/license/licenseMaintenanceActions';
import { useActorRuntimeSnapshot } from '../useActorRuntimeSnapshot';
import { actorRuntimeController } from '../actorRuntimeController';
import { beginActorRuntimeAuthentication, restoreActorRuntimeFromCurrentSessionCache } from '../actorSessionRuntimeBridge';
import { evaluateAdminOfflineAuthorization } from '../adminOfflineAuthorization';
import { captureActorScopedStorageHandle, invalidateActorScopedStorage } from '../actorScopedStorage';
import { clearActiveTenantStorageNamespace, markTenantStorageReady, setActiveTenantStorageNamespace } from '../../tenant/tenantScopedStorage';

const START = Date.parse('2026-10-01T00:00:00Z');
const DAY = 86400000;
const TENANT = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1
});
const contextKey = () => `lanzo:t:${fixture.tenant.opaqueId}:actor-runtime-context:v1`;

const restoreAdmin = async ({ session = 'session-a', expires = START + 1000, validatedAt = START, licenseExpiry = START + 30 * DAY } = {}) => {
  fixture.session = session;
  fixture.authorize.mockImplementation(async () => evaluateAdminOfflineAuthorization({
    now: Date.now(),
    evidence: {
      version: 2, validatedAt, expiresAt: new Date(expires).toISOString(),
      sessionId: session, sessionTokenDigest: 'synthetic-token-digest', adminUserId: 'admin-a',
      licenseId: 'synthetic-license', deviceId: fixture.device, deviceRef: fixture.device,
      deviceTokenDigest: 'synthetic-device-digest', tenantOpaqueId: TENANT.opaqueId
    },
    credentials: { adminToken: 'synthetic-admin-token', adminSessionId: session, adminTokenDigest: 'synthetic-token-digest' },
    license: { license_id: 'synthetic-license', device_id: fixture.device, admin_user: { id: 'admin-a' },
      device_role: 'admin', status: 'active', localExpiry: new Date(licenseExpiry).toISOString(), expires_at: null },
    adminUser: { id: 'admin-a' }, deviceRef: fixture.device, deviceTokenDigest: 'synthetic-device-digest',
    tenantOpaqueId: TENANT.opaqueId, tenantBinding: { tenantIdentity: 'license-id:synthetic-license' }
  }));
  beginActorRuntimeAuthentication('admin');
  return restoreActorRuntimeFromCurrentSessionCache({ actorType: 'admin', actor: { id: 'admin-a' } });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal('navigator', { onLine: false });
  fixture.tenant = TENANT;
  fixture.ready = true;
  fixture.device = 'device-a';
  fixture.authorize.mockReset();
  actorRuntimeController.lock('fixture_reset');
  invalidateActorScopedStorage('fixture_reset');
  window.localStorage.clear();
  window.sessionStorage.clear();
  setActiveTenantStorageNamespace(TENANT.opaqueId);
  markTenantStorageReady();
});
afterEach(() => {
  cleanup();
  actorRuntimeController.lock('fixture_cleanup');
  invalidateActorScopedStorage('fixture_cleanup');
  clearActiveTenantStorageNamespace();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


const health = (overrides = {}) => {
  const state = { appStatus: 'ready', _isInitializing: false,
    runLicenseSyncCheck: vi.fn(async () => undefined), ...overrides };
  Object.assign(state, createLicenseMaintenanceActions({ set: vi.fn(), get: () => state }));
  return state;
};

describe('F-02 health check against canonical React authority', () => {
  it('EXP-F02-01: keeps the complete valid grant, durable and handles unchanged offline', async () => {
    const grant = await restoreAdmin();
    const handle = actorRuntimeController.capture();
    const durable = localStorage.getItem(contextKey());
    const calls = fixture.authorize.mock.calls.length;
    const { result } = renderHook(useActorRuntimeSnapshot);
    await act(async () => { await health().performSystemHealthCheck('focus'); });
    expect(result.current).toEqual(grant);
    expect(actorRuntimeController.getState()).toEqual(grant);
    expect(localStorage.getItem(contextKey())).toBe(durable);
    expect(handle.assertCurrent()).toEqual(grant);
    expect(fixture.authorize).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['offline without timestamp', {}],
    ['initializing', { _isInitializing: true }],
    ['app not ready', { appStatus: 'loading' }],
    ['tenant not ready', { tenantNotReady: true }],
    ['short inactivity', { short: true }],
    ['realtime mode', { licenseSyncMode: 'hybrid_realtime' }]
  ])('EXP-F02-02/04: expiry reaches React before early return: %s', async (_label, options) => {
    const grant = await restoreAdmin();
    const handle = actorRuntimeController.capture();
    const { result } = renderHook(useActorRuntimeSnapshot);
    expect(result.current.status).toBe('granted');
    vi.setSystemTime(START + 999);
    await act(async () => { await health().performSystemHealthCheck('focus'); });
    expect(result.current).toEqual(grant);
    // No controller read between advancing time and invoking the health action.
    vi.setSystemTime(START + 1000);
    if (options.tenantNotReady) fixture.ready = false;
    if (options.short) sessionStorage.setItem('lanzo_last_active', String(START + 999));
    const state = health(options);
    await act(async () => { await state.performSystemHealthCheck('focus'); });
    expect(result.current).toMatchObject({ status: 'locked', reason: 'admin_offline_authorization_expired', generation: grant.generation + 1 });
    expect(JSON.parse(localStorage.getItem(contextKey())).status).toBe('locked');
    expect(() => handle.assertCurrent()).toThrow();
    expect(state.runLicenseSyncCheck).not.toHaveBeenCalled();
  });

  it('EXP-F02-13: expiry publishes once despite reentrant observers and repeated checks', async () => {
    const grant = await restoreAdmin();
    const observer = vi.fn(() => actorRuntimeController.getState());
    const unsubscribe = actorRuntimeController.subscribe(observer);
    try {
      vi.setSystemTime(START + 1001);
      const state = health();
      await Promise.all(['focus', 'visibility', 'online', 'pageshow'].map(r => state.performSystemHealthCheck(r)));
      expect(observer).toHaveBeenCalledTimes(1);
      expect(actorRuntimeController.getState().generation).toBe(grant.generation + 1);
      expect(observer).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('EXP-F02-11: a known lock is not restored by resume', async () => {
    await restoreAdmin();
    actorRuntimeController.lock('known_revocation');
    const locked = actorRuntimeController.getState();
    const calls = fixture.authorize.mock.calls.length;
    await health().performSystemHealthCheck('focus');
    expect(actorRuntimeController.getState()).toEqual(locked);
    expect(fixture.authorize).toHaveBeenCalledTimes(calls);
  });
});


describe('F-02 resume events and policy boundaries', () => {
  let stop;
  beforeEach(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
  afterEach(() => { stop?.(); stop = null; });

  it.each(['focus', 'pageshow', 'online', 'resume', 'visibilitychange'])('EXP-F02-03: %s publishes expiry before the remote debounce', async event => {
    const grant = await restoreAdmin();
    const { result } = renderHook(useActorRuntimeSnapshot);
    const performHealthCheck = vi.fn();
    stop = startAdminResumeChecks({ performHealthCheck });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.setSystemTime(START + 1000);
    // React retains the old snapshot until a lifecycle signal evaluates it.
    expect(result.current).toEqual(grant);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { (['resume', 'visibilitychange'].includes(event) ? document : window).dispatchEvent(new Event(event)); });
    expect(result.current.status).toBe('locked');
    expect(performHealthCheck).not.toHaveBeenCalled();
  });

  it.each([
    ['EXP-F02-05 / 168h', { expires: START + 30 * DAY }, START + 7 * DAY],
    ['EXP-F02-06 / shorter session', { expires: START + 1000 }, START + 1000],
    ['EXP-F02-07 / shorter license', { expires: START + 30 * DAY, licenseExpiry: START + 500 }, START + 500]
  ])('%s: uses the existing shortest deadline without renewal', async (_name, options, deadline) => {
    const grant = await restoreAdmin(options);
    expect(grant.authorizationExpiresAt).toBe(deadline);
    const { result } = renderHook(useActorRuntimeSnapshot);
    const performHealthCheck = vi.fn();
    stop = startAdminResumeChecks({ performHealthCheck });
    vi.setSystemTime(deadline - 1);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toEqual(grant);
    vi.setSystemTime(deadline);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toMatchObject({ status: 'locked', generation: grant.generation + 1 });
    vi.setSystemTime(deadline + 1);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.generation).toBe(grant.generation + 1);
    expect(performHealthCheck).not.toHaveBeenCalled();
  });

  it('EXP-F02-12: onLine true with rejected transport preserves an unexpired grant', async () => {
    const grant = await restoreAdmin();
    vi.stubGlobal('navigator', { onLine: true });
    const transportError = new Error('synthetic transport unreachable');
    const state = health({ runLicenseSyncCheck: vi.fn().mockRejectedValue(transportError) });
    await expect(state.performSystemHealthCheck('online')).rejects.toBe(transportError);
    expect(actorRuntimeController.getState()).toEqual(grant);
  });

  it('EXP-F02-14: expiry via resume then a historical hint preserves new session B', async () => {
    await restoreAdmin();
    const oldHandle = actorRuntimeController.capture();
    const oldStorage = captureActorScopedStorageHandle();
    const state = health();
    stop = startAdminResumeChecks({ performHealthCheck: state.performSystemHealthCheck });
    vi.setSystemTime(START + 1000);
    act(() => window.dispatchEvent(new Event('focus')));
    const obsolete = localStorage.getItem(contextKey());
    const grantB = await restoreAdmin({ session: 'session-b', expires: START + 10000, validatedAt: START + 1000 });
    const runtimeB = actorRuntimeController.capture();
    const storageB = captureActorScopedStorageHandle();
    const durableB = localStorage.getItem(contextKey());
    const calls = fixture.authorize.mock.calls.length;
    window.dispatchEvent(new StorageEvent('storage', { key: contextKey(), newValue: obsolete, storageArea: localStorage }));
    await vi.advanceTimersByTimeAsync(250);
    expect(actorRuntimeController.getState()).toEqual(grantB);
    expect(localStorage.getItem(contextKey())).toBe(durableB);
    expect(() => oldHandle.assertCurrent()).toThrow();
    expect(() => oldStorage.assertCurrent()).toThrow();
    expect(() => runtimeB.assertCurrent()).not.toThrow();
    expect(() => storageB.assertCurrent()).not.toThrow();
    expect(fixture.authorize).toHaveBeenCalledTimes(calls);
  });

  it('EXP-F02-15: deferred tenant A work is discarded after a legitimate tenant B grant', async () => {
    await restoreAdmin();
    const performHealthCheck = vi.fn();
    stop = startAdminResumeChecks({ performHealthCheck });
    window.dispatchEvent(new Event('focus'));
    actorRuntimeController.lock('tenant_transition');
    invalidateActorScopedStorage('tenant_transition');
    fixture.tenant = { ...TENANT, opaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', generation: 2 };
    // Synthetic direct grant isolates the helper boundary; no B login is claimed.
    actorRuntimeController.beginAuthentication({ actorType: 'admin' });
    const grantB = actorRuntimeController.grant({ actorType: 'admin', actorId: 'admin-b', sessionId: 'session-b', deviceRef: 'device-b',
      tenantOpaqueId: fixture.tenant.opaqueId, authorizationExpiresAt: new Date(START + 10000).toISOString() });
    await vi.advanceTimersByTimeAsync(250);
    expect(performHealthCheck).not.toHaveBeenCalled();
    expect(actorRuntimeController.getState()).toEqual(grantB);
  });

  it('EXP-F02-16 / RESUME-07: a deferred protected callback cannot commit with an expired handle', async () => {
    await restoreAdmin();
    const handle = actorRuntimeController.capture();
    const commit = vi.fn();
    let resolve;
    const pending = new Promise(done => { resolve = done; }).then(() => { handle.assertCurrent(); commit(); });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    vi.setSystemTime(START + 1000);
    await health().performSystemHealthCheck('focus');
    resolve();
    await rejected;
    expect(commit).not.toHaveBeenCalled();
  });
});


describe('F02 resume with pending lifecycle services', () => {
  let stop;
  beforeEach(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
  afterEach(() => { stop?.(); stop = null; resetAdminServiceWorkerForTests(); });

  it('RESUME-08: hours away and pending transport do not delay local expiration or duplicate checks', async () => {
    await restoreAdmin({ expires: START + 4 * 60 * 60 * 1000 });
    const { result } = renderHook(useActorRuntimeSnapshot);
    vi.stubGlobal('navigator', { onLine: true });
    let reject;
    const state = health({ runLicenseSyncCheck: vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })) });
    stop = startAdminResumeChecks({ performHealthCheck: state.performSystemHealthCheck });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(250);
    expect(state.runLicenseSyncCheck).toHaveBeenCalledTimes(1);
    vi.setSystemTime(START + 4 * 60 * 60 * 1000);
    act(() => { document.dispatchEvent(new Event('resume')); window.dispatchEvent(new Event('online')); });
    expect(result.current.status).toBe('locked');
    expect(state.runLicenseSyncCheck).toHaveBeenCalledTimes(1);
    reject(Error('synthetic transport unreachable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.status).toBe('locked');
  });

  it('RESUME-09: a resume during the real bridge authentication does not start another restore', async () => {
    await restoreAdmin({ expires: START + 10000 });
    actorRuntimeController.lock('fixture_new_authentication');
    invalidateActorScopedStorage('fixture_new_authentication');
    const authorize = fixture.authorize.getMockImplementation();
    let release;
    fixture.authorize.mockImplementation(async args => { await new Promise(done => { release = done; }); return authorize(args); });
    beginActorRuntimeAuthentication('admin');
    const pending = restoreActorRuntimeFromCurrentSessionCache({ actorType: 'admin', actor: { id: 'admin-a' } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const authentication = actorRuntimeController.getState();
    const state = health({ _isInitializing: true });
    stop = startAdminResumeChecks({ performHealthCheck: state.performSystemHealthCheck });
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('resume'));
    await vi.advanceTimersByTimeAsync(250);
    expect(actorRuntimeController.getState()).toEqual(authentication);
    expect(state.runLicenseSyncCheck).not.toHaveBeenCalled();
    expect(fixture.authorize).toHaveBeenCalledTimes(2); // one initial, one pending restore
    release(); await pending;
    expect(actorRuntimeController.getState().status).toBe('granted');
    expect(fixture.authorize).toHaveBeenCalledTimes(2);
  });

  it('RESUME-10: a waiting Service Worker and tracked operation survive resume without activation/reload', async () => {
    await restoreAdmin({ expires: START + 10000 });
    let finish;
    const operation = runTrackedActorOperationWithHandle(actorRuntimeController.capture(), 'synthetic_pending', () => new Promise(done => { finish = done; }));
    expect(getPendingActorOperations()).toHaveLength(1);
    const waiting = { state: 'installed', postMessage: vi.fn() };
    const registration = Object.assign(new EventTarget(), { active: {}, waiting, update: vi.fn() });
    const serviceWorker = Object.assign(new EventTarget(), { controller: {}, register: vi.fn(async () => registration) });
    const windowTarget = { location: { reload: vi.fn() }, setInterval: vi.fn(() => 1), clearInterval: vi.fn(), setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) };
    setAdminServiceWorkerReloadGuard(() => getPendingActorOperations().length === 0);
    await startAdminServiceWorker({ navigatorTarget: { serviceWorker, onLine: true }, windowTarget });
    const state = health();
    stop = startAdminResumeChecks({ performHealthCheck: state.performSystemHealthCheck });
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('resume'));
    await vi.advanceTimersByTimeAsync(250);
    expect(getAdminServiceWorkerState().waiting).toBe(true);
    expect(getPendingActorOperations()).toHaveLength(1);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(windowTarget.location.reload).not.toHaveBeenCalled();
    finish(); await operation;
    expect(getPendingActorOperations()).toHaveLength(0);
  });
});
