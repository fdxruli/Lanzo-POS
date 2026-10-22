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

import { createLicenseMaintenanceActions } from '../../../store/slices/license/licenseMaintenanceActions';
import { useActorRuntimeSnapshot } from '../useActorRuntimeSnapshot';
import { actorRuntimeController } from '../actorRuntimeController';
import { beginActorRuntimeAuthentication, restoreActorRuntimeFromCurrentSessionCache } from '../actorSessionRuntimeBridge';
import { evaluateAdminOfflineAuthorization } from '../adminOfflineAuthorization';
import { captureActorScopedStorageHandle, getActorScopedStorageState, invalidateActorScopedStorage } from '../actorScopedStorage';
import { clearActiveTenantStorageNamespace, markTenantStorageReady, setActiveTenantStorageNamespace } from '../../tenant/tenantScopedStorage';

const START = Date.parse('2026-10-01T00:00:00Z');
const DAY = 86400000;
const TENANT = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1
});
const contextKey = () => `lanzo:t:${fixture.tenant.opaqueId}:actor-runtime-context:v1`;

const restoreAdmin = async ({ session = 'session-a', expires = START + 1000 } = {}) => {
  fixture.session = session;
  fixture.authorize.mockImplementation(async () => evaluateAdminOfflineAuthorization({
    now: Date.now(),
    evidence: {
      version: 2, validatedAt: Date.now(), expiresAt: new Date(expires).toISOString(),
      sessionId: session, sessionTokenDigest: 'synthetic-token-digest', adminUserId: 'admin-a',
      licenseId: 'synthetic-license', deviceId: fixture.device, deviceRef: fixture.device,
      deviceTokenDigest: 'synthetic-device-digest', tenantOpaqueId: TENANT.opaqueId
    },
    credentials: { adminToken: 'synthetic-admin-token', adminSessionId: session, adminTokenDigest: 'synthetic-token-digest' },
    license: { license_id: 'synthetic-license', device_id: fixture.device, admin_user: { id: 'admin-a' },
      device_role: 'admin', status: 'active', localExpiry: new Date(START + 30 * DAY).toISOString(), expires_at: null },
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
