import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ generation: 1, rpc: vi.fn() }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => {
  const generation = runtime.generation;
  return { actorType:'admin', assertCurrent: () => { if (generation !== runtime.generation) throw new Error('ACTOR_CONTEXT_STALE'); } };
} } }));
vi.mock('../customerCreditCloudRepository', () => ({ customerCreditCloudRepository: { historicalCreditBatch: runtime.rpc } }));
import { db, STORES } from '../../db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { customerCreditMigrationService as migration } from '../customerCreditMigrationService';
import { historicalCreditSnapshot } from '../historicalCreditSnapshot';

const key='historical-credit:v1:batch';
const licenseKey='synthetic-license';
const tenant='10000000-0000-0000-0000-000000000001';
const readBatch=async()=>(await db.table(STORES.SYNC_CACHE).get(key))?.value;
beforeEach(async()=>{
  runtime.generation=1;runtime.rpc.mockReset();await openTestTenantRuntime();
  await db.table(STORES.CUSTOMERS).put({id:'legacy',name:'Synthetic',debt:'125.01'});
  runtime.rpc.mockImplementation(async({action,manifest})=>{
    if(action==='context')return {success:true,tenant_id:tenant};
    if(action==='preview')return {success:true,hash:'server-hash',results:manifest.entries.map(e=>({...e,status:'READY'}))};
    throw new Error('unexpected action');
  });
});
afterEach(()=>closeTestTenantRuntime());
describe('durable import workflow; RPC transport is a controlled boundary double',()=>{
  it('startup and reconnect preserve debt without approval or financial RPC',async()=>{
    expect(await migration.runInitialMigrationIfNeeded({licenseKey})).toMatchObject({success:false,code:'PENDING_AUTHORIZATION'});
    expect(runtime.rpc).not.toHaveBeenCalled();expect((await historicalCreditSnapshot.list())[0].amountCents).toBe(12501);
  });
  it('preview persists exact manifest and only reads the server',async()=>{
    const p=await migration.preview({licenseKey});
    expect((await readBatch()).previewHash).toBe('server-hash');
    expect(p.batch.manifest.entries).toEqual([{customer_id:'legacy',source_customer_id:'legacy',amount_cents:12501}]);
    expect(runtime.rpc.mock.calls.map(([request])=>request.action)).toEqual(['context','preview']);
  });
  it('does not authorize a manifest which was not reviewed',async()=>{
    await migration.preview({licenseKey});runtime.rpc.mockClear();
    await expect(migration.authorizeAndImport({licenseKey,reviewedHash:'different'})).rejects.toThrow('HISTORICAL_REVIEW_REQUIRED');
    expect(runtime.rpc).not.toHaveBeenCalled();
  });
  it('lost approval response preserves batch and recovers status after a reload',async()=>{
    await migration.preview({licenseKey});
    runtime.rpc.mockImplementation(async({action})=>{expect(action).toBe('authorize');throw new Error('timeout');});
    await expect(migration.authorizeAndImport({licenseKey,reviewedHash:'server-hash'})).rejects.toThrow('timeout');
    expect((await readBatch()).state).toBe('AUTHORIZATION_UNCERTAIN');
    const entries=(await readBatch()).manifest.entries;
    runtime.rpc.mockImplementation(async({action})=>{expect(action).toBe('status');return {success:true,hash:'server-hash',authorization_id:'receipt-id',state:'CONSUMED',results:entries.map(e=>({...e,status:'IMPORTED',ledger_id:'ledger-id'}))};});
    await expect(migration.status({licenseKey})).resolves.toMatchObject({state:'CONSUMED'});
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({status:'IMPORTED',originalCustomer:{debt:'125.01'}});
  });
  it('checks status before retry and never reauthorizes automatically',async()=>{
    await migration.preview({licenseKey});const entries=(await readBatch()).manifest.entries;const actions=[];
    runtime.rpc.mockImplementation(async({action})=>{actions.push(action);return {success:true,hash:'server-hash',authorization_id:'receipt-id',state:'CONSUMED',results:entries.map(e=>({...e,status:'IMPORTED',ledger_id:'ledger-id'}))};});
    await migration.resumeImport({licenseKey});expect(actions).toEqual(['status']);
  });
  it('rejects stale actor responses before saving a batch into another context',async()=>{
    runtime.rpc.mockImplementation(async()=>{runtime.generation++;return {success:true,tenant_id:tenant};});
    await expect(migration.preview({licenseKey})).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(await readBatch()).toBeUndefined();
  });
  it('rejects a mismatched receipt without completing preserved debt',async()=>{
    await migration.preview({licenseKey});
    runtime.rpc.mockResolvedValue({success:true,hash:'server-hash',authorization_id:'receipt-id',state:'CONSUMED',results:[{customer_id:'legacy',source_customer_id:'legacy',amount_cents:999,status:'IMPORTED',ledger_id:'ledger-id'}]});
    await expect(migration.status({licenseKey})).rejects.toThrow('HISTORICAL_RESPONSE_MISMATCH');
    expect((await historicalCreditSnapshot.list())[0].status).toBe('PENDING_AUTHORIZATION');
  });
  it('archives a consumed batch before reviewing additional pending customers',async()=>{
    await migration.preview({licenseKey});
    const previous=await readBatch();
    runtime.rpc.mockResolvedValueOnce({success:true,hash:'server-hash',authorization_id:'receipt-id',state:'CONSUMED',results:previous.manifest.entries.map(e=>({...e,status:'IMPORTED',ledger_id:'ledger-id'}))});
    await migration.status({licenseKey});
    await db.table(STORES.CUSTOMERS).put({id:'next',name:'Next synthetic',debt:'10.01'});
    runtime.rpc.mockImplementation(async({action,manifest})=>action==='context'
      ? {success:true,tenant_id:tenant}
      : {success:true,hash:'next-hash',results:manifest.entries.map(e=>({...e,status:'READY'}))});
    const next=await migration.preview({licenseKey});
    expect(next.batch.manifest.entries).toEqual([{customer_id:'next',source_customer_id:'next',amount_cents:1001}]);
    expect(next.batch.manifest.batch_id).not.toBe(previous.manifest.batch_id);
    expect((await db.table(STORES.SYNC_CACHE).get(`${key}:archive:${previous.manifest.batch_id}`)).value).toMatchObject({state:'CONSUMED',authorizationId:'receipt-id'});
    expect(runtime.rpc.mock.calls.slice(-2).map(([request])=>request.action)).toEqual(['context','preview']);
  });
  it('does not mark a consumed batch confirmed without every receipt',async()=>{
    await migration.preview({licenseKey});
    runtime.rpc.mockResolvedValue({success:true,hash:'server-hash',authorization_id:'receipt-id',state:'CONSUMED',results:[]});
    await expect(migration.status({licenseKey})).rejects.toThrow('HISTORICAL_RECEIPT_MISSING');
    expect((await historicalCreditSnapshot.list())[0].status).toBe('PENDING_AUTHORIZATION');
  });
  it('keeps later local activity visible when no importable snapshots remain',async()=>{
    await historicalCreditSnapshot.preserveAll();
    await db.table(STORES.SYNC_CACHE).update('historical-credit:v1:customer:legacy',{'value.status':'CONFLICT_LOCAL_ACTIVITY'});
    expect(await migration.preview({licenseKey})).toMatchObject({success:false,empty:false,state:'LOCAL_CONFLICT',results:[{status:'CONFLICT_LOCAL_ACTIVITY'}]});
  });
});
