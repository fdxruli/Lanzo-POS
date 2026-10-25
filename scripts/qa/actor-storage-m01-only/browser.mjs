// Real Chromium documents, one origin and one BrowserContext per scenario.
// Commercial controller/bridge/handoff/storage; synthetic session/tenant/DB provider.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const main = 'f48aab53634663438a06dc5187fa7e6d17b74fb3';
const focal = '1cdc1cd029982e0279177ab29be1f8fffacb6ed8';
const auth = 'src/services/auth/';
const versions = ['main', 'focal', 'candidate'];
const files = ['actorScopedStorage.js', 'actorSessionRuntimeBridge.js'];
const source = Object.fromEntries(versions.map(v => [v, Object.fromEntries(files.map(f => [f,
  v === 'candidate' ? readFileSync(auth + f, 'utf8')
    : execFileSync('git', ['show', `${v === 'main' ? main : focal}:${auth}${f}`], { encoding: 'utf8' })]))]));
const hashes = Object.fromEntries(versions.map(v => [v, Object.fromEntries(files.map(f => [f,
  createHash('sha256').update(source[v][f]).digest('hex')]))]));
const bundles = {};
for (const v of versions) {
  const result = await build({ stdin: { contents: `
    import * as storage from './src/services/auth/actorScopedStorage';
    import * as bridge from './src/services/auth/actorSessionRuntimeBridge';
    import { actorRuntimeController as runtime, runWithActorHandle } from './src/services/auth/actorRuntimeController';
    import * as tenant from './src/services/tenant/tenantScopedStorage';
    import * as handoff from './src/services/auth/actorOperationalHandoff';
    window.qa = {storage, bridge, runtime, tenant, handoff, runWithActorHandle};
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'isolated-providers', setup(b) {
    b.onResolve({ filter: /tenantRuntimeRouter$|\/supabase$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('supabase') ? `
      export const getStableDeviceId = async () => window.fixture.device;
      export const getAdminOfflineAuthorization = async () => ({eligible:true,
        effectiveExpiresAt:new Date(window.fixture.expires).toISOString(), effectiveNow:Date.now()});
    ` : `
      export const getTenantRuntimeReadiness = () => ({ready:true,runtime:window.fixture.tenant});
      export const db = {table: name => name === 'sync_cache'
        ? {get: async key => ({value: {admin_session_token:'synthetic-token', admin_session_id:window.fixture.session}[key]})}
        : {filter: () => ({toArray: async () => []})}};
    ` }));
    b.onLoad({ filter: /actorScopedStorage\.js$|actorSessionRuntimeBridge\.js$/ }, args => ({
      contents: source[v][args.path.split('/').at(-1)], loader: 'js', resolveDir: resolve(auth)
    }));
  } }] });
  bundles[v] = result.outputFiles[0].text;
}
const { chromium } = await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href);
let barrier = null;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/barrier') {
    try { await barrier(); res.end('ready'); } catch (e) { res.statusCode = 500; res.end(String(e)); }
  } else if (/^\/(main|focal|candidate)\.mjs$/.test(req.url)) {
    res.setHeader('Content-Type', 'text/javascript'); res.end(bundles[req.url.slice(1, -4)]);
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Isolated V1 stability QA</title>'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
const boot = async (context, version, noBC = false) => {
  const p = await context.newPage();
  await p.addInitScript(({ noBC }) => {
    window.signals = 0;
    if (noBC) window.BroadcastChannel = undefined;
    else {
      const Native = window.BroadcastChannel;
      window.BroadcastChannel = class extends Native {
        addEventListener(name, fn, ...rest) {
          super.addEventListener(name, (...args) => { fn(...args); window.signals++; }, ...rest);
        }
      };
    }
    window.fixture = { tenant: {opaqueId:'t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      databaseName:'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',generation:1},
      session:'session-a',device:'device-a',now:Date.now()};
    Date.now = () => window.fixture.now;
    window.fixture.expires = Date.now() + 1000;
  }, { noBC });
  await p.goto(origin);
  await p.evaluate(async version => {
    await import(`/${version}.mjs`);
    const { qa, fixture: f } = window;
    window.contextKey = `lanzo:t:${f.tenant.opaqueId}:actor-runtime-context:v1`;
    qa.events = [];
    qa.storage.subscribeActorScopedStorage(e => qa.events.push(e));
    qa.tenant.setActiveTenantStorageNamespace(f.tenant.opaqueId); qa.tenant.markTenantStorageReady();
    qa.mount = async (session = 'session-a', actor = 'a') => {
      f.session = session;
      qa.bridge.beginActorRuntimeAuthentication('admin');
      const result = await qa.bridge.restoreActorRuntimeFromCurrentSessionCache({actorType:'admin',actor:{id:actor}});
      qa.oldRuntime = qa.runtimeHandle; qa.oldStorage = qa.storageHandle;
      qa.runtimeHandle = qa.runtime.capture(); qa.storageHandle = qa.storage.captureActorScopedStorageHandle();
      return result;
    };
    qa.probe = () => {
      const attempt = fn => {try {fn();return {allowed:true};}catch(e){return {allowed:false,code:e.code};}};
      const state = qa.runtime.getState();
      return { durable:localStorage.getItem(window.contextKey), state,
        storage:qa.storage.getActorScopedStorageState(),
        runtime:attempt(() => qa.runtimeHandle.assertCurrent()),
        write:attempt(() => qa.storageHandle.setItem('lanzo-active-orders-storage','synthetic-draft')),
        oldRuntime:qa.oldRuntime ? attempt(() => qa.oldRuntime.assertCurrent()) : null,
        oldStorage:qa.oldStorage ? attempt(() => qa.oldStorage.assertCurrent()) : null };
    };
  }, version);
  return p;
};
const run = async (id, expectation, fn) => {
  const context = await browser.newContext();
  try { results.push({id,expectation,...await fn(context)}); }
  catch(e) {results.push({id,status:'HARNESS_ERROR',error:String(e)});}
  finally {await context.close();}
};
try {
  for (const v of versions) await run(`EXP14-${v}`, 'B remains granted, old handles rejected', async c => {
    const p = await boot(c, v); await p.evaluate(() => window.qa.mount());
    const old = await p.evaluate(() => {
      window.fixture.now += 1000; window.qa.runtime.getState(); return localStorage.getItem(window.contextKey);
    });
    await p.evaluate(() => {window.fixture.expires += 100000; return window.qa.mount('session-b');});
    const before = await p.evaluate(() => window.qa.probe());
    const after = await p.evaluate(old => {
      window.dispatchEvent(new StorageEvent('storage',{key:window.contextKey,newValue:old,storageArea:localStorage}));
      return window.qa.probe();
    }, old);
    return {before,after,status: after.state.status === 'granted' && after.write.allowed && !after.oldRuntime.allowed
      && !after.oldStorage.allowed && after.durable === before.durable && after.state.generation === before.state.generation ? 'PASS':'FAIL'};
  });

  for (const [av,bv] of [['main','main'],['main','candidate'],['candidate','main'],['candidate','candidate'],['focal','focal']]) {
    for (const frozen of ['none','A','B']) await run(`LC13-${av}-${bv}-freeze-${frozen}`,
      'stale A cannot overwrite B; old A denied', async c => {
        const a = await boot(c,av), b = await boot(c,bv);
        await a.evaluate(() => window.qa.mount());
        let cd;
        if(frozen==='A') {cd=await c.newCDPSession(a);await cd.send('Page.setWebLifecycleState',{state:'frozen'});}
        await b.evaluate(() => window.qa.mount('session-b','b'));
        const before=await b.evaluate(() => window.qa.probe());
        if(frozen==='B') {cd=await c.newCDPSession(b);await cd.send('Page.setWebLifecycleState',{state:'frozen'});}
        if(frozen==='A') await cd.send('Page.setWebLifecycleState',{state:'active'});
        await a.evaluate(() => window.qa.storage.invalidateActorScopedStorage('late-a'));
        if(frozen==='B') await cd.send('Page.setWebLifecycleState',{state:'active'});
        const after=await b.evaluate(() => window.qa.probe()), old=await a.evaluate(() => window.qa.probe());
        return {before,after,old,status:after.durable===before.durable && after.write.allowed && !old.write.allowed ? 'PASS':'FAIL'};
      });
  }

  // v1 invalidate has no ownership read. Pause immediately before its real
  // publication: B's grant lands after A's last observation, before A's write.
  for (const v of ['main', 'candidate']) await run(`CONCURRENT-LC13-${v}`,
    'B publication before A write must preserve B (known v1 FAIL)', async c => {
      const a=await boot(c,v), b=await boot(c,v); await a.evaluate(() => window.qa.mount());
      await b.evaluate(async () => {
        const f=window.fixture; await window.qa.storage.prepareActorScopedStorage({tenant:f.tenant,actorKey:'admin:b',actorGeneration:1});
      });
      let during;
      barrier=async () => {during=await b.evaluate(() => {
        window.qa.storage.activateActorScopedStorage({tenant:window.fixture.tenant,actorKey:'admin:b',generation:1});
        window.qa.storage.resumeActorScopedStorageWrites();window.qa.storageHandle=window.qa.storage.captureActorScopedStorageHandle();
        return localStorage.getItem(window.contextKey);
      });};
      await a.evaluate(() => {
        const observed=localStorage.getItem(window.contextKey);
        window.lastObservation=observed;
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,value){
          if(k===window.contextKey){Storage.prototype.setItem=original;const x=new XMLHttpRequest();x.open('GET','/barrier',false);x.send();if(x.status!==200)throw Error('barrier failed');}
          return original.call(this,k,value);};
        window.qa.storage.invalidateActorScopedStorage('concurrent-a');
      });
      const after=await b.evaluate(() => {
        let allowed;try{window.qa.storageHandle.assertCurrent();allowed=true;}catch{allowed=false;}
        return {durable:localStorage.getItem(window.contextKey),allowed};
      });
      return {during,after,runtime:'B NOT_GRANTED: isolated storage interleaving',status:after.durable===during && after.allowed?'PASS':'FAIL'};
    });

  for (const v of ['main','candidate']) for (const cleanup of ['pending','logout-finally'])
    await run(`LC13-${cleanup}-${v}`, 'old cleanup must preserve later B (known v1 FAIL)', async c => {
      const a=await boot(c,v),b=await boot(c,v);
      if(cleanup==='pending') await a.evaluate(() => window.qa.storage.prepareActorScopedStorage({tenant:window.fixture.tenant,actorKey:'admin:a',actorGeneration:1}));
      else {await a.evaluate(() => window.qa.mount()); await a.evaluate(() => window.qa.runtime.lock('logout-before-await'));}
      await b.evaluate(() => window.qa.mount('session-b','b'));
      const before=await b.evaluate(() => window.qa.probe());
      await a.evaluate(() => window.qa.storage.invalidateActorScopedStorage('finally-after-await'));
      const after=await b.evaluate(() => window.qa.probe());
      return {before,after,status:after.durable===before.durable&&after.write.allowed?'PASS':'FAIL',
        limitation:'controlled delayed cleanup call; not full license logout RPC/UI E2E'};
    });

  for(const noBC of [false,true]) await run(`replacement-C-noBC-${noBC}`, 'B rejects after legitimate C', async c => {
    const b=await boot(c,'candidate',noBC), d=await boot(c,'candidate',noBC);
    await b.evaluate(() => window.qa.mount('session-b','b'));
    await d.evaluate(() => window.qa.mount('session-c','c'));
    await b.waitForFunction(() => window.qa.storage.getActorScopedStorageState().writesSuspended);
    const bAfter=await b.evaluate(() => window.qa.probe()), cAfter=await d.evaluate(() => window.qa.probe());
    return {bAfter,cAfter,status:!bAfter.write.allowed && bAfter.state.status==='locked' && cAfter.write.allowed?'PASS':'FAIL'};
  });
  await run('BC-out-of-order-candidate', 'old BC hint never overrides B durable', async c => {
    const p=await boot(c,'candidate');await p.evaluate(() => window.qa.mount());
    const before=await p.evaluate(() => window.qa.probe());
    await p.evaluate(() => {const x=new BroadcastChannel('lanzo-actor-storage-v1');
      x.postMessage({tenantOpaqueId:window.fixture.tenant.opaqueId,contextToken:'obsolete',status:'locked'});window.testChannel=x;});
    await p.waitForFunction(() => window.signals>0);
    const after=await p.evaluate(() => window.qa.probe());
    return {before,after,status:after.write.allowed&&after.state.generation===before.state.generation&&after.durable===before.durable?'PASS':'FAIL'};
  });
  for(const mode of ['missing','corrupt','inaccessible','duplicate','out-of-order']) await run(`durable-${mode}`,
    'bad durable denies; duplicated or historical hints preserve valid B',async c => {
      const p=await boot(c,'candidate');await p.evaluate(() => window.qa.mount());
      const after=await p.evaluate(mode => {
        if(mode==='missing')localStorage.removeItem(window.contextKey);
        if(mode==='corrupt')localStorage.setItem(window.contextKey,'{broken');
        const descriptor=Object.getOwnPropertyDescriptor(window,'localStorage');
        if(mode==='inaccessible')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError');},configurable:true});
        for(let i=0;i<2;i++)window.dispatchEvent(new StorageEvent('storage',{key:window.contextKey,newValue:'{"obsolete":true}'}));
        if(mode==='inaccessible')Object.defineProperty(window,'localStorage',descriptor);
        return window.qa.probe();
      },mode);
      const valid=['duplicate','out-of-order'].includes(mode);
      return {after,status:valid?after.write.allowed?'PASS':'FAIL':!after.write.allowed&&after.state.status==='locked'?'PASS':'FAIL'};
    });
  await run('V1-16-close-grants', 'after hints settle, exactly one storage handle remains current; no CAS claim', async c => {
    const a=await boot(c,'candidate'), b=await boot(c,'candidate');
    const returned=await Promise.all([a.evaluate(() => window.qa.mount('session-a','a')),
      b.evaluate(() => window.qa.mount('session-b','b'))]);
    const bindingA=await a.evaluate(() => window.qa.storage.getActorScopedStorageState().active.contextToken);
    const winner=await b.evaluate(() => JSON.parse(localStorage.getItem(window.contextKey)).contextToken);
    const loser=winner===bindingA?b:a;
    await loser.waitForFunction(() => window.qa.runtime.getState().status==='locked');
    const afterA=await a.evaluate(() => window.qa.probe()),afterB=await b.evaluate(() => window.qa.probe());
    return {returned,afterA,afterB,status:Number(afterA.write.allowed)+Number(afterB.write.allowed)===1?'PASS':'FAIL',
      limitation:'eventual storage correspondence; both grant calls may have returned GRANTED before notification. No atomic grant/financial admission proof'};
  });
  await run('V1-21-runtime-boundary', 'storage rejection alone cannot certify all runtime callbacks', async c => {
    const p=await boot(c,'candidate');await p.evaluate(() => window.qa.mount());
    const observation=await p.evaluate(async () => {
      const q=window.qa,record=JSON.parse(localStorage.getItem(window.contextKey));
      localStorage.setItem(window.contextKey,JSON.stringify({...record,contextToken:'foreign-before-hint'}));
      const before=q.probe();let syntheticEffects=0;
      await q.runWithActorHandle(q.runtimeHandle,async ({guardedWrite}) => guardedWrite(() => {syntheticEffects++;}));
      return {before,syntheticEffects};
    });
    return {...observation,status:!observation.before.write.allowed && observation.before.runtime.allowed
      && observation.syntheticEffects===1 ? 'PASS_LIMITATION_DETECTED':'HARNESS_ERROR',
      limitation:'Runtime callback is not storage fenced; synthetic counter, no sale/server bypass demonstrated'};
  });
  console.log(JSON.stringify({main,focal,hashes,chromium:browser.version(),scope:'real modules; synthetic auth/DB provider; no financial E2E',results},null,2));
  if(results.some(r=>r.status==='HARNESS_ERROR'))process.exitCode=2;
  // Known FAILs remain FAIL in evidence; never infer safety from exit 0.
} finally {await browser.close();await new Promise(done=>server.close(done));}
