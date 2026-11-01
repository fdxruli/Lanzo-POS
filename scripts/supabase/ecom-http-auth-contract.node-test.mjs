import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createBroker } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import { applicationKeysFromEnvironment, createHandler } from '../../supabase/functions/lanzo-ecom-bridge-qa/handler.mjs';
import { createVault } from '../../supabase/functions/lanzo-ecom-bridge-qa/secrets.mjs';
import { createEcomSignalBrokerClient } from '../../src/services/ecommerce/ecomSignalReceiver.js';

const projectUrl = 'https://fixture.supabase.co';
const appKey = 'sb_publishable_fixture_project_key';
const foreignKey = 'sb_publishable_other_project_key';
const controlToken = 'control-token-for-http-contract-test-0123456789';
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `header.${enc({
  sub: 'qa-user', role: 'lanzo_ecom_bridge_receiver', iss: `${projectUrl}/auth/v1`, aud: 'authenticated',
  session_id: 'qa-session', exp: 4102444800,
  app_metadata: { lanzo_bridge: 'qa_1a2', binding_id: 'qa-identity' }
})}.signature`;

function makeBackend({ denyPrepare = false, fail = false } = {}) {
  const rpcCalls = [];
  const authCalls = [];
  const rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    if (fail) throw new Error('server-only-secret-and-stack');
    if (name === 'prepare') return denyPrepare ? { code: 'DENIED' } : {
      code: 'RESERVED', id: 'qa-grant', identity_id: 'qa-identity', lease_id: 'qa-lease', auth_user_id: null
    };
    if (name === 'finish') return { code: 'READY', expires_at: '2099-01-01T00:00:00Z' };
    if (name === 'abort') return true;
    throw new Error('unexpected RPC');
  };
  const auth = {
    createUser: async () => { authCalls.push('createUser'); return { id: 'qa-user' }; },
    signIn: async () => { authCalls.push('signIn'); return { access_token: accessToken, refresh_token: 'server-only-refresh' }; },
    refresh: async () => { authCalls.push('refresh'); throw new Error('unexpected refresh'); },
    signOut: async () => { authCalls.push('signOut'); },
    deleteUser: async () => { authCalls.push('deleteUser'); }
  };
  const key = Buffer.alloc(32, 0x43).toString('base64');
  const backend = {
    rpc,
    collect: async () => ({ deleted: 0 }),
    issue: createBroker({ rpc, auth, vault: createVault({ current: 'fixture', keys: { fixture: key } }),
      passwordFor: async () => 'server-only-password', url: projectUrl, publicKey: 'fixture-realtime-key' })
  };
  return { backend, rpcCalls, authCalls };
}

async function withHttp(handler, inspect, run) {
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    inspect?.(headers, incoming.url);
    const init = { method: incoming.method, headers };
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      init.body = Readable.toWeb(incoming);
      init.duplex = 'half';
    }
    try {
      const response = await handler(new Request(`http://127.0.0.1${incoming.url}`, init));
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.statusCode = 500;
      outgoing.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}/functions/v1/lanzo-ecom-bridge-qa`); }
  finally {
    const closed = once(server, 'close');
    server.closeAllConnections();
    server.close();
    await closed;
  }
}

function testKeys() {
  const values = new Map([
    ['SUPABASE_ANON_KEY', 'eyJ.fixture.legacy-anon-key'],
    ['SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: appKey, web: 'sb_publishable_second_valid_key' })],
    ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_never-accepted-by-browser' })]
  ]);
  return applicationKeysFromEnvironment({ get: name => values.get(name) ?? null });
}

test('environment app-key allowlist accepts only this project publishable and legacy anon keys', () => {
  const keys = testKeys();
  assert.equal(keys.has(appKey), true);
  assert.equal(keys.has('sb_publishable_second_valid_key'), true);
  assert.equal(keys.has('eyJ.fixture.legacy-anon-key'), true);
  assert.equal(keys.has(foreignKey), false);
  assert.equal(keys.has('sb_secret_never-accepted-by-browser'), false);
  assert.throws(() => applicationKeysFromEnvironment({ get: name => name === 'SUPABASE_PUBLISHABLE_KEYS' ? '{bad' : null }), /APP_KEY_CONFIG/);
  assert.throws(() => applicationKeysFromEnvironment({ get: name => name === 'SUPABASE_PUBLISHABLE_KEYS'
    ? JSON.stringify({ default: 'sb_secret_wrongly-in-publishable-env' }) : null }), /APP_KEY_CONFIG/);
  assert.throws(() => applicationKeysFromEnvironment({ get: () => null }), /APP_KEY_CONFIG/);
});

test('real browser broker POST uses apikey without Authorization and reaches the grant broker', async () => {
  const observed = [];
  const { backend, rpcCalls, authCalls } = makeBackend();
  await withHttp(createHandler(backend, { applicationKeys: testKeys(), controlToken }), (headers, path) => observed.push({ headers, path }), async httpEndpoint => {
    const broker = createEcomSignalBrokerClient({ endpoint: httpEndpoint, publicKey: appKey });
    const capture = {
      license_key: 'fixture-license', device_fingerprint: 'fixture-device-fingerprint',
      security_token: 'fixture-device-token', actor_session_token: 'fixture-actor-session',
      runtime_id: '11111111-1111-4111-8111-111111111111', actor_generation: 2, tenant_generation: 3,
      tenant_id: 'attacker-controlled-and-not-forwarded'
    };
    const result = await broker(capture, { signal: new AbortController().signal });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.connection.topic, 'ecom:qa-probe:1a2:qa-grant');
    assert.equal(typeof result.connection.accessToken, 'string');
    assert.doesNotMatch(JSON.stringify(result), /refresh_token|server-only-password|server-only-refresh/);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].path, '/functions/v1/lanzo-ecom-bridge-qa');
    assert.equal(observed[0].headers.get('apikey'), appKey);
    assert.equal(observed[0].headers.get('authorization'), null);
    assert.equal(observed[0].headers.get('content-type'), 'application/json');
    assert.deepEqual(rpcCalls.map(([name]) => name), ['prepare', 'finish']);
    const prepared = rpcCalls[0][1].p;
    assert.equal(prepared.license_key, capture.license_key);
    assert.equal(prepared.device_fingerprint, capture.device_fingerprint);
    assert.equal(prepared.security_token, capture.security_token);
    assert.equal(prepared.actor_session_token, capture.actor_session_token);
    assert.equal('tenant_id' in prepared, false);
    assert.deepEqual(authCalls, ['createUser', 'signIn']);
  });
});

test('missing, invalid and other-project apikeys are rejected before broker work', async () => {
  const { backend, rpcCalls, authCalls } = makeBackend();
  await withHttp(createHandler(backend, { applicationKeys: testKeys() }), null, async httpEndpoint => {
    for (const key of [null, 'not-a-project-key', foreignKey]) {
      const response = await fetch(httpEndpoint, {
        method: 'POST',
        headers: { ...(key ? { apikey: key } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: 'fixture-license' })
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { code: 'UNAUTHORIZED' });
    }
  });
  assert.deepEqual(rpcCalls, []);
  assert.deepEqual(authCalls, []);
});

test('a valid application key without Lanzo credentials reaches prepare but creates no Auth identity', async () => {
  const { backend, rpcCalls, authCalls } = makeBackend({ denyPrepare: true });
  await withHttp(createHandler(backend, { applicationKeys: testKeys() }), null, async httpEndpoint => {
    const response = await fetch(httpEndpoint, { method: 'POST',
      headers: { apikey: appKey, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'DENIED' });
  });
  assert.deepEqual(rpcCalls.map(([name]) => name), ['prepare']);
  assert.deepEqual(authCalls, []);
  assert.equal(rpcCalls[0][1].p.license_key, undefined);
  assert.equal(rpcCalls[0][1].p.security_token, undefined);
  assert.equal(rpcCalls[0][1].p.actor_session_token, undefined);
});

test('HTTP boundary rejects wrong content type and excessive payload before broker work', async () => {
  const { backend, rpcCalls } = makeBackend();
  await withHttp(createHandler(backend, { applicationKeys: testKeys() }), null, async httpEndpoint => {
    const wrongType = await fetch(httpEndpoint, { method: 'POST', headers: { apikey: appKey, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
    assert.deepEqual(await wrongType.json(), { code: 'UNSUPPORTED_MEDIA_TYPE' });
    const large = await fetch(httpEndpoint, { method: 'POST', headers: { apikey: appKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(9000) }) });
    assert.equal(large.status, 413);
    assert.equal(await large.text(), '');
  });
  assert.deepEqual(rpcCalls, []);
});

test('administrative HTTP actions need both the project key and the dedicated control token', async () => {
  let collections = 0;
  const backend = { collect: async () => { collections++; return { deleted: 0 }; }, issue: async () => assert.fail('not an issuance action') };
  await withHttp(createHandler(backend, { applicationKeys: testKeys(), controlToken }), null, async httpEndpoint => {
    for (const token of [null, 'wrong-control-token']) {
      const response = await fetch(httpEndpoint, { method: 'POST',
        headers: { apikey: appKey, 'Content-Type': 'application/json', ...(token ? { 'x-lanzo-qa-control': token } : {}) },
        body: JSON.stringify({ action: 'collect' }) });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { code: 'DENIED' });
    }
    const authorized = await fetch(httpEndpoint, { method: 'POST',
      headers: { apikey: appKey, 'Content-Type': 'application/json', 'x-lanzo-qa-control': controlToken },
      body: JSON.stringify({ action: 'collect' }) });
    assert.equal(authorized.status, 200);
  });
  assert.equal(collections, 1);
});

test('HTTP error responses do not disclose backend details', async () => {
  const { backend } = makeBackend({ fail: true });
  await withHttp(createHandler(backend, { applicationKeys: testKeys() }), null, async httpEndpoint => {
    const response = await fetch(httpEndpoint, { method: 'POST', headers: { apikey: appKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: 'fixture-license', device_fingerprint: 'fixture-device',
        security_token: 'fixture-token', actor_session_token: 'fixture-session' }) });
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.doesNotMatch(body, /server-only-secret-and-stack|server-only-password|server-only-refresh/);
    assert.match(body, /UNAVAILABLE/);
  });
});

test('deployment config scopes verify_jwt=false to this QA function only', async () => {
  const config = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  const functionSections = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*$/gm)];
  assert.deepEqual(functionSections.map(match => match[1]), ['lanzo-ecom-bridge-qa']);
  assert.match(config, /^\[functions\.lanzo-ecom-bridge-qa\]\s*\r?\n(?:[^\r\n]*\r?\n)*?verify_jwt\s*=\s*false\s*$/m);
});
