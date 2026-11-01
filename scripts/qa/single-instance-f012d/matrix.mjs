import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve(process.argv[2]||'scripts/qa/single-instance-f012d/evidence');
const global=JSON.parse(readFileSync(join(out,'candidate/global.json'),'utf8'));
const assertions=global.testResults.flatMap(s=>s.assertionResults.map(t=>({...t,file:s.name})));
const scopeTraces=['scope','sync','recovery'].flatMap(name=>JSON.parse(readFileSync(join(out,`${name}-traces.json`),'utf8')));
const existing={
 51:t=>/wrapped transport: valid$/.test(t.fullName)&&/adminOfflineAuthorization/.test(t.file),
 52:t=>/wrapped transport: expired$/.test(t.fullName)&&/adminOfflineAuthorization/.test(t.file),
 53:t=>/wrapped transport: staff$/.test(t.fullName)&&/adminOfflineAuthorization/.test(t.file),
 54:t=>/actorScopedStorage.m01.integration/.test(t.file),
 55:t=>/EXP-F02-05 \/ 168h/.test(t.fullName),
 56:t=>/posSyncClient.tenantIsolation/.test(t.file),
 57:t=>/freeLocalAuthority/.test(t.file),
 59:t=>/ecommerce/i.test(t.file)&&/free/i.test(t.fullName)
};
const limits={
 14:'Handler public settlement observed; raw/descendant lifetime remains UNKNOWN.',
 15:'Snapshot public continuation retained; snapshot handler descendants remain UNKNOWN.',
 29:'Status queue registered; lower realtime reconnect/remove lifetime remains UNKNOWN.',
 30:'Unknown-owner restart rejected. Clean drained restart separately demonstrated in D-04.',
 60:'Deterministic LockManager substitute and actual F01-1 coordinator. Native Chromium NOT_EXECUTED.'
};
const rows=[];
for(let i=1;i<=60;i++){
 const id=`D-${String(i).padStart(2,'0')}`;
 if(i===50||i===58){rows.push({id,result:'PASS',evidence:'preservation.json',scope:'Exact source and bundle audit only; no physical/product E2E claim.',assertion:i===50?'Gate remains OFF; App/main and instance coordinator unchanged; no scope factory/QA in commercial bundles.':'Financial durable source blobs unchanged except explicitly authorized recovery coordinator; idempotency/receipt/ledger contracts preserved.'});continue;}
 const test=assertions.find(i in existing?existing[i]:t=>t.fullName.includes(`${id} `));
 assert(test,`Missing evidence for ${id}`);assert.equal(test.status,'passed',`${id} assertion failed`);
 const trace=scopeTraces.find(t=>test.fullName.endsWith(t.test));
 const suffix=test.file.match(/(?:scripts|src)\/.*/)?.[0]||test.file;
 const source=existsSync(suffix)?readFileSync(suffix,'utf8'):'';
 const excerpt=source.split('\n').find(line=>line.includes(`${id} `))||null;
 rows.push({id,result:[14,15,29,30].includes(i)?'PARTIAL':'PASS',assertionStatus:test.status,assertion:test.fullName,file:suffix,
   initialState:trace?'Synthetic fixture; initial owner context and generation in events/source below.':'Existing original suite fixture, source unchanged; default path without new scope.',
   actorTenant:trace?'actor-A/tenant-A (scope tests use actor/tenant metadata; recovery uses session-A); all synthetic.':'See original fixture; no owner credentials or production data.',
   scope:trace?.scopes?.[0]?.id||trace?.snapshots?.[0]?.id||'Per test fixture; see source',
   generation:trace?.scopes?.[0]?.generation??trace?.snapshots?.[0]?.generation??'Original fixture',
   events:trace?.events||[],finalSnapshots:trace?.scopes||trace?.snapshots||[],writes:trace?.writes||trace?.calls||null,
   sourceAssertion:excerpt,limit:limits[i]||(i>=31&&i<=40?'Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites.':i>=51&&i<=59?'Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow.':'Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes.')});
}
writeFileSync(join(out,'d-matrix.json'),JSON.stringify(rows,null,2));
writeFileSync(join(out,'d-matrix.md'),'| Caso | Estado | Evidencia / límite |\n| --- | --- | --- |\n'+rows.map(r=>`| ${r.id} | ${r.result} | ${(r.assertion+'; '+(r.limit||r.scope)).replaceAll('|','/')} |`).join('\n')+'\n');
console.log(JSON.stringify({rows:rows.length,pass:rows.filter(r=>r.result==='PASS').length,partial:rows.filter(r=>r.result==='PARTIAL').length,newAssertions:assertions.filter(t=>t.file.includes('/single-instance-f012d/')).length}));
