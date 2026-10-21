// RESEARCH ONLY: all profiles, origins, DBs and effects are synthetic.
import { createServer } from 'node:http';
import { createServer as createTLS } from 'node:https';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const sha = 'f48aab53634663438a06dc5187fa7e6d17b74fb3';
let legacy;
try { legacy = readFileSync(resolve(here, 'fixtures/main-actorScopedStorage.mjs')); }
catch { legacy = execFileSync('git', ['show', `${sha}:src/services/auth/actorScopedStorage.js`], { cwd: root }); }
const blobHash = createHash('sha1').update(`blob ${legacy.length}\0`).update(legacy).digest('hex');
if (blobHash !== 'dcc09e7be2fcf2435801302c3199f8592e029edc') throw new Error('LEGACY_ARTIFACT_MISMATCH');
const dexiePath = process.env.AUTHORITY_QA_DEXIE || resolve(root, 'node_modules/dexie/dist/dexie.mjs');
const sources = {
  '/main.mjs': legacy,
  '/client.mjs': readFileSync(resolve(here, 'client.mjs')),
  '/prototype.mjs': readFileSync(resolve(here, '../actor-context-contract/prototype.mjs')),
  '/admission.mjs': readFileSync(resolve(here, '../actor-authority-admission/admission-model.mjs')),
  '/dexie.mjs': readFileSync(dexiePath),
};
let distributionLocked = false; let workerVersion = 1;
const workerSource = () => `const VERSION=${workerVersion};self.addEventListener('install',e=>e.waitUntil(caches.open('synthetic-v'+VERSION).then(c=>c.addAll(['/cached-legacy.html','/main.mjs','/client.mjs','/prototype.mjs','/admission.mjs']))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).origin===self.location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`;
const handler = (req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (path === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(workerSource()); }
  else if (path === '/main.mjs' && distributionLocked) { res.writeHead(410); res.end('LEGACY_DISTRIBUTION_DENIED'); }
  else if (sources[path]) { res.setHeader('Content-Type', 'text/javascript'); res.end(sources[path]); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Synthetic transition laboratory</title>${path === '/away' ? '<p>Away</p>' : '<script type="module" src="/client.mjs"></script>'}`); }
};
const server = createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let tlsServer;
if(process.env.ACTOR_QA_TLS_KEY&&process.env.ACTOR_QA_TLS_CERT){
  tlsServer=createTLS({key:readFileSync(process.env.ACTOR_QA_TLS_KEY),cert:readFileSync(process.env.ACTOR_QA_TLS_CERT)},handler);
  await new Promise(r=>tlsServer.listen(0,'127.0.0.1',r));
}
const modulePath = process.env.ACTOR_QA_PLAYWRIGHT_MODULE || resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath));
let browser;
const results = []; const blockedNetwork = []; let counter = 0;
const manifest = Object.fromEntries(Object.entries(sources).map(([p,b]) => [p, createHash('sha256').update(b).digest('hex')]));
const newContext = async () => {
  const c = await browser.newContext({ignoreHTTPSErrors:Boolean(tlsServer)});
  await c.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (['127.0.0.1','localhost'].includes(u.hostname) && [String(server.address().port),String(tlsServer?.address().port)].includes(u.port)) await route.continue();
    else { blockedNetwork.push(u.origin); await route.abort(); }
  });
  return c;
};
const boot = async (c, kind, id) => { const p = await c.newPage(); await p.goto(`${origin}/?kind=${kind}&id=${id}`); await p.waitForFunction(() => Boolean(window.ready)); await p.evaluate(() => window.ready); return p; };
const snapshot = p => p.evaluate(() => window.lab.snapshot());
const write = p => p.evaluate(() => window.lab.write());
const run = async (id, domain, test) => {
  distributionLocked = false; workerVersion = 1;
  const context = await newContext(); const fixture = `case-${++counter}`;
  try {
    const result = await test(context, fixture);
    results.push({ id, domain, mainSHA: sha, legacyBlob: blobHash, profile: `isolated-context-${counter}`, origin, level: 'SYNTHETIC_BOUNDARY_ONLY', expected: 'B restricted without proof; A must be unable to commit for P2', ...result });
  } catch(error) { results.push({ id, domain, status: 'ERROR', error: error.stack }); }
  finally { await context.close(); }
};
const mixed = async (c,id,setup) => {
  const a = await boot(c,'legacy',id); const before = await snapshot(a);
  if (setup) await setup(a,c,'before');
  const b = await boot(c,'v2',id);
  if (setup) await setup(a,c,'after');
  const protectedBefore = await snapshot(b);
  const protectedPrototype = await b.evaluate(() => window.lab.protectedWrite());
  const protectedAfter = await snapshot(b);
  const writes = { legacy: await write(a), protectedPrototype, forcedPrototype: await write(b) };
  return { before, after: { a: await snapshot(a), b: await snapshot(b) }, writes,
    containment: !protectedPrototype.committed && JSON.stringify(protectedBefore.durable) === JSON.stringify(protectedAfter.durable) ? 'PASS' : 'FAIL', status: writes.legacy.committed ? 'FAIL' : 'PASS',
    limitation: 'Forced prototype grant is a rejected activation hypothesis; real admission policy remains restricted. Writes are storage payload/effect, not POS sales.' };
};
try {
  browser = await chromium.launch({ executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE, headless: true,ignoreDefaultArgs:['--disable-back-forward-cache'],
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-proxy-server'] });
  await run('T3-01','unmanaged', (c,id) => mixed(c,id));
  await run('T3-02','unmanaged', async(c,id) => {
    let cdp;
    return mixed(c,id,async(a,c,phase) => { if(phase==='before'){ cdp=await c.newCDPSession(a); await cdp.send('Page.setWebLifecycleState',{state:'frozen'}); } else await cdp.send('Page.setWebLifecycleState',{state:'active'}); });
  });
  results.push({ id:'T3-03',domain:'partial',status:'PENDING',limitation:'Real closed-document session restore not provided by this headless context. Reload is not substituted.' });
  await run('T3-04','partial',async(c,id) => {
    const a = await boot(c,'legacy',id);
    await a.evaluate(async() => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await a.waitForFunction(() => navigator.serviceWorker.controller);
    distributionLocked = true;
    const denial = await fetch(`${origin}/main.mjs`).then(r=>r.status);
    const cached = await c.newPage(); await cached.goto(`${origin}/cached-legacy.html`); await cached.waitForFunction(()=>Boolean(window.ready)); await cached.evaluate(()=>window.ready);
    const swResponse = await cached.evaluate(async()=>({status:(await fetch('/main.mjs')).status,controller: navigator.serviceWorker.controller.scriptURL,caches:await caches.keys()}));
    const outcome=await write(cached);
    return { status:outcome.committed?'FAIL':'PASS',serverDenial:denial,swResponse,executed:await cached.evaluate(()=>window.lab.executedSource),write:outcome,after:await snapshot(cached),limitation:'Server distribution denies old artifact, but cached exact module still executes. Synthetic SW, not Lanzo Workbox.' };
  });
  await run('T3-05','unmanaged',async(c,id)=>{
    const [a,b]=await Promise.all([boot(c,'legacy',id),boot(c,'v2',id)]);
    const writes=await Promise.all([write(a),write(b)]);
    return { status:writes.every(x=>x.committed)?'FAIL':'PASS',writes,after:await Promise.all([snapshot(a),snapshot(b)]) };
  });
  await run('T3-06','unmanaged',async(c,id)=>{
    const a=await boot(c,'legacy',id); const other=await newContext();
    try { const b=await boot(other,'v2',id); await write(b); const x=await snapshot(a); const y=await snapshot(b);
      return { status:x.durable.effects.length===0&&y.durable.effects.length===1?'PASS':'FAIL',beforeOther:x,afterOther:y,limitation:'Two isolated BrowserContexts are separate storage partitions, not two physical desktop profiles. No shared-IDB claim.' };
    } finally {await other.close();}
  });
  results.push({id:'T3-07',domain:'partial',status:'PENDING',limitation:'Installed PWA unavailable; headless page is not installation.'});
  await run('T3-08','unmanaged',async(c,id)=>{
    const a=await boot(c,'legacy',id); await a.goto(`${origin}/away`); await a.goBack(); await a.waitForFunction(()=>Boolean(window.ready)); await a.evaluate(()=>window.ready);
    const persisted=await a.evaluate(()=>window.lab.pageshowPersisted===true); const outcome=await write(a);
    return {status:persisted?(outcome.committed?'FAIL':'PASS'):'PENDING',persisted,write:outcome,limitation:'Only pageshow.persisted=true counts as BFCache. A normal history reload does not.'};
  });
  await run('T3-09','partial',async(c,id)=>{
    const a=await boot(c,'legacy',id); await a.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});await a.waitForFunction(()=>navigator.serviceWorker.controller);
    const before=await snapshot(a); workerVersion=2;
    const reg=await a.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();return {active:r.active?.state,installing:r.installing?.state,waiting:r.waiting?.state};});
    const outcome=await write(a); return {status:outcome.committed?'FAIL':'PASS',before,reg,write:outcome,after:await snapshot(a),limitation:'New SW source served does not replace already executing legacy JS.'};
  });
  await run('T3-10','partial',async(c,id)=>{
    const b=await boot(c,'v2',id); await b.evaluate(async()=>{await window.lab.client.beginOperation(window.lab.handle,'pending');await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});await b.waitForFunction(()=>navigator.serviceWorker.controller);
    const before=await snapshot(b); workerVersion=2;await b.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js?revision=2',{scope:'/'});});
    await b.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting),null,{timeout:10000}).catch(()=>{});
    const after=await snapshot(b);const worker=await b.evaluate(async()=>({waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,active:(await navigator.serviceWorker.getRegistration()).active?.state,hasHandle:!!window.lab.handle}));
    return {status:worker.waiting!=='installed'?'PENDING':worker.hasHandle&&JSON.stringify(before.durable)===JSON.stringify(after.durable)?'PASS':'FAIL',before,after,worker,limitation:'No skipWaiting or reload called. Fixture intent, not real payment. Missing waiting observation is not a security failure.'};
  });
  results.push({id:'T3-11',domain:'partial',status:'PENDING',limitation:'Persistent desktop session restart/restore not executed; context shutdown does not prove restored versions.'});
  for(const id of ['T3-12','T3-13']) await run(id,'unmanaged',async(c,fixture)=>{
    const a=await boot(c,'legacy',fixture);
    const outcome=await a.evaluate(async(held)=>{
      const {default:Dexie}=await import('/dexie.mjs');const name='synthetic-dexie-'+window.lab.id;
      const old=new Dexie(name);old.version(1).stores({effects:'id'});await old.open();const table=old.table('effects');await table.put({id:'before',synthetic:true});
      const next=new Dexie(name);next.version(1).stores({effects:'id'});next.version(2).stores({authority:'tenant'});
      let blocked=false;let heldWrite=false;
      if(held){old.on('versionchange',()=>false);const barrier=new Promise(r=>next.on('blocked',()=>{blocked=true;r();}));const upgrade=next.open();await barrier;await table.put({id:'while-upgrade-blocked',synthetic:true});heldWrite=true;old.close();await upgrade;}
      else await next.open();
      const stateAfterUpgrade=old.isOpen();let error;
      try{await old.open();await table.put({id:'after-upgrade',synthetic:true});}catch(e){error=e.name;}
      const rows=await next.table('effects').toArray();const out={dexieVersion:Dexie.semVer,stateAfterUpgrade,oldVersion:old.verno,nextVersion:next.verno,blocked,heldWrite,rows,error};old.close();next.close();return out;
    },id==='T3-13');return {status:outcome.rows.some(r=>r.id==='after-upgrade')?'FAIL':'PASS',...outcome,limitation:'Real Dexie and captured table on synthetic schema. T3-13 refuses versionchange until a synthetic write commits, then closes voluntarily. Lanzo preflight/complete financial route not loaded.'};
  });
  await run('T3-14','unmanaged',async(c,id)=>{
    const b=await boot(c,'v2',id);await b.evaluate(()=>window.lab.client.invalidate(window.lab.handle));
    await b.evaluate(()=>window.lab.prototype.transaction(window.lab.db,['effects'],'readwrite',tx=>tx.put('effects',['synthetic-T','legacy-direct'],{synthetic:true,bypassedFence:true})));
    const after=await snapshot(b);return {status:after.durable.effects.some(e=>e.bypassedFence)?'FAIL':'PASS',after,limitation:'Noncooperating direct IDB writer is synthetic, not exact POS financial code.'};
  });
  await run('T3-15','unmanaged',async(c,id)=>{
    const a=await boot(c,'legacy',id);const b=await boot(c,'v2',id);await c.setOffline(true);
    const writes=await Promise.all([write(a),write(b)]);return {status:writes.every(x=>x.committed)?'FAIL':'PASS',writes,after:await Promise.all([snapshot(a),snapshot(b)]),limitation:'Offline browser network, no Supabase configured; does not certify product Admin policy.'};
  });
  await run('T3-16','unmanaged',async(c,id)=>{
    const a=await boot(c,'legacy',id);const b=await boot(c,'v2',id);await a.evaluate(()=>window.lab.mount());const before=await snapshot(b);const outcome=await write(a);
    return {status:outcome.committed?'FAIL':'PASS',before,write:outcome,after:await snapshot(b),limitation:'New synthetic legacy storage activation, not authentication or real session issuance.'};
  });
  await run('T3-17','unmanaged',async(c,id)=>{
    const a=await boot(c,'legacy',id);const b=await boot(c,'v2',id);const before=await snapshot(b);await a.evaluate(()=>window.lab.legacy.invalidateActorScopedStorage('late-synthetic-logout'));
    const outcome=await write(b);const after=await snapshot(b);return {status:outcome.committed?'PASS':'FAIL',before,after,write:outcome,limitation:'P1 separation only. Does not retire A or close legacy LC13. Prototype Runtime only.'};
  });
  await run('T3-18','partial',async(c,id)=>{
    const a=await boot(c,'legacy',id);distributionLocked=true;
    const denial=await fetch(`${origin}/main.mjs`).then(r=>r.status);const b=await boot(c,'v2',id);const outcome=await write(a);
    return {status:denial===410&&outcome.committed?'FAIL':'PASS',serverDenial:denial,write:outcome,after:await snapshot(b),limitation:'Distribution gate rejects download but memory remains. Not a managed OS distribution certificate.'};
  });
  await run('T3-19','partial',async(c,id)=>{
    const b=await boot(c,'v2',id);const before=await snapshot(b);
    const decision=await b.evaluate(async()=>{const {admissionDecision}=await import('/admission.mjs');return admissionDecision({storage:'unavailable'});});const after=await snapshot(b);
    return {status:decision.state!=='ADMISSION_GRANTED'&&JSON.stringify(before.durable)===JSON.stringify(after.durable)?'PASS':'FAIL',decision,before,after,limitation:'Injected unavailable witness/storage policy input; no real management agent exists. Forced prototype context is not a production grant.'};
  });
  await run('T3-20','partial',async(c,id)=>{
    const a=await boot(c,'legacy',id);await a.close();const b=await boot(c,'v2',id);const reopened=await boot(c,'legacy',id);const outcome=await write(reopened);
    return {status:outcome.committed?'FAIL':'PASS',write:outcome,after:await snapshot(b),limitation:'Reentry after voluntary closure; no enforced transition was completed.'};
  });
  results.push({id:'DOMAIN-3',domain:'fully-managed',status:'UNPROVEN',code:'MANAGED_ENFORCEMENT_NOT_AVAILABLE',limitation:'Harness controls its child browser, not an OS-wide allowlist, external writer reference monitor or persistent rollback protection. No positive admission asserted.'});
  for(const host of ['127.0.0.1','localhost']) await run('CAP-'+host,'capability',async(c)=>{
    const p=await c.newPage();await p.goto(`http://${host}:${server.address().port}/away`);return {status:'PASS',capabilities:await p.evaluate(()=>({secure:isSecureContext,idb:!!indexedDB,locks:!!navigator.locks,bc:!!window.BroadcastChannel,sw:!!navigator.serviceWorker,subtle:!!crypto.subtle,random:!!crypto.getRandomValues}))};
  });
  await run('CAP-IP','capability',async(c)=>{
    await c.route('http://192.168.250.10/**',route=>route.fulfill({body:'<!doctype html><title>Synthetic IP</title>',contentType:'text/html'}));const p=await c.newPage();await p.goto('http://192.168.250.10/');
    return {status:'PASS',capabilities:await p.evaluate(async()=>{const r=indexedDB.open('synthetic-cap',1);await new Promise((yes,no)=>{r.onsuccess=yes;r.onerror=no;});r.result.close();return {secure:isSecureContext,idb:true,locks:!!navigator.locks,bc:!!window.BroadcastChannel,sw:!!navigator.serviceWorker,subtle:!!crypto.subtle,random:!!crypto.getRandomValues};}),limitation:'Intercepted private-IP origin; no LAN device or transport contacted.'};
  });
  if(tlsServer)await run('CAP-HTTPS','capability',async(c)=>{
    const p=await c.newPage();await p.goto(`https://127.0.0.1:${tlsServer.address().port}/away`);
    return {status:'PASS',capabilities:await p.evaluate(()=>({secure:isSecureContext,idb:!!indexedDB,locks:!!navigator.locks,bc:!!window.BroadcastChannel,sw:!!navigator.serviceWorker,subtle:!!crypto.subtle,random:!!crypto.getRandomValues})),limitation:'Real local TLS with disposable self-signed certificate, ignoreHTTPSErrors enabled. No public trust-chain or owner-device claim.'};
  });else results.push({id:'CAP-HTTPS',status:'PENDING',limitation:'No real QA TLS certificate/chain configured; intercepted HTTPS is not TLS validation.'});
  const output={date:new Date().toISOString(),mainSHA:sha,parentResearchSHA:'c6d5e56afdbdb0e2d59dc479bdd5ada94d418f61',legacyBlob:blobHash,chromium:browser.version(),platform:process.platform,node:process.version,manifest,blockedNetwork,results};
  mkdirSync(resolve(here,'evidence'),{recursive:true});writeFileSync(resolve(here,'evidence/browser.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({chromium:output.chromium,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),results:results.map(({id,status})=>({id,status}))},null,2));
  if(results.some(r=>r.status==='ERROR'))process.exitCode=2;
} finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(tlsServer){tlsServer.closeAllConnections();await new Promise(r=>tlsServer.close(r));}}
