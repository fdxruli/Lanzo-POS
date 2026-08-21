import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { LanzoDatabase, STORES } from '../../db/dexie';

const names = [];
const ledgerSchema = 'id, &idempotencyKey, status, operationType, createdAt, updatedAt, originActorKey, cashSessionId, [status+updatedAt], [originActorKey+status]';

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('financial intent Dexie schema', () => {
  it('registers the tenant-owned ledger with its unique K index on a fresh canonical database', async () => {
    const name = `lanzo-financial-fresh-${crypto.randomUUID()}`;
    names.push(name);
    const database = new LanzoDatabase(name);
    await database.open();
    expect(database.tables.map((table) => table.name)).toContain(STORES.FINANCIAL_INTENTS);
    expect(database.table(STORES.FINANCIAL_INTENTS).schema.idxByName.idempotencyKey.unique).toBe(true);
    expect(database.table(STORES.FINANCIAL_INTENTS).schema.idxByName['[status+updatedAt]']).toBeDefined();
    database.close();
  });

  it('upgrades a v23 tenant database additively without rewriting existing business rows', async () => {
    const name = `lanzo-financial-v23-${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(23).stores({ sales: 'id, timestamp', menu: 'id' });
    await legacy.open();
    await legacy.table('sales').put({ id: 'sale-a', timestamp: '2026-08-21T00:00:00.000Z', total: '100' });
    await legacy.table('menu').put({ id: 'product-a', name: 'Existing product' });
    legacy.close();

    const upgraded = new Dexie(name);
    upgraded.version(23).stores({ sales: 'id, timestamp', menu: 'id' });
    upgraded.version(24).stores({ [STORES.FINANCIAL_INTENTS]: ledgerSchema });
    await upgraded.open();
    await expect(upgraded.table('sales').get('sale-a')).resolves.toMatchObject({ total: '100' });
    await expect(upgraded.table('menu').get('product-a')).resolves.toMatchObject({ name: 'Existing product' });
    await upgraded.table(STORES.FINANCIAL_INTENTS).add({ id: 'intent-a', idempotencyKey: 'k-a', status: 'PREPARED' });
    await expect(upgraded.table(STORES.FINANCIAL_INTENTS).add({ id: 'intent-b', idempotencyKey: 'k-a', status: 'PREPARED' })).rejects.toThrow();
    upgraded.close();
  });
});
