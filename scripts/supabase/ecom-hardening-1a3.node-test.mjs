import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, createPasswordDeriver, serverSecrets } from '../../supabase/functions/lanzo-ecom-bridge-qa/secrets.mjs';
import { createBroker, createBackend } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
import { createHandler } from '../../supabase/functions/lanzo-ecom-bridge-qa/handler.mjs';
const key = n => Buffer.alloc(32,n).toString('base64');
const vault = keys => createVault(keys ?? {current:'one',keys:{one:key(1)}});
const url='https://qa.supabase.co';
const applicationKey='fixture-project-publishable-key';
const jwt = extra => `h.${Buffer.from(JSON.stringify({sub:'u',role:'lanzo_ecom_bridge_receiver',iss:`${url}/auth/v1`,aud:'authenticated',session_id:'s',exp:4000000000,app_metadata:{lanzo_bridge:'qa_1a2',binding_id:'i'},...extra})).toString('base64url')}.s`;
const session = extra => ({access_token:jwt(extra),refresh_token:'private-refresh'});
const reservation = {code:'RESERVED',id:'g',identity_id:'i',auth_user_id:'u',auth_session_id:'s',lease_id:'l'};

test('dedicated secrets reject missing, weak, malformed and reused key material',()=>{
  for(const config of [undefined,{current:'one',keys:{}},{current:'one',keys:{one:'short'}},{current:'one',keys:{one:Buffer.alloc(31).toString('base64')}}]) assert.throws(()=>createVault(config));
  assert.throws(()=>createPasswordDeriver({id:'one',secret:''}));
  const entries={LANZO_ECOM_VAULT_KEYS:JSON.stringify({one:key(1)}),LANZO_ECOM_VAULT_KEY_ID:'one',LANZO_ECOM_PASSWORD_KEY_ID:'one',LANZO_ECOM_PASSWORD_KEY:key(1)};
  assert.throws(()=>serverSecrets({get:k=>entries[k]}),/SECRET_PURPOSE_REUSE/);
  assert.throws(()=>createBackend({url,serviceKey:'privileged',publicKey:'public'}));
});
test('vault reads previous version during rotation, rejects retired keys, corruption and swapped bindings',async()=>{
  const old=vault(), next=vault({current:'two',keys:{one:key(1),two:key(2)}}), final=vault({current:'two',keys:{two:key(2)}});
  const box=await old.seal(session(),'g');
  assert.deepEqual(await next.open(box,'g'),session());
  const rewritten=await next.seal(await next.open(box,'g'),'g');
  assert.deepEqual(await final.open(rewritten,'g'),session());
  await assert.rejects(final.open(box,'g'));
  await assert.rejects(next.open(box,'another'));
  await assert.rejects(next.open(box.replace('v2.one.','v2.two.'),'g'));
  await assert.rejects(next.open(box+'.extra','g'));
  await assert.rejects(next.open(box.slice(0,-8)+'AAAAAAAA','g'));
  await assert.rejects(next.open('v1.legacy.ciphertext','g'));
});
test('password derivation is deterministic, purpose separated and explicitly versioned',async()=>{
  const first=createPasswordDeriver({id:'one',secret:key(3)}), next=createPasswordDeriver({id:'two',secret:key(3)});
  assert.equal(await first('i'),await first('i'));
  assert.notEqual(await first('i'),await first('j'));
  assert.notEqual(await first('i'),await next('i'));
});
test('near-expiry JWT refresh preserves bound session and never creates an identity',async()=>{
  const v=vault(), box=await v.seal(session({exp:Math.floor(Date.now()/1000)+45}),'g');let refresh=0,finished=0;
  const issue=createBroker({url,publicKey:'public',vault:v,passwordFor:()=>assert.fail('password'),rpc:async name=>name==='prepare'?{...reservation,vault:box}:name==='finish'?(finished++,{code:'READY',expires_at:'2090-01-01'}):true,
    auth:{refresh:async()=>{refresh++;return session();}}});
  assert.equal((await issue({})).status,200); assert.equal(refresh,1);assert.equal(finished,1);
});
test('cached vault cannot substitute another user, session or privileged role',async()=>{
  for(const extra of [{sub:'another'},{session_id:'another'},{role:'service_role'}]){
    const v=vault(),box=await v.seal(session(extra),'g');
    const issue=createBroker({url,publicKey:'public',vault:v,rpc:async()=>({...reservation,code:'CACHED',vault:box}),auth:{},passwordFor:()=>assert.fail()});
    const result=await issue({});assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result),/private-refresh|access_token|ciphertext/);
  }
});
test('recovery requires Lanzo authority, quarantines before deleting and resets only after deletion',async()=>{
  const calls=[];
  const issue=createBroker({url,publicKey:'public',vault:vault(),passwordFor:()=>assert.fail(),rpc:async(name,args)=>{calls.push(name);if(name==='quarantine'){assert.equal('accessToken' in args.p,false);return {code:'QUARANTINED',identity_id:'i',auth_user_id:'u'};}return {code:'RECOVERED'};},auth:{deleteOwnedUser:async(id,binding)=>{assert.equal(id,'u');assert.equal(binding,'i');calls.push('delete');}}});
  const result=await issue({action:'recover',accessToken:'stolen'});
  assert.equal(result.status,200);assert.equal(result.body.newRuntimeRequired,true);assert.deepEqual(calls,['quarantine','delete','reset_identity']);
});
test('partial recovery preserves quarantine when Auth fails; retry resumes the same inventory',async()=>{
  let allowed=false;const calls=[];
  const issue=createBroker({url,publicKey:'public',vault:vault(),rpc:async name=>{calls.push(name);return name==='quarantine'?{code:'QUARANTINED',identity_id:'i',auth_user_id:'u'}:{code:'RECOVERED'};},auth:{deleteOwnedUser:async()=>{if(!allowed)throw Error('network');}}});
  assert.equal((await issue({action:'recover'})).status,503);assert.equal(calls.includes('reset_identity'),false);
  allowed=true;assert.equal((await issue({action:'recover'})).status,200);
});
test('collector uses immutable inventory even after technical email changed',async()=>{
  const paths=[];
  const backend=createBackend({url,serviceKey:'server',publicKey:'public',vault:vault(),passwordConfig:{id:'one',secret:key(3)},fetcher:async(path,options)=>{
    paths.push([path,options.method]);
    const value=path.endsWith('_collect_batch')?[{id:'i',auth_user_ids:['u']}]:path.endsWith('/users/u')?{id:'u',email:'mutated@example.invalid',role:'lanzo_ecom_bridge_receiver',app_metadata:{lanzo_bridge:'qa_1a2',binding_id:'i'}}:true;
    return new Response(JSON.stringify(value),{status:200});
  }});
  assert.equal((await backend.collect()).deleted,1);
  assert.equal(paths.some(([path,method])=>path.endsWith('/users/u')&&method==='DELETE'),true);
});
test('vault rotation handles CAS conflict, missing key and partial success without exposing data',async()=>{
  const v=vault(),box=await v.seal(session(),'g');let updates=0;
  const backend=createBackend({url,serviceKey:'server',publicKey:'public',vault:v,passwordConfig:{id:'one',secret:key(3)},fetcher:async(path)=>{
    if(path.endsWith('_vault_batch'))return Response.json([{id:'g',vault:box},{id:'bad',vault:'v2.missing.invalid.invalid'}]);
    updates++;return Response.json(false);
  }});
  assert.deepEqual(await backend.rotateVault(),{rotated:0,conflicted:1,failed:1});assert.equal(updates,1);
});
test('HTTP QA controls require their dedicated capability and are disabled without configuration',async()=>{
  const calls=[];const backend={collect:async()=>{calls.push('collect');return {deleted:0};},issue:async()=>{calls.push('issue');return {status:403,body:{code:'DENIED'}};}};
  const request=token=>new Request(url,{method:'POST',headers:{apikey:applicationKey,'Content-Type':'application/json',...(token?{'x-lanzo-qa-control':token}:{Authorization:'Bearer valid-alternate-service-key'})},body:JSON.stringify({action:'collect'})});
  assert.equal((await createHandler(backend,{applicationKeys:[applicationKey]})(request())).status,403);
  assert.equal((await createHandler(backend,{controlToken:'x'.repeat(43),applicationKeys:[applicationKey]})(request('wrong'))).status,403);
  assert.deepEqual(calls,[]);
  assert.equal((await createHandler(backend,{controlToken:'x'.repeat(43),applicationKeys:[applicationKey]})(request('x'.repeat(43)))).status,200);
  assert.deepEqual(calls,['collect']);
});
test('HTTP boundary bounds chunked bytes, rejects malformed bodies and never calls backend',async()=>{
  const backend={issue:()=>assert.fail('backend must not run')};const handler=createHandler(backend,{applicationKeys:[applicationKey]});
  for(const body of ['null','[]','invalid'])assert.equal((await handler(new Request(url,{method:'POST',headers:{apikey:applicationKey,'Content-Type':'application/json'},body}))).status,403);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4096));controller.enqueue(new Uint8Array(4097));controller.close();}});
  assert.equal((await handler(new Request(url,{method:'POST',headers:{apikey:applicationKey,'Content-Type':'application/json'},body:stream,duplex:'half'}))).status,413);
});
