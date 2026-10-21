import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Module instances model independent documents sharing a Web Storage map.
// Browser scheduling/native Storage are tested separately in browser.mjs.
const source = readFileSync('src/services/auth/actorScopedStorage.js', 'utf8');
let sequence = 0;
const tenant = { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
const key = `lanzo:t:${tenant.opaqueId}:actor-runtime-context:v1`;
const cart = 'lanzo-active-orders-storage';
const fixture = async () => {
  const data = new Map();
  const world = { localStorage: {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k)
  }, addEventListener() {} };
  globalThis.window = world;
  globalThis.BroadcastChannel = undefined;
  const load = () => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${++sequence}`);
  const a = await load(), b = await load();
  const prepare = (s, actorKey = 'admin:a') => s.prepareActorScopedStorage({ tenant, actorKey, actorGeneration: 1 });
  const activate = (s, actorKey = 'admin:a') => {
    s.activateActorScopedStorage({ tenant, actorKey, generation: 1 });
    s.resumeActorScopedStorageWrites();
    return s.captureActorScopedStorageHandle();
  };
  return { a, b, world, data, prepare, activate };
};

test('LC13 sequential: activated stale A retires locally, preserves B, A cannot write', async () => {
  const f = await fixture();
  await f.prepare(f.a); const a = f.activate(f.a);
  await f.prepare(f.b, 'admin:b'); const b = f.activate(f.b, 'admin:b');
  const durable = f.data.get(key);
  f.a.invalidateActorScopedStorage('late-a');
  assert.equal(f.data.get(key), durable);
  assert.throws(() => a.setItem(cart, 'old'));
  assert.doesNotThrow(() => b.setItem(cart, 'new'));
  assert.equal(f.a.getActorScopedStorageState().active, null);
});

test('current owner logout still publishes locked and rejects captured handle', async () => {
  const f = await fixture(); await f.prepare(f.a); const a = f.activate(f.a);
  f.a.invalidateActorScopedStorage('real-logout');
  assert.equal(JSON.parse(f.data.get(key)).status, 'locked');
  assert.throws(() => a.setItem(cart, 'denied'));
});

test('CONCURRENT LIMITATION: B activates between A read and write; B is still overwritten', async () => {
  const f = await fixture(); await f.prepare(f.a); const a = f.activate(f.a);
  await f.prepare(f.b, 'admin:b');
  let b;
  const get = f.world.localStorage.getItem;
  f.world.localStorage.getItem = (k) => {
    const observed = get(k);
    if (k === key) {
      f.world.localStorage.getItem = get;
      b = f.activate(f.b, 'admin:b');
    }
    return observed;
  };
  f.a.invalidateActorScopedStorage('concurrent-a');
  assert.equal(JSON.parse(f.data.get(key)).status, 'locked');
  assert.throws(() => a.assertCurrent());
  assert.throws(() => b.assertCurrent());
  // This detecting assertion PASS means LC13 concurrent security property FAIL.
});

test('PENDING LIMITATION: preserve original pre-activation cleanup behavior explicitly', async () => {
  const f = await fixture(); await f.prepare(f.a);
  await f.prepare(f.b, 'admin:b'); const b = f.activate(f.b, 'admin:b');
  f.a.invalidateActorScopedStorage('old-pending-cleanup');
  assert.equal(JSON.parse(f.data.get(key)).status, 'locked');
  assert.throws(() => b.assertCurrent());
});

test('missing, corrupt or inaccessible durable never revives A after invalidation', async () => {
  for (const mode of ['missing', 'corrupt', 'inaccessible']) {
    const f = await fixture(); await f.prepare(f.a); const a = f.activate(f.a);
    if (mode === 'missing') f.data.delete(key);
    if (mode === 'corrupt') f.data.set(key, '{broken');
    if (mode === 'inaccessible') f.world.localStorage.getItem = () => { throw new Error('denied'); };
    f.a.invalidateActorScopedStorage(mode);
    assert.throws(() => a.assertCurrent());
    assert.throws(() => f.a.resumeActorScopedStorageWrites());
    assert.equal(f.a.getActorScopedStorageState().active, null);
  }
});
