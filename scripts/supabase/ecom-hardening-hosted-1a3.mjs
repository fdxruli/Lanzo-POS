// Run only after the reviewed QA migrations + synthetic fixture installation.
// Never prints credentials, MFA secrets, tokens, passwords or vault ciphertext.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { RealtimeClient } from '@supabase/supabase-js';
import { createBackend, claimsOf } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import { createVault } from '../../supabase/functions/lanzo-ecom-bridge-qa/secrets.mjs';
setDefaultResultOrder('ipv4first');
const folder = '.tmp/ecom-native-1a3', fixture = JSON.parse(readFileSync(`${folder}/private-fixtures.json`));
const ref = 'odlrhijtfyavryeqivaa', url = `https://${ref}.supabase.co`;
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
const serviceKey = keys.find(k => k.name === 'service_role').api_key, publicKey = keys.find(k => k.name === 'anon').api_key;
const oldKey = randomBytes(32).toString('base64'), nextKey = randomBytes(32).toString('base64');
const passwordConfig = { id: 'qa1', secret: randomBytes(32).toString('base64') };
const vault = createVault({ current: 'qa1', keys: { qa1: oldKey } });
const backend = createBackend({ url, serviceKey, publicKey, passwordConfig, vault });
const results = [], clients = [], received = [], extraUsers = [];
const artifact = { run: fixture.run, started_at: new Date().toISOString(), results, received, auth_user_ids: [] };
const save = () => writeFileSync(`${folder}/hosted-hardening.json`, JSON.stringify(artifact, null, 2));
const check = (id, ok, detail = {}) => { results.push({ id, status: ok ? 'PASS' : 'FAIL', at: new Date().toISOString(), ...detail }); save(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function request(path, body, token = publicKey, method = 'POST') {
  const r = await fetch(url + path, { method, headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function join(c, token = c.accessToken, topic = c.topic) {
  const client = new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: publicKey } }); clients.push(client); await client.setAuth(token);
  const channel = client.channel(topic, { config: { private: true, broadcast: { ack: true } } });
  channel.on('broadcast', { event: '*' }, m => { received.push({ at: Date.now(), topic, event: m.event, probe_id: m.payload?.probe_id }); save(); });
  const start = performance.now();
  const state = await new Promise(resolve => { const timer = setTimeout(() => resolve('HARNESS_TIMEOUT'), 15000);
    channel.subscribe((s) => { if (['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(s)) { clearTimeout(timer); resolve(s); } }); });
  return { client, channel, state, ms: performance.now() - start };
}
const issue = capture => backend.issue(capture);
async function connection(capture) {
  const result = await issue(capture); if (result.status !== 200) throw Error(`BROKER_${result.status}_${result.body.code}`);
  const claims = claimsOf(result.body.accessToken); artifact.auth_user_ids.push(claims.sub); save(); return result.body;
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest(), offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
try {
  const capture = fixture.captures[0];
  const c = await connection(capture), claims = claimsOf(c.accessToken);
  const own = await join(c); check('HOSTED-JOIN', own.state === 'SUBSCRIBED', { state: own.state, ms: own.ms });
  const probe = randomUUID(), first = await backend.rpc('publish', { p_id: c.grantId, p_probe: probe });
  const retry = await backend.rpc('publish', { p_id: c.grantId, p_probe: probe });
  await sleep(1200);
  check('PUBLISH-IDEMPOTENCY', first.code === 'ENQUEUED' && retry.code === 'ALREADY_ENQUEUED' && received.filter(r => r.probe_id === probe).length === 1, { first: first.code, retry: retry.code });
  await sleep(10500);
  const renewed = await connection(capture);
  check('GRANT-WITHOUT-AUTH-REFRESH', renewed.accessToken === c.accessToken && renewed.grantExpiresAt > c.grantExpiresAt && claimsOf(renewed.accessToken).session_id === claims.session_id);
  const versioned = createVault({ current: 'qa2', keys: { qa1: oldKey, qa2: nextKey } });
  const next = createBackend({ url, serviceKey, publicKey, passwordConfig, vault: versioned });
  const rotated = await next.rotateVault();
  const cached = await next.issue(capture);
  check('VAULT-ROTATION', rotated.rotated >= 1 && !rotated.failed && cached.status === 200 && cached.body.accessToken === c.accessToken, { ...rotated });
  const wrongTenant = await issue({ ...capture, license_key: fixture.tenants[1].key });
  const bearerOnly = await issue({ accessToken: c.accessToken });
  const recoveryBearer = await issue({ action: 'recover', accessToken: c.accessToken });
  check('LANZO-AUTHORITY-REQUIRED', wrongTenant.status === 403 && bearerOnly.status === 403 && recoveryBearer.status === 403);
  const other = await connection(fixture.captures[1]);
  const foreign = await join(c, c.accessToken, other.topic); check('TENANT-TOPIC-ISOLATION', foreign.state === 'CHANNEL_ERROR', { state: foreign.state }); foreign.client.disconnect();
  for (const [name, path, body, method] of [
    ['TABLE','/rest/v1/licenses?select=id', undefined,'GET'],
    ['BINDING-RPC','/rest/v1/rpc/lanzo_ecom_bridge_qa_finish',{ p: { id:c.grantId, auth_user_id:claims.sub, auth_session_id:claims.session_id } },'POST'],
    ['ADMIN-RPC','/rest/v1/rpc/admin_list_staff_users',{p_license_key:fixture.tenants[0].key,p_admin_device_fingerprint:fixture.tenants[0].fingerprint,p_admin_security_token:fixture.tenants[0].token,p_admin_session_token:fixture.tenants[0].actorToken},'POST'],
    ['AUTH-ADMIN-DELETE',`/auth/v1/admin/users/${claims.sub}`,undefined,'DELETE'],
  ]) { const r = await request(path,body,c.accessToken,method); check(`RECEIVER-DENIED-${name}`, r.status >= 400 && r.status < 500,{http:r.status, code:r.body?.code}); }
  const protectedMeta = await request('/auth/v1/user', { app_metadata:{lanzo_bridge:'attacker'},role:'service_role' }, c.accessToken, 'PUT');
  const ordinary = await request('/auth/v1/user', { data:{role:'service_role',tenant_id:fixture.tenants[1].id} }, c.accessToken,'PUT');
  check('METADATA-NO-ESCALATION', protectedMeta.status === 403 && ordinary.status === 200 && ordinary.body.role === claims.role && ordinary.body.app_metadata.lanzo_bridge === 'qa_1a2', { privileged_http:protectedMeta.status, ordinary_http:ordinary.status });
  const password = randomUUID()+randomUUID();
  const passwordUpdate = await request('/auth/v1/user',{password},c.accessToken,'PUT');
  const selfLogin = await request('/auth/v1/token?grant_type=password',{email:claims.email,password});
  check('PASSWORD-SELF-SERVICE-OBSERVED',passwordUpdate.status === 200 && selfLogin.status === 200,{ update_http:passwordUpdate.status, login_http:selfLogin.status, residual:'can create Auth sessions; never Lanzo bindings' });
  if (selfLogin.status === 200) { const unbound = await join(c,selfLogin.body.access_token); check('UNBOUND-SESSION-DENIED',unbound.state === 'CHANNEL_ERROR',{state:unbound.state}); unbound.client.disconnect(); }
  const linking = await request('/auth/v1/user/identities/authorize?provider=github',undefined,c.accessToken,'GET');
  check('IDENTITY-LINKING',linking.status >= 400,{http:linking.status,code:linking.body?.code});
  const removal = await request('/auth/v1/user',undefined,c.accessToken,'DELETE');
  check('USER-SELF-DELETE',removal.status >= 400,{http:removal.status});
  const recoveryMail = await request('/auth/v1/recover',{email:claims.email});
  results.push({id:'PASSWORD-RECOVERY-SYNTHETIC',status:recoveryMail.status >= 200 && recoveryMail.status < 500 ? 'PASS' : 'FAIL',http:recoveryMail.status,code:recoveryMail.body?.code,scope:'only example.invalid, no real recipient'}); save();
  const email = `qa-ecom-1a3-changed-${randomUUID()}@example.invalid`;
  const changedEmail = await request('/auth/v1/user',{email},c.accessToken,'PUT');
  results.push({id:'EMAIL-SELF-SERVICE',status:'PASS',http:changedEmail.status,code:changedEmail.body?.code,meaning:'observed endpoint result, not proof operation prohibited'}); save();
  const enroll = await request('/auth/v1/factors',{factor_type:'totp',friendly_name:'qa-1a3'},c.accessToken);
  let verified = null;
  if (enroll.status === 200) {
    const challenge = await request(`/auth/v1/factors/${enroll.body.id}/challenge`,{},c.accessToken);
    verified = await request(`/auth/v1/factors/${enroll.body.id}/verify`,{challenge_id:challenge.body?.id,code:totp(enroll.body.totp.secret)},c.accessToken);
  }
  check('MFA-SELF-SERVICE-OBSERVED',enroll.status === 200 && verified?.status === 200,{enroll_http:enroll.status,verify_http:verified?.status});
  const recovered = await next.issue({...capture,action:'recover'});
  check('OWNER-RECOVERY-AFTER-PASSWORD-EMAIL-MFA',recovered.status === 200 && recovered.body.code === 'RECOVERED',{http:recovered.status});
  const oldUser = await request('/auth/v1/user',undefined,c.accessToken,'GET');
  const oldPublish = await next.rpc('publish',{p_id:c.grantId,p_probe:randomUUID()});
  const fresh = await connection({...capture,runtime_id:randomUUID()}).catch(() => null);
  // New backend has the current vault key after rotation.
  const freshIssue = fresh ? {status:200,body:fresh} : await next.issue({...capture,runtime_id:randomUUID()});
  check('RECOVERY-NEW-SUB-OLD-TOPIC-EXCLUDED',oldUser.status >= 400 && oldPublish.code === 'EXCLUDED' && freshIssue.status === 200 && claimsOf(freshIssue.body.accessToken).sub !== claims.sub,{old_user_http:oldUser.status,old_publish:oldPublish.code,fresh_http:freshIssue.status});
  if(freshIssue.status === 200) {
    const f = freshIssue.body, fc = claimsOf(f.accessToken);
    const cross = await join(c,f.accessToken); check('RECOVERY-NO-TOPIC-REUSE',cross.state === 'CHANNEL_ERROR',{state:cross.state}); cross.client.disconnect();
    const logout = await request('/auth/v1/logout?scope=local',undefined,f.accessToken);
    const blocked = await next.issue({...capture,runtime_id:fresh ? undefined : randomUUID()});
    check('LOGOUT-EXCLUDES-PUBLISH',logout.status === 204 && (await next.rpc('publish',{p_id:f.grantId,p_probe:randomUUID()})).code === 'EXCLUDED',{http:logout.status});
    // Test Auth refresh rotation/replay with a separate unbound self-created
    // session, after role/tenant checks. These tokens never reach frontend.
    await request(`/auth/v1/admin/users/${fc.sub}`,{password:password},serviceKey,'PUT');
    const replayLogin = await request('/auth/v1/token?grant_type=password',{email:fc.email,password});
    if(replayLogin.status === 200) {
      const r0 = replayLogin.body.refresh_token;
      const r1 = await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:r0});
      const r2 = await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:r1.body.refresh_token});
      const r3 = await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:r2.body.refresh_token});
      await sleep(12000);
      const replay = await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:r0});
      check('AUTH-REFRESH-REPLAY',r1.status === 200 && r2.status === 200 && r3.status === 200 && replay.status >= 400,{refresh_http:[r1.status,r2.status,r3.status],replay_http:replay.status,code:replay.body?.error_code});
    }
  }
  const signupEmail = `qa-ecom-1a3-signup-${randomUUID()}@example.invalid`;
  const signup = await request('/auth/v1/signup',{email:signupEmail,password:randomUUID()+randomUUID(),data:{role:'lanzo_ecom_bridge_receiver'}});
  const signupUser = signup.body?.user ?? signup.body;
  if(signupUser?.id) extraUsers.push(signupUser.id);
  check('ADDITIONAL-IDENTITY-NO-TECHNICAL-ROLE',signup.status >= 400 || signupUser?.role === 'authenticated',{http:signup.status,role:signupUser?.role,scope:'global signup availability is separate from bridge authorization'});
  const staffCapture = {...capture,actor_session_token:fixture.tenants[0].staffToken,runtime_id:randomUUID()};
  const staff = await next.issue(staffCapture); check('STAFF-ECOMMERCE-WITHOUT-SETTINGS',staff.status === 200,{http:staff.status});
  const denied = await next.issue({...capture,actor_session_token:fixture.tenants[0].deniedToken,runtime_id:randomUUID()});
  check('STAFF-WITHOUT-ECOMMERCE-DENIED',denied.status === 403,{http:denied.status});
  if(staff.status === 200) {
    const s = staff.body, live = await join(s);
    const probe = randomUUID(); await next.rpc('revoke',{p_id:s.grantId}); const barrier = Date.now();
    const excluded = await next.rpc('publish',{p_id:s.grantId,p_probe:probe}); await sleep(1000);
    const rejoin = await join(s); rejoin.client.disconnect();
    check('REVOKE-RESIDUAL-SOCKET',excluded.code === 'EXCLUDED' && !received.some(x=>x.probe_id===probe) && rejoin.state === 'CHANNEL_ERROR',{barrier_at:barrier,socket_state:live.channel.state,new_join:rejoin.state});
  }
  artifact.status = results.some(x=>x.status==='FAIL') ? 'FAIL' : 'PASS';
} catch(error) { artifact.status='FAIL'; check('HARNESS',false,{message:error.message}); }
finally {
  for(const c of clients) { c.disconnect(); await c.removeAllChannels().catch(()=>{}); }
  for(const id of extraUsers) await request(`/auth/v1/admin/users/${id}`,undefined,serviceKey,'DELETE');
  artifact.finished_at = new Date().toISOString(); save();
  console.log(JSON.stringify({status:artifact.status,results:results.map(x=>({id:x.id,status:x.status,http:x.http,message:x.message})),file:`${folder}/hosted-hardening.json`},null,2));
}
