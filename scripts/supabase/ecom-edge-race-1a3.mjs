// Independent HTTP transactions against Hosted, synthetic inventory only.
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { RealtimeClient } from '@supabase/supabase-js';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const folder='.tmp/ecom-native-1a3',f=JSON.parse(readFileSync(`${folder}/private-fixtures.json`));
const ref='odlrhijtfyavryeqivaa',url=`https://${ref}.supabase.co`,endpoint=`${url}/functions/v1/lanzo-ecom-bridge-qa`;
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
const service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
const results=[],clients=[],received=[],grants=[];const artifact={started_at:new Date().toISOString(),results,received,grants};
const save=()=>writeFileSync(`${folder}/edge-races.json`,JSON.stringify(artifact,null,2));
const check=(id,ok,detail={})=>{results.push({id,status:ok?'PASS':'FAIL',...detail});save();};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(target,body,token=anon){const started=Date.now();const r=await fetch(target,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});return{status:r.status,body:await r.json().catch(()=>null),elapsed_ms:Date.now()-started};}
const rpc=(name,args)=>post(`${url}/rest/v1/rpc/lanzo_ecom_bridge_qa_${name}`,args,service);
async function issue(capture){const r=await post(endpoint,capture);if(r.status!==200)throw Error(`EDGE_ISSUE_${r.status}_${r.body?.code}`);grants.push(r.body.grantId);save();return r.body;}
async function join(c){const client=new RealtimeClient(`${url}/realtime/v1`,{params:{apikey:anon}});clients.push(client);await client.setAuth(c.accessToken);const channel=client.channel(c.topic,{config:{private:true}});channel.on('broadcast',{event:'*'},m=>{received.push({at:Date.now(),topic:c.topic,event:m.event,probe_id:m.payload?.probe_id});save();});const state=await new Promise(resolve=>{const t=setTimeout(()=>resolve('HARNESS_TIMEOUT'),15000);channel.subscribe(s=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(s)){clearTimeout(t);resolve(s);}});});return{client,channel,state};}
try{
 const capture=f.captures[0];
 const recovery=await post(endpoint,{...capture,action:'recover'});check('EDGE-RECOVERY',recovery.status===200&&recovery.body?.code==='RECOVERED',{http:recovery.status});
 const cap={...capture,runtime_id:randomUUID()};
 const start=Date.now();const concurrent=await Promise.all(Array.from({length:4},()=>post(endpoint,cap)));
 check('EDGE-SINGLE-FLIGHT',concurrent.some(r=>r.status===200)&&new Set(concurrent.filter(r=>r.status===200).map(r=>r.body.grantId)).size===1&&concurrent.every(r=>[200,409].includes(r.status)),{http:concurrent.map(r=>r.status),elapsed_ms:Date.now()-start});
 const c=concurrent.find(r=>r.status===200)?.body;if(!c)throw Error('NO_CONNECTION');grants.push(c.grantId);
 const own=await join(c);check('EDGE-REALTIME-JOIN',own.state==='SUBSCRIBED',{state:own.state});
 const probe=randomUUID();
 const publish=rpc('race',{p_id:c.grantId,p_probe:probe,p_action:'publish'});await sleep(350);
 const revoke=rpc('revoke',{p_id:c.grantId});const [sent,barrier]=await Promise.all([publish,revoke]);await sleep(700);
 const retry=await rpc('publish',{p_id:c.grantId,p_probe:probe});
 check('RACE-PUBLISH-BEFORE-REVOKE',sent.body?.code==='ENQUEUED'&&barrier.body?.code==='REVOKED'&&barrier.elapsed_ms>2000&&retry.body?.code==='EXCLUDED',{publish:sent.body,barrier:barrier.body,revoke_elapsed_ms:barrier.elapsed_ms,retry:retry.body,socket:own.channel.state});
 const d=await issue({...capture,runtime_id:randomUUID()});const p2=randomUUID();
 const revokeFirst=rpc('race',{p_id:d.grantId,p_probe:p2,p_action:'revoke'});await sleep(350);
 const publishSecond=rpc('publish',{p_id:d.grantId,p_probe:p2});const [b2,s2]=await Promise.all([revokeFirst,publishSecond]);
 check('RACE-REVOKE-BEFORE-PUBLISH',b2.body?.code==='REVOKED'&&s2.body?.code==='EXCLUDED'&&s2.elapsed_ms>2000,{revoke:b2.body,publish:s2.body,publish_elapsed_ms:s2.elapsed_ms});
 const staffCapture={...capture,actor_session_token:f.tenants[0].staffToken,runtime_id:randomUUID()};
 // The previous local harness used a different dedicated password key. Drain
 // that synthetic identity before testing the Edge deployment's new key.
 const staffRecovery=await post(endpoint,{...staffCapture,action:'recover'});
 check('EDGE-STAFF-KEY-TRANSITION',staffRecovery.status===200&&staffRecovery.body?.code==='RECOVERED',{http:staffRecovery.status});
 const e=await issue({...staffCapture,runtime_id:randomUUID()});const live=await join(e);
 check('EXPIRY-PRECONDITION',live.state==='SUBSCRIBED',{grant_id:e.grantId,jwt_exp:e.jwtExpiresAt,grant_exp:e.grantExpiresAt});
 await sleep(Math.max(0,e.grantExpiresAt-Date.now()+1200));
 const stillJwt=Date.now()<e.jwtExpiresAt,newJoin=await join(e);newJoin.client.disconnect();const expired=await rpc('publish',{p_id:e.grantId,p_probe:randomUUID()});
 check('GRANT-EXPIRES-WHILE-JWT-VALID',stillJwt&&newJoin.state==='CHANNEL_ERROR'&&expired.body?.code==='EXCLUDED',{old_socket:live.channel.state,new_join:newJoin.state,publish:expired.body,observed_at:Date.now()});
 artifact.status=results.some(x=>x.status==='FAIL')?'FAIL':'PASS';
}catch(error){artifact.status='FAIL';check('HARNESS',false,{message:error.message});}
finally{for(const c of clients){c.disconnect();await c.removeAllChannels().catch(()=>{});}artifact.finished_at=new Date().toISOString();save();console.log(JSON.stringify({status:artifact.status,results},null,2));}
