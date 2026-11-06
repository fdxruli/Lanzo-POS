// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const io=vi.hoisted(()=>({local:vi.fn(),summary:vi.fn()}));
vi.mock('../../../services/database',()=>({queryByIndex:io.local,STORES:{SALES:'sales'}}));
vi.mock('../../../services/customerCredit/customerCreditRepository',()=>({customerCreditRepository:{getCustomerCreditSummary:io.summary}}));
vi.mock('../../../services/customerMessaging',()=>import('../../../services/customerMessaging/normalizers'));
import PurchaseHistoryModal from '../PurchaseHistoryModal';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const row={id:'cloud-note',local_sale_id:'local-note',total:20,amount_paid:0,balance_due:20,
  original_balance_due:20,assigned_payments_total:5,current_balance_due:15,
  credit_allocation_status:'reconciled',payment_method:'credit',status:'closed',sold_at:'2026-01-01'};
const open=async(cloud=row,local=[])=>{
  io.local.mockResolvedValue(local);
  io.summary.mockResolvedValue({success:true,customer:{debt:15},sale_balances_authoritative:true,credit_sales:[cloud]});
  render(<PurchaseHistoryModal show isCloudCredit customer={{id:'c',name:'Synthetic',debt:20}} onClose={vi.fn()} />);
  await screen.findByText('CRÉDITO');
  fireEvent.click(document.querySelector('.history-item'));
};
describe('Cloud credit purchase history',()=>{
  it('shows a server note created on another device without requiring a local sale',async()=>{
    await open();
    expect(screen.getByText('Fiado original:').nextElementSibling.textContent).toContain('20.00');
    expect(screen.getByText('Abonos asignados:').nextElementSibling.textContent).toContain('5.00');
    expect(screen.getByText('Saldo vigente:').nextElementSibling.textContent).toContain('15.00');
    expect(screen.getByText('Deuda Actual').nextElementSibling.textContent).toContain('15.00');
  });
  it('overrides a stale local sale balance with the financial server value',async()=>{
    await open(row,[{id:'local-note',total:20,saldoPendiente:20,paymentMethod:'credit',items:[],timestamp:'2026-01-01'}]);
    expect(document.querySelectorAll('.history-item')).toHaveLength(1);
    expect(screen.getByText('Saldo vigente:').nextElementSibling.textContent).toContain('15.00');
  });
  it('does not display an original balance as the live balance for historical unallocated payments',async()=>{
    await open({...row,current_balance_due:null,assigned_payments_total:0,credit_allocation_status:'historical_unallocated'});
    expect(screen.getByText('Saldo vigente:').nextElementSibling.textContent).toBe('Sin conciliar por nota');
  });
});
