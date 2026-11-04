// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
const m=vi.hoisted(()=>({
  state:null,subscriber:null,callbacks:null,topic:null,
  assertTenant:vi.fn(),lease:vi.fn(),pull:vi.fn(),pending:vi.fn(),reset:vi.fn(),
  realtime:vi.fn(),stopRealtime:vi.fn(),status:vi.fn(),enabled:vi.fn(),cursor:vi.fn(),pullAt:vi.fn(),pullError:vi.fn(),
  processing:vi.fn(),synced:vi.fn(),failed:vi.fn(),conflict:vi.fn(),snapshot:vi.fn(),cache:vi.fn(),installRecovery:vi.fn(),
  unsubscribe:vi.fn()
}));
vi.mock('../../../src/store/useAppStore',()=>({useAppStore:{getState:()=>m.state,subscribe:fn=>{m.subscriber=fn;return m.unsubscribe;}}}));
vi.mock('../../../src/services/Logger',()=>({default:{log:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock('../../../src/services/tenant/localTenantGuard',()=>({assertLocalTenantSyncAccess:m.assertTenant,runWithLocalTenantSyncLease:m.lease,isLocalTenantAccessError:e=>String(e?.code||'').startsWith('LOCAL_TENANT_')}));
vi.mock('../../../src/services/posRealtime',()=>({buildPosRealtimeTopic:()=>m.topic,startPosRealtimeListener:m.realtime,stopPosRealtimeListener:m.stopRealtime}));
vi.mock('../../../src/services/sync/posSyncClient',()=>({posSyncClient:{pullSyncEvents:m.pull}}));
vi.mock('../../../src/services/sync/syncMetaService',()=>({syncMetaService:{getLastChangeSeq:async()=>0,setLastChangeSeq:m.cursor,setLastPullAt:m.pullAt,setLastPullError:m.pullError,setRealtimeStatus:m.status,setSyncEnabled:m.enabled}}));
vi.mock('../../../src/services/sync/syncOutboxService',()=>({syncOutboxService:{resetStuckProcessing:m.reset,getPendingOperations:m.pending,markProcessing:m.processing,markSynced:m.synced,markFailed:m.failed,markConflict:m.conflict}}));
vi.mock('../../../src/services/products/productLocalRepository',()=>({productLocalRepository:{getLocalCatalogForMigration:m.cache}}));
vi.mock('../../../src/services/products/productSyncHandler.js',()=>({productSyncHandler:{onStart:m.snapshot}}));
vi.mock('../../../src/services/customers/customerSyncHandler',()=>({customerSyncHandler:{onStart:m.snapshot}}));
vi.mock('../../../src/services/cash/cashSyncHandler',()=>({cashSyncHandler:{onStart:m.snapshot}}));
vi.mock('../../../src/services/customerCredit/customerCreditSyncHandler',()=>({customerCreditSyncHandler:{onStart:m.snapshot}}));
vi.mock('../../../src/services/salesCloud/salesCloudSyncHandler',()=>({salesCloudSyncHandler:{onStart:m.snapshot}}));
vi.mock('../../../src/services/restaurant/restaurantOrdersSyncHandler.js',()=>({}));
vi.mock('../../../src/services/financial/financialIntentRecoveryCoordinator',()=>({installFinancialIntentRecoveryCoordinator:m.installRecovery,assertFinancialRecoveryScopeAvailable:()=>{}}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const details={license_key:'tenant-A',features:{cloud_pos_sync:true},plan_code:'pro'};
const response={success:true,events:[],latestChangeSeq:0,hasMore:false};
let pos,boot,auto,scopes,events,current;
const traces=[];
const owner=()=>{const s=createSyncExecutionScope({id:`synthetic-sync-${scopes.length}`,generation:scopes.length+1,context:{actor:'actor-A',tenant:'tenant-A'},isContextCurrent:()=>current,onEvent:e=>events.push(e)});scopes.push(s);return s;};
const start=(s)=>pos.start({licenseDetails:details,reason:'initial_bootstrap',...(s?{executionScope:s}:{})});
const close=async s=>{s.quiesce();return s.settleObserved();};
beforeEach(async()=>{
  vi.resetModules();vi.resetAllMocks();vi.useFakeTimers();scopes=[];events=[];current=true;
  vi.stubGlobal('navigator',{onLine:true});m.topic=null;m.subscriber=null;m.callbacks=null;
  window.history.replaceState({},'', '/f012d-no-demand');
  m.state={appStatus:'ready',licenseDetails:details,currentDeviceRole:'admin'};
  m.assertTenant.mockResolvedValue(true);m.lease.mockImplementation(async(_a,_b,fn)=>fn());
  m.pull.mockResolvedValue({...response});m.pending.mockResolvedValue([]);m.cache.mockResolvedValue({products:[{id:'synthetic'}]});
  m.snapshot.mockResolvedValue({success:true});m.realtime.mockImplementation(({callbacks})=>{m.callbacks=callbacks;return{id:'synthetic-channel'};});
  m.stopRealtime.mockResolvedValue();
  pos=(await import('../../../src/services/sync/posSyncOrchestrator')).posSyncOrchestrator;
  boot=await import('../../../src/services/sync/posSyncBootstrapCoordinator');
  auto=await import('../../../src/services/sync/posSyncBootstrapAutoCoordinator');
});
afterEach(async context=>{
  for(const s of scopes)s.quiesce();await flush();
  traces.push({test:context.task.name,events,scopes:scopes.map(s=>s.getSnapshot()),writes:{status:m.status.mock.calls,cursor:m.cursor.mock.calls,synced:m.synced.mock.calls,failed:m.failed.mock.calls},pulls:m.pull.mock.calls,snapshots:m.snapshot.mock.calls,synthetic:true});
  mkdirSync('scripts/qa/single-instance-f012d/evidence',{recursive:true});writeFileSync('scripts/qa/single-instance-f012d/evidence/sync-traces.json',JSON.stringify(traces,null,2));
  vi.useRealTimers();vi.unstubAllGlobals();
});
describe('F012D actual POS coordinators with synthetic providers',()=>{
  it('D-01 unique scoped start is registered before tenant work',async()=>{const s=owner();const p=start(s);expect(s.getSnapshot().pending).toBe(1);expect(m.assertTenant).not.toHaveBeenCalled();await p;expect(m.reset).toHaveBeenCalledTimes(1);expect((await close(s)).state).toBe('DRAINED');});
  it('D-02 concurrent starts have one effective initialization',async()=>{const s=owner();await Promise.all([start(s),start(s)]);expect(m.reset).toHaveBeenCalledTimes(1);await close(s);});
  it('D-03 stop during start prevents continuation resurrection',async()=>{const s=owner(),d=deferred();m.assertTenant.mockReturnValueOnce(d.promise);const p=start(s);await flush();await pos.stop();expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve();await expect(p).resolves.toMatchObject({started:false,stale:true});expect(m.reset).not.toHaveBeenCalled();await s.drain();});
  it('D-04 legitimate restart requires previous generation drained',async()=>{const a=owner();await start(a);await close(a);const b=owner();await start(b);expect(m.reset).toHaveBeenCalledTimes(2);expect(b.generation).not.toBe(a.generation);await close(b);});
  it('D-05 active or UNKNOWN owner cannot be replaced',async()=>{const a=owner(),b=owner();await start(a);expect(()=>start(b)).toThrow('OWNER_MISMATCH');a.markUnobservable('untracked');await close(a);expect(()=>start(b)).toThrow('OWNER_MISMATCH');});
  it('D-06 changed actor guard blocks root before any tenant work',async()=>{const s=owner();current=false;expect(()=>start(s)).toThrow('CONTEXT_STALE');expect(m.assertTenant).not.toHaveBeenCalled();});
  it('D-07 changed tenant after RPC cannot apply events or cursor',async()=>{const s=owner();await start(s);const d=deferred();m.pull.mockReturnValueOnce(d.promise);const p=pos.pullIncremental();await flush();current=false;d.resolve({...response,latestChangeSeq:10});await p;expect(m.cursor).not.toHaveBeenCalled();await close(s);});
  it('D-08 auto coordinator observes plan change and quiesces old sources',async()=>{const s=owner();auto.startPosSyncAutoBootstrap({executionScope:s});await flush();m.state={...m.state,licenseDetails:{...details,features:{cloud_pos_sync:false}}};m.subscriber(m.state);await flush();expect(s.getSnapshot().accepting).toBe(false);expect(m.unsubscribe).toHaveBeenCalledTimes(1);await s.settleObserved();});
  it('D-09 offline start preserves OFFLINE and emits no remote pulls',async()=>{navigator.onLine=false;const s=owner();await start(s);expect(pos.getStatus().status).toBe('offline');expect(m.pull).not.toHaveBeenCalled();expect((await close(s)).state).toBe('DRAINED');});
  it('D-10 reconnect callback removed before drain cannot launch new work',async()=>{const s=owner();await start(s);const listener=pos.getStatus().onlineListener;await close(s);await listener();expect(m.pending).not.toHaveBeenCalled();expect(m.pull).not.toHaveBeenCalled();});
  it('D-11 bootstrap initial pull stays scheduled until explicitly stopped',async()=>{const s=owner();await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:s});expect(s.getSnapshot().scheduled).toBe(2);expect(m.pull).not.toHaveBeenCalled();await close(s);await vi.advanceTimersByTimeAsync(5000);expect(m.pull).not.toHaveBeenCalled();});
  it('D-12 initial pull already running remains in scope after stop',async()=>{const s=owner(),d=deferred();m.pull.mockReturnValue(d.promise);await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:s});await vi.advanceTimersByTimeAsync(4000);expect(m.pull).toHaveBeenCalledTimes(1);s.quiesce();await flush();expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve(response);await s.drain();});
  it('D-13 scheduled outbox is cancelled without durable row writes',async()=>{const s=owner();await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:s});await close(s);await vi.advanceTimersByTimeAsync(5000);expect(m.pending).not.toHaveBeenCalled();expect(m.processing).not.toHaveBeenCalled();expect(m.synced).not.toHaveBeenCalled();});
  it('D-14 fired outbox handler remains observed through delayed settlement',async()=>{const s=owner(),d=deferred();pos.registerEntitySyncHandler('synthetic',{pushOperation:()=>d.promise});await start(s);m.pending.mockResolvedValue([{id:'op-1',entityType:'synthetic',operation:'UPSERT'}]);const p=pos.processOutbox();await flush();s.quiesce();await flush();expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve({success:true});await p;expect((await s.settleObserved()).unknown).toContain('pos_handler_lifetime:push:synthetic');expect(m.synced).not.toHaveBeenCalled();});
  it('D-15 snapshot raw public continuation is retained and descendant UNKNOWN persists',async()=>{const s=owner(),d=deferred();m.snapshot.mockReturnValue(d.promise);await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:s});boot.scheduleDeferredSnapshot({resource:'products',delayMs:0});await vi.advanceTimersByTimeAsync(5000);expect(m.snapshot).toHaveBeenCalledTimes(1);s.quiesce();await flush();expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve({success:true});expect((await s.settleObserved()).unknown).toContain('snapshot_handler_lifetime:products');expect(boot.getPosCloudBootstrapState().completedSnapshots).toEqual([]);});
  it('D-18 removed store listener retains in-flight reconciliation',async()=>{const s=owner(),d=deferred();m.assertTenant.mockReturnValueOnce(d.promise);auto.startPosSyncAutoBootstrap({executionScope:s});await flush();auto.stopPosSyncAutoBootstrap();await flush();expect(m.unsubscribe).toHaveBeenCalledTimes(1);expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve();await s.drain();expect(pos.getStatus().started).toBe(false);});
  it('D-19 late store callback cannot reactivate a quiesced generation',async()=>{const s=owner();auto.startPosSyncAutoBootstrap({executionScope:s});await flush();const callback=m.subscriber;await close(s);const before=m.reset.mock.calls.length;callback({...m.state,licenseDetails:{...details,plan_code:'new'}});await flush();expect(m.reset).toHaveBeenCalledTimes(before);});
  it('D-20 Realtime debounce is registered and cancelled independently',async()=>{const s=owner();await start(s);await pos.schedulePullIncremental('realtime');expect(s.getSnapshot().scheduled).toBe(1);await close(s);await vi.advanceTimersByTimeAsync(2000);expect(m.pull).not.toHaveBeenCalled();});
  it('D-22 late pull after stop does not publish cursor or metadata',async()=>{const s=owner();await start(s);const d=deferred();m.pull.mockReturnValue(d.promise);const p=pos.pullIncremental();await flush();await pos.stop();d.resolve({...response,latestChangeSeq:20});await p;await s.drain();expect(m.cursor).not.toHaveBeenCalled();expect(m.pullAt).not.toHaveBeenCalled();});
  it('D-23 late outbox rejection observes error without stale durable retry writes',async()=>{const s=owner();await start(s);const d=deferred();pos.registerEntitySyncHandler('synthetic',{pushOperation:()=>d.promise});m.pending.mockResolvedValue([{id:'op-1',entityType:'synthetic'}]);const p=pos.processOutbox();await flush();await pos.stop();d.reject(Error('transport-late'));await expect(p).rejects.toThrow('transport-late');await s.settleObserved();expect(m.failed).not.toHaveBeenCalled();});
  it('D-25 tenant change during pull blocks local event dispatch',async()=>{const s=owner();await start(s);const d=deferred(),events=vi.fn();pos.registerEntitySyncHandler('synthetic',{onEvents:events});m.pull.mockReturnValue(d.promise);const p=pos.pullIncremental();await flush();current=false;d.resolve({...response,events:[{entity_type:'synthetic'}]});await p;expect(events).not.toHaveBeenCalled();await close(s);});
  it('D-26 transport failure settles local task and retains degraded behavior',async()=>{const s=owner();await start(s);m.pull.mockRejectedValue(Error('synthetic-network'));await expect(pos.pullIncremental()).resolves.toBeNull();expect(m.pullError).toHaveBeenCalledWith(expect.any(Error),'tenant-A');expect(pos.getStatus().status).toBe('degraded');await close(s);});
  it('D-29 status callback queued before stop is observed through queue settlement',async()=>{m.topic='pos:synthetic';const s=owner();await start(s);const d=deferred();m.status.mockReturnValueOnce(d.promise);m.callbacks.onStatusChange({status:'online',reason:'synthetic'});await flush();s.quiesce();await flush();expect(s.getSnapshot().pending).toBeGreaterThan(0);d.resolve();expect((await s.settleObserved()).unknown).toContain('pos_realtime_internal_reconnect_lifetime');});
  it('D-30 bootstrap restart rejects old UNKNOWN snapshot owner',async()=>{const a=owner();await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:a});boot.scheduleDeferredSnapshot({resource:'products'});await vi.advanceTimersByTimeAsync(5000);await close(a);const b=owner();expect(()=>boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:b})).toThrow('OWNER_MISMATCH');});
  it('D-48 duplicate auto install creates one subscription and recovery source',async()=>{const s=owner();auto.startPosSyncAutoBootstrap({executionScope:s});auto.startPosSyncAutoBootstrap({executionScope:s});await flush();expect(m.installRecovery).toHaveBeenCalledTimes(1);await close(s);expect(m.unsubscribe).toHaveBeenCalledTimes(1);});
  it('D-49 no-scope bootstrap preserves existing delayed pull and outbox behavior',async()=>{await boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap'});await vi.advanceTimersByTimeAsync(5000);expect(m.pull).toHaveBeenCalledTimes(1);expect(m.pending).toHaveBeenCalledTimes(1);expect(scopes).toHaveLength(0);await boot.stopPosCloudBootstrap();});
  it('EXTRA cannot attach a scope to an already running default runtime',async()=>{await start();const s=owner();expect(()=>start(s)).toThrow('LEGACY_OWNER_ACTIVE');await pos.stop();});
  it('EXTRA stale realtime callback cannot add status writes or debounce work',async()=>{m.topic='pos:synthetic';const s=owner();await start(s);const callbacks=m.callbacks;await close(s);const writes=m.status.mock.calls.length;callbacks.onStatusChange({status:'online'});callbacks.onConnectionRestored();callbacks.onPosChangeAvailable({});await flush();expect(m.status).toHaveBeenCalledTimes(writes);expect(m.pull).not.toHaveBeenCalled();});
  it('EXTRA rejected auto attachment never tears down a preexisting legacy runtime',async()=>{await start();const s=owner();expect(()=>auto.startPosSyncAutoBootstrap({executionScope:s})).toThrow('LEGACY_OWNER_ACTIVE');expect(s.getSnapshot().sources).toBe(0);s.quiesce();await s.drain();expect(pos.getStatus().started).toBe(true);expect(m.installRecovery).not.toHaveBeenCalled();await pos.stop();});
  it('EXTRA bootstrap reserves orchestrator ownership before its start factory',async()=>{const s=owner();const p=boot.startPosCloudBootstrap({licenseDetails:details,reason:'initial_bootstrap',executionScope:s});const parallel=pos.processOutbox('parallel');expect(s.getSnapshot().pending).toBe(2);await Promise.all([p,parallel]);await close(s);});
  it('EXTRA completed legacy jobs cannot be retrospectively claimed after stop',async()=>{await start();await pos.stop();const s=owner();expect(()=>start(s)).toThrow('LEGACY_OWNER_ACTIVE');});
  it('EXTRA captured online callback cannot initiate pull after its outbox settles in quiesce',async()=>{const s=owner();await start(s);const d=deferred();m.pending.mockReturnValueOnce(d.promise);const online=pos.getStatus().onlineListener();await flush();s.quiesce();await flush();d.resolve([]);await online;await s.drain();expect(m.pull).not.toHaveBeenCalled();});
});
