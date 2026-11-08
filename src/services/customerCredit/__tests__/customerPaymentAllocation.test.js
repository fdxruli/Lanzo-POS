import { beforeEach, describe, expect, it, vi } from 'vitest';
const cloud = vi.hoisted(() => ({recordCustomerPayment:vi.fn(),getCustomerCreditSummary:vi.fn()}));
const actorRuntime = vi.hoisted(() => ({
  getState: vi.fn(() => ({ actorType: 'admin' })),
  capture: vi.fn(() => ({ actorType: 'admin', assertCurrent: vi.fn(() => ({ actorType: 'admin' })) }))
}));
vi.mock('../../../store/useAppStore', () => ({useAppStore:{getState:()=>({licenseDetails:{}})}}));
vi.mock('../../sync/syncConstants', () => ({ getLicenseKeyFromDetails:()=> 'synthetic',
  isCloudCustomerCreditSyncEnabled:()=>true,SYNC_ENTITY_TYPES:{CUSTOMER_LEDGER:'customer_ledger'},SYNC_OPERATIONS:{CREATE:'create'} }));
vi.mock('../../sync/idempotency', () => ({generateIdempotencyKey:()=> 'test-payment-key'}));
vi.mock('../../sync/posSyncOrchestrator', () => ({posSyncOrchestrator:{pullIncremental:()=>Promise.resolve()}}));
vi.mock('../../utils', () => ({showMessageModal:vi.fn()}));
vi.mock('../../Logger', () => ({default:{error:vi.fn(),warn:vi.fn()}}));
vi.mock('../../cash/cashActor', () => ({getCashMode:()=>({})}));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: actorRuntime,
  isActorRuntimeError: () => false
}));
vi.mock('../customerCreditSyncHandler', () => ({}));
vi.mock('../customerCreditCloudRepository', () => ({customerCreditCloudRepository:cloud}));
vi.mock('../customerCreditLocalRepository', () => ({customerCreditLocalRepository:{applyCloudLedger:async row=>row,applyCloudLedgers:async rows=>rows}}));
vi.mock('../../customers/customerLocalRepository', () => ({customerLocalRepository:{applyCloudCustomer:async row=>row,applyCloudCustomers:async rows=>rows}}));
vi.mock('../../cash/cashLocalRepository', () => ({cashLocalRepository:{applyCloudCashMovements:async rows=>rows,applyCloudCashSessions:async rows=>rows}}));
vi.mock('../../salesCloud/salesCloudLocalRepository', () => ({salesCloudLocalRepository:{applyCloudSalesPayload:vi.fn()}}));
import { customerCreditRepository } from '../customerCreditRepository';
import { localAllocationsToCloud } from '../customerCreditMapper';
beforeEach(()=>vi.clearAllMocks());
describe('specific Cloud payment confirmation', () => {
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
