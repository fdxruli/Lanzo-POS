// Server-side Hosted observation. Secrets remain in this process only.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
import { RealtimeClient } from '@supabase/supabase-js';
setDefaultResultOrder('ipv4first');
const ref = 'odlrhijtfyavryeqivaa', url = `https://${ref}.supabase.co`;
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
const service = keys.find(k => k.name === 'service_role').api_key;
const anon = keys.find(k => k.name === 'anon').api_key;
const directory = '.tmp/ecom-expiry-1a3'; mkdirSync(directory, { recursive: true });
const evidence = { started_at: new Date().toISOString(), observations: [], status: 'RUNNING' };
const save = () => writeFileSync(`${directory}/result.json`, JSON.stringify(evidence, null, 2));
const note = (event, detail = {}) => { evidence.observations.push({ at: new Date().toISOString(), event, ...detail }); save(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let userId; const clients = [];
async function request(path, body, token = service, method = 'POST') {
  const response = await fetch(url + path, { method, headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function join(token, topic) {
  const client = new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: anon } }); clients.push(client);
  await client.setAuth(token);
  const channel = client.channel(topic, { config: { private: true } });
  channel.on('broadcast', { event: '*' }, message => note('received', { event: message.event, probe_id: message.payload?.probe_id }));
  const first = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('HARNESS_TIMEOUT'), 15000);
    channel.subscribe((state, error) => { note('channel', { state, error: error?.message }); clearTimeout(timer); resolve(state); });
  });
  return { client, channel, first };
}
try {
  // Separate expiring transport allowlist, without extending a Lanzo grant.
  const binding = randomUUID(), password = randomUUID() + randomUUID();
  const made = await request('/auth/v1/admin/users', { email: `qa-ecom-1a3-expiry-${binding}@example.invalid`, password, email_confirm: true,
    role: 'lanzo_ecom_bridge_receiver', app_metadata: { lanzo_bridge: 'qa_1a3_expiry', binding_id: binding } });
  if (made.status !== 200) throw Error(`CREATE_${made.status}`);
  userId = made.data.id; evidence.auth_user_id = userId; save();
  const login = await request('/auth/v1/token?grant_type=password', { email: made.data.email, password }, anon);
  if (login.status !== 200) throw Error(`LOGIN_${login.status}`);
  const token = login.data.access_token, claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  evidence.jwt = { exp: claims.exp, iat: claims.iat, session_id: claims.session_id, role: claims.role };
  const topic = `ecom:qa-probe:1a3-expiry:${binding}`;
  const bound = await request('/rest/v1/rpc/lanzo_ecom_expiry_qa_1a3_bind', { p_user: userId, p_session: claims.session_id, p_topic: topic, p_exp: claims.exp });
  if (bound.status !== 200) throw Error(`BIND_${bound.status}`);
  const active = await join(token, topic); if (active.first !== 'SUBSCRIBED') throw Error(`JOIN_${active.first}`);
  note('waiting_natural_expiry', { exp: claims.exp, ttl_seconds: claims.exp - claims.iat });
  // No setAuth or refresh on this client. Incremental evidence survives interruption.
  while (Date.now() < claims.exp * 1000 + 45000) {
    const remaining = claims.exp * 1000 - Date.now();
    if (remaining < 20000 || remaining > 3500000) {
      const probe = randomUUID();
      const sent = await request('/rest/v1/rpc/lanzo_ecom_expiry_qa_1a3_probe', { p_topic: topic, p_probe: probe });
      note('probe', { status: sent.status, probe_id: probe, remaining_ms: remaining, socket_state: active.channel.state });
    }
    await sleep(remaining < 30000 ? 5000 : Math.min(30000, remaining - 25000));
  }
  const expiredJoin = await join(token, topic);
  note('expired_rejoin', { state: expiredJoin.first }); expiredJoin.client.disconnect();
  const fresh = await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: login.data.refresh_token }, anon);
  note('auth_refresh_after_exp', { status: fresh.status });
  if (fresh.status === 200) {
    const denied = await join(fresh.data.access_token, topic);
    note('fresh_token_expired_allowlist_rejoin', { state: denied.first }); denied.client.disconnect();
  }
  evidence.status = expiredJoin.first === 'CHANNEL_ERROR' ? 'PASS_OBSERVATION' : 'FAIL';
} catch (error) { evidence.status = 'BLOCKED'; note('harness_error', { message: error.message }); }
finally {
  for (const client of clients) { client.disconnect(); await client.removeAllChannels().catch(() => {}); }
  if (userId) { const deletion = await request(`/auth/v1/admin/users/${userId}`, undefined, service, 'DELETE'); note('auth_cleanup', { status: deletion.status }); }
  evidence.finished_at = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: evidence.status, file: `${directory}/result.json` }));
}
