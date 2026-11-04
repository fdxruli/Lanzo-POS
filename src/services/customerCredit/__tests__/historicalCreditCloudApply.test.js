import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../../db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { customerLocalRepository } from '../../customers/customerLocalRepository';
import { historicalCreditSnapshot } from '../historicalCreditSnapshot';
import { localCustomerToCloudPayload } from '../../customers/customerMapper';
import { customerCreditRepository } from '../../db/customerCreditRepository';
import { customerCreditLocalRepository } from '../customerCreditLocalRepository';
import { validateCloudSyncV2Envelope } from '../../sync/cloudSyncProtocolV2';

beforeEach(() => openTestTenantRuntime());
afterEach(() => closeTestTenantRuntime());
describe('real Cloud apply through tenant Dexie', () => {
  const historicalReceiptCustomer = () => validateCloudSyncV2Envelope({
    contract_version: 2, tenant_id: 'qa-tenant', endpoint: 'pos_get_financial_operation_receipt_v2',
    family: 'financial_operations', customer_projection_scope: 'OPERATION_RESULT', customer_projections: [],
    operation: { idempotency_key: 'original-key', request_hash: 'original-hash' },
    payload: { status: 'COMPLETED', result: { customer: { id: 'r2-customer', name: 'Past name',
      credit_limit: 100, debt: 10, debt_cents: 1000, server_version: 1,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } } }
  }, { expectedTenantId: 'qa-tenant', expectedEndpoint: 'pos_get_financial_operation_receipt_v2',
    expectedFamily: 'financial_operations', expectedIdempotencyKey: 'original-key', expectedRequestHash: 'original-hash' }).result.customer;

  it('does not roll current $5 debt back to a completed $10 receipt during repeated recovery', async () => {
    await customerLocalRepository.applyCloudCustomer({ id: 'r2-customer', name: 'Current name', debt: 5, debt_cents: 500, server_version: 2 });
    const before = await db.table(STORES.CUSTOMERS).get('r2-customer');
    for (let i = 0; i < 3; i += 1) await customerLocalRepository.applyCloudCustomer(historicalReceiptCustomer(), { source: 'credit_projection' });
    expect(await db.table(STORES.CUSTOMERS).get('r2-customer')).toEqual(before);
    expect(await db.table(STORES.CUSTOMER_LEDGER).count()).toBe(0);
    expect(await historicalCreditSnapshot.list()).toEqual([]);
  });

  it('does not create a zero-debt customer from a historical receipt when no projection exists', async () => {
    expect(await customerLocalRepository.applyCloudCustomer(historicalReceiptCustomer(), { source: 'credit_projection' })).toBeNull();
    expect(await db.table(STORES.CUSTOMERS).get('r2-customer')).toBeUndefined();
  });

  it('preserves pending Local history when a completed receipt is recovered', async () => {
    await db.table(STORES.CUSTOMERS).put({ id: 'r2-customer', name: 'Local name', debt: '22', financialSource: 'local' });
    await customerLocalRepository.applyCloudCustomer(historicalReceiptCustomer(), { source: 'credit_projection' });
    expect(await db.table(STORES.CUSTOMERS).get('r2-customer')).toMatchObject({ name: 'Local name', debt: '22',
      conflictReason: 'HISTORICAL_DEBT_PRESERVATION_REQUIRED' });
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({ amountCents: 2200, status: 'PENDING_AUTHORIZATION' });
  });

  it('rolls back receipt-side Local history changes if the actor changes inside the transaction', async () => {
    await db.table(STORES.CUSTOMERS).put({ id: 'r2-customer', name: 'Local', debt: '22' });
    let checks = 0;
    const actorHandle = { assertCurrent() { if (++checks === 4) throw new Error('ACTOR_CONTEXT_STALE'); } };
    await expect(customerLocalRepository.applyCloudCustomer(historicalReceiptCustomer(), { actorHandle }))
      .rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(await db.table(STORES.CUSTOMERS).get('r2-customer')).toMatchObject({ debt: '22' });
    expect(await historicalCreditSnapshot.list()).toEqual([]);
  });
  it('preserves debt and directory source before applying Cloud zero, pending explicit FIN-01', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45', syncStatus:'local' });
    await customerLocalRepository.applyCloudCustomer({ id:'legacy', name:'Cloud name', phone:'5551234567', debt:0, debt_cents:0, server_version:1 });
    expect(await db.table(STORES.CUSTOMERS).get('legacy')).toMatchObject({ name:'Original', debt:'123.45', debtCents:12345, creditMigrationStatus:'PENDING_AUTHORIZATION', conflictReason:'HISTORICAL_DEBT_PRESERVATION_REQUIRED' });
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({ amountCents:12345, originalCustomer:{name:'Original',debt:'123.45'} });
  });
  it('does not replace unresolved local debt even when Cloud has a nonzero ledger', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45' });
    await customerLocalRepository.applyCloudCustomer({ id:'legacy', name:'Updated', debt:50, debt_cents:5000, server_version:1 });
    expect((await db.table(STORES.CUSTOMERS).get('legacy')).debt).toBe('123.45');
  });
  it('applies ordinary Cloud financial projections without classifying them as Local history', async () => {
    await customerLocalRepository.applyCloudCustomer({ id:'cloud', name:'Cloud', debt:50, debt_cents:5000, server_version:1 });
    await customerLocalRepository.applyCloudCustomer({ id:'cloud', name:'Cloud', debt:25, debt_cents:2500, server_version:2 });
    expect((await db.table(STORES.CUSTOMERS).get('cloud')).debt).toBe(25);
    expect(await historicalCreditSnapshot.list()).toEqual([]);
  });
  it('keeps original and current balance when local activity follows the snapshot', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45' });
    await historicalCreditSnapshot.preserveAll();
    await db.table(STORES.CUSTOMERS).update('legacy', { debt:'100' });
    expect(await historicalCreditSnapshot.saveResult('legacy',{status:'IMPORTED',ledger_id:'receipt'})).toMatchObject({status:'CONFLICT_LOCAL_ACTIVITY',cloudStatus:'IMPORTED'});
    await customerLocalRepository.applyCloudCustomer({ id:'legacy',name:'Cloud',debt:123.45,debt_cents:12345,server_version:1 });
    expect((await db.table(STORES.CUSTOMERS).get('legacy')).debt).toBe('100');
    expect((await historicalCreditSnapshot.list())[0].amountCents).toBe(12345);
  });
  it('directory payload cannot carry arbitrary debt fields', () => {
    const payload=localCustomerToCloudPayload({id:'legacy',name:'Name',debt:123.45,debtCents:12345});
    expect(payload).not.toHaveProperty('debt');expect(payload).not.toHaveProperty('debt_cents');
  });
  it('keeps the earlier Cloud projection checkpoint without freezing ordinary sync', async () => {
    await db.table(STORES.CUSTOMERS).put({id:'cloud-old',name:'Cloud',debt:'80',syncStatus:'synced',serverVersion:2,
      updatedAt:'2026-01-01T00:00:00Z',lastSyncedAt:'2026-01-02T00:00:00Z',metadata:{debt_projection_source:'pos_customer_ledger'}});
    await customerLocalRepository.applyCloudCustomer({id:'cloud-old',name:'Cloud',debt:50,debt_cents:5000,server_version:3});
    expect((await db.table(STORES.CUSTOMERS).get('cloud-old')).debt).toBe(50);
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({status:'CLOUD_PROJECTION',originalCustomer:{debt:'80'}});
  });
  it('preserves a new Local period after earlier Cloud synchronization', async () => {
    await customerLocalRepository.applyCloudCustomer({id:'returning',name:'Cloud',debt:50,debt_cents:5000,server_version:1});
    await db.table(STORES.CUSTOMERS).update('returning',{debt:'70',financialSource:'local'});
    await customerLocalRepository.applyCloudCustomer({id:'returning',name:'Cloud updated',debt:50,debt_cents:5000,server_version:2});
    expect((await db.table(STORES.CUSTOMERS).get('returning')).debt).toBe('70');
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({status:'PENDING_AUTHORIZATION',amountCents:7000});
  });
  for (const pulled of [false, true]) it(`reconciles confirmed history once with later Local activity; ledger pulled=${pulled}`, async () => {
    await db.table(STORES.CUSTOMERS).put({id:'legacy',name:'Original',debt:'100'});
    const original={id:'old-local-charge',customerId:'legacy',type:'CHARGE',amount:'100'};
    await db.table(STORES.CUSTOMER_LEDGER).put(original);
    await historicalCreditSnapshot.preserveAll();
    await db.table(STORES.CUSTOMER_LEDGER).put({id:'later-local-charge',customerId:'legacy',type:'CHARGE',amount:'30'});
    await db.table(STORES.CUSTOMERS).update('legacy',{debt:'130',financialSource:'local'});
    await historicalCreditSnapshot.saveResult('legacy',{status:'IMPORTED',ledger_id:'cloud-initial'});
    if (pulled) await customerCreditLocalRepository.applyCloudLedger({id:'cloud-initial',customer_id:'legacy',type:'INITIAL_BALANCE',amount:100});
    expect(await customerCreditRepository.recalculateDebtFromLedger('legacy')).toBe('130');
    expect(await db.table(STORES.CUSTOMER_LEDGER).get(original.id)).toEqual(original);
    expect((await customerCreditLocalRepository.getCustomerLedger('legacy')).map((row) => row.id)).not.toContain(original.id);
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({originalLedgerEntries:[original],originalCustomer:{debt:'100'}});
  });
  it('keeps a pure confirmed Cloud projection distinct from later Local activity', async () => {
    await db.table(STORES.CUSTOMERS).put({id:'legacy',name:'Original',debt:'100'});
    await db.table(STORES.CUSTOMER_LEDGER).put({id:'old-local',customerId:'legacy',type:'CHARGE',amount:'100'});
    await historicalCreditSnapshot.preserveAll();
    await historicalCreditSnapshot.saveResult('legacy',{status:'IMPORTED',ledger_id:'cloud-initial'});
    await customerCreditLocalRepository.applyCloudLedger({id:'cloud-initial',customer_id:'legacy',type:'INITIAL_BALANCE',amount:100});
    expect(await customerCreditRepository.recalculateDebtFromLedger('legacy')).toBe('100');
    await customerLocalRepository.applyCloudCustomer({id:'legacy',name:'Cloud',debt:90,debt_cents:9000,server_version:1});
    expect((await db.table(STORES.CUSTOMERS).get('legacy')).debt).toBe(90);
    expect((await historicalCreditSnapshot.list())[0].status).toBe('IMPORTED');
  });
});
