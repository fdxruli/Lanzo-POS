import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBroker, createVault as keyringVault } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import { createHandler } from '../../supabase/functions/lanzo-ecom-bridge-qa/handler.mjs';
const createVault = secret => keyringVault({ current: 'test', keys: { test: createHash('sha256').update(secret).digest('base64') } });
import { createEcomSignalReceiver } from '../../src/services/ecommerce/ecomSignalReceiver.js';

const url = 'https://fixture.supabase.co';
const jwt = (extra = {}) => `header.${Buffer.from(JSON.stringify({ sub: 'user', role: 'lanzo_ecom_bridge_receiver',
  iss: `${url}/auth/v1`, aud: 'authenticated', exp: 4000000000, session_id: 'session',
  app_metadata: { lanzo_bridge: 'qa_1a2', binding_id: 'identity' }, ...extra })).toString('base64url')}.signature`;
const session = () => ({ access_token: jwt(), refresh_token: 'server-only-refresh' });
const reserved = () => ({ code: 'RESERVED', id: 'grant', identity_id: 'identity', lease_id: 'lease', auth_user_id: 'user' });
function fixture(overrides = {}) {
  const calls = [];
  const vault = createVault('fixture-server-key');
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'prepare') return reserved();
    if (name === 'finish') return { code: 'READY', expires_at: '2090-01-01T00:00:00Z' };
    return true;
  };
  const auth = { signIn: async () => session(), refresh: async () => session(),
    signOut: async () => calls.push(['signOut']), deleteUser: async () => calls.push(['deleteUser']),
    createUser: async () => ({ id: 'user' }), ...overrides.auth };
  return { calls, vault, issue: createBroker({ rpc: overrides.rpc ?? rpc, auth, vault,
    passwordFor: async () => 'server-only-password', url, publicKey: 'publishable' }) };
}

test('owner-control actions are rejected without the dedicated server control header', async () => {
  let called = false;
  const handler = createHandler({ rpc: async () => { called = true; } }, { controlToken: 'x'.repeat(48) });
  const response = await handler(new Request('https://fixture.supabase.co/functions/v1/qa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve_pilot' })
  }));
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test('pilot approval, kill switch, and pilot revocation use only the server admin capability', async () => {
  const calls = [];
  const token = 'x'.repeat(48);
  const handler = createHandler({ rpc: async (name, args) => { calls.push([name, args]); return { code: 'OK' }; } }, { controlToken: token });
  const send = body => handler(new Request('https://fixture.supabase.co/functions/v1/qa', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lanzo-qa-control': token },
    body: JSON.stringify(body)
  }));
  await send({ action: 'approve_pilot', license_id: 'license', tenant_id: 'tenant', device_id: 'device',
    expires_at: '2090-01-01T00:00:00Z', qa_run_id: 'run', authorized_by: 'owner', approval_ref: 'approval' });
  await send({ action: 'kill_switch', active: true, reason: 'test rollback' });
  await send({ action: 'revoke_pilot', id: 'allowlist-entry' });
  assert.deepEqual(calls, [
    ['approve_pilot', { p_license_id: 'license', p_tenant_id: 'tenant', p_device_id: 'device',
      p_expires_at: '2090-01-01T00:00:00Z', p_qa_run_id: 'run', p_authorized_by: 'owner', p_approval_ref: 'approval' }],
    ['set_kill_switch', { p_active: true, p_reason: 'test rollback' }],
    ['revoke_pilot', { p_id: 'allowlist-entry' }]
  ]);
});

test('broker returns only connection fields and never forwards asserted identity', async () => {
  const { issue, calls } = fixture();
  const r = await issue({ license_key: 'synthetic', tenant_id: 'attacker', actor_id: 'attacker', device_id: 'attacker' });
  assert.equal(r.status, 200);
  assert.equal('tenant_id' in calls[0][1].p, false);
  assert.equal('actor_id' in calls[0][1].p, false);
  assert.equal('device_id' in calls[0][1].p, false);
  assert.doesNotMatch(JSON.stringify(r), /refresh|password|server-only/);
  assert.equal(r.body.topic, 'ecom:qa-probe:1a2:grant');
});
test('vault authenticates binding, ciphertext and key', async () => {
  const vault = createVault('one');
  const box = await vault.seal(session(), 'grant');
  assert.deepEqual(await vault.open(box, 'grant'), session());
  await assert.rejects(vault.open(box, 'other-grant'));
  await assert.rejects(createVault('two').open(box, 'grant'));
  await assert.rejects(vault.open(box.slice(0, -5) + 'AAAAA', 'grant'));
});
test('revoked and concurrent reservations cannot call Auth', async () => {
  for (const code of ['DENIED', 'BUSY', 'CAPACITY', 'RATE_LIMITED']) {
    let called = false;
    const { issue } = fixture({ rpc: async () => ({ code }), auth: { signIn: async () => { called = true; } } });
    assert.notEqual((await issue({})).status, 200);
    assert.equal(called, false);
  }
});
test('creation followed by failed binding compensates Auth and aborts lease', async () => {
  const events = [];
  const { issue } = fixture({ rpc: async name => {
    events.push(name);
    if (name === 'prepare') return { ...reserved(), auth_user_id: null };
    if (name === 'finish') return { code: 'DENIED' };
    if (name === 'abort') return true;
  }, auth: { createUser: async () => ({ id: 'user' }), signOut: async () => events.push('signOut'), deleteUser: async () => events.push('deleteUser') } });
  assert.equal((await issue({})).status, 503);
  assert.deepEqual(events, ['prepare', 'finish', 'abort', 'signOut', 'deleteUser']);
});
test('lost finish response cannot delete an already committed Auth binding', async () => {
  const events = [];
  const { issue } = fixture({ rpc: async name => {
    events.push(name);
    if (name === 'prepare') return { ...reserved(), auth_user_id: null };
    if (name === 'finish') throw new Error('response lost after commit');
    if (name === 'abort') return false;
  }, auth: { signOut: async () => events.push('signOut'), deleteUser: async () => events.push('deleteUser') } });
  assert.equal((await issue({})).status, 503);
  assert.deepEqual(events, ['prepare', 'finish', 'abort']);
});
test('a malformed Auth scope is rejected before binding', async () => {
  const { issue, calls } = fixture({ auth: { signIn: async () => ({ ...session(), access_token: jwt({ role: 'authenticated' }) }) } });
  assert.equal((await issue({})).status, 503);
  assert.equal(calls.some(([name]) => name === 'finish'), false);
});
test('renewal revalidates Lanzo without refreshing a still-valid Auth session', async () => {
  const vault = createVault('fixture-server-key');
  const box = await vault.seal(session(), 'grant');
  let refresh = 0;
  const { issue } = fixture({ rpc: async name => name === 'prepare' ? { ...reserved(), vault: box } : { code: 'READY', expires_at: '2090-01-01T00:00:00Z' },
    auth: { refresh: async token => { assert.equal(token, 'server-only-refresh'); refresh++; return session(); },
      createUser: async () => { throw new Error('must not create'); }, signIn: async () => { throw new Error('must not login'); } } });
  assert.equal((await issue({})).status, 200);
  assert.equal(refresh, 0);
});

function receiverFixture(broker) {
  const timers = new Map(); let id = 0; let now = 0;
  const transports = [];
  const connection = { url, publicKey: 'publishable', accessToken: 'memory', grantExpiresAt: 120000,
    jwtExpiresAt: 3600000, topic: 'ecom:qa-probe:1a2:grant' };
  const controller = createEcomSignalReceiver({ broker: broker ?? (async () => ({ ok: true, connection })), now: () => now,
    setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: id => timers.delete(id), random: () => 0.5,
    createTransport: async () => {
      const t = { disconnected: 0, removed: 0, disconnect() { this.disconnected++; }, removeAllChannels() { this.removed++; },
        setAuth: async () => {}, channel: () => ({ on: (_type, _filter, fn) => { t.probe = fn; }, subscribe: fn => { t.status = fn; } }) };
      transports.push(t); return t;
    } });
  return { controller, transports, timers, connection, advance: value => { now = value; } };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
test('close during broker request discards late token and creates no transport', async () => {
  let resolve;
  const f = receiverFixture(() => new Promise(r => { resolve = r; }));
  const cleanup = f.controller.start({ actor_generation: 1 });
  cleanup(); cleanup();
  resolve({ ok: true, connection: f.connection });
  await flush();
  assert.equal(f.transports.length, 0);
});
test('Strict Mode cleanup cannot destroy the next actor context', async () => {
  const f = receiverFixture(); let count = 0;
  const oldCleanup = f.controller.start({ actor_generation: 1 }, () => count++);
  await flush(); const old = f.transports[0];
  f.controller.start({ actor_generation: 2 }, () => count++); await flush();
  oldCleanup();
  const current = f.transports[1]; current.status('SUBSCRIBED');
  old.probe({ payload: {} }); current.probe({ payload: {} });
  assert.equal(count, 1); assert.equal(current.disconnected, 0);
  f.controller.stop(); assert.equal(current.disconnected, 1);
  assert.equal(f.timers.size, 0);
});
test('authoritative response and channel error stop instead of retrying', async () => {
  const denied = receiverFixture(async () => ({ ok: false, status: 403 }));
  denied.controller.start({}); await flush(); assert.equal(denied.timers.size, 0);
  const f = receiverFixture(); const states = [];
  f.controller.start({}, () => {}, state => states.push(state)); await flush();
  f.transports[0].status('CHANNEL_ERROR', new Error('Unauthorized'));
  assert.equal(states.at(-1), 'denied'); assert.equal(f.timers.size, 0);
});
test('temporary network errors use bounded backoff and never leave two transports', async () => {
  let calls = 0;
  const f = receiverFixture(async () => { calls++; throw new TypeError('Failed to fetch'); });
  f.controller.start({}); await flush();
  for (let i = 0; i < 5; i++) {
    assert.equal(f.timers.size, 1);
    const [id, timer] = [...f.timers][0]; f.timers.delete(id); timer.fn(); await flush();
  }
  assert.equal(calls, 6); assert.equal(f.timers.size, 0);
});
test('expired grant drops messages while JWT remains valid', async () => {
  const f = receiverFixture(); let count = 0;
  f.controller.start({}, () => count++); await flush();
  const t = f.transports[0]; t.status('SUBSCRIBED');
  f.advance(120001); t.probe({ payload: {} });
  assert.equal(count, 0); f.controller.stop();
});
test('repeated close notifications schedule only one reconnect', async () => {
  const f = receiverFixture(); f.controller.start({}); await flush();
  const t = f.transports[0]; t.status('SUBSCRIBED'); t.status('CLOSED'); t.status('CLOSED');
  assert.equal(f.timers.size, 1); f.controller.stop();
});
