import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalTenantGuard,
  resolveActiveTenantIdentity
} from '../localTenantGuard';
import {
  LOCAL_TENANT_BINDING_STORE,
  createLocalTenantAccessController,
  installLocalTenantDbMiddleware
} from '../localTenantPolicy';
import {
  clearActiveTenantStorageNamespace,
  inspectActiveTenantStorageSnapshot,
  setActiveTenantStorageNamespace
} from '../tenantScopedStorage';

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
  tenantSessionStorage = null,
  activeTenantStorageInspector = null
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
      tenantSessionStorage,
      activeTenantStorageInspector
    })
  };
};

const seedLegacyBusiness = async (database, tenant = 'TENANT-A') => {
  await Promise.all([
    database.table('menu').put({ id: 'product-a', name: 'Producto A' }),
    database.table('product_batches').put({ id: 'batch-a', productId: 'product-a' }),
    database.table('customers').put({ id: 'customer-a', name: 'Cliente A' }),
    database.table('sales').put({ id: 'sale-a', total: 100 }),
    database.table('company').put({
      id: `company:${tenant}`,
      license_key: tenant,
      name: 'Negocio histórico'
    }),
    database.table('sync_outbox').put({
      id: 'pending-a',
      licenseKey: tenant,
      status: 'pending'
    }),
    database.table('sync_meta').put({
      key: `${tenant}:pos_last_change_seq`,
      value: 42
    })
  ]);
};

afterEach(async () => {
  clearActiveTenantStorageNamespace();
  await Promise.all(databases.splice(0).map(async (database) => {
    const name = database.name;
    database.close();
    await Dexie.delete(name);
  }));
});

describe('LocalTenantGuard', () => {
  it('binds A and B isolated databases without reading or adopting legacy unscoped storage', async () => {
    const aOpaqueId = 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bOpaqueId = 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const legacyKey = 'lanzo-active-orders-storage';
    const legacyPayload = JSON.stringify({ state: { activeOrders: [['legacy', { id: 'legacy' }]] } });
    const browserStorage = createMemoryStorage();
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: browserStorage } });
    try {
      browserStorage.setItem(legacyKey, legacyPayload);

      setActiveTenantStorageNamespace(aOpaqueId);
      const a = await createDatabase({ activeTenantStorageInspector: inspectActiveTenantStorageSnapshot });
      a.guard.initialize();
      await expect(a.guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })).resolves.toMatchObject({ status: 'bound' });
      const aBinding = await a.guard.getLocalTenantBinding();
      const aScopedKey = `lanzo:t:${aOpaqueId}:active-orders`;
      browserStorage.setItem(aScopedKey, 'A-payload');
      expect(browserStorage.getItem(legacyKey)).toBe(legacyPayload);

      clearActiveTenantStorageNamespace();
      setActiveTenantStorageNamespace(bOpaqueId);
      const b = await createDatabase({ activeTenantStorageInspector: inspectActiveTenantStorageSnapshot });
      b.guard.initialize();
      await expect(b.guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })).resolves.toMatchObject({ status: 'bound' });
      expect((await b.guard.inspectTenantOwnedLocalData()).occupiedStores).toEqual([]);
      expect(await b.guard.getLocalTenantBinding()).not.toEqual(aBinding);
      expect(browserStorage.getItem(legacyKey)).toBe(legacyPayload);
      expect(browserStorage.getItem(`lanzo:t:${bOpaqueId}:active-orders`)).toBeNull();

      clearActiveTenantStorageNamespace();
      setActiveTenantStorageNamespace(aOpaqueId);
      await expect(a.guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })).resolves.toMatchObject({ status: 'pass' });
      expect((await a.guard.inspectTenantOwnedLocalData()).occupiedStores).toEqual([`localStorage:${aScopedKey}`]);
      expect(browserStorage.getItem(legacyKey)).toBe(legacyPayload);
    } finally {
      clearActiveTenantStorageNamespace();
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
      else delete globalThis.window;
    }
  });

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

  it('reports an anonymized, read-only topology for conflicting legacy ownership', async () => {
    const { database, guard } = await createDatabase();
    await database.table('menu').put({ id: 'product-a', name: 'Producto A privado' });
    await database.table('company').bulkPut([
      { id: 'company:TOP-SECRET-A', license_key: 'TOP-SECRET-A', name: 'Farmacia privada A' },
      { id: 'company:TOP-SECRET-C', license_key: 'TOP-SECRET-C', name: 'Farmacia privada C' },
      { id: 'company:TOP-SECRET-MISMATCH', license_key: 'TOP-SECRET-OTHER', name: 'Conflicto' },
      { id: 'company', name: 'Perfil legacy sin scope' }
    ]);
    await database.table('sync_meta').bulkPut([
      { key: 'TOP-SECRET-A:pos_last_change_seq', value: 42 },
      { key: 'TOP-SECRET-C:pos_sync_enabled', value: true },
      { key: 'pos_sync_enabled', value: true }
    ]);
    await database.table('sync_outbox').put({
      id: 'outbox-private-b',
      licenseKey: 'TOP-SECRET-B',
      status: 'pending',
      payload: { customer: 'No exponer' }
    });
    await database.table('sync_cache').bulkPut([
      { key: 'devices_TOP-SECRET-D', value: [] },
      { key: 'last_valid_license_state', value: { payload: { license_key: 'TOP-SECRET-E' } } }
    ]);

    const nativeDatabase = database.backendDB();
    const nativeTransaction = nativeDatabase.transaction.bind(nativeDatabase);
    const transactionModes = [];
    vi.spyOn(nativeDatabase, 'transaction').mockImplementation((...args) => {
      transactionModes.push(args[1]);
      return nativeTransaction(...args);
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const countsBefore = {
      menu: await database.table('menu').count(),
      company: await database.table('company').count(),
      outbox: await database.table('sync_outbox').count(),
      bindings: await database.table(LOCAL_TENANT_BINDING_STORE).count()
    };

    const diagnostic = await guard.inspectLocalTenantDiagnostic({ license_key: 'TOP-SECRET-A' });

    expect(diagnostic).toMatchObject({
      diagnosticVersion: 2,
      binding: { present: false },
      tenantOwnedData: true,
      ownershipSourceTypes: ['company_scoped', 'sync_meta', 'sync_outbox'],
      ownershipCandidateCount: 3,
      ownershipSourceTypeCount: 3,
      decision: 'LEGACY_UNRESOLVED',
      reason: 'conflicting_legacy_tenant_evidence',
      companyRecords: {
        total: 4,
        scopedRecords: 3,
        unscopedRecords: 1,
        scopedCandidateCount: 2
      },
      syncMeta: { unscopedRecordCount: 1 },
      auxiliaryCandidateCount: 4
    });
    expect(diagnostic.recordCounts).toMatchObject({ company: 4, menu: 1, sync_outbox: 1, sync_meta: 3 });
    expect(diagnostic.ownershipCandidates).toHaveLength(3);
    expect(diagnostic.ownershipCandidates.filter((candidate) => candidate.matchesActiveLicense)).toHaveLength(1);
    expect(diagnostic.ownershipCandidates.filter((candidate) => candidate.sourceTypeCount === 2)).toHaveLength(2);
    expect(diagnostic.ownershipCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTypes: ['company_scoped', 'sync_meta'],
        sourceRecordCounts: { company_scoped: 1, sync_outbox: 0, sync_meta: 1 },
        earliestEvidenceAt: null,
        latestEvidenceAt: null
      }),
      expect.objectContaining({
        sourceTypes: ['sync_outbox'],
        sourceRecordCounts: { company_scoped: 0, sync_outbox: 1, sync_meta: 0 },
        outboxRecordCount: 1
      })
    ]));
    expect(diagnostic.auxiliaryCandidates).toHaveLength(4);
    expect(diagnostic.auxiliaryCandidates.filter((candidate) => (
      candidate.sourceTypes.some((source) => source.startsWith('sync_cache.'))
    ))).toHaveLength(2);
    const serialized = JSON.stringify(diagnostic);
    for (const secret of [
      'TOP-SECRET-A',
      'TOP-SECRET-B',
      'TOP-SECRET-C',
      'TOP-SECRET-D',
      'TOP-SECRET-E',
      'Farmacia privada A',
      'Producto A privado',
      'No exponer',
      'license-key-sha256'
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(transactionModes).toEqual(['readonly']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await database.table('menu').count()).toBe(countsBefore.menu);
    expect(await database.table('company').count()).toBe(countsBefore.company);
    expect(await database.table('sync_outbox').count()).toBe(countsBefore.outbox);
    expect(await database.table(LOCAL_TENANT_BINDING_STORE).count()).toBe(countsBefore.bindings);
    expect(await database.table('company').get('company:TOP-SECRET-A')).toMatchObject({
      license_key: 'TOP-SECRET-A'
    });
  });

  it('reports no active match and safe chronology for a candidate with all ownership sources', async () => {
    const { database, guard } = await createDatabase();
    await database.table('menu').put({ id: 'product-a' });
    await database.table('company').put({
      id: 'company:TOPOLOGY-A',
      license_key: 'TOPOLOGY-A',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    await database.table('sync_meta').put({
      key: 'TOPOLOGY-A:pos_last_change_seq',
      value: 42,
      updatedAt: '2026-01-02T00:00:00.000Z'
    });
    await database.table('sync_outbox').put({
      id: 'topology-outbox-a',
      licenseKey: 'TOPOLOGY-A',
      status: 'completed',
      createdAt: '2026-01-03T00:00:00.000Z'
    });

    const diagnostic = await guard.inspectLocalTenantDiagnostic({ license_key: 'TOPOLOGY-NONE' });

    expect(diagnostic.ownershipCandidates).toEqual([
      expect.objectContaining({
        matchesActiveLicense: false,
        sourceTypes: ['company_scoped', 'sync_outbox', 'sync_meta'],
        sourceTypeCount: 3,
        companyScopedRecordCount: 1,
        outboxRecordCount: 1,
        scopedSyncMetaRecordCount: 1,
        earliestEvidenceAt: '2026-01-02T00:00:00.000Z',
        latestEvidenceAt: '2026-01-03T00:00:00.000Z'
      })
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain('TOPOLOGY-A');
    expect(JSON.stringify(diagnostic)).not.toContain('TOPOLOGY-NONE');

    const idOnlyDiagnostic = await guard.inspectLocalTenantDiagnostic({
      license_id: 'stable-license-id-without-key'
    });
    expect(idOnlyDiagnostic.ownershipCandidates[0].matchesActiveLicense).toBe('unknown');
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

  it('backfills a complete legacy business for its historical owner after blocking another tenant', async () => {
    const browserStorage = createMemoryStorage();
    const { database, guard } = await createDatabase({ browserStorage });
    await seedLegacyBusiness(database);
    browserStorage.setItem('lanzo:restaurant-order-close-pending:v1', JSON.stringify([
      { localOrderId: 'legacy-order-a' }
    ]));
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_MISMATCH' });

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
    expect((await guard.getLocalTenantBinding()).source).toBe('legacy_internal_evidence');
    await expect(database.table('menu').get('product-a')).resolves.toBeTruthy();
    await expect(database.table('product_batches').get('batch-a')).resolves.toBeTruthy();
    await expect(database.table('customers').get('customer-a')).resolves.toBeTruthy();
    await expect(database.table('sales').get('sale-a')).resolves.toBeTruthy();
    await expect(database.table('sync_outbox').get('pending-a')).resolves.toMatchObject({
      licenseKey: 'TENANT-A',
      status: 'pending'
    });
    expect(browserStorage.getItem('lanzo:restaurant-order-close-pending:v1')).toContain('legacy-order-a');

    guard.lock('logout');
    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-B' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_MISMATCH' });
    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'pass' });
  });

  it.each([
    ['sync_cache', { key: 'admin_session_token', value: 'synthetic-token' }],
    ['sync_outbox', { id: 'legacy-operation', status: 'pending' }],
    ['sync_meta', { key: 'pos_sync_enabled', value: true }]
  ])('preserves normal unscoped %s rows when durable legacy ownership has a quorum', async (storeName, record) => {
    const { database, guard } = await createDatabase();
    await seedLegacyBusiness(database);
    await database.table(storeName).put(record);
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).resolves.toMatchObject({ status: 'legacy_backfilled' });
    expect(await database.table(storeName).get(record.id || record.key)).toBeTruthy();
  });

  it('allows an offline legacy owner when the durable local ownership quorum matches', async () => {
    const { database, guard } = await createDatabase();
    await seedLegacyBusiness(database);
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
      details: { reason: 'missing_legacy_ownership_quorum' }
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
      details: { reason: 'missing_legacy_ownership_quorum' }
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
    await seedLegacyBusiness(database, 'TENANT-A');
    await database.table('sync_meta').put({
      key: 'TENANT-B:pos_last_change_seq',
      value: 17
    });
    guard.initialize();

    await expect(
      guard.assertLocalTenantAccess({ license_key: 'TENANT-A' })
    ).rejects.toMatchObject({
      code: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
      details: { reason: 'conflicting_legacy_tenant_evidence' }
    });
  });
});
