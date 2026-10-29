import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createHistoricalCreditSnapshotRepository } from '../historicalCreditSnapshot';

let database;
let repository;
beforeEach(async () => {
  database = new Dexie(`historical-fixture-${crypto.randomUUID()}`);
  database.version(1).stores({ customers: 'id', sync_cache: 'key' });
  await database.open();
  repository = createHistoricalCreditSnapshotRepository(database, () => ['synthetic-tenant']);
  await database.table('customers').add({ id: 'a', name: 'Synthetic', debt: '125.01', syncStatus: 'local' });
});
afterEach(async () => { await database.delete(); });

describe('durable historical credit snapshots using real Dexie', () => {
  it('opens an old schema without adding stores and preserves cents and identity', async () => {
    await repository.preserveAll();
    expect(database.verno).toBe(1);
    expect((await repository.list())[0]).toMatchObject({ amountCents: 12501, customerId: 'a', tenant: ['synthetic-tenant'], status: 'PENDING_AUTHORIZATION' });
  });
  it('retains the original after overwrite, close and reopen', async () => {
    await repository.preserveAll();
    await database.table('customers').update('a', { debt: 0, name: 'Cloud' });
    database.close();
    await database.open();
    await repository.preserveAll();
    expect((await repository.list())[0].originalCustomer).toMatchObject({ debt: '125.01', name: 'Synthetic' });
  });
  it('rolls back snapshot and customer together on interrupted apply', async () => {
    await expect(database.transaction('rw', database.table('customers'), database.table('sync_cache'), async () => {
      await repository.preserveInTransaction(await database.table('customers').get('a'));
      await database.table('customers').update('a', { debt: 0 });
      throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    expect(await repository.list()).toEqual([]);
    expect((await database.table('customers').get('a')).debt).toBe('125.01');
  });
  it('preserves original source through conflict and safe retry', async () => {
    await repository.preserveAll();
    const original = (await repository.list())[0];
    await repository.saveResult('a', { status: 'CONFLICT_EXISTING_CLOUD_LEDGER' });
    await repository.preserveAll();
    expect((await repository.list())[0]).toMatchObject({ ...original, status: 'CONFLICT_EXISTING_CLOUD_LEDGER' });
    await repository.saveResult('a', { status: 'IMPORTED', ledger_id: 'receipt' });
    expect((await repository.list())[0].originalCustomer.debt).toBe('125.01');
  });
  it('serializes concurrent preservation without changing source', async () => {
    await Promise.all([repository.preserveAll(), repository.preserveAll()]);
    expect(await repository.list()).toHaveLength(1);
  });
  it('does not classify known Cloud debt as new historical debt', async () => {
    await database.table('customers').update('a', { financialSource: 'cloud' });
    await repository.preserveAll();
    expect(await repository.list()).toEqual([]);
  });
});
