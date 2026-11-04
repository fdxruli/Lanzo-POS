// Real Chromium + React + production authority/lifecycle modules. Synthetic
// identity, tenant DB and authorization evidence; no commercial app or RPC.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const base = '9ca65fc07804f40c2add5e59bee0e6edca940b8f';
const paths = ['src/App.jsx', 'src/store/slices/license/licenseMaintenanceActions.js'];
const baseline = Object.fromEntries(paths.map(p => [p, execFileSync('git', ['show', `${base}:${p}`], { encoding: 'utf8' })]));
const app = baseline['src/App.jsx'];
const oldLifecycle = app.slice(app.indexOf('    let resumeCheckTimer = null;'), app.indexOf('\n  if (isDuplicate)')).replace(/\n  }, \[\]\);\s*$/, '');
const bundles = {};
for (const version of ['main', 'candidate']) {
  const lifecycle = version === 'main' ? `function start({performHealthCheck}) { const useAppStore = {getState:()=>({performSystemHealthCheck:performHealthCheck})}; ${oldLifecycle} }`
    : `import {startAdminResumeChecks as start} from './src/pwa/adminResumeChecks';`;
  const entry = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {useActorRuntimeSnapshot} from './src/services/auth/useActorRuntimeSnapshot';
    import {actorRuntimeController as runtime} from './src/services/auth/actorRuntimeController';
    import * as bridge from './src/services/auth/actorSessionRuntimeBridge';
    import * as storage from './src/services/auth/actorScopedStorage';
    import * as tenant from './src/services/tenant/tenantScopedStorage';
    import {createLicenseMaintenanceActions} from './src/store/slices/license/licenseMaintenanceActions';
    ${lifecycle}
    const f = window.fixture;
    const qa = window.qa = {runtime,bridge,storage,tenant,remote:0,events:[]};
    const state = {appStatus:'ready',_isInitializing:false,runLicenseSyncCheck:async()=>{qa.remote++;}};
    Object.assign(state,createLicenseMaintenanceActions({set:patch=>Object.assign(state,patch),get:()=>state}));
    tenant.setActiveTenantStorageNamespace(f.tenant.opaqueId);tenant.markTenantStorageReady();
    qa.key = 'lanzo:t:'+f.tenant.opaqueId+':actor-runtime-context:v1';
    qa.mount = async (session='session-a') => {
      f.session=session;bridge.beginActorRuntimeAuthentication('admin');
      await bridge.restoreActorRuntimeFromCurrentSessionCache({actorType:'admin',actor:{id:'admin-a'}});
      qa.oldHandle=qa.handle;qa.oldStorage=qa.storageHandle;
      qa.handle=runtime.capture();qa.storageHandle=storage.captureActorScopedStorageHandle();
      return runtime.getState();
    };
    function View(){const snapshot=useActorRuntimeSnapshot();qa.ui=snapshot;return React.createElement('output',null,snapshot.status);}
    qa.view = ()=>{qa.root=createRoot(document.getElementById('root'));flushSync(()=>qa.root.render(React.createElement(View)));};
    qa.start=()=>{qa.stop=start({performHealthCheck:r=>state.performSystemHealthCheck(r)});};
    qa.probe=()=>{
      const attempt=fn=>{try{fn();return true;}catch{return false;}};
      return {ui:qa.ui,runtime:runtime.getState(),durable:localStorage.getItem(qa.key),storage:storage.getActorScopedStorageState(),
        oldHandle:qa.oldHandle?attempt(()=>qa.oldHandle.assertCurrent()):null,handle:qa.handle?attempt(()=>qa.handle.assertCurrent()):null,
        storageHandle:qa.storageHandle?attempt(()=>qa.storageHandle.assertCurrent()):null,remote:qa.remote};
    };
  `;
  const out = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, write: false,
    format: 'esm', platform: 'browser', define: {'process.env.NODE_ENV':'"production"','import.meta.env.PROD':'true'},
    plugins: [{name:'synthetic-boundaries',setup(b){
      b.onResolve({filter:/tenantRuntimeRouter$|\/supabase$|\/licenseService$|\/licenseStorage$|\/localTenantGuard$/},a=>({path:a.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),contents:
        a.path.endsWith('tenantRuntimeRouter')?`
          export const getTenantRuntimeReadiness=()=>({ready:window.fixture.ready,runtime:window.fixture.tenant});
          export const db={table:name=>name==='sync_cache'?{get:async key=>({value:{admin_session_token:'synthetic-token',admin_session_id:window.fixture.session}[key]})}:{filter:()=>({toArray:async()=>[]})}};
        `:a.path.endsWith('/supabase')?`
          import {evaluateAdminOfflineAuthorization} from './src/services/auth/adminOfflineAuthorization';
          export const getStableDeviceId=async()=>window.fixture.device;
          export const getAdminOfflineAuthorization=async()=>{
            const f=window.fixture;
            return evaluateAdminOfflineAuthorization({now:Date.now(),evidence:{version:2,validatedAt:f.validatedAt,expiresAt:new Date(f.expires).toISOString(),
              sessionId:f.session,sessionTokenDigest:'token-digest',adminUserId:'admin-a',licenseId:'qa-license',deviceId:f.device,deviceRef:f.device,deviceTokenDigest:'device-digest',tenantOpaqueId:f.tenant.opaqueId},
              credentials:{adminToken:'synthetic-token',adminSessionId:f.session,adminTokenDigest:'token-digest'},
              license:{license_id:'qa-license',device_id:f.device,admin_user:{id:'admin-a'},device_role:'admin',status:'active',localExpiry:new Date(f.now+30*86400000).toISOString(),expires_at:null},
              adminUser:{id:'admin-a'},deviceRef:f.device,deviceTokenDigest:'device-digest',tenantOpaqueId:f.tenant.opaqueId,tenantBinding:{tenantIdentity:'license-id:qa-license'}});
          };
        `:a.path.endsWith('localTenantGuard')?'export const assertLocalTenantSyncAccess=async()=>{};':a.path.endsWith('licenseService')?'export const renewLicenseService=async()=>{throw Error("RPC forbidden");};':'export const saveLicenseToStorage=async()=>{throw Error("write forbidden");};'
      }));
      if(version==='main') b.onLoad({filter:/licenseMaintenanceActions\.js$/},()=>({contents:baseline[paths[1]],loader:'js',resolveDir:resolve('src/store/slices/license')}));
    }}] });
  bundles[version]=out.outputFiles[0].text;
}
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.endsWith('.mjs')){res.setHeader('Content-Type','text/javascript');res.end(bundles[req.url.slice(1,-4)]);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>F02 isolated QA</title><div id="root"></div>');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:process.env.ACTOR_QA_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const results=[];
const origin=`http://127.0.0.1:${server.address().port}`;
const boot=async(ctx,version,noBC=false)=>{
  const p=await ctx.newPage();
  await p.addInitScript(({noBC})=>{
    if(noBC) window.BroadcastChannel=undefined;
    window.fixture={tenant:{opaqueId:'t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',databaseName:'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',generation:1},session:'session-a',device:'device-a',ready:true,
      now:Date.parse('2026-10-01T00:00:00Z'),validatedAt:Date.parse('2026-10-01T00:00:00Z')};
    fixture.expires=fixture.now+60000;Date.now=()=>fixture.now;
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixture.hidden?'hidden':'visible'});
  },{noBC});
  await p.goto(origin);await p.evaluate(v=>import(`/${v}.mjs`),version);return p;
};
const record=async(id,fn)=>{try{results.push({id,...await fn()});}catch(e){results.push({id,status:'HARNESS_ERROR',error:String(e),stack:e.stack});}};
try{
  for(const version of ['main','candidate']) for(const event of ['focus','pageshow','online','resume','visibilitychange']) await record(`${version}-${event}-offline-expiry`,async()=>{
    const ctx=await browser.newContext();const p=await boot(ctx,version);
    const before=await p.evaluate(async()=>{await qa.mount();qa.view();qa.start();fixture.hidden=true;document.dispatchEvent(new Event('visibilitychange'));return qa.probe();});
    const immediate=await p.evaluate(event=>{fixture.now=fixture.expires;fixture.hidden=false;(event==='resume'||event==='visibilitychange'?document:window).dispatchEvent(new Event(event));return {ui:qa.ui,remote:qa.remote,durable:localStorage.getItem(qa.key)};},event);
    await p.waitForFunction(()=>window.qa.ui.status==='locked',{},{timeout:700}).catch(()=>{});
    const observed=await p.evaluate(()=>({ui:qa.ui,remote:qa.remote,durable:localStorage.getItem(qa.key)}));
    const after=await p.evaluate(()=>qa.probe());
    const pass=observed.ui.status==='locked'&&after.runtime.status==='locked'&&!after.handle&&after.remote===0;
    await ctx.close();return {status:pass?'PASS':'FAIL',expectedBaselineFailure:version==='main',before,immediate,observed,after};
  });
  for(const a of ['main','candidate']) for(const b of ['main','candidate']) for(const noBC of [false,true]) await record(`${a}-${b}-historical-hints-${noBC?'noBC':'BC'}`,async()=>{
    const ctx=await browser.newContext();const p=await boot(ctx,a,noBC);const q=await boot(ctx,b,noBC);
    await p.evaluate(async()=>{await qa.mount();fixture.now=fixture.expires;qa.runtime.getState();});
    const obsolete=await p.evaluate(()=>localStorage.getItem(qa.key));
    const before=await q.evaluate(async()=>{fixture.session='session-b';fixture.device='device-b';fixture.now+=60000;fixture.validatedAt=fixture.now;fixture.expires=fixture.now+60000;await qa.mount('session-b');qa.view();qa.start();return qa.probe();});
    await q.evaluate(old=>{window.dispatchEvent(new StorageEvent('storage',{key:qa.key,newValue:old,storageArea:localStorage}));if(window.BroadcastChannel){const ch=new BroadcastChannel('lanzo-actor-storage-v1');ch.postMessage({tenantOpaqueId:fixture.tenant.opaqueId,contextToken:'historical'});ch.close();}window.dispatchEvent(new Event('focus'));},obsolete);
    await q.waitForTimeout(300);
    const after=await q.evaluate(()=>qa.probe());
    const pass=after.runtime.status==='granted'&&after.runtime.sessionId==='session-b'&&after.runtime.generation===before.runtime.generation&&after.durable===before.durable&&after.handle&&after.storageHandle;
    // A current foreign replacement must still revoke the older B handles.
    await p.evaluate(async()=>{fixture.now+=1000;fixture.validatedAt=fixture.now;fixture.expires=fixture.now+60000;await qa.mount('session-c');});
    await q.waitForTimeout(80);const revoked=await q.evaluate(()=>qa.probe());
    await ctx.close();return {status:pass&&revoked.runtime.status==='locked'&&!revoked.handle&&!revoked.storageHandle?'PASS':'FAIL',before,after,revoked};
  });
  await record('candidate-freeze-resume-valid-and-expired',async()=>{
    const ctx=await browser.newContext();const p=await boot(ctx,'candidate');await p.evaluate(async()=>{await qa.mount();qa.view();qa.start();});
    const cdp=await ctx.newCDPSession(p);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});
    const valid=await p.evaluate(()=>{window.dispatchEvent(new Event('focus'));return qa.probe();});
    await p.evaluate(()=>{fixture.now=fixture.expires;});await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});
    await p.evaluate(()=>document.dispatchEvent(new Event('resume')));await p.waitForFunction(()=>qa.ui.status==='locked');const expired=await p.evaluate(()=>qa.probe());await ctx.close();
    return {status:valid.runtime.status==='granted'&&expired.runtime.status==='locked'?'PASS':'FAIL',valid,expired,limit:'CDP freeze; not OS sleep/hibernation'};
  });
  await record('candidate-inaccessible-durable',async()=>{
    const ctx=await browser.newContext();const p=await boot(ctx,'candidate');await p.evaluate(async()=>{await qa.mount();qa.view();qa.start();});
    await p.evaluate(()=>{const native=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k===qa.key)throw Error('synthetic access denied');return native.call(this,k);};window.dispatchEvent(new StorageEvent('storage',{key:qa.key}));});
    const after=await p.evaluate(()=>({runtime:qa.runtime.getState(),suspended:qa.storage.getActorScopedStorageState().writesSuspended}));await ctx.close();return {status:after.runtime.status==='locked'&&after.suspended?'PASS':'FAIL',after};
  });
}finally{await browser.close();server.close();}
console.info(JSON.stringify({base,browser:'Chromium headless',sourceHashes:Object.fromEntries(Object.entries(bundles).map(([v,s])=>[v,createHash('sha256').update(s).digest('hex')])),limits:'React/controller/bridge/storage/lifecycle real; synthetic identity/DB/evidence. No financial E2E or physical suspension.',results},null,2));
if(results.some(x=>x.status==='HARNESS_ERROR'||x.status==='FAIL'&&!x.expectedBaselineFailure))process.exitCode=1;
