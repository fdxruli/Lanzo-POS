import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalTenantGuard,
  resolveActiveTenantIdentity
} from '../localTenantGuard';
import {
  LOCAL_TENANT_BINDING_STORE,
  createLocalTenantAccessController,
  installLocalTenantDbMiddleware
} from '../localTenantPolicy';

const databases = [];

const createMemoryStorage = () => {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear()
  };
};

const createDatabase = async ({
  browserStorage = null,
  tenantSessionStorage = null
} = {}) => {
  const name = `lanzo-tenant-guard-${crypto.randomUUID()}`;
  const database = new Dexie(name);
  database.version(1).stores({
    menu: 'id',
    product_batches: 'id',
    customers: 'id',
    sales: 'id',
    company: 'id',
    sync_cache: 'key',
    sync_outbox: 'id',
    sync_meta: 'key',
    sync_conflicts: 'id',
    [LOCAL_TENANT_BINDING_STORE]: 'key'
  });

  const controller = createLocalTenantAccessController();
  installLocalTenantDbMiddleware(database, controller);
  await database.open();
  databases.push(database);

  return {
    database,
    controller,
    guard: createLocalTenantGuard({
      database,
      controller,
      browserStorage,
      tenantSessionStorage
    })
  };
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    const name = database.name;
    database.close();
    await Dexie.delete(name);
  }));
});

describe('LocalTenantGuard', () => {
  it('keeps sync fail-closed until the production guard is initialized and granted', async () => {
    const { guard } = await createDatabase();

    await expect(
      guard.assertLocalTenantSyncAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });

    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    await expect(
      guard.assertLocalTenantSyncAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
  });

  it('binds a new empty database and stores only a SHA-256 identity', async () => {
    const { database, guard } = await createDatabase();
    guard.initialize();

    const result = await guard.assertLocalTenantAccess({ license_key: 'TENANT-A-SECRET' });
    const binding = await guard.getLocalTenantBinding();

    expect(result.status).toBe('bound');
    expect(binding.authority).toBe('license_key_sha256');
    expect(binding.tenantIdentity).toMatch(/^license-key-sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(binding)).not.toContain('TENANT-A-SECRET');

    await database.table('menu').put({ id: 'product-a', name: 'Producto A' });
    await expect(database.table('menu').get('product-a')).resolves.toMatchObject({ id: 'product-a' });
  });

  it('passes the same tenant across admin/staff actor changes and offline reuse', async () => {
    const { database, guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A', device_role: 'admin' });
    await database.table('menu').put({ id: 'product-a' });

    guard.lock('actor_logout');
    await expect(database.table('menu').toArray()).rejects.toMatchObject({
      code: 'LOCAL_TENANT_ACCESS_REQUIRED'
    });

    await expect(guard.assertLocalTenantAccess({
      license_key: 'TENANT-A',
      device_role: 'staff'
    })).resolves.toMatchObject({ status: 'pass' });
    await expect(database.table('menu').toArray()).resolves.toHaveLength(1);
  });

  it('rejects a mixed identity when one alias matches but another contradicts', async () => {
    const { guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({
      license_id: 'license-a',
      license_key: 'TENANT-A'
    });
    guard.lock('logout');

    await expect(guard.assertLocalTenantAccess({
      license_id: 'license-a',
      license_key: 'TENANT-B'
    })).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { reason: 'bound_tenant_mismatch' }
    });
    expect(guard.getState().status).toBe('mismatch');
  });

  it('auto-enables and grants when assert is called against an existing binding', async () => {
    const { guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    guard.reset();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
    expect(guard.getState()).toMatchObject({ enabled: true, status: 'granted' });
  });

  it('blocks A to B before business data or outbox can be read and preserves A', async () => {
    const { database, guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    await Promise.all([
      database.table('menu').put({ id: 'product-a' }),
      database.table('product_batches').put({ id: 'batch-a', productId: 'product-a' }),
      database.table('customers').put({ id: 'customer-a' }),
      database.table('sales').put({ id: 'sale-a' }),
      database.table('company').put({ id: 'company:TENANT-A', license_key: 'TENANT-A' }),
      database.table('sync_outbox').put({
        id: 'operation-a',
        licenseKey: 'TENANT-A',
        status: 'pending'
      })
    ]);

    guard.lock('logout');
    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_MISMATCH' });

    for (const storeName of [
      'menu',
      'product_batches',
      'customers',
      'sales',
      'company',
      'sync_outbox'
    ]) {
      await expect(database.table(storeName).toArray()).rejects.toMatchObject({
        code: 'LOCAL_TENANT_MISMATCH'
      });
    }

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
    await expect(database.table('menu').get('product-a')).resolves.toBeTruthy();
    await expect(database.table('product_batches').get('batch-a')).resolves.toBeTruthy();
    await expect(database.table('customers').get('customer-a')).resolves.toBeTruthy();
    await expect(database.table('sales').get('sale-a')).resolves.toBeTruthy();
    await expect(database.table('sync_outbox').get('operation-a')).resolves.toMatchObject({
      status: 'pending',
      licenseKey: 'TENANT-A'
    });
  });

  it('keeps an existing binding sticky even when the database is empty', async () => {
    const { guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    guard.lock('logout');

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { reason: 'bound_tenant_mismatch' }
    });

    const expected = await resolveActiveTenantIdentity({ license_key: 'TENANT-A' });
    const binding = await guard.getLocalTenantBinding();
    expect(binding.tenantAliases).toContain(expected.primary);
  });

  it('does not call a database empty while a tenant-owned browser cache has data', async () => {
    const browserStorage = createMemoryStorage();
    const { guard } = await createDatabase({ browserStorage });
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    browserStorage.setItem('lanzo-active-orders-storage', JSON.stringify({
      state: {
        activeOrders: [['order-a', { id: 'order-a', items: [{ id: 'product-a' }] }]],
        currentOrderId: 'order-a'
      },
      version: 0
    }));
    guard.lock('logout');

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { occupiedStores: ['localStorage:lanzo-active-orders-storage'] }
    });

    expect(browserStorage.getItem('lanzo-active-orders-storage')).toContain('order-a');
  });

  it('does not let empty serialized browser caches weaken a sticky binding', async () => {
    const browserStorage = createMemoryStorage();
    const { guard } = await createDatabase({ browserStorage });
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    browserStorage.setItem('lanzo-active-orders-storage', JSON.stringify({
      state: { activeOrders: [], currentOrderId: null },
      version: 0
    }));
    guard.lock('logout');

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { reason: 'bound_tenant_mismatch' }
    });
  });

  it('does not rebind an empty database while another tenant sync operation is active', async () => {
    const { guard } = await createDatabase();
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    const lease = await guard.acquireLocalTenantSyncLease(
      { license_key: 'TENANT-A' },
      { reason: 'synthetic_delayed_pull' }
    );

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { reason: 'tenant_transition_during_active_sync' }
    });

    lease.release();
    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { reason: 'bound_tenant_mismatch' }
    });
  });

  it('fails closed for legacy browser business data without a database binding', async () => {
    const browserStorage = createMemoryStorage();
    browserStorage.setItem('lanzo:restaurant-order-close-pending:v1', JSON.stringify([
      { localOrderId: 'synthetic-order-a' }
    ]));
    const { guard } = await createDatabase({ browserStorage });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: {
        occupiedStores: ['localStorage:lanzo:restaurant-order-close-pending:v1']
      }
    });
  });

  it('fails closed when browser business storage cannot be inspected', async () => {
    const browserStorage = {
      get length() { throw new Error('denied'); },
      key: () => null,
      getItem: () => null
    };
    const { guard } = await createDatabase({ browserStorage });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_STORAGE_INSPECTION_FAILED',
      details: { reason: 'local_storage_enumeration_failed' }
    });
    expect(guard.getState().status).toBe('legacy_unresolved');
  });

  it('treats a persisted Drive credential as tenant-sensitive session state', async () => {
    const tenantSessionStorage = createMemoryStorage();
    const { guard } = await createDatabase({ tenantSessionStorage });
    guard.initialize();
    await guard.assertLocalTenantAccess({ license_key: 'TENANT-A' });
    tenantSessionStorage.setItem('lanzo_drive_session:v1', JSON.stringify({
      accessToken: 'synthetic-token',
      expiresAt: Date.now() + 60_000
    }));
    guard.lock('logout');

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_MISMATCH',
      details: { occupiedStores: ['sessionStorage:lanzo_drive_session:v1'] }
    });
  });

  it('backfills a legacy database only from unambiguous durable evidence', async () => {
    const { database, guard } = await createDatabase();
    await database.table('company').put({
      id: 'company:TENANT-A',
      license_key: 'TENANT-A',
      name: 'Synthetic A'
    });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_MISMATCH' });

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
    expect((await guard.getLocalTenantBinding()).source).toBe('legacy_internal_evidence');
  });

  it.each([
    ['sync_cache', { key: 'admin_session_token', value: 'synthetic-token' }],
    ['sync_outbox', { id: 'legacy-operation', status: 'pending' }],
    ['sync_meta', { key: 'pos_sync_enabled', value: true }]
  ])('does not adopt a legacy company when %s remains unscoped', async (storeName, record) => {
    const { database, guard } = await createDatabase();
    await database.table('company').put({
      id: 'company:TENANT-A',
      license_key: 'TENANT-A',
      name: 'Synthetic A'
    });
    await database.table(storeName).put(record);
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: {
        reason: 'unverifiable_legacy_tenant_data',
        unscopedLegacyStores: [storeName]
      }
    });
    expect(await guard.getLocalTenantBinding()).toBeNull();
  });

  it('ignores only allowlisted device cache rows during narrow legacy adoption', async () => {
    const { database, guard } = await createDatabase();
    await database.table('company').put({
      id: 'company:TENANT-A',
      license_key: 'TENANT-A',
      name: 'Synthetic A'
    });
    await database.table('sync_cache').bulkPut([
      { key: 'lanzo_device_id', value: 'synthetic-device' },
      { key: 'lanzo_license_attempts', value: { count: 2 } }
    ]);
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'legacy_backfilled' });
    expect((await guard.getLocalTenantBinding()).source).toBe('legacy_internal_evidence');
  });

  it('fails closed for a legacy database with data but no tenant evidence', async () => {
    const { database, guard } = await createDatabase();
    await database.table('menu').put({ id: 'orphan-product' });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_LEGACY_UNRESOLVED' });
    expect(await guard.getLocalTenantBinding()).toBeNull();
  });

  it('does not adopt legacy business data from a devices cache key alone', async () => {
    const { database, guard } = await createDatabase();
    await database.table('menu').put({ id: 'product-a' });
    await database.table('sync_cache').put({ key: 'devices_TENANT-B', value: [] });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: { reason: 'unverifiable_legacy_tenant_data' }
    });
    expect(await guard.getLocalTenantBinding()).toBeNull();
  });

  it('does not adopt unscoped legacy rows from a mutable company profile', async () => {
    const { database, guard } = await createDatabase();
    await database.table('menu').put({ id: 'product-a' });
    await database.table('company').bulkPut([
      { id: 'company', license_key: 'TENANT-B', name: 'Mutable alias B' },
      { id: 'company:TENANT-B', license_key: 'TENANT-B', name: 'Scoped B' }
    ]);
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: { reason: 'unverifiable_legacy_tenant_data' }
    });
    expect(await guard.getLocalTenantBinding()).toBeNull();
    guard.reset();
    expect(await database.table('menu').get('product-a')).toEqual({ id: 'product-a' });
  });

  it('keeps device identity/rate-limit records available while tenant records are locked', async () => {
    const { database, guard } = await createDatabase();
    guard.initialize();

    await expect(database.table('sync_cache').put({
      key: 'lanzo_device_id',
      value: 'synthetic-device'
    })).resolves.toBe('lanzo_device_id');
    await expect(database.table('sync_cache').get('lanzo_device_id')).resolves.toMatchObject({
      value: 'synthetic-device'
    });

    await expect(database.table('sync_cache').get('device_security_token')).rejects.toMatchObject({
      code: 'LOCAL_TENANT_ACCESS_REQUIRED'
    });
  });

  it('allows only native versionchange work while the database is locked', () => {
    const controller = createLocalTenantAccessController();
    controller.enable('synthetic_upgrade');

    expect(() => controller.assertDatabaseAccess('menu', 'mutate', {
      trans: { mode: 'readwrite' },
      type: 'put',
      values: [{ id: 'product-a' }]
    })).toThrowError(expect.objectContaining({ code: 'LOCAL_TENANT_ACCESS_REQUIRED' }));

    expect(controller.assertDatabaseAccess('menu', 'mutate', {
      trans: { mode: 'versionchange' },
      type: 'put',
      values: [{ id: 'legacy-upgrade-row' }]
    })).toBe(true);
  });

  it('treats conflicting legacy evidence as unresolved', async () => {
    const { database, guard } = await createDatabase();
    await database.table('company').bulkPut([
      { id: 'company:TENANT-A', license_key: 'TENANT-A' },
      { id: 'company:TENANT-B', license_key: 'TENANT-B' }
    ]);
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: { reason: 'conflicting_legacy_tenant_evidence' }
    });
  });
});
