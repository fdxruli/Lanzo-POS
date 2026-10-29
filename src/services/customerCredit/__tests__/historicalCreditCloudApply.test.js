import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../../db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { customerLocalRepository } from '../../customers/customerLocalRepository';
import { historicalCreditSnapshot } from '../historicalCreditSnapshot';
import { localCustomerToCloudPayload } from '../../customers/customerMapper';
import { customerCreditRepository } from '../../db/customerCreditRepository';
import { customerCreditLocalRepository } from '../customerCreditLocalRepository';

beforeEach(() => openTestTenantRuntime());
afterEach(() => closeTestTenantRuntime());
describe('real Cloud apply through tenant Dexie', () => {
  it('preserves debt before applying Cloud zero while synchronizing directory fields', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45', syncStatus:'local' });
    await customerLocalRepository.applyCloudCustomer({ id:'legacy', name:'Cloud name', phone:'5551234567', debt:0, debt_cents:0, server_version:1 });
    expect(await db.table(STORES.CUSTOMERS).get('legacy')).toMatchObject({ name:'Cloud name', debt:'123.45', debtCents:12345, creditMigrationStatus:'PENDING_AUTHORIZATION' });
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({ amountCents:12345, originalCustomer:{name:'Original',debt:'123.45'} });
  });
  it('does not replace unresolved local debt even when Cloud has a nonzero ledger', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45' });
    await customerLocalRepository.applyCloudCustomer({ id:'legacy', name:'Updated', debt:50, debt_cents:5000 });
    expect((await db.table(STORES.CUSTOMERS).get('legacy')).debt).toBe('123.45');
  });
  it('applies ordinary Cloud financial projections without classifying them as Local history', async () => {
    await customerLocalRepository.applyCloudCustomer({ id:'cloud', name:'Cloud', debt:50, debt_cents:5000 });
    await customerLocalRepository.applyCloudCustomer({ id:'cloud', name:'Cloud', debt:25, debt_cents:2500 });
    expect((await db.table(STORES.CUSTOMERS).get('cloud')).debt).toBe(25);
    expect(await historicalCreditSnapshot.list()).toEqual([]);
  });
  it('keeps original and current balance when local activity follows the snapshot', async () => {
    await db.table(STORES.CUSTOMERS).put({ id:'legacy', name:'Original', debt:'123.45' });
    await historicalCreditSnapshot.preserveAll();
    await db.table(STORES.CUSTOMERS).update('legacy', { debt:'100' });
    expect(await historicalCreditSnapshot.saveResult('legacy',{status:'IMPORTED',ledger_id:'receipt'})).toMatchObject({status:'CONFLICT_LOCAL_ACTIVITY',cloudStatus:'IMPORTED'});
    await customerLocalRepository.applyCloudCustomer({ id:'legacy',name:'Cloud',debt:123.45,debt_cents:12345 });
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
    await customerLocalRepository.applyCloudCustomer({id:'cloud-old',name:'Cloud',debt:50,debt_cents:5000});
    expect((await db.table(STORES.CUSTOMERS).get('cloud-old')).debt).toBe(50);
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({status:'CLOUD_PROJECTION',originalCustomer:{debt:'80'}});
  });
  it('preserves a new Local period after earlier Cloud synchronization', async () => {
    await customerLocalRepository.applyCloudCustomer({id:'returning',name:'Cloud',debt:50,debt_cents:5000});
    await db.table(STORES.CUSTOMERS).update('returning',{debt:'70',financialSource:'local'});
    await customerLocalRepository.applyCloudCustomer({id:'returning',name:'Cloud updated',debt:50,debt_cents:5000});
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
    await customerLocalRepository.applyCloudCustomer({id:'legacy',name:'Cloud',debt:90,debt_cents:9000});
    expect((await db.table(STORES.CUSTOMERS).get('legacy')).debt).toBe(90);
    expect((await historicalCreditSnapshot.list())[0].status).toBe('IMPORTED');
  });
});
