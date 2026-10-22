// Explicit synthetic inventory only. Auth credentials stay in memory/ignored .tmp.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { RealtimeClient } from '@supabase/supabase-js';
import { createBackend, claimsOf } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import { createEcomSignalReceiver } from '../../src/services/ecommerce/ecomSignalReceiver.js';
setDefaultResultOrder('ipv4first');
const folder='.tmp/ecom-native-1a4',ref='odlrhijtfyavryeqivaa',url=`https://${ref}.supabase.co`;
const f=JSON.parse(readFileSync(`${folder}/private-fixtures.json`));
if(f.captures.some(c=>!c.license_key.startsWith('QA-ECOM-SIGNAL-R2-1A2-')))throw Error('QA_INVENTORY_REQUIRED');
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
const service=keys.find(k=>k.name==='service_role').api_key,publicKey=keys.find(k=>k.name==='anon').api_key;
const secretFile=`${folder}/private-server.json`;
if(!existsSync(secretFile))writeFileSync(secretFile,JSON.stringify({vaultConfig:{current:'qa4',keys:{qa4:randomBytes(32).toString('base64')}},passwordConfig:{id:'qa4',secret:randomBytes(32).toString('base64')}}));
const backend=createBackend({url,serviceKey:service,publicKey,...JSON.parse(readFileSync(secretFile))});
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)??'ttl';
const ttl=Number(process.argv.find(a=>a.startsWith('--ttl='))?.slice(6)??600);
const results=[],clients=[],artifact={stage,ttl,started_at:new Date().toISOString(),results};
const file=`${folder}/hosted-${stage}${stage==='ttl'?`-${ttl}`:''}.json`;
const save=()=>writeFileSync(file,JSON.stringify(artifact,null,2));
const check=(id,ok,detail={})=>{results.push({id,status:ok?'PASS':'FAIL',...detail});save();if(!ok)process.exitCode=1;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{const end=Date.now()+20000;while(!predicate()){if(Date.now()>end)throw Error('OBSERVATION_TIMEOUT');await sleep(50);}};
async function issue(capture){const r=await backend.issue(capture);if(r.status!==200)throw Error(`BROKER_${r.status}_${r.body?.code}`);return r.body;}
async function request(path,body,token=publicKey,method='POST'){
 const r=await fetch(url+path,{method,headers:{apikey:publicKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 return {status:r.status,body:await r.json().catch(()=>null)};
}
async function join(c,token=c.accessToken){
 const t=new RealtimeClient(`${url}/realtime/v1`,{params:{apikey:publicKey}});clients.push(t);await t.setAuth(token);
 const channel=t.channel(c.topic,{config:{private:true}});const started=performance.now();
 const state=await new Promise(resolve=>{const timer=setTimeout(()=>resolve('TIMEOUT'),15000);channel.subscribe(s=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(s)){clearTimeout(timer);resolve(s);}});});
 return {t,channel,state,ms:performance.now()-started};
}
let receiver;
try {
 if(stage==='ttl'){
  const connections=[],timers=new Map(),states=[],probes=[];let setups=0;
  receiver=createEcomSignalReceiver({random:()=>0.5,broker:async capture=>{const r=await backend.issue(capture);if(r.status===200)connections.push(r.body);return {ok:r.status===200,status:r.status,connection:r.body};},
   createTransport:async()=>{setups++;const t=new RealtimeClient(`${url}/realtime/v1`,{params:{apikey:publicKey}});clients.push(t);return t;},
   setTimer:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
  receiver.start({...f.captures[0],runtime_id:randomUUID()},p=>probes.push(p),s=>states.push(s));
  await wait(()=>states.includes('connected'));const first=connections[0],claims=claimsOf(first.accessToken);
  check('TTL-SERVER',Math.abs((first.grantExpiresAt-Date.now())/1000-ttl)<12,{remaining_seconds:(first.grantExpiresAt-Date.now())/1000,native_jwt_seconds:claims.exp-claims.iat});
  const id=randomUUID(),sentAt=performance.now();await backend.rpc('publish',{p_id:first.grantId,p_probe:id});await wait(()=>probes.some(p=>p.probe_id===id));
  check('LIVE-PROBE',true,{roundtrip_ms:performance.now()-sentAt});
  // Trigger the receiver's real renewal callback after the SQL cache window;
  // do not pretend this controlled clock is a full TTL soak.
  await sleep(11000);[...timers.values()].sort((a,b)=>a.ms-b.ms)[0].fn();
  await wait(()=>states.filter(s=>s==='connected').length===2);const next=connections.at(-1);
  check('RENEW-NO-REJOIN',setups===1&&next.accessToken===first.accessToken&&next.grantId===first.grantId&&next.grantExpiresAt>first.grantExpiresAt,{transport_setups:setups,broker_calls:connections.length,method:'controlled renewal callback; real SQL/Auth/Realtime, 11s wall wait'});
  const p2=randomUUID();await backend.rpc('publish',{p_id:next.grantId,p_probe:p2});await wait(()=>probes.some(p=>p.probe_id===p2));check('POST-RENEW-DELIVERY',true);
  const barrier=await backend.rpc('revoke',{p_id:next.grantId});const excluded=await backend.rpc('publish',{p_id:next.grantId,p_probe:randomUUID()});
  check('REVOKE-BARRIER',barrier.code==='REVOKED'&&excluded.code==='EXCLUDED');
  artifact.auth_user=claims.sub;artifact.auth_session=claims.session_id;
 }
 if(stage==='prepare-expiry'){
  const capture={...f.captures[0],runtime_id:randomUUID()},c=await issue(capture);
  writeFileSync(`${folder}/private-expiry.json`,JSON.stringify({capture,c}));
  artifact.grant_id=c.grantId;check('EXPIRY-PREPARED',true);
 }
 if(stage==='recover-expiry'){
  const {capture,c}=JSON.parse(readFileSync(`${folder}/private-expiry.json`));
  const old=await backend.issue(capture),fresh=await issue({...capture,runtime_id:randomUUID()});
  const joined=await join(fresh),cross=await join(c,fresh.accessToken);
  check('EXPIRED-TOMBSTONE',old.status===410,{http:old.status});
  check('NEW-GRANT-SAME-IDENTITY',fresh.grantId!==c.grantId&&claimsOf(fresh.accessToken).sub===claimsOf(c.accessToken).sub&&claimsOf(fresh.accessToken).session_id!==claimsOf(c.accessToken).session_id);
  check('RECOVERY-JOIN',joined.state==='SUBSCRIBED'&&cross.state==='CHANNEL_ERROR',{new_join:joined.state,old_topic:cross.state});
  await backend.rpc('revoke',{p_id:fresh.grantId});
 }
 if(stage==='security'){
  const cap={...f.captures[0],runtime_id:randomUUID()},c=await issue(cap),claims=claimsOf(c.accessToken);
  const password=randomUUID()+randomUUID();const update=await request('/auth/v1/user',{password},c.accessToken,'PUT');
  const login=await request('/auth/v1/token?grant_type=password',{email:claims.email,password});
  check('SELF-SERVICE-RESIDUAL',update.status===200&&login.status===200,{update_http:update.status,login_http:login.status,meaning:'observed residual, not prevention'});
  if(login.status===200){const unbound=await join(c,login.body.access_token);check('UNBOUND-DENIED',unbound.state==='CHANNEL_ERROR');}
  const denied=await backend.issue(cap),excluded=await backend.rpc('publish',{p_id:c.grantId,p_probe:randomUUID()});
  check('ANOMALY-QUARANTINE',denied.status===403&&excluded.code==='EXCLUDED',{http:denied.status,publish:excluded.code});
  const recovered=await backend.issue({...cap,action:'recover'});let fresh=await issue({...cap,runtime_id:randomUUID()});
  check('RECOVER-COMPROMISED-IDENTITY',recovered.status===200&&claimsOf(fresh.accessToken).sub!==claims.sub);
  const enroll=await request('/auth/v1/factors',{factor_type:'totp',friendly_name:'QA 1A4'},fresh.accessToken);
  const mfaDeny=await backend.issue({...cap,runtime_id:randomUUID()});
  check('MFA-QUARANTINE',enroll.status===200&&mfaDeny.status===403,{enroll_http:enroll.status,broker_http:mfaDeny.status});
  await backend.issue({...cap,action:'recover'});fresh=await issue({...cap,runtime_id:randomUUID()});
  const staff=await issue({...cap,actor_session_token:f.tenants[0].staffToken,runtime_id:randomUUID()});
  check('STAFF-ISOLATED',claimsOf(staff.accessToken).sub!==claimsOf(fresh.accessToken).sub);
  const deniedStaff=await backend.issue({...cap,actor_session_token:f.tenants[0].deniedToken,runtime_id:randomUUID()});
  const foreign=await backend.issue({...cap,license_key:f.tenants[1].key,runtime_id:randomUUID()});
  check('STAFF-AND-TENANT-DENIED',deniedStaff.status===403&&foreign.status===403);
  const other=await issue({...f.captures[1],runtime_id:randomUUID()});const cross=await join(other,staff.accessToken);
  check('TENANT-SOCKET-ISOLATION',cross.state==='CHANNEL_ERROR');
  for(const conn of [fresh,staff,other])await backend.rpc('revoke',{p_id:conn.grantId});
 }
 if(stage==='races'){
  const c=await issue({...f.captures[0],runtime_id:randomUUID()}),probe=randomUUID();
  const first=backend.rpc('race',{p_id:c.grantId,p_probe:probe,p_action:'publish'});await sleep(350);
  const start=performance.now(),revoke=backend.rpc('revoke',{p_id:c.grantId});const [sent,barrier]=await Promise.all([first,revoke]);
  const elapsed=performance.now()-start,retry=await backend.rpc('publish',{p_id:c.grantId,p_probe:probe});
  check('PUBLISH-THEN-REVOKE',sent.code==='ENQUEUED'&&barrier.code==='REVOKED'&&retry.code==='EXCLUDED'&&elapsed>2000,{revoke_wait_ms:elapsed,sent:sent.code,retry:retry.code});
  const d=await issue({...f.captures[0],runtime_id:randomUUID()}),p2=randomUUID();
  const before=backend.rpc('race',{p_id:d.grantId,p_probe:p2,p_action:'revoke'});await sleep(350);
  const started=performance.now(),after=backend.rpc('publish',{p_id:d.grantId,p_probe:p2});const [b,s]=await Promise.all([before,after]);
  check('REVOKE-THEN-PUBLISH',b.code==='REVOKED'&&s.code==='EXCLUDED'&&performance.now()-started>2000,{publish_wait_ms:performance.now()-started,selected:s.code});
 }
 if(stage==='natural-expiry'){
  const cap={...f.captures[0],runtime_id:randomUUID()},c=await issue(cap),live=await join(c);
  check('NATURAL-PRECONDITION',live.state==='SUBSCRIBED'&&c.grantExpiresAt<Date.now()+125000,{grant_expires_at:c.grantExpiresAt,jwt_expires_at:c.jwtExpiresAt});
  if(c.grantExpiresAt>Date.now()+125000)throw Error('SET_QA_POLICY_120_FIRST');
  await sleep(Math.max(0,c.grantExpiresAt-Date.now()+500));
  const old=await backend.issue(cap),excluded=await backend.rpc('publish',{p_id:c.grantId,p_probe:randomUUID()});
  const collection=await backend.collect();
  check('COLLECT-KEEPS-LIVE-LANZO-IDENTITY',collection.deleted===0,{retired:collection.retired,deleted:collection.deleted});
  const fresh=await issue({...cap,runtime_id:randomUUID()}),joined=await join(fresh),cross=await join(c,fresh.accessToken);
  check('NATURAL-GRANT-EXPIRED',old.status===410&&excluded.code==='EXCLUDED'&&Date.now()<c.jwtExpiresAt,{old_http:old.status,publish:excluded.code,old_socket:live.channel.state});
  check('NATURAL-RECOVERY',joined.state==='SUBSCRIBED'&&cross.state==='CHANNEL_ERROR'&&fresh.grantId!==c.grantId,{new_join:joined.state,old_topic:cross.state});
  await backend.rpc('revoke',{p_id:fresh.grantId});
 }
 if(stage==='prepare-session'){
  const c=await issue({...f.captures[0],runtime_id:randomUUID()}),session=randomUUID(),token=randomUUID();
  const q=v=>`'${String(v).replaceAll("'","''")}'`;
  writeFileSync(`${folder}/private-session-rotation.json`,JSON.stringify({old:c,capture:{...f.captures[0],actor_session_token:token,runtime_id:randomUUID()},session}));
  writeFileSync(`${folder}/session-rotation.sql`,`begin;
   update public.license_admin_sessions set revoked_at=clock_timestamp() where id=${q(f.tenants[0].session)} and license_id=${q(f.tenants[0].id)};
   insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
    values(${q(session)},${q(f.tenants[0].id)},${q(f.tenants[0].admin)},${q(f.tenants[0].device)},extensions.crypt(${q(token)},extensions.gen_salt('bf',4)),clock_timestamp()+interval '2 hours');commit;`);
  check('SESSION-ROTATION-PREPARED',true);
 }
 if(stage==='session-rotation'){
  const {old,capture}=JSON.parse(readFileSync(`${folder}/private-session-rotation.json`));
  const denied=await backend.issue({...f.captures[0],runtime_id:randomUUID()}),excluded=await backend.rpc('publish',{p_id:old.grantId,p_probe:randomUUID()});
  const fresh=await issue(capture),joined=await join(fresh),cross=await join(old,fresh.accessToken);
  check('OLD-ADMIN-SESSION-DENIED',denied.status===403&&excluded.code==='EXCLUDED');
  check('SAME-ADMIN-NEW-SESSION-ISOLATED',claimsOf(old.accessToken).sub!==claimsOf(fresh.accessToken).sub&&joined.state==='SUBSCRIBED'&&cross.state==='CHANNEL_ERROR');
  await backend.rpc('revoke',{p_id:fresh.grantId});
 }
 if(stage==='collect'){
  artifact.collection=await backend.collect({batchSize:1,maxBatches:10});
  artifact.repeat=await backend.collect({batchSize:1,maxBatches:10});
  check('COLLECT-INCREMENTAL',artifact.collection.failed===0&&artifact.repeat.deleted===0,artifact.collection);
 }
 artifact.status=results.some(r=>r.status==='FAIL')?'FAIL':'PASS';
}catch(error){artifact.status='FAIL';check('HARNESS',false,{message:error.message});}
finally {receiver?.stop();for(const t of clients){t.disconnect();await t.removeAllChannels().catch(()=>{});}artifact.finished_at=new Date().toISOString();save();console.log(JSON.stringify(artifact));}
// Failed-channel SDK retry timers may retain Node after all clients are removed.
// All observations and cleanup above are awaited before ending this QA process.
process.exit(process.exitCode??0);
