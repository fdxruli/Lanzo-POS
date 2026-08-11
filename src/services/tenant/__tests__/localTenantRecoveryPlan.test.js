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
    local_tenant_binding: 'key'
  });
  await database.open();
  databases.push(database);
  return database;
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

  it('distinguishes exact direct and relational proof without claiming unrelated rows', async () => {
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

    expect(plan.classifications.PROVEN_DIRECT).toBe(2);
    expect(plan.classifications.PROVEN_RELATIONAL).toBe(1);
    expect(plan.classifications.AMBIGUOUS).toBe(2);
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
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('uses only readonly IndexedDB access and produces a deterministic immutable plan', async () => {
    const database = await createDatabase();
    await database.table('menu').put({ id: 'product-a' });
    await database.table('sync_outbox').put({
      id: 'outbox-a', licenseKey: 'ACTIVE-A', entityType: 'product', entityId: 'product-a'
    });
    const transaction = vi.spyOn(database, 'transaction');
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
    const adapter = createReadOnlyLegacyInspectionAdapter({ database, sourceDatabase: 'LanzoDB1' });
    const first = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const second = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    expect(transaction.mock.calls.every(([mode]) => mode === 'r')).toBe(true);
    expect([...writes, ...outboxWrites, ...bindingWrites].every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.sourceSnapshotFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(database.table('menu').count()).resolves.toBe(1);
    await expect(database.table('sync_outbox').count()).resolves.toBe(1);
    await expect(database.table('local_tenant_binding').count()).resolves.toBe(0);
  });
});
