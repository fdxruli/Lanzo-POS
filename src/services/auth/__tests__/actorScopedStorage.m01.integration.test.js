/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ tenant: null, session: 'session-a', device: 'device-a', authorize: vi.fn() }));
vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: fixture.tenant }),
  db: { table: (name) => {
    if (name === 'sync_cache') return { get: async (key) => ({ value: {
      admin_session_token: 'synthetic-token', admin_session_id: fixture.session
    }[key] ?? null }) };
    if (name === 'sales') return { filter: () => ({ toArray: async () => [] }) };
    throw new Error(`Unexpected fixture table ${name}`);
  } }
}));
vi.mock('../../supabase', () => ({
  getAdminOfflineAuthorization: (...args) => fixture.authorize(...args),
  getStableDeviceId: async () => fixture.device
}));

const START = Date.parse('2026-10-01T00:00:00Z');
const TENANT = Object.freeze({ opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 });
const CART = 'lanzo-active-orders-storage';
const key = `lanzo:t:${TENANT.opaqueId}:actor-runtime-context:v1`;
let storage, runtime, bridge, tenantStorage, storageListener, bcListener, sent, events, expires;
const durable = () => window.localStorage.getItem(key);
const record = () => JSON.parse(durable());
const hint = (value = null, eventKey = key) => storageListener({ key: eventKey, newValue: value });
const mount = async (session = 'session-a', actor = 'a') => {
  fixture.session = session;
  bridge.beginActorRuntimeAuthentication('admin');
  return bridge.restoreActorRuntimeFromCurrentSessionCache({ actorType: 'admin', actor: { id: actor } });
};
const setup = async (noBC = false) => {
  vi.resetModules();
  sent = []; events = []; storageListener = undefined; bcListener = undefined;
  vi.stubGlobal('BroadcastChannel', noBC ? undefined : class {
    addEventListener(_name, fn) { bcListener = fn; }
    postMessage(message) { sent.push(message); }
  });
  // Capture this module instance's browser callback; do not leak listeners across resets.
  vi.spyOn(window, 'addEventListener').mockImplementation((name, fn) => {
    if (name === 'storage') storageListener = fn;
  });
  storage = await import('../actorScopedStorage');
  ({ actorRuntimeController: runtime } = await import('../actorRuntimeController'));
  bridge = await import('../actorSessionRuntimeBridge');
  tenantStorage = await import('../../tenant/tenantScopedStorage');
  storage.subscribeActorScopedStorage(e => events.push(e));
  tenantStorage.setActiveTenantStorageNamespace(TENANT.opaqueId);
  tenantStorage.markTenantStorageReady();
};
const assertDenied = (handle) => {
  expect(runtime.getState().status).toBe('locked');
  expect(storage.getActorScopedStorageState().writesSuspended).toBe(true);
  expect(() => handle.setItem(CART, 'denied')).toThrow();
};
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(START); vi.stubGlobal('navigator', { onLine: false });
  window.localStorage.clear(); window.sessionStorage.clear();
  fixture.tenant = TENANT; fixture.device = 'device-a'; expires = START + 10000;
  fixture.authorize.mockReset().mockImplementation(async () => ({ eligible: true,
    effectiveExpiresAt: new Date(expires).toISOString(), effectiveNow: Date.now() }));
  await setup();
});
afterEach(() => {
  vi.restoreAllMocks();
  runtime.lock('fixture_cleanup'); storage.invalidateActorScopedStorage('fixture_cleanup');
  tenantStorage.clearActiveTenantStorageNamespace();
  window.localStorage.clear(); window.sessionStorage.clear();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('M-01 durable notification boundary (real bridge/runtime; synthetic authorization)', () => {
  it.each(['StorageEvent', 'BroadcastChannel'])('%s: historical, duplicated and reordered hints preserve the exact grant', async (transport) => {
    await mount(); const before = runtime.getState(), raw = durable();
    const handle = storage.captureActorScopedStorageHandle();
    const calls = fixture.authorize.mock.calls.length, published = sent.length;
    for (const token of ['old-a', 'old-b', 'old-a']) {
      const old = { ...record(), status: 'locked', contextToken: token, actorGeneration: 0 };
      if (transport === 'StorageEvent') hint(JSON.stringify(old)); else bcListener({ data: old });
    }
    expect(runtime.getState()).toEqual(before); expect(durable()).toBe(raw);
    expect(() => handle.setItem(CART, 'current')).not.toThrow();
    expect(fixture.authorize).toHaveBeenCalledTimes(calls); expect(sent).toHaveLength(published);
    expect(events.filter(e => e.type === 'foreign_context')).toHaveLength(0);
  });

  it.each(['contextToken', 'actorOpaqueId', 'actorGeneration', 'tenantOpaqueId', 'status'])('a real durable %s replacement revokes even when the hint carries our token', async (field) => {
    await mount(); const current = record(), handle = storage.captureActorScopedStorageHandle();
    const next = { ...current, [field]: field === 'actorGeneration' ? current.actorGeneration + 1
      : field === 'status' ? 'locked' : 'foreign-value' };
    window.localStorage.setItem(key, JSON.stringify(next)); const published = sent.length;
    hint(JSON.stringify(current)); assertDenied(handle);
    expect(record()).toEqual(next); expect(sent).toHaveLength(published);
    expect(events.filter(e => e.type === 'foreign_context')).toHaveLength(1);
  });

  it.each(['missing', 'corrupt', 'wrong-version', 'unreadable'])('%s durable fails closed without a grant or recursive publication', async (mode) => {
    await mount(); const handle = storage.captureActorScopedStorageHandle(), own = record();
    const published = sent.length, calls = fixture.authorize.mock.calls.length;
    if (mode === 'missing') window.localStorage.removeItem(key);
    if (mode === 'corrupt') window.localStorage.setItem(key, '{broken');
    if (mode === 'wrong-version') window.localStorage.setItem(key, JSON.stringify({ ...own, version: 0 }));
    if (mode === 'unreadable') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    hint(JSON.stringify(own)); assertDenied(handle);
    expect(sent).toHaveLength(published); expect(fixture.authorize).toHaveBeenCalledTimes(calls);
  });

  it('a clear notification rechecks missing durable and revokes', async () => {
    await mount(); const handle = storage.captureActorScopedStorageHandle();
    window.localStorage.clear(); hint(null, null); assertDenied(handle);
  });

  it.each(['storage-key', 'BC-tenant'])('ignores an unrelated %s without comparing generations across documents', async mode => {
    await mount(); const before = runtime.getState();
    if (mode === 'storage-key') hint('{broken', 'another-key');
    else bcListener({ data: { tenantOpaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', actorGeneration: 9999 } });
    expect(runtime.getState()).toEqual(before);
    expect(() => storage.captureActorScopedStorageHandle().setItem(CART, 'own')).not.toThrow();
  });

  it('no BroadcastChannel: durable assertions and StorageEvent still reject actual replacement', async () => {
    vi.restoreAllMocks(); await setup(true); await mount();
    const handle = storage.captureActorScopedStorageHandle();
    window.localStorage.setItem(key, JSON.stringify({ ...record(), contextToken: 'real-replacement' }));
    expect(() => handle.setItem(CART, 'before-hint')).toThrow();
    hint(); assertDenied(handle);
  });

  it('getState expiry during a genuine foreign callback retains expiry and never grants', async () => {
    await mount(); const handle = storage.captureActorScopedStorageHandle(), generation = runtime.getState().generation;
    window.localStorage.setItem(key, JSON.stringify({ ...record(), contextToken: 'foreign' }));
    vi.setSystemTime(expires); hint();
    expect(runtime.getState()).toMatchObject({ status: 'locked', reason: 'admin_offline_authorization_expired', generation: generation + 1 });
    expect(() => handle.assertCurrent()).toThrow();
    // v1 expiry invalidation remains unchanged, including its LC13 limitation.
    expect(record().status).toBe('locked');
  });

  it('an obsolete hint cannot extend a session at expiry even when durable still matches', async () => {
    await mount(); const handle = storage.captureActorScopedStorageHandle();
    vi.setSystemTime(expires); hint(JSON.stringify({ ...record(), contextToken: 'old' }));
    assertDenied(handle); expect(runtime.getState().reason).toBe('admin_offline_authorization_expired');
  });

  it('a binding retired during durable read does not emit a foreign event for its successor', async () => {
    await mount(); const original = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(k) {
      const value = original.call(this, k);
      if (k === key) { spy.mockRestore(); storage.invalidateActorScopedStorage('reentrant-retire'); }
      return value;
    });
    hint();
    expect(storage.getActorScopedStorageState().active).toBeNull();
    expect(events.filter(e => e.type === 'foreign_context')).toHaveLength(0);
  });

  it('a callback delivered during authentication does not lock the pending attempt', async () => {
    await mount(); runtime.lock('transition-start'); bridge.beginActorRuntimeAuthentication('admin');
    const before = runtime.getState(); hint(JSON.stringify({ contextToken: 'old' }));
    expect(runtime.getState()).toEqual(before); expect(before.status).toBe('authenticating');
  });

  it('actual logout rejects the old handle; a valid later session remains independent', async () => {
    await mount(); const old = storage.captureActorScopedStorageHandle();
    bridge.lockActorRuntime('logout'); expect(record().status).toBe('locked');
    expect(() => old.setItem(CART, 'old')).toThrow();
    await mount('session-b'); const current = runtime.getState(); hint(JSON.stringify({ ...record(), contextToken: 'logout-a' }));
    expect(runtime.getState()).toEqual(current); expect(() => old.setItem(CART, 'old')).toThrow();
  });
});
