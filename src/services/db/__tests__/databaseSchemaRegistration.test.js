import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_TENANT_BINDING_DEXIE_VERSION,
  POS_SYNC_DEXIE_VERSION,
  PRIMARY_KEY_RECOVERY_DEXIE_VERSION,
  RECOVERY_STORES,
  registerCanonicalDexieExtensions
} from '../databaseSchema';

const names = [];
const stores = {
  SALES: 'sales',
  DELETED_SALES: 'deleted_sales'
};

const baseSchema = {
  sales: 'id, timestamp',
  deleted_sales: 'id, deletedAt'
};

const describeSchema = (database) => ({
  versions: database._versions.map((version) => version._cfg.version).sort((a, b) => a - b),
  tables: database.tables.map((table) => table.name).sort(),
  salesIndexes: Object.keys(database.table('sales').schema.idxByName).sort()
});

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('canonical Dexie registration', () => {
  it('produces the same declared schema regardless of registration order', async () => {
    const firstName = `lanzo-order-first-${crypto.randomUUID()}`;
    const secondName = `lanzo-order-second-${crypto.randomUUID()}`;
    names.push(firstName, secondName);

    const first = new Dexie(firstName);
    first.version(23).stores(baseSchema);
    registerCanonicalDexieExtensions(first, stores);

    const second = new Dexie(secondName);
    registerCanonicalDexieExtensions(second, stores);
    second.version(23).stores(baseSchema);

    await first.open();
    await second.open();

    const firstDescription = describeSchema(first);
    const secondDescription = describeSchema(second);

    expect(firstDescription).toEqual(secondDescription);
    expect(firstDescription.versions).toContain(POS_SYNC_DEXIE_VERSION);
    expect(firstDescription.versions).toContain(PRIMARY_KEY_RECOVERY_DEXIE_VERSION);
    expect(firstDescription.versions).toContain(LOCAL_TENANT_BINDING_DEXIE_VERSION);
    expect(firstDescription.tables).toEqual(expect.arrayContaining([
      'sales',
      'deleted_sales',
      'sync_outbox',
      'sync_meta',
      'sync_conflicts',
      RECOVERY_STORES.SALES_BACKUP,
      RECOVERY_STORES.DELETED_SALES_BACKUP,
      RECOVERY_STORES.META,
      'local_tenant_binding'
    ]));
    expect(first.table('sales').schema.primKey.keyPath).toBe('id');
    expect(second.table('sales').schema.primKey.keyPath).toBe('id');

    first.close();
    second.close();
  });

  it('adds the tenant binding store to a v30 database without changing tenant data', async () => {
    const name = `lanzo-v30-to-v31-${crypto.randomUUID()}`;
    names.push(name);
    const v30Schema = {
      menu: 'id',
      customers: 'id',
      sales: 'id, timestamp',
      deleted_sales: 'id, deletedAt',
      sync_outbox: 'id, status, createdAt, [status+createdAt]',
      sync_meta: 'key',
      sync_conflicts: 'id',
      [RECOVERY_STORES.SALES_BACKUP]: 'legacyKey',
      [RECOVERY_STORES.DELETED_SALES_BACKUP]: 'legacyKey',
      [RECOVERY_STORES.META]: 'key'
    };

    const legacy = new Dexie(name);
    legacy.version(PRIMARY_KEY_RECOVERY_DEXIE_VERSION).stores(v30Schema);
    await legacy.open();
    await legacy.table('menu').put({ id: 'product-a', name: 'Synthetic product' });
    await legacy.table('customers').put({ id: 'customer-a', name: 'Synthetic customer' });
    legacy.close();

    const upgraded = new Dexie(name);
    upgraded.version(PRIMARY_KEY_RECOVERY_DEXIE_VERSION).stores(v30Schema);
    upgraded.version(LOCAL_TENANT_BINDING_DEXIE_VERSION).stores({
      local_tenant_binding: 'key'
    });
    await upgraded.open();

    await expect(upgraded.table('menu').get('product-a')).resolves.toMatchObject({
      name: 'Synthetic product'
    });
    await expect(upgraded.table('customers').get('customer-a')).resolves.toMatchObject({
      name: 'Synthetic customer'
    });
    await expect(upgraded.table('local_tenant_binding').count()).resolves.toBe(0);
    upgraded.close();
  });
});
