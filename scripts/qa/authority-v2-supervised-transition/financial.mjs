// SYNTHETIC_BOUNDARY_ONLY. These are not Lanzo financial integration tests.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openPrototype, createClient, snapshot, transaction } from '../actor-context-contract/prototype.mjs';
import { admissionDecision, recoveryDecision } from '../actor-authority-admission/admission-model.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const dependency=process.env.AUTHORITY_QA_FAKE_IDB || resolve(here,'../../../node_modules/fake-indexeddb/build/esm/index.js');
const {IDBFactory}=await import(pathToFileURL(dependency));
const identity={tenant:'synthetic-T',actor:'admin:A',session:'session-A',device:'device-A'};
const results=[];let sequence=0;
const run=async(id,test)=>{
  const db=await openPrototype(`synthetic-fin-${++sequence}`,new IDBFactory());
  const a=createClient(db,identity);const h=await a.grant(a.prepare());
  const b=createClient(db,{...identity,actor:'admin:B',session:'session-B'});
  try{const before=await snapshot(db);const details=await test({db,a,h,b});results.push({id,status:'PASS',level:'SYNTHETIC_BOUNDARY_ONLY',before,...details,after:await snapshot(db)});}
  catch(error){results.push({id,status:'FAIL',error:error.stack});process.exitCode=1;}
  finally{db.close();}
};
await run('FIN-T3-01',async({db,a,h,b})=>{
  await a.beginOperation(h,'prepared-sale');const before=await snapshot(db);
  await assert.rejects(b.grant(b.prepare(),h.binding.token),{code:'HANDOFF_PENDING'});assert.deepEqual(await snapshot(db),before);return {expectation:'B cannot inherit preparation'};
});
await run('FIN-T3-02',async({db,a,h,b})=>{
  await a.beginOperation(h,'sale');const receipt=await a.commit(h,'sale','sale-key');await b.grant(b.prepare(),h.binding.token);
  assert.deepEqual((await snapshot(db)).effects[0],receipt);assert.equal(receipt.owner.actor,'admin:A');return {receipt};
});
await run('FIN-T3-03',async({db,a,h,b})=>{
  await a.beginOperation(h,'ambiguous-dispatch');const before=await snapshot(db);
  await assert.rejects(b.grant(b.prepare(),h.binding.token),{code:'HANDOFF_PENDING'});
  const intent={origin:identity,key:'K',hash:'H',attempts:1,state:'DISPATCHING'};
  const decision=recoveryDecision({intent,receipt:{status:'NOT_FOUND'},executor:identity});assert.equal(decision.action,'PRESERVE');assert.deepEqual(await snapshot(db),before);return {intent,decision,limitation:'Receipt lookup is a model, no RPC'};
});
await run('FIN-T3-04',async({db,a,h,b})=>{
  await a.beginOperation(h,'absent-actor-payment');await a.invalidate(h);const before=await snapshot(db);
  await assert.rejects(b.grant(b.prepare(),h.binding.token),{code:'HANDOFF_PENDING'});assert.deepEqual(await snapshot(db),before);
  return {classification:'MANUAL_RECONCILIATION_REQUIRED',capabilityImplemented:false};
});
await run('FIN-T3-05',async({db,a,h})=>{
  await a.beginOperation(h,'ui-response-lost');const receipt=await a.commit(h,'ui-response-lost','K');const replay=await a.commit(h,'ui-response-lost','K');assert.deepEqual(replay,receipt);assert.equal((await snapshot(db)).effects.length,1);return {receipt,replay};
});
await run('FIN-T3-06',async({db,a,h,b})=>{
  const origin={...identity};const intent={origin,key:'K',hash:'H',attempts:1,state:'DISPATCHING'};
  await b.grant(b.prepare(),h.binding.token);const before=await snapshot(db);
  const receipt={status:'COMPLETED',id:'receipt-A',key:'K',hash:'H'};
  const denied=recoveryDecision({intent,receipt,executor:{...identity,actor:'admin:B'}});assert.equal(denied.action,'DENY');
  const allowed=recoveryDecision({intent,receipt,executor:{...identity,session:'new-session-A'}});assert.equal(allowed.action,'PROJECT_EXISTING');assert.deepEqual(allowed.origin,origin);assert.deepEqual(await snapshot(db),before);
  return {intent,receipt,denied,allowed,limitation:'Delayed result is injected, not network RPC; no projection persisted'};
});
await run('FIN-T3-07',async({db,h,b})=>{
  const cash={synthetic:true,type:'open-cash',status:'OPEN',originActor:'admin:A'};
  await transaction(db,['effects'],'readwrite',tx=>tx.put('effects',['synthetic-T','cash'],cash));await b.grant(b.prepare(),h.binding.token);
  assert.deepEqual((await snapshot(db)).effects[0],cash);return {cash,limitation:'Metadata preservation only, not Caja repository'};
});
await run('FIN-T3-08',async({db,h,b})=>{
  const outbox={synthetic:true,type:'outbox',status:'PENDING',localReceipt:'complete',originActor:'admin:A',key:'original-K'};
  await transaction(db,['effects'],'readwrite',tx=>tx.put('effects',['synthetic-T','outbox'],outbox));await b.grant(b.prepare(),h.binding.token);
  assert.deepEqual((await snapshot(db)).effects[0],outbox);return {outbox,limitation:'Confirmed-local evidence encoded as fixture metadata, not product sync'};
});
results.push({id:'FIN-T3-09',status:'PENDING',level:'BROWSER_EVIDENCE_REQUIRED',reference:'browser.json T3-10; see final evidence report',limitation:'Not executed by Node runner; browser observation assessed separately'});
await run('FIN-T3-10',async({db})=>{
  const before=await snapshot(db);const decision=admissionDecision();assert.equal(decision.state,'ADMISSION_RESTRICTED');assert.deepEqual(await snapshot(db),before);return {decision};
});
for(const type of ['prepared-sale','confirmed-local-sale','payment-in-flight','pending-remote-receipt','outbox-confirmed-local','open-cash','credit','layaway','restaurant-checkout']){
  await run('FIXTURE-'+type,async({db,a,h,b})=>{
    const blocks=['prepared-sale','payment-in-flight','pending-remote-receipt','restaurant-checkout'].includes(type);
    if(blocks){await a.beginOperation(h,type);await assert.rejects(b.grant(b.prepare(),h.binding.token),{code:'HANDOFF_PENDING'});}
    else{await transaction(db,['effects'],'readwrite',tx=>tx.put('effects',['synthetic-T',type],{synthetic:true,type,originActor:'admin:A'}));await b.grant(b.prepare(),h.binding.token);}
    const state=await snapshot(db);assert(blocks?state.operations[0].owner.actor==='admin:A':state.effects[0].originActor==='admin:A');
    return {type,classification:blocks?'BLOCKS_HANDOFF':'PRESERVED_EVIDENCE',limitation:'Credit/layaway/cash alone do not prove absence of active suboperations; activity must be inspected separately'};
  });
}
const attemptedEvidence=['silence','timeout','broadcast-ack','empty-worker-list','localStorage-flag','new-schema','self-reported-build','new-browser','hash-alone','new-domain'];
for(const evidence of attemptedEvidence){const decision=admissionDecision({[evidence]:true});assert.notEqual(decision.state,'ADMISSION_GRANTED');results.push({id:'FORGE-'+evidence,status:'PASS',level:'POLICY_MODEL_ONLY',decision,limitation:'Ignored client claim, no real external verifier implemented'});}
mkdirSync(resolve(here,'evidence'),{recursive:true});writeFileSync(resolve(here,'evidence/financial.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,results},null,2)+'\n');
console.log(JSON.stringify({counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),results:results.map(({id,status,error})=>({id,status,error}))},null,2));
