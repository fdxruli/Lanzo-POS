import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLegacyRecoveryPlan,
  createReadOnlyLegacyInspectionAdapter,
  inspectLegacyVaultAndBuildRecoveryPlan,
  summarizeLegacyRecoveryPlan
} from '../localTenantRecoveryPlan';

const databases = [];

const createDatabase = async () => {
  const database = new Dexie(`legacy-recovery-${crypto.randomUUID()}`);
  database.version(1).stores({
    menu: 'id',
    product_batches: 'id, productId',
    categories: 'id',
    images: 'id',
    ingredients: 'id',
    customers: 'id',
    customer_ledger: 'id, customerId',
    sales: 'id',
    cajas: 'id',
    movimientos_caja: 'id, caja_id',
    inventory_events: 'id, saleId, productId',
    transaction_log: 'id',
    waste_logs: 'id',
    daily_stats: 'id',
    global_stats: 'id',
    sequences: 'id',
    sync_outbox: 'id',
    sync_meta: 'key',
    sync_conflicts: 'id',
    sync_cache: 'key',
    company: 'id',
    local_tenant_binding: 'key',
    __lanzo_sales_backup_v30: 'legacyKey',
    __lanzo_deleted_sales_backup_v30: 'legacyKey',
    __lanzo_db_recovery: 'key',
    unknown_legacy_store: 'id'
  });
  await database.open();
  databases.push(database);
  return database;
};

const createReadOnlyStorage = (entries) => {
  const values = new Map(entries);
  return {
    get length() {
      return values.size;
    },
    key: vi.fn((index) => [...values.keys()][index] ?? null),
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  };
};

const createPhysicalUnmodeledStore = async (database) => {
  const name = database.name;
  const version = database.backendDB().version;
  database.close();
  const nativeDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version + 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('physical_unmodeled_store', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = nativeDatabase.transaction(['physical_unmodeled_store'], 'readwrite');
    transaction.objectStore('physical_unmodeled_store').put({ id: 'physical-row' });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return nativeDatabase;
};

const farmaciaGarySnapshot = () => ({
  sourceDatabase: 'LanzoDB1',
  recordsByStore: {
    menu: [{ id: 'legacy-menu', name: 'Producto histórico' }],
    customers: [{ id: 'legacy-customer', name: 'Cliente histórico' }],
    sales: [{ id: 'legacy-sale', total: 100 }],
    daily_stats: [{ id: '2026-08-11', total: 100 }],
    global_stats: [{ id: 'global', total: 100 }],
    sequences: [{ id: 'sales', value: 100 }],
    company: [
      { id: 'company:FOREIGN-A', license_key: 'FOREIGN-A' },
      { id: 'company:FOREIGN-B', license_key: 'FOREIGN-B' },
      { id: 'company:ACTIVE-C', license_key: 'ACTIVE-C' }
    ],
    sync_meta: [
      ...['pos_last_change_seq', 'pos_sync_enabled', 'pos_realtime_status', 'pos_last_pull_at']
        .map((suffix) => ({ key: `FOREIGN-A:${suffix}` })),
      ...['pos_last_change_seq', 'pos_sync_enabled', 'pos_realtime_status', 'pos_last_pull_at', 'pos_last_pull_error']
        .map((suffix, index) => ({ key: `ACTIVE-C:${suffix}`, updatedAt: `2026-08-0${index + 1}T00:00:00.000Z` }))
    ],
    sync_outbox: [
      { id: 'outbox-active-1', licenseKey: 'ACTIVE-C', entityType: 'product', entityId: 'missing-product', status: 'pending' },
      { id: 'outbox-active-2', licenseKey: 'ACTIVE-C', entityType: 'sale', entityId: 'missing-sale', status: 'synced' }
    ],
    sync_cache: [
      { key: 'devices_FOREIGN-A', data: [] },
      { key: 'devices_FOREIGN-AUX', data: [] }
    ]
  },
  localStorage: {
    'lanzo-active-orders-storage': '{"foreign":"data"}'
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map(async (database) => {
    const name = database.name;
    database.close();
    await Dexie.delete(name);
  }));
});

describe('local tenant recovery plan', () => {
  it('maps the Farmacia Gary topology without assigning whole-db ownership', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: farmaciaGarySnapshot(),
      activeTenantSource: { license_key: 'ACTIVE-C' }
    });

    expect(plan.evidence).toMatchObject({
      activeCandidateHasTierA: true,
      activeTierARecordCount: 2,
      wholeDatabaseOwnership: false
    });
    expect(plan.classifications.AMBIGUOUS).toBeGreaterThanOrEqual(4);
    expect(plan.classifications.FOREIGN).toBeGreaterThanOrEqual(6);
    expect(plan.classifications.DERIVED_RECOMPUTE).toBe(2);
    expect(plan.classifications.DO_NOT_MIGRATE).toBe(1);
    expect(plan.provenDirect).toHaveLength(2);
    expect(plan.quarantined.some((row) => row.store === 'sync_outbox')).toBe(true);
    expect(plan.provenDirect.every((row) => row.store === 'sync_outbox')).toBe(true);
    expect(plan.warnings).toContain('WHOLE_DATABASE_BINDING_FORBIDDEN');
    expect(summarizeLegacyRecoveryPlan(plan).automaticallyRecoverableCount).toBe(0);
    expect(JSON.stringify(plan)).not.toContain('ACTIVE-C');
    expect(JSON.stringify(plan)).not.toContain('FOREIGN-A');
  });

  it('keeps the old outbox operationally quarantined even when it is Tier A evidence', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: farmaciaGarySnapshot(),
      activeTenantSource: { license_key: 'ACTIVE-C' }
    });
    const outbox = plan.provenDirect.find((row) => row.store === 'sync_outbox');

    expect(outbox).toMatchObject({ destinationAction: 'QUARANTINE', tier: 'TIER_A' });
    expect(plan.storeSummaries.sync_outbox.destinationAction).toBe('QUARANTINE');
    expect(summarizeLegacyRecoveryPlan(plan).automaticallyRecoverableCount).toBe(0);
  });

  it('creates a non-destructive plan for FREE/offline legacy data with no tenant marker', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: {
          menu: [{ id: 'free-product' }],
          customers: [{ id: 'free-customer' }],
          sales: [{ id: 'free-sale' }]
        },
        localStorage: {}
      },
      activeTenantSource: { license_key: 'FREE-ACTIVE' }
    });

    expect(plan.status).toBe('PLAN_CREATED');
    expect(plan.classifications.AMBIGUOUS).toBe(3);
    expect(plan.evidence.activeCandidateHasTierA).toBe(false);
    expect(plan.warnings).toContain('ASSISTED_RECOVERY_REQUIRED');
    expect(summarizeLegacyRecoveryPlan(plan)).toMatchObject({
      automaticallyRecoverableCount: 0,
      dataWillBeDeleted: false
    });
  });

  it('keeps current business rows ambiguous when the only proof is a historical outbox reference', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: {
          menu: [{ id: 'product-proven' }, { id: 'product-unrelated' }],
          product_batches: [{ id: 'batch-proven', productId: 'product-proven' }],
          customers: [{ id: 'customer-unrelated' }],
          sync_outbox: [{
            id: 'product-operation', licenseKey: 'PROVEN-A', entityType: 'product', entityId: 'product-proven'
          }]
        },
        localStorage: {}
      },
      activeTenantSource: { license_key: 'PROVEN-A' }
    });

    expect(plan.classifications.PROVEN_DIRECT).toBe(1);
    expect(plan.provenDirect).toHaveLength(1);
    expect(plan.provenDirect[0]).toMatchObject({ store: 'sync_outbox', destinationAction: 'QUARANTINE' });
    expect(plan.classifications.PROVEN_RELATIONAL).toBe(0);
    expect(plan.ambiguous.some((row) => row.store === 'menu')).toBe(true);
    expect(plan.ambiguous.some((row) => row.store === 'product_batches')).toBe(true);
    expect(summarizeLegacyRecoveryPlan(plan).automaticallyRecoverableCount).toBe(0);
  });

  it('does not let Tenant B or mutable localStorage promote Tenant A rows', async () => {
    const snapshot = farmaciaGarySnapshot();
    snapshot.localStorage['lanzo-cart-storage'] = 'ACTIVE-C';
    const plan = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'FOREIGN-B' }
    });

    expect(plan.evidence.activeCandidateHasTierA).toBe(false);
    expect(plan.provenDirect).toHaveLength(0);
    expect(plan.classifications.FOREIGN).toBeGreaterThan(0);
    expect(plan.warnings).toContain('ASSISTED_RECOVERY_REQUIRED');
  });

  it('never promotes a contradictory outbox record or its entity reference', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: {
          menu: [{ id: 'product-a' }],
          sync_outbox: [{
            id: 'contradictory',
            licenseKey: 'ACTIVE-A',
            metadata: { licenseKey: 'FOREIGN-B' },
            entityType: 'product',
            entityId: 'product-a'
          }]
        },
        localStorage: {}
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(plan.evidence.activeTierARecordCount).toBe(0);
    expect(plan.provenDirect).toHaveLength(0);
    expect(plan.foreign).toHaveLength(1);
    expect(plan.ambiguous.some((row) => row.store === 'menu')).toBe(true);
  });

  it('fingerprints privacy-preserving ownership evidence that changes classification', async () => {
    const snapshot = {
      sourceDatabase: 'LanzoDB1',
      recordsByStore: {
        sync_outbox: [{ id: 'same-row', licenseKey: 'ACTIVE-A', entityType: 'product', entityId: 'product-a' }],
        company: [{ id: 'company:ACTIVE-A', license_key: 'ACTIVE-A' }]
      },
      localStorage: {}
    };
    const activePlan = await buildLegacyRecoveryPlan({ snapshot, activeTenantSource: { license_key: 'ACTIVE-A' } });
    const foreignPlan = await buildLegacyRecoveryPlan({
      snapshot: {
        ...snapshot,
        recordsByStore: {
          ...snapshot.recordsByStore,
          sync_outbox: [{ ...snapshot.recordsByStore.sync_outbox[0], licenseKey: 'FOREIGN-B' }]
        }
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const companyConflictPlan = await buildLegacyRecoveryPlan({
      snapshot: {
        ...snapshot,
        recordsByStore: {
          ...snapshot.recordsByStore,
          company: [{ id: 'company:ACTIVE-A', license_key: 'FOREIGN-B' }]
        }
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(activePlan.sourceSnapshotFingerprint).not.toBe(foreignPlan.sourceSnapshotFingerprint);
    expect(activePlan.sourceSnapshotFingerprint).not.toBe(companyConflictPlan.sourceSnapshotFingerprint);
    expect(JSON.stringify(activePlan)).not.toContain('ACTIVE-A');
    expect(JSON.stringify(foreignPlan)).not.toContain('FOREIGN-B');
  });

  it('fingerprints complete business rows, nested values and source structure without exposing them', async () => {
    const snapshot = {
      sourceDatabase: 'LanzoDB1',
      sourceMetadata: {
        sourceDatabaseName: 'LanzoDB1',
        nativeDatabaseName: 'LanzoDB1',
        nativeDatabaseVersion: 30,
        objectStores: [{ name: 'menu', keyPath: 'id' }]
      },
      recordsByStore: {
        menu: [{ id: 'p1', name: 'A', price: 10, stock: 20, payload: { nested: ['one'] } }]
      },
      localStorage: {}
    };
    const build = (nextSnapshot = snapshot) => buildLegacyRecoveryPlan({
      snapshot: nextSnapshot,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const original = await build();
    const same = await build();
    const changedName = await build({
      ...snapshot,
      recordsByStore: { menu: [{ ...snapshot.recordsByStore.menu[0], name: 'B' }] }
    });
    const changedPriceStock = await build({
      ...snapshot,
      recordsByStore: { menu: [{ ...snapshot.recordsByStore.menu[0], price: 999, stock: 0 }] }
    });
    const changedNested = await build({
      ...snapshot,
      recordsByStore: { menu: [{ ...snapshot.recordsByStore.menu[0], payload: { nested: ['two'] } }] }
    });
    const changedStructure = await build({
      ...snapshot,
      sourceMetadata: { ...snapshot.sourceMetadata, nativeDatabaseVersion: 31 }
    });

    expect(original.sourceSnapshotFingerprint).toBe(same.sourceSnapshotFingerprint);
    expect(original.sourceSnapshotFingerprint).not.toBe(changedName.sourceSnapshotFingerprint);
    expect(original.sourceSnapshotFingerprint).not.toBe(changedPriceStock.sourceSnapshotFingerprint);
    expect(original.sourceSnapshotFingerprint).not.toBe(changedNested.sourceSnapshotFingerprint);
    expect(original.sourceSnapshotFingerprint).not.toBe(changedStructure.sourceSnapshotFingerprint);
    expect(JSON.stringify(original)).not.toContain('"name":"A"');
    expect(JSON.stringify(original)).not.toContain('"price":10');
  });

  it('fingerprints binary structured-clone values deterministically and fails closed for unsupported values', async () => {
    const createSnapshot = (bytes) => ({
      sourceDatabase: 'LanzoDB1',
      recordsByStore: {
        menu: [{
          id: 'binary-product',
          bytes: new Uint8Array(bytes),
          buffer: new Uint8Array(bytes).buffer,
          attachment: new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
        }]
      },
      localStorage: {}
    });
    const original = await buildLegacyRecoveryPlan({
      snapshot: createSnapshot([1, 2, 3]),
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const same = await buildLegacyRecoveryPlan({
      snapshot: createSnapshot([1, 2, 3]),
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const changed = await buildLegacyRecoveryPlan({
      snapshot: createSnapshot([1, 2, 4]),
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(original.sourceSnapshotFingerprint).toBe(same.sourceSnapshotFingerprint);
    expect(original.sourceSnapshotFingerprint).not.toBe(changed.sourceSnapshotFingerprint);
    await expect(buildLegacyRecoveryPlan({
      snapshot: { sourceDatabase: 'LanzoDB1', recordsByStore: { menu: [{ id: 'unsupported', value: new Map() }] } },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED' });
  });

  it('creates separate plans across tenant switches without changing the source snapshot', async () => {
    const snapshot = farmaciaGarySnapshot();
    const before = JSON.stringify(snapshot);
    const planA = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'ACTIVE-C' }
    });
    const planB = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'FOREIGN-B' }
    });

    expect(planA.evidence.activeCandidateHasTierA).toBe(true);
    expect(planB.evidence.activeCandidateHasTierA).toBe(false);
    expect(planA.sourceSnapshotFingerprint).toBe(planB.sourceSnapshotFingerprint);
    expect(planA.recoveryContextFingerprint).not.toBe(planB.recoveryContextFingerprint);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('binds the opaque recovery context to the active tenant without changing a FREE vault fingerprint', async () => {
    const snapshot = {
      sourceDatabase: 'LanzoDB1',
      recordsByStore: {
        menu: [{ id: 'free-product' }],
        customers: [{ id: 'free-customer' }]
      },
      localStorage: {}
    };
    const tenantA = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'FREE-A' }
    });
    const tenantARepeat = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'FREE-A' }
    });
    const tenantB = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'FREE-B' }
    });

    expect(tenantA.sourceSnapshotFingerprint).toBe(tenantB.sourceSnapshotFingerprint);
    expect(tenantA.recoveryContextFingerprint).not.toBe(tenantB.recoveryContextFingerprint);
    expect(tenantA.sourceSnapshotFingerprint).toBe(tenantARepeat.sourceSnapshotFingerprint);
    expect(tenantA.recoveryContextFingerprint).toBe(tenantARepeat.recoveryContextFingerprint);
    expect(JSON.stringify(tenantA)).not.toContain('FREE-A');
    expect(JSON.stringify(tenantB)).not.toContain('FREE-B');
  });

  it('uses only readonly IndexedDB access and produces a deterministic immutable plan', async () => {
    const database = await createDatabase();
    await database.table('menu').put({ id: 'product-a' });
    await database.table('sync_outbox').put({
      id: 'outbox-a', licenseKey: 'ACTIVE-A', entityType: 'product', entityId: 'product-a'
    });
    const nativeTransaction = vi.spyOn(database.backendDB(), 'transaction');
    const writes = ['put', 'update', 'delete', 'clear'].map((method) => (
      vi.spyOn(database.table('menu'), method)
    ));
    const outboxWrites = ['put', 'update', 'delete', 'clear'].map((method) => (
      vi.spyOn(database.table('sync_outbox'), method)
    ));
    const bindingWrites = ['put', 'update', 'delete', 'clear'].map((method) => (
      vi.spyOn(database.table('local_tenant_binding'), method)
    ));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const adapter = createReadOnlyLegacyInspectionAdapter({
      database,
      sourceDatabase: 'LanzoDB1',
      allowStorageNotApplicable: true
    });
    const first = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const second = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(nativeTransaction.mock.calls.every(([, mode]) => mode === 'readonly')).toBe(true);
    expect([...writes, ...outboxWrites, ...bindingWrites].every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.sourceSnapshotFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(database.table('menu').count()).resolves.toBe(1);
    await expect(database.table('sync_outbox').count()).resolves.toBe(1);
    await expect(database.table('local_tenant_binding').count()).resolves.toBe(0);
  });

  it('inventories configured localStorage through read-only methods only', async () => {
    const database = await createDatabase();
    const browserStorage = createReadOnlyStorage([
      ['lanzo-active-orders-storage', '{"state":"legacy"}'],
      ['ignored_expirations_ttl', '{"legacy":true}'],
      ['lanzo_cash_opening_policy', '{"opened":true}'],
      ['lanzo-cart-storage-corrupted-123', '{"corrupt":true}']
    ]);
    const sessionStorage = createReadOnlyStorage([
      ['lanzo_drive_session:v1', '{"legacy":true}']
    ]);
    const adapter = createReadOnlyLegacyInspectionAdapter({ database, browserStorage, sessionStorage });
    const snapshot = await adapter.readSnapshot();
    const plan = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(browserStorage.getItem).toHaveBeenCalledWith('ignored_expirations_ttl');
    expect(browserStorage.getItem).toHaveBeenCalledWith('lanzo_cash_opening_policy');
    expect(browserStorage.getItem).toHaveBeenCalledWith('lanzo-cart-storage-corrupted-123');
    expect(sessionStorage.getItem).toHaveBeenCalledWith('lanzo_drive_session:v1');
    expect(browserStorage.key).toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
    expect(browserStorage.removeItem).not.toHaveBeenCalled();
    expect(browserStorage.clear).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(sessionStorage.clear).not.toHaveBeenCalled();
    expect(plan.storeSummaries['localStorage:lanzo-active-orders-storage']).toMatchObject({ total: 1 });
    expect(plan.storeSummaries['localStorage:ignored_expirations_ttl']).toMatchObject({ total: 1 });
    expect(plan.storeSummaries['localStorage:lanzo_cash_opening_policy']).toMatchObject({ total: 1 });
    expect(plan.storeSummaries['localStorage:lanzo-cart-storage-corrupted-123']).toMatchObject({ total: 1 });
    expect(plan.storeSummaries['sessionStorage:lanzo_drive_session:v1']).toMatchObject({ total: 1 });
    expect(JSON.stringify(plan)).not.toContain('{"corrupt":true}');
  });

  it('uses canonical browser storage by default and fails closed when it cannot inspect it', async () => {
    const database = await createDatabase();
    const localStorage = createReadOnlyStorage([['ignored_expirations_ttl', '{"legacy":true}']]);
    const sessionStorage = createReadOnlyStorage([['lanzo_drive_session:v1', '{"legacy":true}']]);
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const snapshot = await createReadOnlyLegacyInspectionAdapter({ database }).readSnapshot();

    expect(snapshot.browserStorageInspection).toEqual({ status: 'COMPLETE' });
    expect(snapshot.localStorage.ignored_expirations_ttl).toBe('{"legacy":true}');
    expect(snapshot.sessionStorage['lanzo_drive_session:v1']).toBe('{"legacy":true}');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() { throw new Error('denied'); },
        sessionStorage
      }
    });
    await expect(createReadOnlyLegacyInspectionAdapter({ database }).readSnapshot())
      .rejects.toMatchObject({ code: 'RECOVERY_STORAGE_INSPECTION_FAILED' });
  });

  it('requires explicit non-browser storage non-applicability instead of treating omission as empty', async () => {
    const database = await createDatabase();
    await expect(createReadOnlyLegacyInspectionAdapter({ database }).readSnapshot())
      .rejects.toMatchObject({ code: 'RECOVERY_STORAGE_INSPECTION_REQUIRED' });
    const snapshot = await createReadOnlyLegacyInspectionAdapter({
      database,
      allowStorageNotApplicable: true
    }).readSnapshot();

    expect(snapshot.browserStorageInspection).toEqual({ status: 'NOT_APPLICABLE' });
  });

  it('requires COMPLETE storage inspection before a future copy can be eligible', async () => {
    const snapshot = {
      sourceDatabase: 'LanzoDB1',
      recordsByStore: { menu: [{ id: 'empty-safe-product' }] },
      localStorage: {},
      sessionStorage: {},
      browserStorageInspection: { status: 'COMPLETE' }
    };
    const complete = await buildLegacyRecoveryPlan({
      snapshot,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const notApplicable = await buildLegacyRecoveryPlan({
      snapshot: {
        ...snapshot,
        browserStorageInspection: { status: 'NOT_APPLICABLE' }
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const omitted = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: snapshot.sourceDatabase,
        recordsByStore: snapshot.recordsByStore,
        localStorage: snapshot.localStorage,
        sessionStorage: snapshot.sessionStorage
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(complete.executableForFutureCopy).toBe(true);
    expect(complete.preconditionFailure).toBeNull();
    expect(notApplicable.browserStorageInspection.status).toBe('NOT_APPLICABLE');
    expect(notApplicable.executableForFutureCopy).toBe(false);
    expect(notApplicable.preconditionFailure).toBe('RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE');
    expect(notApplicable.warnings).toContain('RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE');
    expect(omitted.browserStorageInspection.status).toBe('UNVERIFIED');
    expect(omitted.executableForFutureCopy).toBe(false);
    expect(omitted.preconditionFailure).toBe('RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE');
    expect(complete.sourceSnapshotFingerprint).not.toBe(notApplicable.sourceSnapshotFingerprint);
  });

  it('fingerprints browser-storage payload changes without exposing their contents', async () => {
    const snapshot = {
      sourceDatabase: 'LanzoDB1',
      recordsByStore: {},
      localStorage: { ignored_expirations_ttl: '{"revision":1}' },
      sessionStorage: { 'lanzo_drive_session:v1': '{"revision":1}' }
    };
    const changed = await buildLegacyRecoveryPlan({
      snapshot: {
        ...snapshot,
        localStorage: { ignored_expirations_ttl: '{"revision":2}' }
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const original = await buildLegacyRecoveryPlan({ snapshot, activeTenantSource: { license_key: 'ACTIVE-A' } });

    expect(original.sourceSnapshotFingerprint).not.toBe(changed.sourceSnapshotFingerprint);
    expect(JSON.stringify(original)).not.toContain('{"revision":1}');
    expect(JSON.stringify(changed)).not.toContain('{"revision":2}');
  });

  it('blocks future copy planning for an already-bound vault while preserving infrastructure', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: {
          local_tenant_binding: [{ key: 'primary', tenantIdentity: 'opaque-binding' }],
          __lanzo_sales_backup_v30: [{ legacyKey: 'sale-1' }],
          __lanzo_deleted_sales_backup_v30: [{ legacyKey: 'sale-2' }],
          __lanzo_db_recovery: [{ key: 'metadata' }]
        },
        localStorage: {}
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(plan.preconditionFailure).toBe('RECOVERY_SOURCE_ALREADY_BOUND');
    expect(plan.executableForFutureCopy).toBe(false);
    expect(plan.warnings).toContain('RECOVERY_SOURCE_ALREADY_BOUND');
    expect(plan.storeSummaries.__lanzo_sales_backup_v30.destinationAction).toBe('PRESERVE_VAULT');
  });

  it('fails closed for unknown IndexedDB stores instead of assigning a copy policy', async () => {
    const plan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: { unknown_legacy_store: [{ id: 'unknown-row' }] },
        localStorage: {}
      },
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(plan.unknownStores).toEqual(['unknown_legacy_store']);
    expect(plan.executableForFutureCopy).toBe(false);
    expect(plan.warnings).toContain('UNKNOWN_STORE_PRESENT');
    expect(plan.storeSummaries.unknown_legacy_store).toMatchObject({
      destinationAction: 'PRESERVE_VAULT',
      classifications: { AMBIGUOUS: 1 }
    });
  });

  it('inventories physical infrastructure and unknown stores from the real adapter', async () => {
    const database = await createDatabase();
    await database.table('__lanzo_sales_backup_v30').put({ legacyKey: 'backup-sale' });
    await database.table('__lanzo_db_recovery').put({ key: 'recovery-meta' });
    await database.table('unknown_legacy_store').put({ id: 'unknown-row' });
    const snapshot = await createReadOnlyLegacyInspectionAdapter({
      database,
      allowStorageNotApplicable: true
    }).readSnapshot();

    expect(snapshot.recordsByStore.__lanzo_sales_backup_v30).toHaveLength(1);
    expect(snapshot.recordsByStore.__lanzo_db_recovery).toHaveLength(1);
    expect(snapshot.recordsByStore.unknown_legacy_store).toHaveLength(1);
  });

  it('fails closed for a physical object store absent from Dexie and the Recovery registry', async () => {
    const database = await createDatabase();
    const nativeDatabase = await createPhysicalUnmodeledStore(database);
    const nativeTransaction = vi.spyOn(nativeDatabase, 'transaction');
    const adapter = createReadOnlyLegacyInspectionAdapter({
      database: { backendDB: () => nativeDatabase },
      allowStorageNotApplicable: true
    });
    const plan = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(plan.unknownStores).toContain('physical_unmodeled_store');
    expect(plan.warnings).toContain('UNKNOWN_STORE_PRESENT');
    expect(plan.executableForFutureCopy).toBe(false);
    expect(nativeTransaction.mock.calls.every(([, mode]) => mode === 'readonly')).toBe(true);
    nativeDatabase.close();
  });
});
