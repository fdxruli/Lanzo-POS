import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_TENANT_BINDING_DEXIE_VERSION,
  FINANCIAL_INTENT_DEXIE_VERSION,
  POS_SYNC_DEXIE_VERSION,
  PRIMARY_KEY_RECOVERY_DEXIE_VERSION,
  RECOVERY_STORES,
  registerCanonicalDexieExtensions
} from '../databaseSchema';
import {
  createCanonicalLanzoDatabase,
  LanzoDatabase,
  STORES
} from '../dexie';

const names = [];
const stores = {
  SALES: 'sales',
  DELETED_SALES: 'deleted_sales',
  FINANCIAL_INTENTS: 'financial_intents'
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
  it('reuses the production declarations for an explicitly named canonical database', async () => {
    const productionStyleName = `lanzo-production-style-${crypto.randomUUID()}`;
    const destinationName = `lanzo-destination-style-${crypto.randomUUID()}`;
    names.push(productionStyleName, destinationName);

    const productionStyle = new LanzoDatabase(productionStyleName);
    registerCanonicalDexieExtensions(productionStyle, STORES);
    const destination = createCanonicalLanzoDatabase(destinationName);
    await productionStyle.open();
    await destination.open();

    const describe = (database) => database.tables.map((table) => ({
      name: table.name,
      primaryKey: table.schema.primKey.keyPath,
      autoIncrement: table.schema.primKey.auto,
      indexes: table.schema.indexes.map((index) => ({
        name: index.name,
        keyPath: index.keyPath,
        unique: index.unique,
        multiEntry: index.multi
      })).sort((left, right) => left.name.localeCompare(right.name))
    })).sort((left, right) => left.name.localeCompare(right.name));

    expect(describe(destination)).toEqual(describe(productionStyle));
    expect(destination.verno).toBe(productionStyle.verno);
    productionStyle.close();
    destination.close();
  });

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
    expect(firstDescription.versions).toContain(FINANCIAL_INTENT_DEXIE_VERSION);
    expect(firstDescription.tables).toEqual(expect.arrayContaining([
      'sales',
      'deleted_sales',
      'sync_outbox',
      'sync_meta',
      'sync_conflicts',
      RECOVERY_STORES.SALES_BACKUP,
      RECOVERY_STORES.DELETED_SALES_BACKUP,
      RECOVERY_STORES.META,
      'local_tenant_binding',
      'financial_intents'
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

  it('migrates cash identity metadata deterministically and preserves unresolved legacy rows', async () => {
    const name = `lanzo-v31-to-v32-cash-${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(31).stores({
      sales: 'id, timestamp',
      deleted_sales: 'id, deletedAt',
      cajas: 'id, estado, fecha_apertura',
      movimientos_caja: 'id, caja_id, cash_session_id, fecha',
      local_tenant_binding: 'key'
    });
    await legacy.open();
    await legacy.table('cajas').bulkPut([
      {
        id: 'cash-device-bound',
        estado: 'abierta',
        fecha_apertura: '2026-08-19T10:00:00.000Z',
        actorKey: 'admin:a',
        deviceId: 'device-a'
      },
      {
        id: 'cash-legacy-unresolved',
        estado: 'cerrada',
        fecha_apertura: '2026-08-18T10:00:00.000Z',
        actorKey: 'staff:x'
      }
    ]);
    await legacy.table('movimientos_caja').put({
      id: 'movement-device-bound',
      caja_id: 'cash-device-bound',
      cash_session_id: 'cash-device-bound',
      fecha: '2026-08-19T11:00:00.000Z',
      actorKey: 'admin:a'
    });
    legacy.close();

    const upgraded = createCanonicalLanzoDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(FINANCIAL_INTENT_DEXIE_VERSION);
    await expect(upgraded.table('cajas').get('cash-device-bound')).resolves.toMatchObject({
      cashStationId: 'local:device:device-a',
      cashIdentityState: 'deterministic-device-bound',
      originActorKey: 'admin:a',
      openedByActorKey: 'admin:a'
    });
    await expect(upgraded.table('movimientos_caja').get('movement-device-bound')).resolves.toMatchObject({
      cashStationId: 'local:device:device-a',
      originActorKey: 'admin:a'
    });
    await expect(upgraded.table('cajas').get('cash-legacy-unresolved')).resolves.toMatchObject({
      cashIdentityState: 'legacy_unresolved'
    });
    await expect(upgraded.table('cajas').get('cash-legacy-unresolved')).resolves.not.toHaveProperty('cashStationId');
    upgraded.close();
  });
});
