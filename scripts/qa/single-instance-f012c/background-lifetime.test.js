// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
vi.hoisted(() => { vi.stubEnv('VITE_SUPABASE_URL','https://synthetic.invalid'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','synthetic'); });
const m = vi.hoisted(() => {
  const actorListeners = new Set();
  const state = {
    rpc: vi.fn(), load: vi.fn(), save: vi.fn(), online: vi.fn(), guard: vi.fn(),
    registry: vi.fn(), actor: null, tenant: null, accessible: true, writes: [], storeWrites: [], scopes: [], checkpoints: [],
    setActor(actor) {
      state.actor = actor;
      const snapshot = actor && { ...actor };
      for (const listener of actorListeners) {
        try { listener(snapshot); } catch { /* Match the runtime's observer isolation. */ }
      }
    },
    subscribeActorRuntime(listener) {
      actorListeners.add(listener);
      return () => actorListeners.delete(listener);
    }
  };
  return state;
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: m.rpc }) }));
vi.mock('@fingerprintjs/fingerprintjs', () => ({ default: { load: async () => ({ get: async () => ({ visitorId: 'synthetic-device' }) }) } }));
vi.mock('../../../src/services/database', () => ({ STORES: { COMPANY: 'company', SYNC_CACHE: 'sync_cache' }, loadData: m.load, saveData: m.save }));
vi.mock('../../../src/services/licenseStorage', () => ({ saveLicenseToStorage: m.save, getLicenseFromStorage: async () => ({ license_key: 'synthetic-A' }) }));
vi.mock('../../../src/services/device/deviceRegistry', () => ({ DEVICE_REGISTRY_KEYS: { STABLE_DEVICE_ID: 'lanzo_device_id', LICENSE_ATTEMPTS: 'attempts' }, readDeviceRegistryValue: m.registry, writeDeviceRegistryValue: vi.fn() }));
vi.mock('../../../src/services/utils', () => ({ safeLocalStorageSet: (k,v) => localStorage.setItem(k,v), checkInternetConnection: m.online, showMessageModal: vi.fn() }));
vi.mock('../../../src/services/Logger', () => ({ default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/services/db/tenantRuntimeRouter', () => ({
  db: { table: () => ({ get: async () => null }) }, getActiveTenantRuntime: () => m.tenant,
  getTenantRuntimeReadiness: () => ({ ready: Boolean(m.tenant), runtime: m.tenant }),
  isTenantRuntimeError: e => e?.code?.startsWith('TENANT_')
}));
vi.mock('../../../src/services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: m.guard, assertLocalTenantSyncAccess: m.guard,
  isLocalTenantAccessError: e => e?.code?.startsWith('LOCAL_TENANT_'), getLocalTenantBinding: () => null,
  runWithLocalTenantSyncLease: async (_l,_o,f) => f()
}));
vi.mock('../../../src/services/tenant/localTenantPolicy', () => ({ canAccessTenantOwnedRuntimeCache: () => m.accessible }));
vi.mock('../../../src/services/tenant/tenantScopedStorage', () => ({ getTenantStorageItem: k => localStorage.getItem(k), setTenantStorageItem: (k,v) => localStorage.setItem(k,v) }));
vi.mock('../../../src/services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { LOCKED: 'locked', AUTHENTICATING: 'authenticating', HANDOFF_CHECK: 'handoff_check', GRANTED: 'granted' },
  actorRuntimeController: { getState: () => m.actor, capture: () => {
    const binding = JSON.stringify(m.actor);
    return { ...m.actor, assertCurrent: () => { if (JSON.stringify(m.actor) !== binding) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' }); } };
  }, subscribe: listener => m.subscribeActorRuntime(listener) },
  runWithActorHandle: async (_h,f) => f({ guardedWrite: op => op() }),
  ActorRuntimeError: class extends Error {}, ACTOR_RUNTIME_ERROR_CODES: { CONTEXT_STALE: 'ACTOR_CONTEXT_STALE' }
}));
vi.mock('../../../src/services/auth/actorSessionRuntimeBridge', () => ({
  lockActorRuntime: () => { m.setActor({ ...m.actor, status: 'locked', generation: m.actor.generation+1 }); },
  beginActorRuntimeAuthentication: vi.fn(), grantAuthenticatedActorRuntime: vi.fn()
}));
vi.mock('../../../src/services/storage/imageUploadService', () => ({ IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'logo' }, uploadImageFile: vi.fn() }));
import { createBootstrapLifecycle, loadBootstrapProfile } from '../../../src/services/bootstrap/bootstrapLifecycle';
import { createProfileSlice } from '../../../src/store/slices/createProfileSlice';
import { createDriveSlice, DRIVE_SESSION_KEY } from '../../../src/store/slices/createDriveSlice';
import { createUISlice } from '../../../src/store/slices/createUISlice';
import { createLicenseProcessingActions } from '../../../src/store/slices/license/licenseProcessingActions';
import { getBusinessProfile, revalidateLicense } from '../../../src/services/supabase';
import { PROFILE_LAST_LOAD_KEY, PROFILE_LAST_LICENSE_KEY } from '../../../src/store/slices/license/licenseConstants';
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; };
const advance = async ms => {
  await vi.advanceTimersByTimeAsync(ms);
  m.checkpoints.push({afterAdvanceMs:ms,actor:{...m.actor},tenant:m.tenant && {...m.tenant},
    rpcStarted:m.rpc.mock.calls.length,localWrites:m.writes.length,lifecycles:m.scopes.map(s=>s.getSnapshot())});
};
const tick = () => advance(0);
const scopes = () => { const s=createBootstrapLifecycle();m.scopes.push(s);return s; };
const profile = (name='Current') => ({ license_key: 'synthetic-A', business_name:name, business_type:['abarrotes'] });
const response = name => ({ data:{ success:true, data:profile(name) }, error:null });
const setup = () => {
  let state = { licenseDetails:{ license_key:'synthetic-A', plan_code:'free_trial', valid:true, status:'active', device_role:'admin', localExpiry:'2099-01-01T00:00:00Z' }, currentDeviceRole:'admin', currentAdminUser:{ id:'admin-A' }, appStatus:'loading' };
  const get=()=>state, set=p=>{ m.storeWrites.push(Object.keys(p));state={...state,...p}; };
  state={...state,...createProfileSlice(set,get),...createDriveSlice(set),...createUISlice(set,get)};
  return { get,set,load:options=>state._loadProfile('synthetic-A', options) };
};
const traces=[];
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.stubEnv('VITE_SUPABASE_URL','https://synthetic.invalid');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','synthetic');
  m.setActor({status:'locked',reason:'logged_out',generation:0});
  m.setActor({status:'granted',actorType:'admin',actorId:'admin-A',actorKey:'synthetic-actor-A',sessionId:'session-A',generation:1,deviceRef:'device-A'});
  m.tenant={opaqueId:'synthetic-tenant-A',databaseName:'synthetic-db-A',generation:1};m.accessible=true;m.writes=[];m.storeWrites=[];m.scopes=[];m.checkpoints=[];
  m.guard.mockResolvedValue(true);m.online.mockResolvedValue(true);
  m.registry.mockImplementation(async k=>k==='lanzo_device_id'?'synthetic-device':null);
  m.load.mockImplementation(async (_s,k)=>k==='device_security_token'?{value:'synthetic-token'}:null);
  m.save.mockImplementation(async (...args)=>{m.writes.push({args,tenant:{...m.tenant},actor:{...m.actor}});});
  m.rpc.mockResolvedValue(response('Remote'));
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
});
afterEach(ctx => {
  traces.push({test:ctx.task.name, initial:{actor:'admin-A',tenant:'synthetic-tenant-A',providers:'synthetic'},
    finalActor:m.actor,finalTenant:m.tenant,rpcCalls:m.rpc.mock.calls.map(([name])=>name),writes:m.writes,storeWrites:m.storeWrites,
    checkpoints:m.checkpoints,lifecycles:m.scopes.map(s=>s.getSnapshot()),outcome:ctx.task.result?.state,
    limits:'Local synthetic scope; no server confirmation, sync quiescence or physical browser certification.'});
  vi.useRealTimers();vi.unstubAllEnvs();
});
afterAll(()=>{const dir='scripts/qa/single-instance-f012c/evidence';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/bgx-traces.json`,JSON.stringify(traces,null,2));});

it('BGX-01 PROF-01 no cache: raw RPC, both local writes and publication settle', async()=>{
 const x=setup(),s=scopes();await x.load({lifecycle:s});await s.drain();expect(x.get().companyProfile.name).toBe('Remote');expect(m.writes).toHaveLength(2);expect(s.getSnapshot().pending).toBe(0);
});
it('BGX-02 PROF-02 fresh memory cache avoids remote work',async()=>{
 const x=setup(),s=scopes();x.set({companyProfile:{...profile(),name:'Cached'}});localStorage.setItem(PROFILE_LAST_LOAD_KEY,String(Date.now()));localStorage.setItem(PROFILE_LAST_LICENSE_KEY,'synthetic-A');await x.load({lifecycle:s});await s.drain();expect(m.rpc).not.toHaveBeenCalled();expect(x.get().companyProfile.name).toBe('Cached');
});
it('BGX-03 PROF-03 slow raw RPC keeps root and transport pending',async()=>{
 const x=setup(),s=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:s});await tick();expect(s.getSnapshot().pending).toBe(2);d.resolve(response('Slow'));await p;await s.drain();expect(x.get().companyProfile.name).toBe('Slow');
});
it('BGX-04 PROF-04 quiesce before transport admission starts no RPC',async()=>{
 const s=scopes();s.quiesce();await expect(getBusinessProfile('synthetic-A',{lifecycle:s})).rejects.toThrow('QUIESCED');expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-05 PROF-05 public profile timeout leaves transport pending without late publication',async()=>{
 const x=setup(),s=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:s});await advance(8000);await p;expect(s.getSnapshot().pending).toBe(1);s.quiesce();d.resolve(response('Too late'));await s.drain();expect(x.get().companyProfile).toBeNull();expect(m.writes).toHaveLength(0);
});
for(const [id,label,change] of [
 ['06','PROF-06 tenant change',()=>{m.tenant={...m.tenant,opaqueId:'tenant-B',generation:2};}],
 ['07','PROF-07 actor change',()=>{m.setActor({...m.actor,actorId:'admin-B',generation:2});}],
 ['08','PROF-08 logout',x=>{x.set({licenseDetails:null});m.setActor({...m.actor,status:'locked',generation:2});}]
]) it(`BGX-${id} ${label} rejects old remote response before writes`,async()=>{
 const x=setup(),s=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:s});const assertion=expect(p).rejects.toMatchObject({code:'ACTOR_CONTEXT_STALE'});await tick();change(x);d.resolve(response('Old'));await assertion;await s.drain();expect(m.writes).toHaveLength(0);expect(x.get().companyProfile).toBeNull();
});
it('BGX-09 PROF-09 new profile wins over previous request',async()=>{
 const x=setup(),s=scopes(),d=deferred();m.rpc.mockReturnValueOnce(d.promise);const old=x.load({lifecycle:s});const assertion=expect(old).rejects.toMatchObject({code:'ACTOR_CONTEXT_STALE'});await tick();await x.load({lifecycle:s,forceRemote:true});d.resolve(response('Old'));await assertion;await s.drain();expect(x.get().companyProfile.name).toBe('Remote');
});
it('BGX-10 PROF-10 asynchronous preference substitute is observed and remains UNKNOWN',async()=>{
 const x=setup(),s=scopes(),d=deferred();x.set({refreshTenantUiPreferences:()=>d.promise});await x.load({lifecycle:s});expect(s.getSnapshot()).toMatchObject({pending:1,unknown:['profile_async_refreshTenantUiPreferences']});d.resolve();await tick();expect(s.getSnapshot().pending).toBe(0);expect(s.getSnapshot().unknown).toHaveLength(1);
});
it('BGX-11 PROF-11 asynchronous refresh rejection is observed',async()=>{
 const x=setup(),s=scopes(),d=deferred();x.set({refreshTenantUiPreferences:()=>d.promise});await x.load({lifecycle:s});d.reject(new Error('synthetic-refresh-failure'));await tick();expect(s.getSnapshot().rejected).toBe(1);expect(s.getSnapshot().unknown).toHaveLength(1);
});
it('BGX-12 PROF-12 invalidated request never invokes onPrepared',async()=>{
 const x=setup(),s=scopes(),d=deferred(),cb=vi.fn();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:s,onPrepared:cb});const assertion=expect(p).rejects.toThrow();await tick();x.get()._invalidateProfileLoads();d.resolve(response('Old'));await assertion;expect(cb).not.toHaveBeenCalled();
});
it('BGX-13 PROF-13 offline Admin profile uses tenant cache without extending authorization',async()=>{
 const x=setup(),s=scopes();Object.defineProperty(navigator,'onLine',{value:false,configurable:true});m.load.mockResolvedValue(profile('Local'));const actor={...m.actor};await x.load({lifecycle:s});await s.drain();expect(m.rpc).not.toHaveBeenCalled();expect(x.get().companyProfile.name).toBe('Local');expect(m.actor).toEqual(actor);
});
it('BGX-14 PROF-14 profile observation cannot authorize a locked Staff',async()=>{
 const x=setup(),s=scopes();m.setActor({...m.actor,status:'locked',actorType:'staff'});x.set({currentDeviceRole:'staff',currentStaffUser:{id:'staff-A'}});Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await x.load({lifecycle:s});expect(m.actor.status).toBe('locked');expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-15 PROF-15 final local cache continuation is part of drain',async()=>{
 const x=setup(),s=scopes(),d=deferred();m.save.mockImplementationOnce(async()=>{await d.promise;});const p=x.load({lifecycle:s});await tick();expect(x.get().companyProfile).toBeNull();expect(s.getSnapshot().pending).toBe(1);d.resolve();await p;s.quiesce();await s.drain();expect(x.get().companyProfile.name).toBe('Remote');
});

it('BGX-16 Drive refresh is synchronous and issues no network request',()=>{
 const x=setup();expect(x.get().refreshDriveSession()).toBeUndefined();expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-17 Drive local token rehydrates only through existing cache permission',()=>{
 const x=setup();sessionStorage.setItem(DRIVE_SESSION_KEY,JSON.stringify({accessToken:'synthetic-token',expiresAt:Date.now()+60000}));x.get().refreshDriveSession();expect(x.get().isDriveConnected).toBe(true);m.accessible=false;x.get().refreshDriveSession();expect(x.get().isDriveConnected).toBe(false);
});
it('BGX-18 locking Drive hides token without deleting credentials',()=>{
 const x=setup();x.get().connectDrive({accessToken:'synthetic-token',expiresIn:3600});const stored=sessionStorage.getItem(DRIVE_SESSION_KEY);x.get().lockDriveSession();expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBe(stored);expect(x.get().driveAccessToken).toBeNull();
});
it('BGX-19 expired Drive session retains existing reauth behavior',()=>{
 const x=setup();sessionStorage.setItem(DRIVE_SESSION_KEY,JSON.stringify({accessToken:'synthetic-token',expiresAt:Date.now()-1}));x.get().refreshDriveSession();expect(x.get().needsDriveReauth).toBe(true);expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
});
it('BGX-20 malformed Drive session is safely cleared as before',()=>{
 const x=setup();sessionStorage.setItem(DRIVE_SESSION_KEY,'invalid-json');x.get().refreshDriveSession();expect(x.get().isDriveConnected).toBe(false);expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
});
it('BGX-21 async Drive replacement keeps UNKNOWN until its own contract exists',async()=>{
 const x=setup(),s=scopes(),d=deferred();x.set({refreshDriveSession:()=>d.promise});await x.load({lifecycle:s});expect(s.getSnapshot().unknown).toContain('profile_async_refreshDriveSession');expect(s.getSnapshot().pending).toBe(1);d.resolve();await tick();
});
it('BGX-22 pending profile cannot refresh Drive after tenant switch at local guard',async()=>{
 const x=setup(),s=scopes(),d=deferred(),refresh=vi.fn();m.guard.mockReturnValueOnce(d.promise);x.set({refreshDriveSession:refresh});const p=x.load({lifecycle:s});const a=expect(p).rejects.toThrow();await tick();m.tenant={...m.tenant,generation:2};d.resolve();await a;expect(refresh).not.toHaveBeenCalled();
});
it('BGX-23 UI preference refresh is synchronous tenant-local policy read',()=>{
 const x=setup();localStorage.setItem('lanzo_cash_opening_policy','automatic');expect(x.get().refreshTenantUiPreferences()).toBeUndefined();expect(x.get().cashOpeningPolicy).toBe('automatic');expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-24 permission-denied preference refresh falls back to manual',()=>{
 const x=setup();localStorage.setItem('lanzo_cash_opening_policy','automatic');m.accessible=false;x.get().refreshTenantUiPreferences();expect(x.get().cashOpeningPolicy).toBe('manual');
});
it('BGX-25 profile and Drive refresh never auto-backup or mutate remote credentials',async()=>{
 const x=setup(),s=scopes();x.get().connectDrive({accessToken:'synthetic-token',expiresIn:3600});const token=sessionStorage.getItem(DRIVE_SESSION_KEY);await x.load({lifecycle:s});await s.drain();expect(m.rpc.mock.calls.map(([n])=>n)).toEqual(['get_business_profile_anon']);expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBe(token);
});

const denial={data:{valid:false,reason:'synthetic_denial'},error:null};
const shared = async (key='synthetic-shared') => {
 const owner=scopes(),consumer=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);
 const a=revalidateLicense(key,{bootstrapLifecycle:owner});await tick();const b=revalidateLicense(key,{bootstrapLifecycle:consumer});await tick();return {owner,consumer,d,a,b};
};
it('BGX-26 SHARED-01 owner and consumer join one raw lifetime',async()=>{
 const z=await shared();expect(m.rpc).toHaveBeenCalledTimes(1);z.d.resolve(denial);await Promise.all([z.a,z.b]);await Promise.all([z.owner.drain(),z.consumer.drain()]);expect(z.consumer.getSnapshot().unknown).toEqual([]);
});
it('BGX-27 SHARED-02 two consumers share owner without additional transport',async()=>{
 const z=await shared(),third=scopes();const c=revalidateLicense('synthetic-shared',{bootstrapLifecycle:third});z.d.resolve(denial);await Promise.all([z.a,z.b,c]);await third.drain();expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('BGX-28 SHARED-03 public owner timeout does not settle either lifetime',async()=>{
 const z=await shared();await advance(8000);await Promise.all([z.a,z.b]);expect(z.owner.getSnapshot().pending).toBe(1);expect(z.consumer.getSnapshot().pending).toBe(1);z.d.resolve(denial);await z.consumer.drain();await z.owner.drain();
});
it('BGX-29 SHARED-04 consumer quiesce never cancels shared transport',async()=>{
 const z=await shared();z.consumer.quiesce();expect(z.consumer.getSnapshot().pending).toBe(1);z.d.resolve(denial);await Promise.all([z.a,z.b]);await z.consumer.drain();expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('BGX-30 SHARED-05 public deadline plus raw reject records late failure in both consumers',async()=>{
 const z=await shared();await advance(8000);await Promise.all([z.a,z.b]);z.d.reject(new Error('synthetic-late'));await z.owner.drain();await z.consumer.drain();expect(z.owner.getSnapshot().rejected).toBe(1);expect(z.consumer.getSnapshot().rejected).toBe(1);
});
for(const [id,label,change] of [
 ['31','SHARED-06 logout',()=>{m.setActor({...m.actor,status:'locked',generation:2});}],
 ['32','SHARED-07 tenant switch',()=>{m.tenant={...m.tenant,generation:2};}]
]) it(`BGX-${id} ${label} blocks shared old continuations`,async()=>{
 const z=await shared();const aa=expect(z.a).rejects.toThrow('LICENSE_VALIDATION_CONTEXT_STALE'),bb=expect(z.b).rejects.toThrow('LICENSE_VALIDATION_CONTEXT_STALE');change();z.d.resolve({data:{valid:true,features:{},new_security_token:'must-not-persist'},error:null});await aa;await bb;await z.consumer.drain();expect(m.writes).toHaveLength(0);
});
it('BGX-33 SHARED-08 late shared rejection has no unhandled promise',async()=>{
 const z=await shared();await advance(8000);await Promise.all([z.a,z.b]);z.d.reject(new Error('late-shared-rejection'));await z.consumer.drain();expect(z.consumer.getSnapshot()).toMatchObject({pending:0,rejected:1});
});
it('BGX-34 SHARED-09 new actor cannot reuse old actor validation',async()=>{
 const z=await shared();const aa=expect(z.a).rejects.toThrow(),bb=expect(z.b).rejects.toThrow();m.setActor({...m.actor,generation:2,actorId:'admin-B'});m.rpc.mockResolvedValue(denial);await revalidateLicense('synthetic-shared',{bootstrapLifecycle:scopes()});expect(m.rpc).toHaveBeenCalledTimes(2);z.d.resolve(denial);await aa;await bb;
});
it('BGX-35 SHARED-10 originally unobserved owner remains conservatively UNKNOWN',async()=>{
 const d=deferred();m.rpc.mockReturnValue(d.promise);const a=revalidateLicense('unobserved');await tick();const s=scopes(),b=revalidateLicense('unobserved',{bootstrapLifecycle:s});expect(s.getSnapshot().unknown).toContain('shared_license_revalidation_owner');d.resolve(denial);await Promise.all([a,b]);await tick();expect(s.getSnapshot().pending).toBe(0);expect(s.getSnapshot().unknown).toHaveLength(1);
});

const processing = () => {
 const x=setup();let active=true;const sync=vi.fn(async()=>{}),profileLoad=vi.fn(async()=>{});
 x.set({appStatus:'ready',companyProfile:profile(),refreshLicenseSyncMode:sync,_loadProfile:profileLoad});
 Object.assign(x.get(),createLicenseProcessingActions({get:x.get,set:x.set,clearLocalLicenseSession:vi.fn(),hasStaffValidationContext:vi.fn()}));
 const s=scopes();const run=(data={valid:true,status:'active',features:{},license_key:'synthetic-A'})=>x.get()._processServerValidation(data,x.get().licenseDetails,{lifecycle:s,refreshProfile:true,isContextCurrent:()=>active});
 return {...x,s,sync,profileLoad,run,invalidate:()=>{active=false;}};
};
it('BGX-36 processing settlement retains delegated sync UNKNOWN',async()=>{
 const z=processing();await z.run();expect(z.sync).toHaveBeenCalledTimes(1);expect(z.s.getSnapshot().unknown).toContain('background_server_processing_sync_work');
});
it('BGX-37 processing waits for profile public result but cannot infer child raw settlement',async()=>{
 const z=processing(),d=deferred();z.profileLoad.mockReturnValue(d.promise);let settled=false;const p=z.run().then(()=>{settled=true;});await tick();expect(settled).toBe(false);d.resolve();await p;expect(z.s.getSnapshot().unknown).toContain('background_profile_nested_work');
});
it('BGX-38 context invalidated during profile never starts subsequent sync refresh',async()=>{
 const z=processing(),d=deferred();z.profileLoad.mockReturnValue(d.promise);const p=z.run();await tick();z.invalidate();d.resolve();await p;expect(z.sync).not.toHaveBeenCalled();
});
it('BGX-39 context invalidated during persistence never publishes result',async()=>{
 const z=processing(),d=deferred();m.save.mockReturnValue(d.promise);const p=z.run();await tick();const count=m.storeWrites.length;z.invalidate();d.resolve();await p;expect(m.storeWrites).toHaveLength(count);expect(z.profileLoad).not.toHaveBeenCalled();
});
it('BGX-40 stale processing before admission has no effects',async()=>{
 const z=processing();z.invalidate();m.guard.mockClear();await z.run();expect(m.guard).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(z.sync).not.toHaveBeenCalled();
});
it('BGX-41 processing persistence errors remain failures without sync side effects',async()=>{
 const z=processing();m.save.mockRejectedValue(new Error('synthetic-persistence'));await expect(z.run()).rejects.toThrow('synthetic-persistence');expect(z.sync).not.toHaveBeenCalled();
});
it('BGX-42 pending sync refresh remains pending processing without confirmation',async()=>{
 const z=processing(),d=deferred();z.sync.mockReturnValue(d.promise);let settled=false;const p=z.run().then(()=>{settled=true;});await tick();expect(settled).toBe(false);expect(z.s.getSnapshot().unknown).toContain('background_server_processing_sync_work');d.resolve();await p;
});
it('BGX-43 processing can settle while a subscriber child is still running',async()=>{
 const z=processing(),d=deferred();let childSettled=false;d.promise.then(()=>{childSettled=true;});z.sync.mockImplementation(async()=>{});await z.run();expect(childSettled).toBe(false);expect(z.s.getSnapshot().unknown).toContain('background_server_processing_sync_work');d.resolve();await tick();
});
it('BGX-44 asynchronous store-triggered work is a reproducible unknown counterexample',async()=>{
 const x=setup(),s=scopes(),child=deferred();let childPending=false;const original=x.set;
 const set=p=>{original(p);if(p.licenseDetails){childPending=true;child.promise.then(()=>{childPending=false;});}};
 const actions=createLicenseProcessingActions({get:x.get,set,clearLocalLicenseSession:vi.fn(),hasStaffValidationContext:vi.fn()});x.set({appStatus:'ready',companyProfile:profile(),refreshLicenseSyncMode:async()=>{}});
 await actions._processServerValidation({valid:true,status:'active',features:{}},x.get().licenseDetails,{lifecycle:s});expect(childPending).toBe(true);expect(s.getSnapshot().unknown).toContain('background_server_processing_sync_work');child.resolve();await tick();
});
it('BGX-45 processing UNKNOWN prevents a false SYNC_QUIESCED drain',async()=>{
 const z=processing();await z.run();z.s.quiesce();let drained=false;z.s.drain().then(()=>{drained=true;});await advance(60000);expect(drained).toBe(false);expect(z.s.getSnapshot().pending).toBe(0);
});

it('BGX-46 joining an owned promise registers synchronously',async()=>{
 const s=scopes(),d=deferred();s.observe(d.promise);expect(s.getSnapshot().pending).toBe(1);d.resolve();await s.drain();
});
it('BGX-47 quiesced consumer cannot join or start more work',async()=>{
 const s=scopes();s.quiesce();expect(()=>s.observe(Promise.resolve())).toThrow('QUIESCED');expect(()=>s.track(()=>m.rpc())).toThrow('QUIESCED');expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-48 context invalidation before profile factory blocks all providers',async()=>{
 const x=setup();let valid=true;const s=createBootstrapLifecycle({isContextCurrent:()=>valid});m.scopes.push(s);const p=x.load({lifecycle:s});const a=expect(p).rejects.toThrow('CONTEXT_STALE');valid=false;await a;expect(m.guard).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-49 two stores do not invalidate each others profile generation',async()=>{
 const a=setup(),b=setup(),d=deferred();m.rpc.mockReturnValueOnce(d.promise);const p=a.load({lifecycle:scopes()});await tick();await b.load({lifecycle:scopes()});d.resolve(response('First'));await p;expect(a.get().companyProfile.name).toBe('First');expect(b.get().companyProfile.name).toBe('Remote');
});
it('BGX-50 license cleared without actor update still rejects old profile',async()=>{
 const x=setup(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=x.load({lifecycle:scopes()});const a=expect(p).rejects.toMatchObject({code:'ACTOR_CONTEXT_STALE'});await tick();x.set({licenseDetails:null});d.resolve(response('Old'));await a;expect(m.writes).toHaveLength(0);
});
it('BGX-51 timeout before validation transport suppresses later RPC and observes deadline rejection',async()=>{
 const s=scopes(),d=deferred();m.online.mockReturnValue(d.promise);const p=revalidateLicense('slow-precheck',{bootstrapLifecycle:s});await advance(8000);expect(s.getSnapshot().pending).toBe(1);d.resolve(true);await p;await s.drain();expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-52 raw profile rejection after timeout remains observed',async()=>{
 const s=scopes(),d=deferred();m.rpc.mockReturnValue(d.promise);const p=getBusinessProfile('synthetic-A',{lifecycle:s});await advance(8000);await p;d.reject(new Error('late-profile'));await s.drain();expect(s.getSnapshot().rejected).toBe(1);
});
it('BGX-53 unknown profile substitute cannot claim complete drain',async()=>{
 const s=scopes(),provider=vi.fn(async()=>{});await loadBootstrapProfile(provider,'synthetic-A',{},s,'unknown-provider');expect(s.getSnapshot().unknown).toEqual(['unknown-provider']);
});
it('BGX-54 scope invalidation after raw result blocks profile publication',async()=>{
 const x=setup(),d=deferred();let valid=true;const s=createBootstrapLifecycle({isContextCurrent:()=>valid});m.scopes.push(s);m.save.mockImplementationOnce(async()=>{await d.promise;});const p=x.load({lifecycle:s});const a=expect(p).rejects.toThrow('CONTEXT_STALE');await tick();valid=false;d.resolve();await a;expect(x.get().companyProfile).toBeNull();expect(m.save).toHaveBeenCalledTimes(1);
});
it('BGX-55 successful profile RPC clears its public deadline timer',async()=>{
 const s=scopes();await getBusinessProfile('synthetic-A',{lifecycle:s});await s.drain();expect(vi.getTimerCount()).toBe(0);
});
it('BGX-56 default non-observed profile still publishes usable profile',async()=>{
 const x=setup();await x.load();expect(x.get().appStatus).toBe('ready');expect(x.get().companyProfile.name).toBe('Remote');
});
it('BGX-57 default non-observed revalidation preserves server denial result',async()=>{
 m.rpc.mockResolvedValue(denial);await expect(revalidateLicense('default-denial')).resolves.toEqual(denial.data);
});
it('BGX-58 no license cannot acquire authority through lifecycle',async()=>{
 const s=scopes();await expect(revalidateLicense(null,{bootstrapLifecycle:s})).resolves.toEqual({valid:false,reason:'no_license_key'});expect(m.rpc).not.toHaveBeenCalled();
});
it('BGX-59 no ready tenant skips background profile and all refresh providers',async()=>{
 const x=setup(),s=scopes();m.tenant=null;await x.load({lifecycle:s,profileLoadMode:'background'});await s.drain();expect(m.rpc).not.toHaveBeenCalled();expect(m.guard).not.toHaveBeenCalled();expect(x.get().companyProfile).toBeNull();
});
it('BGX-60 observer and default queries keep identical public profile values',async()=>{
 const a=await getBusinessProfile('synthetic-A');const s=scopes(),b=await getBusinessProfile('synthetic-A',{lifecycle:s});await s.drain();expect(b).toEqual(a);expect(m.actor.generation).toBe(1);
});

it('EXTRA-01 context captured at invocation blocks actor replacement before factory',async()=>{
 const x=setup(),s=scopes();const p=x.load({lifecycle:s});const a=expect(p).rejects.toMatchObject({code:'ACTOR_CONTEXT_STALE'});m.setActor({...m.actor,generation:2});await a;expect(m.guard).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
it('EXTRA-02 asynchronous onPrepared callback stays observed and UNKNOWN',async()=>{
 const x=setup(),s=scopes(),d=deferred();await x.load({lifecycle:s,onPrepared:()=>d.promise});expect(s.getSnapshot()).toMatchObject({pending:1,unknown:['profile_async_onPrepared']});d.resolve();await tick();expect(s.getSnapshot().pending).toBe(0);expect(s.getSnapshot().unknown).toHaveLength(1);
});

for(const [label,change] of [
 ['actor',()=>{m.setActor({...m.actor,generation:2,actorId:'admin-B'});}],
 ['tenant',()=>{m.tenant={...m.tenant,generation:2,opaqueId:'tenant-B'};}]
]) it(`EXTRA-TOKEN-${label} credential recovery rechecks context before persisting`,async()=>{
 const d=deferred(),s=scopes();localStorage.setItem('lanzo_license',JSON.stringify({data:{license_key:'synthetic-token-recovery',new_security_token:'synthetic-old-token'}}));
 m.load.mockImplementation(async(_store,key)=>key==='device_security_token'?d.promise:null);
 const p=revalidateLicense('synthetic-token-recovery',{bootstrapLifecycle:s});const a=expect(p).rejects.toThrow('LICENSE_VALIDATION_CONTEXT_STALE');await tick();change();d.resolve(null);await a;await s.drain();expect(m.save).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
it('EXTRA-TOKEN-valid credential recovery preserves legitimate persistence',async()=>{
 const s=scopes();localStorage.setItem('lanzo_license',JSON.stringify({data:{license_key:'synthetic-token-valid',new_security_token:'synthetic-recovered-token'}}));m.load.mockResolvedValue(null);m.rpc.mockResolvedValue(denial);await revalidateLicense('synthetic-token-valid',{bootstrapLifecycle:s});await s.drain();expect(m.save).toHaveBeenCalledWith('sync_cache',{key:'device_security_token',value:'synthetic-recovered-token'});expect(m.rpc).toHaveBeenCalledTimes(1);
});

for (const name of ['refreshTenantUiPreferences', 'refreshDriveSession', 'onPrepared']) {
  for (const event of ['quiesce', 'invalidate']) {
    it(`EXTRA-LATE-${name} synchronous ${event} retains unknown continuation and rejection`, async () => {
      const x = setup(), d = deferred();
      let current = true;
      const s = createBootstrapLifecycle({ isContextCurrent: () => current });
      m.scopes.push(s);
      const callback = () => {
        if (event === 'quiesce') s.quiesce();
        else current = false;
        return d.promise;
      };
      const options = { lifecycle: s };
      if (name === 'onPrepared') options.onPrepared = callback;
      else x.set({ [name]: callback });
      await expect(x.load(options)).rejects.toThrow(event === 'quiesce' ? 'QUIESCED' : 'CONTEXT_STALE');
      expect(s.getSnapshot().unknown).toContain(`profile_async_${name}`);
      let drained = false;
      void s.drain().then(() => { drained = true; });
      d.reject(new Error('synthetic-late-continuation'));
      await tick();
      expect(drained).toBe(false);
      expect(s.getSnapshot().pending).toBe(0);
    });
  }
}
