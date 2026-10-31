import test from 'node:test';
import assert from 'node:assert/strict';
import { createEcomSignalReceiver } from '../../src/services/ecommerce/ecomSignalReceiver.js';
import { createBackend, createVault } from '../../supabase/functions/lanzo-ecom-bridge-qa/broker.mjs';
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function fixture(ttl = 600) {
  let time = 1000000, calls = 0, response, authCalls = 0, jwtExpiry = 4600000, jwtVersion = 1;
  const timers = new Map(), transports = [], states = [], reconciles = [];
  const connection = () => {
    if(time>=jwtExpiry-90000){jwtExpiry=time+3600000;jwtVersion++;}
    return { url:'https://qa.invalid', publicKey:'public', accessToken:`jwt-${jwtVersion}`,
      topic:'ecom:qa-probe:1a2:grant', grantExpiresAt:time + ttl*1000, jwtExpiresAt:jwtExpiry };
  };
  const receiver = createEcomSignalReceiver({ now:()=>time, random:()=>0.5,
    setTimer:(fn,ms)=>{const id={};timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    broker:async()=>{calls++;return response ?? {ok:true,connection:connection()};},
    createTransport:async()=>{const t={closed:0,setAuth:async()=>{authCalls++;},disconnect:()=>{t.closed++;},removeAllChannels:async()=>{},
      channel:()=>({on:()=>{},subscribe:cb=>{t.status=cb;cb('SUBSCRIBED');}})};transports.push(t);return t;}
  });
  receiver.start({},()=>{},s=>states.push(s),r=>reconciles.push(r));
  const advance = async ms => {
    const end=time+ms;
    for(let n=0;n<1000;n++){
      const entry=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!entry)break;
      const [id,v]=entry;timers.delete(id);time=v.at;v.fn();await flush();
    }
    time=end;await flush();
  };
  return {receiver,transports,states,reconciles,advance,timers,get calls(){return calls;},get authCalls(){return authCalls;},set response(r){response=r;},connection};
}
for (const ttl of [120,300,600,900]) test(`TTL ${ttl}s: renewal and natural JWT boundary keep one socket`,async()=>{
  const f=fixture(ttl);await flush();await f.advance(3600000);
  assert.equal(f.calls,({120:41,300:14,600:8,900:6})[ttl]);
  assert.equal(f.transports.length,1);assert.equal(f.transports[0].closed,0);
  assert.equal(f.authCalls,2);assert.equal(f.reconciles.length,1);f.receiver.stop();
});
test('temporary broker failure retains healthy transport until successful renewal',async()=>{
  const f=fixture();await flush();f.response={ok:false,status:503};await f.advance(570000);
  assert.equal(f.transports[0].closed,0);f.response=undefined;await f.advance(500);
  assert.equal(f.transports.length,1);assert.equal(f.states.at(-1),'connected');f.receiver.stop();
});
test('a changed JWT reauthorizes the existing socket while a changed topic reconciles',async()=>{
  const f=fixture();await flush();f.response={ok:true,connection:{...f.connection(),accessToken:'next',grantExpiresAt:2200000}};
  await f.advance(570000);assert.equal(f.authCalls,2);assert.equal(f.transports.length,1);
  f.response={ok:true,connection:{...f.connection(),topic:'ecom:qa-probe:1a2:new',grantExpiresAt:3000000}};
  await f.advance(600000);assert.equal(f.transports.length,2);assert.equal(f.transports[0].closed,1);
  assert.equal(f.reconciles.length,2);f.receiver.stop();
});
test('expiry is distinguishable from revocation and both destroy transport',async()=>{
  for(const [status,state] of [[410,'expired'],[403,'denied']]){
    const f=fixture();await flush();f.response={ok:false,status};await f.advance(570000);
    assert.equal(f.states.at(-1),state);assert.equal(f.transports[0].closed,1);
    assert.equal(f.timers.size,0);f.receiver.stop();
  }
});
test('a session-clamped grant does not cause a one-second renewal storm',async()=>{
  const f=fixture();await flush();const c=f.connection();f.response={ok:true,connection:c};
  await f.advance(599000);assert.equal(f.calls,2);assert.equal(f.transports.length,1);
  await f.advance(1000);assert.equal(f.states.at(-1),'expired');assert.equal(f.calls,2);
});
test('an SDK WebSocket channel error rechecks authority without latching a false denial',async()=>{
  const f=fixture();await flush();f.transports[0].status('CHANNEL_ERROR');
  assert.equal(f.states.at(-1),'retrying');assert.equal(f.transports[0].closed,1);
  await f.advance(500);assert.equal(f.transports.length,2);assert.equal(f.states.at(-1),'connected');f.receiver.stop();
});
function backend(fetcher,options={}) {return createBackend({url:'https://qa.invalid',serviceKey:'server',publicKey:'public',
  vault:createVault({current:'a',keys:{a:Buffer.alloc(32,1).toString('base64')}}),passwordConfig:{id:'p',secret:Buffer.alloc(32,2).toString('base64')},fetcher,...options});}
test('collector stops at its time budget without skipping unfinished inventory',async()=>{
  let time=0;
  const b=backend(async url=>{
    if(url.endsWith('_collect_batch')){time=2000;return Response.json([{id:'i',auth_user_ids:['u']}]);}
    assert.fail('budget must prevent Auth IO and ack');
  },{now:()=>time});
  const result=await b.collect({budgetMs:1000});
  assert.equal(result.budgetExhausted,true);assert.equal(result.after,null);assert.equal(result.retired,0);assert.equal(result.complete,false);
});
test('collector keyset pages past 1000 identities without offset scans or unbounded execution',async()=>{
  let deleted=0,acks=0;
  const b=backend(async(url,options)=>{
    const p=options.body?JSON.parse(options.body):{};
    if(url.endsWith('_collect_batch'))return Response.json(Array.from({length:100},(_,n)=>({id:String(Number(p.p_after??0)+n+1),auth_user_ids:[]})));
    if(url.endsWith('_collect_ack')){acks++;return Response.json(true);}
    if(options.method==='DELETE')deleted++;
    assert.fail('unexpected Auth scan');
  });
  const first=await b.collect({batchSize:100,maxBatches:10});
  assert.equal(first.after,'1000');assert.equal(first.complete,false);assert.equal(acks,1000);
  const second=await b.collect({after:first.after,batchSize:100,maxBatches:1});
  assert.equal(second.after,'1100');assert.equal(deleted,0);
  await assert.rejects(b.collect({maxBatches:11}),/COLLECTION_BUDGET/);
});
test('collector acknowledges failure without deleting another binding, then retries idempotently',async()=>{
  let safe=false;const acks=[];
  const b=backend(async(url,options)=>{
    if(url.endsWith('_collect_batch'))return Response.json([{id:'i',auth_user_ids:['u']}]);
    if(url.endsWith('_collect_ack')){acks.push(JSON.parse(options.body).p_success);return Response.json(true);}
    if(url.endsWith('/users/u')&&!options.method)return safe?new Response(null,{status:404}):Response.json({id:'u',role:'lanzo_ecom_bridge_receiver',app_metadata:{lanzo_bridge:'qa_1a2',binding_id:'foreign'}});
    assert.fail('must not delete foreign user');
  });
  assert.equal((await b.collect()).failed,1);safe=true;assert.equal((await b.collect()).failed,0);
  assert.deepEqual(acks,[false,true]);
});
