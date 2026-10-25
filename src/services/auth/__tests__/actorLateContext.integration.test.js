/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ tenant: null, session: 'session-a', device: 'device-a', authorize: vi.fn() }));
vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: fixture.tenant }),
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
  actorRuntimeController.lock('fixture_cleanup');
  invalidateActorScopedStorage('fixture_cleanup');
  clearActiveTenantStorageNamespace();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('late actor-context integration — reconstructed EXP-F02-14 only', () => {
  it('EXP-F02-14 / LC-01 / LC-09 / LC-20: preserves the later legitimate Admin grant after an obsolete storage notification', async () => {
    await restoreAdmin();
    const oldRuntime = actorRuntimeController.capture();
    const oldStorage = captureActorScopedStorageHandle();
    vi.setSystemTime(START + 1000);
    expect(actorRuntimeController.getState().status).toBe('locked');
    const obsolete = window.localStorage.getItem(contextKey());
    const granted = await restoreAdmin({ session: 'session-b', expires: START + 10000 });
    const newRuntime = actorRuntimeController.capture();
    const newStorage = captureActorScopedStorageHandle();
    const durable = window.localStorage.getItem(contextKey());
    const authorizationCalls = fixture.authorize.mock.calls.length;
    expect(granted).toMatchObject({ status: 'granted', sessionId: 'session-b' });
    expect(durable).not.toBe(obsolete);
    window.dispatchEvent(new StorageEvent('storage', {
      key: contextKey(), newValue: obsolete, storageArea: window.localStorage
    }));
    const after = actorRuntimeController.getState();
    console.info('EXP-F02-14', JSON.stringify({
      before: granted, after, durableNewRecordPreserved: window.localStorage.getItem(contextKey()) === durable,
      writesSuspended: getActorScopedStorageState().writesSuspended
    }));
    expect(window.localStorage.getItem(contextKey())).toBe(durable);
    expect(() => oldRuntime.assertCurrent()).toThrow();
    expect(() => oldStorage.assertCurrent()).toThrow();
    expect(after).toEqual(granted);
    expect(getActorScopedStorageState().writesSuspended).toBe(false);
    expect(() => newRuntime.assertCurrent()).not.toThrow();
    expect(() => newStorage.assertCurrent()).not.toThrow();
    expect(fixture.authorize).toHaveBeenCalledTimes(authorizationCalls);
  });
});
