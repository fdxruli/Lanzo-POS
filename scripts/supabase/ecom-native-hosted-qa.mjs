// Requires the explicitly installed QA candidate + synthetic fixtures + temporary
// capability-protected driver. Never reads or logs privileged credentials.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const sdkPath = process.argv.find(a => a.startsWith('--sdk='))?.slice(6);
const { RealtimeClient } = await import(sdkPath || '@supabase/supabase-js');
const root = resolve(import.meta.dirname, '../..');
const folder = resolve(root, '.tmp/ecom-native-qa');
const fixture = JSON.parse(readFileSync(resolve(folder, 'private-fixtures.json')));
const driver = JSON.parse(readFileSync(resolve(folder, 'private-driver.json')));
const endpoint = 'https://odlrhijtfyavryeqivaa.supabase.co/functions/v1/lanzo-ecom-bridge-qa';
const results = [], clients = [], received = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (id, ok, detail = {}) => { results.push({ id, status: ok ? 'PASS' : 'FAIL', ...detail }); };
async function issue(capture) {
  const start = performance.now();
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capture), signal: AbortSignal.timeout(25000) });
  return { status: r.status, body: await r.json(), ms: performance.now() - start };
}
async function control(action, args = {}) {
  const start = performance.now();
  const r = await fetch(driver.endpoint, { method: 'POST', headers: { 'x-lanzo-qa': driver.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...args }), signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`QA_CONTROL_${r.status}`);
  return { ...await r.json(), elapsed_ms: performance.now() - start };
}
async function join(connection, topic = connection.topic, token = connection.accessToken) {
  const client = new RealtimeClient(`${connection.url}/realtime/v1`, { params: { apikey: connection.publicKey } });
  clients.push(client); await client.setAuth(token);
  const channel = client.channel(topic, { config: { private: true, broadcast: { ack: true, self: false } } });
  channel.on('broadcast', { event: '*' }, message => received.push({ at: Date.now(), topic, event: message.event, payload: message.payload }));
  const start = performance.now();
  const joined = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ status: 'HARNESS_TIMEOUT' }), 15000);
    channel.subscribe((status, error) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
        clearTimeout(timer); resolve({ status, error: error?.message ?? null });
      }
    });
  });
  return { client, channel, ...joined, ms: performance.now() - start };
}
async function rest(c, path, body, method = 'POST') {
  const r = await fetch(`${c.url}${path}`, { method, headers: { apikey: c.publicKey,
    Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
try {
  const capture = fixture.captures[0]; const t = fixture.tenants[0];
  const issued = await issue(capture); check('AUTH-01', issued.status === 200, { ms: issued.ms });
  if (issued.status !== 200) throw new Error(`BROKER_${issued.status}_${issued.body.code}`);
  const c = issued.body;
  const decoded = JSON.parse(Buffer.from(c.accessToken.split('.')[1], 'base64url'));
  check('NATIVE-CLAIMS', decoded.role === 'lanzo_ecom_bridge_receiver' && decoded.sub && decoded.session_id && decoded.app_metadata?.lanzo_bridge === 'qa_1a2',
    { role: decoded.role, issuer: decoded.iss, audience: decoded.aud, native_ttl_seconds: decoded.exp - decoded.iat });
  const retry = await issue(capture);
  check('AUTH-27', retry.status === 200 && retry.body.grantId === c.grantId, { ms: retry.ms });
  for (const [id, input] of [
    ['AUTH-02', { ...capture, actor_session_token: 'invalid' }],
    ['AUTH-03', { ...capture, actor_session_token: t.deniedToken, runtime_id: randomUUID() }],
    ['AUTH-06', { ...capture, license_key: fixture.tenants[1].key }],
  ]) { const r = await issue(input); check(id, r.status === 403, { status: r.status, ms: r.ms }); }
  const own = await join(c); check('AUTH-07', own.status === 'SUBSCRIBED', { status: own.status, error: own.error, ms: own.ms });
  if (own.status !== 'SUBSCRIBED') throw new Error('JOIN_DENIED');
  const probe = randomUUID(); const sent = await control('publish', { id: c.grantId, probe });
  await sleep(1800);
  check('PROBE-DELIVERY', sent.code === 'ENQUEUED' && received.some(x => x.payload?.probe_id === probe), { publish: sent, received: received.filter(x => x.payload?.probe_id === probe) });
  const foreign = await join(c, `ecom:qa-probe:1a2:${randomUUID()}`);
  check('AUTH-09', foreign.status === 'CHANNEL_ERROR', { status: foreign.status, error: foreign.error, ms: foreign.ms });
  foreign.client.disconnect();
  const badJwt = `${c.accessToken.slice(0, -8)}AAAAAAAA`;
  const tampered = await join(c, c.topic, badJwt);
  check('AUTH-08', tampered.status === 'CHANNEL_ERROR', { status: tampered.status, error: tampered.error, ms: tampered.ms }); tampered.client.disconnect();
  const broadcast = await own.channel.send({ type: 'broadcast', event: 'qa_probe', payload: { probe_id: randomUUID() } });
  check('AUTH-21', broadcast !== 'ok', { response: broadcast });
  const presence = await own.channel.track({ probe_id: randomUUID() });
  check('AUTH-22', presence !== 'ok', { response: presence });
  const table = await rest(c, `/rest/v1/licenses?select=id&id=eq.${t.id}`, undefined, 'GET');
  check('AUTH-24', table.status === 403, { status: table.status, code: table.body?.code });
  const rpc = await rest(c, '/rest/v1/rpc/admin_list_staff_users', { p_license_key: t.key,
    p_admin_device_fingerprint: t.fingerprint, p_admin_security_token: t.token, p_admin_session_token: t.actorToken });
  check('AUTH-23', rpc.status === 403, { status: rpc.status, code: rpc.body?.code });
  const self = await rest(c, '/auth/v1/user', { data: { role: 'service_role', lanzo_bridge: 'attempted' },
    app_metadata: { lanzo_bridge: 'attempted' }, role: 'service_role' }, 'PUT');
  const ordinaryMetadata = await rest(c, '/auth/v1/user', { data: { role: 'service_role', lanzo_bridge: 'attempted' } }, 'PUT');
  check('AUTH-25-METADATA', self.status === 403 && ordinaryMetadata.status === 200 && ordinaryMetadata.body?.role === 'lanzo_ecom_bridge_receiver'
    && ordinaryMetadata.body?.app_metadata?.lanzo_bridge === 'qa_1a2', { protected_status: self.status,
      user_metadata_status: ordinaryMetadata.status, role: ordinaryMetadata.body?.role, app_scope: ordinaryMetadata.body?.app_metadata?.lanzo_bridge });
  // Revalidate after the 10s idempotency window. Same Auth session, same grant.
  await sleep(11000);
  const renewal = await issue(capture);
  const renewed = renewal.status === 200 ? JSON.parse(Buffer.from(renewal.body.accessToken.split('.')[1], 'base64url')) : null;
  check('BROKER-RENEWAL', renewal.status === 200 && renewed.session_id === decoded.session_id && renewal.body.grantId === c.grantId, { ms: renewal.ms, status: renewal.status });
  const revoke = await control('revoke', { id: c.grantId }); const confirmedAt = Date.now();
  const afterProbe = randomUUID(); const excluded = await control('publish', { id: c.grantId, probe: afterProbe });
  await sleep(2000);
  check('AUTH-12', revoke.code === 'REVOKED' && excluded.code === 'EXCLUDED' && own.channel.state === 'joined'
    && !received.some(x => x.payload?.probe_id === afterProbe), { revoke, excluded, socket_state: own.channel.state,
      confirmed_at: confirmedAt, events_received_after_confirmation: received.filter(x => x.at > confirmedAt) });
  const renewalDenied = await issue(capture); check('AUTH-13', renewalDenied.status === 403, { ms: renewalDenied.ms, status: renewalDenied.status });
  const revokedJoin = await join(c); check('REVOKED-NEW-JOIN', revokedJoin.status === 'CHANNEL_ERROR', { status: revokedJoin.status, error: revokedJoin.error }); revokedJoin.client.disconnect();
  const tabs = [];
  for (let n = 0; n < 4; n++) { const tab = await issue({ ...capture, runtime_id: randomUUID() }); tabs.push(tab.status); }
  check('AUTH-17', tabs.slice(0, 3).every(s => s === 200) && tabs[3] === 429, { responses: tabs });
  const other = await issue(fixture.captures[1]);
  check('AUTH-15-BROKER', other.status === 200 && other.body.grantId !== c.grantId, { status: other.status });
  if (other.status === 200) {
    const cross = await join(other.body, c.topic); check('AUTH-15-REALTIME', cross.status === 'CHANNEL_ERROR', { status: cross.status, error: cross.error }); cross.client.disconnect();
  }
  const secondDevice = await issue({ ...capture, device_fingerprint: t.fingerprint2, runtime_id: randomUUID() });
  check('AUTH-16', secondDevice.status === 200 && JSON.parse(Buffer.from(secondDevice.body.accessToken.split('.')[1], 'base64url')).sub !== decoded.sub,
    { status: secondDevice.status });
  // A stolen receiver can change its own password through Auth. Measure that
  // residual capability, then prove a self-created session gets no Lanzo grant.
  const password = randomUUID() + randomUUID();
  const changed = await rest(c, '/auth/v1/user', { password }, 'PUT');
  const loginResponse = await fetch(`${c.url}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: c.publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: decoded.email, password }) });
  const selfSession = await loginResponse.json();
  check('AUTH-25-PASSWORD', changed.status === 200 && loginResponse.status === 200,
    { password_update_status: changed.status, self_login_status: loginResponse.status, residual: 'receiver can change own password and create unbound Auth session' });
  if (selfSession.access_token) {
    const unbound = await join(c, c.topic, selfSession.access_token);
    check('AUTH-10', unbound.status === 'CHANNEL_ERROR', { status: unbound.status, error: unbound.error }); unbound.client.disconnect();
    await rest({ ...c, accessToken: selfSession.access_token }, '/auth/v1/logout?scope=local', undefined);
  }
  const expiring = await issue({ ...capture, actor_session_token: t.staffToken, runtime_id: randomUUID() });
  check('STAFF-ECOMMERCE-WITHOUT-SETTINGS', expiring.status === 200, { status: expiring.status });
  if (expiring.status === 200) {
    const e = expiring.body; const live = await join(e);
    const wait = Math.max(0, e.grantExpiresAt - Date.now() + 1500);
    await sleep(wait);
    const newJoin = await join(e);
    const expiredPublish = await control('publish', { id: e.grantId, probe: randomUUID() });
    const stillAuthValid = await rest(e, '/auth/v1/user', undefined, 'GET');
    check('AUTH-11', live.status === 'SUBSCRIBED' && newJoin.status === 'CHANNEL_ERROR' && expiredPublish.code === 'EXCLUDED'
      && stillAuthValid.status === 200, { wait_ms: wait, new_join: newJoin.status, old_socket_state: live.channel.state,
        jwt_still_valid: Date.now() < e.jwtExpiresAt, auth_user_http: stillAuthValid.status, expired_publish: expiredPublish });
    newJoin.client.disconnect();
  }
  results.push({ id: 'AUTH-28', status: 'BLOCKED', reason: 'Natural native JWT expiry not awaited; no global TTL change' });
} catch (e) {
  results.push({ id: 'HARNESS', status: 'FAIL', message: e.message, cause_code: e.cause?.code });
} finally {
  for (const client of clients) { client.disconnect(); await client.removeAllChannels().catch(() => {}); }
  const artifact = { run: fixture.run, results, received };
  writeFileSync(resolve(folder, 'hosted-result.json'), JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ run: fixture.run, results: results.map(r => ({ id: r.id, status: r.status, ms: r.ms, message: r.message })) }, null, 2));
}
