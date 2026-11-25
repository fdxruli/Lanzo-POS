// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, STORES } from '../../../src/services/db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../src/test/tenantRuntimeTestHarness';
import { customerLocalRepository } from '../../../src/services/customers/customerLocalRepository';
import { customerCreditLocalRepository } from '../../../src/services/customerCredit/customerCreditLocalRepository';
import { cashLocalRepository } from '../../../src/services/cash/cashLocalRepository';
import { actorRuntimeController } from '../../../src/services/auth/actorRuntimeController';
import { localTenantAccessController } from '../../../src/services/tenant/localTenantPolicy';
import { getActiveTenantRuntime } from '../../../src/services/db/tenantRuntimeRouter';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
import * as supabase from '../../../src/services/supabase';

const m = vi.hoisted(() => ({ snapshot: vi.fn(), changes: vi.fn(), register: vi.fn(),
  creditProtocol: vi.fn(), salesProtocol: vi.fn(), customerProtocol: vi.fn(),
  salesSnapshot: vi.fn(), shadow: vi.fn(), customerSnapshot: vi.fn(), customerMigration: vi.fn()
}));
vi.mock('../../../src/services/sync/posSyncOrchestrator', () => ({ posSyncOrchestrator: { registerEntitySyncHandler: m.register } }));
vi.mock('../../../src/services/customerCredit/customerCreditCloudRepository', () => ({
  customerCreditCloudRepository: {
    negotiateSnapshotProtocol: m.creditProtocol,
    pullCreditSnapshot: m.snapshot,
    pullCreditChanges: m.changes
  }
}));
vi.mock('../../../src/services/sync/actorPermission', () => ({ hasCurrentActorPermission: () => true }));
vi.mock('../../../src/store/useAppStore', () => ({ useAppStore: { getState: () => ({ licenseDetails: {
  license_key: 'synthetic-T', features: { cloud_pos_sync: true, cloud_sales_sync_base: true }
} }) } }));
vi.mock('../../../src/services/salesCloud/salesCloudRepository', () => ({ salesCloudRepository: {
  negotiateSnapshotProtocol: m.salesProtocol,
  pullSalesSnapshot: m.salesSnapshot,
  upsertSaleShadow: m.shadow
} }));
vi.mock('../../../src/services/customers/customerCloudRepository', () => ({ customerCloudRepository: {
  negotiateSnapshotProtocol: m.customerProtocol,
  pullCustomerSnapshot: m.customerSnapshot,
  migrateLocalCustomers: m.customerMigration
} }));
import { customerCreditSyncHandler } from '../../../src/services/customerCredit/customerCreditSyncHandler';
import { customerCreditMigrationService } from '../../../src/services/customerCredit/customerCreditMigrationService';
import { customerSyncHandler } from '../../../src/services/customers/customerSyncHandler';
import { salesCloudSyncHandler } from '../../../src/services/salesCloud/salesCloudSyncHandler';

const deferred = () => {
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const SNAPSHOT_PROTOCOL = { supported: true, tenantId: 'synthetic-snapshot-tenant' };
const snapshotPage = (data = {}) => ({
  success: true,
  snapshot_contract: 'keyset_reference_v1',
  snapshot_contract_version: 1,
  snapshot_reference_change_seq: 37,
  safe_change_seq: 37,
  sync_deferred: false,
  has_more: false,
  snapshot_complete: true,
  next_page_cursor: null,
  ...data
});
const creditPayload = () => snapshotPage({
  customers: [{ id: 'synthetic-customer', name: 'Synthetic customer', current_debt: 0, server_version: 1 }],
  ledger_entries: [], cash_movements: [], cash_sessions: [], latest_change_seq: 37,
  customer_id: null, ledger_reconciliation_complete: true
});
const testTenantIdentity = {
  aliases: ['license-key-sha256:test-tenant-runtime-a'],
  primary: 'license-key-sha256:test-tenant-runtime-a',
  authority: 'license_key_sha256'
};
beforeEach(async () => {
  await openTestTenantRuntime();
  localTenantAccessController.enable('sync_handler_test_setup');
  localTenantAccessController.grant(testTenantIdentity, 'sync_handler_test_setup');
  actorRuntimeController.lock('test_setup');
  actorRuntimeController.beginAuthentication({ actorType: 'staff' });
  const tenantRuntime = getActiveTenantRuntime();
  if (!tenantRuntime) throw new Error('TEST_TENANT_RUNTIME_REQUIRED');
  actorRuntimeController.grant({
    actorType: 'staff', actorId: 'synthetic-staff', sessionId: 'synthetic-session',
    deviceRef: 'synthetic-device', permissions: ['customers', 'pos'],
    tenantOpaqueId: tenantRuntime.opaqueId
  });
  m.creditProtocol.mockResolvedValue(SNAPSHOT_PROTOCOL);
  m.salesProtocol.mockResolvedValue(SNAPSHOT_PROTOCOL);
  m.customerProtocol.mockResolvedValue(SNAPSHOT_PROTOCOL);
  m.snapshot.mockResolvedValue(creditPayload()); m.changes.mockResolvedValue(creditPayload());
  m.salesSnapshot.mockResolvedValue(snapshotPage({
    sales: [], items: [], payments: [],
    scope: { date_from: null, date_to: null, visibility: 'actor' }
  }));
  m.customerSnapshot.mockResolvedValue(snapshotPage({ customers: [] }));
  vi.spyOn(supabase, 'getStableDeviceId').mockResolvedValue('synthetic-device');
});
afterEach(async () => {
  vi.restoreAllMocks();
  actorRuntimeController.lock('test_teardown');
  localTenantAccessController.lock('test_teardown');
  await closeTestTenantRuntime();
  localTenantAccessController.reset();
});

it.each(['events', 'snapshot'])('real credit %s waits for delayed Dexie sibling even when another write rejects', async mode => {
  const gate = deferred(), started = deferred(), failure = new Error('synthetic-ledger-write-failure');
  const original = customerLocalRepository.applyCloudCustomers.bind(customerLocalRepository);
  vi.spyOn(customerCreditLocalRepository, 'applyCloudLedgers').mockRejectedValue(failure);
  vi.spyOn(customerLocalRepository, 'applyCloudCustomers').mockImplementation(async rows => {
    started.resolve(); await gate.promise; return original(rows);
  });
  // Keep the real migration check: no Local history -> no automatic credit
  // import, then the actual handler snapshot. Only external RPCs are controlled.
  const migration = vi.spyOn(customerCreditMigrationService, 'runInitialMigrationIfNeeded');
  const scope = createSyncExecutionScope();
  let settled = false;
  const result = scope.run('real-credit-handler', () => mode === 'events'
    ? customerCreditSyncHandler.onEvents([], { licenseKey: 'synthetic-T' })
    : customerCreditSyncHandler.onStart({ licenseKey: 'synthetic-T', licenseDetails: {
      features: { cloud_pos_sync: true, cloud_cash_sync: true, cloud_customer_credit_sync: true }
    } }));
  const outcome = result.then(value => ({ value }), error => ({ error })).then(value => { settled = true; return value; });
  await started.promise; await flush(); scope.quiesce(); await flush();
  expect(settled).toBe(false); expect(scope.getSnapshot().pending).toBe(1);
  expect(await db.table(STORES.CUSTOMERS).get('synthetic-customer')).toBeUndefined();
  gate.resolve(); const final = await outcome;
  expect(await db.table(STORES.CUSTOMERS).get('synthetic-customer')).toMatchObject({ name: 'Synthetic customer' });
  if (mode === 'events') expect(final.error).toBe(failure);
  else {
    expect(final.value).toMatchObject({ success: false, error: failure });
    expect(migration).toHaveBeenCalledTimes(1);
    expect(m.creditProtocol).toHaveBeenCalledTimes(1);
    expect(m.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotProtocol: SNAPSHOT_PROTOCOL, snapshotReferenceChangeSeq: null, pageCursor: null
    }));
  }
  expect((await scope.drain()).pending).toBe(0);
});

it('real credit success retains all four mappings and persists customer before notification', async () => {
  const listener = vi.fn(); window.addEventListener('lanzo:customers-sync-updated', listener);
  try {
    const result = await customerCreditSyncHandler.onEvents([], { licenseKey: 'synthetic-T' });
    expect(result.applied).toBe(1);
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1); expect(listener).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener('lanzo:customers-sync-updated', listener); }
});

it('late rejection of a second local projection is observed before real handler rejection', async () => {
  const gate = deferred(), started = deferred();
  vi.spyOn(customerCreditLocalRepository, 'applyCloudLedgers').mockRejectedValue(new Error('first'));
  vi.spyOn(cashLocalRepository, 'applyCloudCashMovements').mockImplementation(() => { started.resolve(); return gate.promise; });
  let settled = false;
  const result = customerCreditSyncHandler.onEvents([], { licenseKey: 'synthetic-T' });
  const outcome = result.then(() => { settled = true; }, error => { settled = true; return error; });
  await started.promise; await flush(); expect(settled).toBe(false);
  gate.reject(new Error('late-second')); expect((await outcome).message).toBe('first');
});

it('real credit local write which never settles keeps the handler and local drain pending', async () => {
  const started = deferred();
  vi.spyOn(customerCreditLocalRepository, 'applyCloudLedgers').mockRejectedValue(new Error('first'));
  vi.spyOn(cashLocalRepository, 'applyCloudCashMovements').mockImplementation(() => {
    started.resolve(); return new Promise(() => {});
  });
  const scope = createSyncExecutionScope();
  void scope.run('real-credit', () => customerCreditSyncHandler.onEvents([], { licenseKey: 'synthetic-T' }));
  await started.promise; scope.quiesce(); await flush(); expect(scope.getSnapshot().pending).toBe(1);
});

it('real sales snapshot awaits shadow RPC and actual local writes before snapshot pull', async () => {
  await db.table(STORES.SALES).put({ id: 'synthetic-sale', status: 'completed',
    cloudSalesSyncStatus: 'pending', sourceMode: 'shadow', total: 10, items: [], payments: [] });
  const started = deferred(), gate = deferred();
  m.shadow.mockImplementation(() => { started.resolve(); return gate.promise; });
  const scope = createSyncExecutionScope();
  const result = scope.run('real-sales-snapshot', () => salesCloudSyncHandler.onStart({
    licenseKey: 'synthetic-T', licenseDetails: { features: { cloud_pos_sync: true, cloud_sales_sync_base: true } }
  }));
  await started.promise;
  expect(m.salesProtocol).not.toHaveBeenCalled();
  expect(m.salesSnapshot).not.toHaveBeenCalled();
  scope.quiesce();
  expect(scope.getSnapshot().pending).toBe(1);
  // Snapshot negotiation and pull must both wait for the pending shadow write.
  gate.resolve({ success: true }); await result; await scope.drain();
  expect(m.shadow).toHaveBeenCalledTimes(1); expect(m.salesSnapshot).toHaveBeenCalledTimes(1);
  expect(m.salesProtocol).toHaveBeenCalledTimes(1);
  expect(m.salesSnapshot).toHaveBeenCalledWith(expect.objectContaining({
    snapshotProtocol: SNAPSHOT_PROTOCOL, snapshotReferenceChangeSeq: null, pageCursor: null
  }));
  expect(await db.table(STORES.SALES).get('synthetic-sale')).toMatchObject({ cloudSalesSyncStatus: 'synced' });
});

it('real customer onStart retains initial migration and snapshot, including durable migrated flag', async () => {
  await db.table(STORES.CUSTOMERS).put({ id: 'synthetic-migrate', name: 'Synthetic', phone: '5551234567' });
  const gate = deferred(), started = deferred();
  m.customerMigration.mockImplementation(() => { started.resolve(); return gate.promise; });
  const result = customerSyncHandler.onStart({ licenseKey: 'synthetic-T' });
  await started.promise; expect(m.customerSnapshot).not.toHaveBeenCalled();
  gate.resolve({ success: true, results: [{ success: true, customer: { id: 'synthetic-migrate', name: 'Synthetic', phone: '5551234567', server_version: 1 } }] });
  expect(await result).toMatchObject({ success: true, migrated: 1 });
  expect(m.customerMigration).toHaveBeenCalledTimes(1); expect(m.customerSnapshot).toHaveBeenCalledTimes(1);
  expect(m.customerProtocol).toHaveBeenCalledTimes(1);
  expect(m.customerSnapshot).toHaveBeenCalledWith(expect.objectContaining({
    snapshotProtocol: SNAPSHOT_PROTOCOL, snapshotReferenceChangeSeq: null, pageCursor: null,
    includeDeleted: true
  }));
  expect(await db.table('sync_meta').get('synthetic-T:customers_cloud_migrated')).toMatchObject({ value: true });
});

it('credit preserves earliest rejection in time even when it is a later array entry', async () => {
  const gate = deferred(), started = deferred();
  vi.spyOn(customerCreditLocalRepository, 'applyCloudLedgers').mockImplementation(() => { started.resolve(); return gate.promise; });
  vi.spyOn(cashLocalRepository, 'applyCloudCashMovements').mockRejectedValue(new Error('earliest-movement'));
  const outcome = customerCreditSyncHandler.onEvents([], { licenseKey: 'synthetic-T' }).catch(error => error);
  await started.promise; await flush(); gate.reject(new Error('later-ledger'));
  expect((await outcome).message).toBe('earliest-movement');
});
