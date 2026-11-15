import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
const cloud = vi.hoisted(() => ({recordCustomerPayment:vi.fn(),getCustomerCreditSummary:vi.fn(),rpc:vi.fn()}));
const actorRuntime = vi.hoisted(() => {
  const initialState = () => ({
    status: 'granted', actorType: 'admin', actorId: 'admin-1', actorKey: 'admin:admin-1',
    sessionId: 'session-1', permissions: ['*'],
    tenant: { opaqueId: 'tenant-1', databaseName: 'db-1', generation: 1 },
    deviceRef: 'device-1', generation: 1, reason: null
  });
  const listeners = new Set();
  let state = initialState();
  const snapshot = () => ({ ...state, permissions: [...state.permissions], tenant: { ...state.tenant } });
  const publish = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
    return current;
  };
  return {
    getState: vi.fn(() => snapshot()),
    capture: vi.fn(() => {
      const captured = snapshot();
      return {
        ...captured,
        assertCurrent: vi.fn((permission) => {
          if (state.status !== 'granted' || state.actorKey !== captured.actorKey
            || state.sessionId !== captured.sessionId || state.generation !== captured.generation
            || state.tenant?.opaqueId !== captured.tenant?.opaqueId
            || state.tenant?.generation !== captured.tenant?.generation
            || state.deviceRef !== captured.deviceRef) {
            throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
          }
          if (permission && !state.permissions.includes('*') && !state.permissions.includes(permission)) {
            throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
          }
          return snapshot();
        })
      };
    }),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    updateState: (patch) => {
      state = { ...state, ...patch };
      return publish();
    },
    reset: () => {
      state = initialState();
      publish();
    }
  };
});
vi.mock('../../../store/useAppStore', () => ({useAppStore:{getState:()=>({licenseDetails:{}})}}));
vi.mock('../../sync/syncConstants', async (importOriginal) => ({
  ...(await importOriginal()),
  getLicenseKeyFromDetails: () => 'synthetic',
  isCloudCustomerCreditSyncEnabled: () => true
}));
vi.mock('../../sync/posSyncClient', async (importOriginal) => ({
  ...(await importOriginal()),
  buildPosSyncAuthContext: vi.fn(async ({ licenseKey }) => ({
    licenseKey,
    deviceFingerprint: 'device-1',
    securityToken: 'test-security-token',
    staffSessionToken: null
  }))
}));
vi.mock('../../supabase', async (importOriginal) => ({
  ...(await importOriginal()),
  supabaseClient: { rpc: cloud.rpc }
}));
vi.mock('../../sync/idempotency', () => ({generateIdempotencyKey:()=> 'test-payment-key'}));
vi.mock('../../sync/posSyncOrchestrator', () => ({posSyncOrchestrator:{
  pullIncremental:()=>Promise.resolve(),
  registerEntitySyncHandler:vi.fn((_entityType,_handler)=>()=>{})
}}));
vi.mock('../../utils', () => ({showMessageModal:vi.fn()}));
vi.mock('../../Logger', () => ({default:{error:vi.fn(),warn:vi.fn(),log:vi.fn(),info:vi.fn()}}));
vi.mock('../../cash/cashActor', () => ({getCashMode:()=>({})}));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: actorRuntime,
  ACTOR_RUNTIME_STATUS: { LOCKED: 'locked', GRANTED: 'granted' },
  isActorRuntimeError: (error) => String(error?.code || '').startsWith('ACTOR_')
}));
vi.mock('../customerCreditSyncHandler', () => ({}));
vi.mock('../customerCreditCloudRepository', () => ({customerCreditCloudRepository:cloud}));
vi.mock('../customerCreditLocalRepository', () => ({customerCreditLocalRepository:{applyCloudLedger:async row=>row,applyCloudLedgers:async rows=>rows}}));
vi.mock('../../customers/customerLocalRepository', () => ({customerLocalRepository:{applyCloudCustomer:async row=>row,applyCloudCustomers:async rows=>rows}}));
vi.mock('../../cash/cashLocalRepository', () => ({cashLocalRepository:{applyCloudCashMovements:async rows=>rows,applyCloudCashSessions:async rows=>rows}}));
vi.mock('../../salesCloud/salesCloudLocalRepository', () => ({salesCloudLocalRepository:{applyCloudSalesPayload:vi.fn()}}));
import { customerCreditRepository } from '../customerCreditRepository';
import { localAllocationsToCloud } from '../customerCreditMapper';
beforeEach(async()=>{
  actorRuntime.reset();
  vi.clearAllMocks();
  cloud.recordCustomerPayment.mockReset();
  cloud.getCustomerCreditSummary.mockReset();
  cloud.rpc.mockImplementation(async (name, args = {}) => {
    if (name === 'pos_get_cash_station_state') {
      return { data: { cash_station: { id: 'station-1' }, station_open_cash_session: { id: 'cash' } }, error: null };
    }
    if (name === 'pos_fin01_sync_contract_v1') {
      return { data: {
        contract_version: 2,
        tenant_id: 'tenant-1',
        server_status: 'SUPPORTED',
        endpoint_families: ['financial_operations', 'customer_credit'],
        endpoints: ['pos_record_customer_payment_v2'],
        capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'financial_operation_result_v1']
      }, error: null };
    }
    if (name === 'pos_record_customer_payment_v2') {
      const payload = await cloud.recordCustomerPayment(args);
      return { data: {
        contract_version: 2,
        tenant_id: 'tenant-1',
        endpoint: name,
        family: 'customer_credit',
        customer_id: args.p_customer_id,
        payload,
        customer_projections: [],
        operation: { idempotency_key: args.p_idempotency_key }
      }, error: null };
    }
    return { data: null, error: new Error(`Unexpected RPC ${name}`) };
  });
  await openTestTenantRuntime();
});
afterEach(async()=>closeTestTenantRuntime());
describe('specific Cloud payment confirmation', () => {
  it('notifies authority subscribers and invalidates a captured handle after a generation change', () => {
    const listener = vi.fn();
    const handle = actorRuntime.capture();
    const unsubscribe = actorRuntime.subscribe(listener);

    actorRuntime.updateState({ sessionId: 'session-2', generation: 2 });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-2', generation: 2 }));
    expect(() => handle.assertCurrent('customer_payments')).toThrow('ACTOR_CONTEXT_STALE');
    unsubscribe();

    actorRuntime.updateState({ sessionId: 'session-3', generation: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not write money when the server only supports descriptive allocations', async () => {
    cloud.getCustomerCreditSummary.mockResolvedValue({success:true,pending_credit_sales:[]});
    const r=await customerCreditRepository.processPayment('c',5,'efectivo','cash','',[{saleId:'s',amountApplied:5}]);
    expect(r).toMatchObject({success:false,code:'CUSTOMER_SALE_BALANCES_UNRECONCILED'});
    expect(cloud.recordCustomerPayment).not.toHaveBeenCalled();
  });
  it('blocks specific allocation on a historically unreconciled customer', async () => {
    cloud.getCustomerCreditSummary.mockResolvedValue({sale_allocation_version:1,sale_balances_authoritative:true,sale_allocation_status:'historical_unallocated'});
    expect((await customerCreditRepository.processPayment('c',5,'efectivo','cash','',[{saleId:'s',amountApplied:5}])).success).toBe(false);
    expect(cloud.recordCustomerPayment).not.toHaveBeenCalled();
  });
  it('uses the server-applied allocation in receipts', async () => {
    cloud.getCustomerCreditSummary.mockResolvedValue({sale_allocation_version:1,sale_balances_authoritative:true,sale_allocation_status:'reconciled'});
    cloud.recordCustomerPayment.mockResolvedValue({success:true,new_debt:15,sale_allocation_version:1,sale_allocation_status:'applied',unallocated_amount:0,
      ledger_entry:{id:'ledger',allocation_payload:[{sale_id:'s',amount_applied:5,previous_sale_balance:20,new_sale_balance:15}]}});
    const r=await customerCreditRepository.processPayment('c',5,'efectivo','cash','',[{saleId:'s',amountApplied:5}]);
    expect(r).toMatchObject({success:true,allocationStatus:'applied',confirmedAllocations:[{saleId:'s',amountApplied:'5'}]});
  });
  it('never sends browser balances and never silently turns invalid selections into FIFO', () => {
    expect(localAllocationsToCloud([{saleId:'s',amountApplied:5,previousSaleBalance:999,newSaleBalance:0}]))
      .toEqual([{sale_id:'s',amount_applied:'5'}]);
    expect(localAllocationsToCloud([{saleId:'s',amountApplied:-1},{}]))
      .toEqual([{sale_id:'s',amount_applied:'-1'},{sale_id:null,amount_applied:'0'}]);
  });
});
