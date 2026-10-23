// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api=vi.hoisted(()=>({preview:vi.fn(),authorizeAndImport:vi.fn(),resumeImport:vi.fn(),status:vi.fn()}));
vi.mock('../../../store/useAppStore',()=>({useAppStore:(selector)=>selector({licenseDetails:{license_key:'synthetic'}})}));
vi.mock('../../../services/sync/syncConstants',()=>({getLicenseKeyFromDetails:()=> 'synthetic',isCloudCustomerCreditSyncEnabled:()=>true}));
vi.mock('../../../services/customerCredit/customerCreditMigrationService',()=>({customerCreditMigrationService:api}));
import HistoricalCreditImport from '../HistoricalCreditImport';
afterEach(cleanup);
beforeEach(()=>{
  Object.values(api).forEach(fn=>fn.mockReset());
  api.preview.mockResolvedValue({hash:'reviewed-hash',batch:{manifest:{customer_count:1,total_cents:12501}},names:{a:'Synthetic'},results:[{customer_id:'a',amount_cents:12501,status:'READY',over_limit:true}]});
  api.authorizeAndImport.mockResolvedValue({state:'CONSUMED',results:[{customer_id:'a',amount_cents:12501,status:'IMPORTED'}]});
});
describe('explicit owner review UI; presentation boundary only',()=>{
  it('opening the screen never approves or imports',()=>{
    render(<HistoricalCreditImport/>);expect(api.preview).not.toHaveBeenCalled();expect(api.authorizeAndImport).not.toHaveBeenCalled();
  });
  it('shows exact amounts and requires review confirmation before import',async()=>{
    render(<HistoricalCreditImport/>);fireEvent.click(screen.getByRole('button',{name:'Revisar saldos preservados'}));
    const approve=await screen.findByRole('button',{name:'Autorizar e importar estos saldos'});
    expect(approve).toBeDisabled();expect(screen.getByText('Synthetic')).toBeInTheDocument();
    expect(screen.getByText(/Supera el límite actual/)).toBeInTheDocument();expect(api.authorizeAndImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(approve);
    await waitFor(()=>expect(api.authorizeAndImport).toHaveBeenCalledWith({licenseKey:'synthetic',reviewedHash:'reviewed-hash'}));
    expect(await screen.findByText(/Importación confirmada/)).toBeInTheDocument();
  });
  it('a timeout preserves the preview and offers a status check',async()=>{
    api.authorizeAndImport.mockRejectedValue(new Error('timeout'));render(<HistoricalCreditImport/>);
    fireEvent.click(screen.getByRole('button',{name:'Revisar saldos preservados'}));await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Autorizar e importar estos saldos'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los saldos locales siguen preservados');
    expect(screen.getByRole('button',{name:'Autorizar e importar estos saldos'})).toBeDisabled();
    expect(screen.getByText('Synthetic')).toBeInTheDocument();expect(api.resumeImport).not.toHaveBeenCalled();
  });
});
