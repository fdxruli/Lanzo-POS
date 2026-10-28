import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='scripts/qa/single-instance-f012c/evidence';
const result=JSON.parse(readFileSync(`${dir}/candidate/global.json`));
const suite=result.testResults.find(s=>s.name.endsWith('/single-instance-f012c/background-lifetime.test.js'));
assert(suite);const traces=JSON.parse(readFileSync(`${dir}/bgx-traces.json`));
const source=readFileSync('scripts/qa/single-instance-f012c/background-lifetime.test.js','utf8');
const groups=[
 {range:[1,15],root:'_loadProfile',children:['local profile reads','synchronous preferences/Drive','getBusinessProfile RPC','both cache writes','profile publication/onPrepared'],publicPromise:'Profile public result retains 8000ms RPC race; cache/publish awaits remain part of root.',transport:'Raw get_business_profile_anon may remain pending after public timeout. BGX-03/05/15 assert intermediate pending states.'},
 {range:[16,25],root:'refreshDriveSession / refreshTenantUiPreferences, directly or from _loadProfile',children:['sessionStorage token read','cash policy local read','synchronous Zustand publication'],publicPromise:'Production refresh providers return synchronously. Async replacements are separately observed and UNKNOWN.',transport:'No Google RPC, OAuth request, token renewal, backup or restore in these refresh providers.'},
 {range:[26,35],root:'revalidateLicense owner record + joined consumers',children:['tenant lease','connectivity','device identity','credential preparation','raw license RPC','response/cache continuation','fallback','lease/finally'],publicPromise:'Public root preserves original 8000ms race and offline result. Raw completion has independent ledger.',transport:'One RPC for same binding; changed actor/tenant never joins old record. BGX-28/30/33 assert lifetime remains after public result.'},
 {range:[36,45],root:'_processServerValidation',children:['license persistence','profile public load','refreshLicenseSyncMode','possible synchronous store subscribers/delegated sync'],publicPromise:'Root public processing can settle with children outside the coordinator contract. UNKNOWN deliberately remains.',transport:'Synthetic sync/public providers only; no live sync calls. BGX-43/44 reproduce pending delegated work despite settled processing.'},
 {range:[46,55],root:'lifecycle admission/join, profile or validation',children:['known registered promises','raw transport','local persistence continuations'],publicPromise:'See scenario assertions: quiesce, invalidation, timeout and late rejection are distinct from drain.',transport:'Synchronous registration plus actual pending checkpoint; no remote state confirmation.'},
 {range:[56,60],root:'default or observed compatibility path',children:['profile/query work only as scenario'],publicPromise:'Default public values and no-license/no-tenant paths preserve existing behavior.',transport:'No provider access for no license/tenant. Explicitly mocked for every network-capable test.'}
];
const rows=suite.assertionResults.map(test=>{
 const match=test.fullName.match(/^BGX-(\d+)/),id=match?Number(match[1]):null;
 const group=id?groups.find(g=>id>=g.range[0]&&id<=g.range[1]):{root:'extra context/callback/token recovery guard',children:['captured context','optional async callback / credential read/write'],publicPromise:'Extra security boundaries explicitly asserted in source.',transport:'Synthetic only; stale token recovery starts neither persistence nor license RPC.'};
 const trace=traces.find(t=>t.test===test.fullName);assert(trace);const line=source.split('\n').findIndex(l=>l.includes(test.fullName.split(' ').slice(0,2).join(' ')))+1;
 return {id:match?`BGX-${String(id).padStart(2,'0')}`:test.fullName,assertion:test.fullName,status:test.status,
  initialContext:trace.initial,actor:trace.initial.actor,tenant:trace.initial.tenant,rootTask:group.root,childTasks:group.children,
  publicPromise:group.publicPromise,realTransportStateEvidence:group.transport,
  invalidationMoment:'The named event is performed between the explicit awaits in this scenario; checkpoints capture observed actor/tenant and pending tasks. None when scenario has no invalidation.',
  continuationsExecuted:trace.storeWrites,persistentWrites:trace.writes,checkpoints:trace.checkpoints,finalLifecycle:trace.lifecycles,
  drainResult:trace.lifecycles.map(s=>s.unknown.length?'UNKNOWN: cannot credit drain':s.pending?'PENDING: not yet settled':'REGISTERED_WORK_SETTLED: bounded local contract only'),
  source:{path:'scripts/qa/single-instance-f012c/background-lifetime.test.js',line:line||null,lookup:'Use full assertion title, including parameterized for-loop labels.'},
  residualRisk:trace.limits};
});
assert.equal(rows.filter(r=>r.id.startsWith('BGX-')).length,60);assert(rows.every(r=>r.status==='passed'));
writeFileSync(`${dir}/bgx-matrix.json`,JSON.stringify(rows,null,2));
writeFileSync(`${dir}/bgx-table.md`,['| ID | Assertion | Result |','| --- | --- | --- |',...rows.map(r=>`| ${r.id} | ${r.assertion.replaceAll('|','/')} | ${r.status.toUpperCase()} |`)].join('\n')+'\n');
console.log(JSON.stringify({rows:rows.length,bgx:60,extras:rows.length-60,allPassed:true}));
