import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ generation: 1, actorType: 'admin', directory: new Map(), receipts: new Map(), upsert: vi.fn(), rpc: vi.fn(), pull: vi.fn() }));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => ({ ...await importOriginal(), actorRuntimeController: { ...(await importOriginal()).actorRuntimeController, capture: () => {
  const generation = boundary.generation;
  return { actorType: boundary.actorType, assertCurrent() { if (generation !== boundary.generation) throw new Error('ACTOR_CONTEXT_STALE'); } };
} } }));
vi.mock('../../customers/customerCloudRepository', () => ({ customerCloudRepository: {
  upsertCustomer: boundary.upsert, pullCustomerSnapshot: boundary.pull, migrateLocalCustomers: vi.fn()
} }));
vi.mock('../customerCreditCloudRepository', () => ({ customerCreditCloudRepository: { historicalCreditBatch: boundary.rpc } }));

import { db, STORES } from '../../db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { useAppStore } from '../../../store/useAppStore';
import { customerCreditMigrationService as migration } from '../customerCreditMigrationService';
import { customerMigrationService } from '../../customers/customerMigrationService';
import { customerLocalRepository } from '../../customers/customerLocalRepository';
import { customerCreditLocalRepository } from '../customerCreditLocalRepository';
import { historicalCreditSnapshot } from '../historicalCreditSnapshot';
import { getActiveTenantDatabase } from '../../db/tenantRuntimeRouter';

const licenseKey = 'license-key-sha256:test-tenant-runtime-a';
const tenant = '10000000-0000-0000-0000-000000000001';
const local = { id: 'local-ten', name: 'Cliente QA', phone: '5551234567', address: 'Prueba', creditLimit: 50, debt: '10', debtCents: 1000, financialSource: 'local', syncStatus: 'local' };
const movement = { id: 'local-charge', customerId: local.id, type: 'CHARGE', amount: '10', syncStatus: 'local' };
const hash = 'canonical-financial-hash';
const receiptResults = (manifest) => manifest.entries.map((entry) => {
  const receipt = boundary.receipts.get(entry.customer_id);
  return { ...entry, status: receipt ? 'IMPORTED' : boundary.directory.has(entry.customer_id) ? 'READY' : 'CONFLICT_CUSTOMER_MISSING', ...(receipt ? { ledger_id: receipt.id } : {}) };
});

beforeEach(async () => {
  boundary.generation = 1; boundary.actorType = 'admin'; boundary.directory.clear(); boundary.receipts.clear();
  boundary.upsert.mockReset(); boundary.pull.mockReset(); boundary.rpc.mockReset();
  useAppStore.setState({ licenseDetails: { license_key: licenseKey, features: {
    cloud_pos_sync: true, cloud_cash_sync: true, cloud_customer_credit_sync: true, fin01_historical_credit_import: true
  } } });
  await openTestTenantRuntime();
  await db.table(STORES.CUSTOMERS).put({ ...local });
  await db.table(STORES.CUSTOMER_LEDGER).put({ ...movement });
  boundary.pull.mockImplementation(async () => ({ success: true, customers: [...boundary.directory.values()], has_more: false }));
  // Controlled Cloud double: mirrors the installed create/version guard and
  // financial protocol. This is NOT an execution of PostgreSQL or Production.
  boundary.upsert.mockImplementation(async ({ customer, expectedVersion }) => {
    const existing = boundary.directory.get(customer.id);
    if (existing) return { success: false, code: 'VERSION_CONFLICT', customer: existing };
    expect(expectedVersion).toBe(0);
    expect(Object.keys(customer).sort()).toEqual(['address', 'created_at', 'credit_limit', 'id', 'metadata', 'name', 'phone', 'phone_key', 'updated_at']);
    const saved = { ...customer, license_id: tenant, server_version: 1, debt: 0, debt_cents: 0 };
    boundary.directory.set(customer.id, saved);
    return { success: true, customer: saved };
  });
  boundary.rpc.mockImplementation(async ({ action, manifest }) => {
    if (action === 'context') return { success: true, tenant_id: tenant };
    if (action === 'preview') return { success: true, hash, results: receiptResults(manifest) };
    if (action === 'authorize') return { success: true, hash, authorization_id: 'approval', state: 'PENDING' };
    if (action === 'consume') for (const entry of manifest.entries) {
      if (!boundary.receipts.has(entry.customer_id)) {
        const ledger = { id: 'cloud-initial', customer_id: entry.customer_id, type: 'INITIAL_BALANCE', amount: entry.amount_cents / 100, server_version: 1 };
        boundary.receipts.set(entry.customer_id, ledger);
        Object.assign(boundary.directory.get(entry.customer_id), { debt: ledger.amount, debt_cents: entry.amount_cents, server_version: 2 });
      }
    }
    return { success: true, hash, authorization_id: 'approval', state: boundary.receipts.size ? 'CONSUMED' : 'PENDING', results: receiptResults(manifest) };
  });
});
afterEach(async () => { useAppStore.setState({ licenseDetails: null }); await closeTestTenantRuntime(); });

describe('FIN-01 directory bridge: real tenant Dexie, simulated Cloud', () => {
  it('reproduces the missing-directory block, then prepares zero and imports $10 once with separate authorization', async () => {
    expect(await customerMigrationService.runInitialMigrationIfNeeded({ licenseKey }))
      .toMatchObject({ blocked: true, code: 'HISTORICAL_DEBT_PRESERVATION_REQUIRED' });
    const missing = await migration.preview({ licenseKey });
    expect(missing.results).toMatchObject([{ status: 'CONFLICT_CUSTOMER_MISSING', amount_cents: 1000 }]);
    expect(boundary.upsert).not.toHaveBeenCalled();
    const original = structuredClone((await historicalCreditSnapshot.list())[0]);
    await expect(migration.authorizeAndImport({ licenseKey, reviewedHash: missing.hash })).rejects.toThrow('HISTORICAL_DIRECTORY_PREPARATION_REQUIRED');
    await migration.prepareDirectory({ licenseKey, reviewedHash: missing.hash });
    expect(boundary.directory.get(local.id)).toMatchObject({ id: local.id, debt: 0, debt_cents: 0 });
    expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: '10', debtCents: 1000 });
    expect(await db.table(STORES.CUSTOMER_LEDGER).get(movement.id)).toEqual(movement);
    expect((await historicalCreditSnapshot.list())[0]).toEqual(original);
    expect(boundary.rpc.mock.calls.some(([call]) => ['authorize', 'consume'].includes(call.action))).toBe(false);
    await expect(migration.authorizeAndImport({ licenseKey, reviewedHash: missing.hash })).rejects.toThrow('HISTORICAL_REVIEW_REQUIRED');
    const reviewed = await migration.preview({ licenseKey });
    expect(reviewed.hash).toBe(hash);
    expect(reviewed.results).toMatchObject([{ status: 'READY', amount_cents: 1000 }]);
    await migration.authorizeAndImport({ licenseKey, reviewedHash: reviewed.hash });
    await customerCreditLocalRepository.applyCloudLedger(boundary.receipts.get(local.id));
    await customerLocalRepository.applyCloudCustomer(boundary.directory.get(local.id), { source: 'credit_projection' });
    await migration.resumeImport({ licenseKey });
    expect(boundary.directory.get(local.id)).toMatchObject({ debt: 10, debt_cents: 1000 });
    expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: 10, debtCents: 1000, financialSource: 'cloud', syncStatus: 'synced', conflictReason: null });
    await customerLocalRepository.applyCloudCustomer({ ...boundary.directory.get(local.id), debt: 0, debt_cents: 0, server_version: 1 }, { source: 'mutation_ack', operationId: 'delayed-zero' });
    expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: 10, debtCents: 1000, serverVersion: 2 });
    expect(boundary.receipts.size).toBe(1);
    expect((await db.table(STORES.CUSTOMER_LEDGER).toArray()).filter((row) => row.type === 'INITIAL_BALANCE')).toHaveLength(1);
    expect(await db.table(STORES.CUSTOMER_LEDGER).get(movement.id)).toEqual(movement);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
    expect(boundary.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not prepare on startup, reconnect or a read-only review', async () => {
    await migration.runInitialMigrationIfNeeded({ licenseKey });
    await migration.runInitialMigrationIfNeeded({ licenseKey });
    await migration.preview({ licenseKey });
    expect(boundary.upsert).not.toHaveBeenCalled();
    expect(boundary.receipts.size).toBe(0);
  });

  it('leaves an existing compatible Cloud customer untouched', async () => {
    const reviewed = await migration.preview({ licenseKey });
    const existing = { id: local.id, name: local.name, phone: local.phone, address: local.address, credit_limit: 50, debt: 0, debt_cents: 0, server_version: 4, license_id: tenant };
    boundary.directory.set(local.id, existing);
    expect(await migration.prepareDirectory({ licenseKey, reviewedHash: reviewed.hash }))
      .toMatchObject({ success: true, results: [{ status: 'VERIFIED_EXISTING' }] });
    expect(boundary.upsert).not.toHaveBeenCalled();
    expect(boundary.directory.get(local.id)).toBe(existing);
  });

  it('does not prepare a Local customer without debt or financial history', async () => {
    await db.table(STORES.CUSTOMER_LEDGER).clear();
    await db.table(STORES.CUSTOMERS).update(local.id, { debt: 0, debtCents: 0 });
    expect(await migration.preview({ licenseKey })).toMatchObject({ empty: true });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: hash })).rejects.toThrow('HISTORICAL_REVIEW_REQUIRED');
    expect(boundary.upsert).not.toHaveBeenCalled();
  });

  it('recovers a lost creation reply after reopening without another write or financial approval', async () => {
    const create = boundary.upsert.getMockImplementation();
    boundary.upsert.mockImplementationOnce(async (request) => { await create(request); throw new Error('timeout'); });
    const missing = await migration.preview({ licenseKey });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: missing.hash })).rejects.toThrow('timeout');
    const database = getActiveTenantDatabase();
    database.close(); await database.open();
    // Review may now see READY, so no further preparation is needed.
    const ready = await migration.preview({ licenseKey });
    expect(ready.results).toMatchObject([{ status: 'READY' }]);
    expect(boundary.directory.size).toBe(1);
    expect(boundary.upsert).toHaveBeenCalledTimes(1);
    expect(boundary.receipts.size).toBe(0);
    expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: '10' });
    expect((await historicalCreditSnapshot.list())[0]).toMatchObject({ status: 'PENDING_AUTHORIZATION', originalLedgerEntries: [movement] });
  });

  it('reuses the exact durable request when the first send never reached Cloud', async () => {
    boundary.upsert.mockRejectedValueOnce(new Error('timeout'));
    const missing = await migration.preview({ licenseKey });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: missing.hash })).rejects.toThrow('timeout');
    const retryReview = await migration.preview({ licenseKey });
    await migration.prepareDirectory({ licenseKey, reviewedHash: retryReview.hash });
    expect(boundary.upsert.mock.calls[0][0]).toEqual(boundary.upsert.mock.calls[1][0]);
    expect(boundary.directory.size).toBe(1);
    expect(boundary.receipts.size).toBe(0);
  });

  for (const overrides of [{ name: 'Otra persona' }, { license_id: 'other-tenant' }, { server_version: 0 }, { deleted_at: '2026-01-01' }]) {
    it(`rejects an existing incompatible directory: ${JSON.stringify(overrides)}`, async () => {
      const missing = await migration.preview({ licenseKey });
      const collision = { id: local.id, name: local.name, phone: local.phone, address: local.address, credit_limit: 50, debt: 0, server_version: 1, license_id: tenant, ...overrides };
      boundary.directory.set(local.id, collision);
      await expect(migration.prepareDirectory({ licenseKey, reviewedHash: missing.hash })).rejects.toThrow('HISTORICAL_DIRECTORY_CONFLICT');
      expect(boundary.upsert).not.toHaveBeenCalled();
      expect(boundary.directory.get(local.id)).toBe(collision);
      expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: '10' });
    });
  }

  it('does not turn a concurrent ID collision into an update', async () => {
    const reviewed = await migration.preview({ licenseKey });
    boundary.upsert.mockImplementationOnce(async ({ expectedVersion }) => {
      expect(expectedVersion).toBe(0);
      boundary.directory.set(local.id, { id: local.id, name: 'Concurrent customer', server_version: 1 });
      return { success: false, code: 'VERSION_CONFLICT' };
    });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: reviewed.hash })).rejects.toThrow('VERSION_CONFLICT');
    expect(boundary.directory.get(local.id).name).toBe('Concurrent customer');
    expect(boundary.upsert).toHaveBeenCalledTimes(1);
    expect(boundary.receipts.size).toBe(0);
    await expect(migration.preview({ licenseKey })).rejects.toThrow('HISTORICAL_DIRECTORY_CONFLICT');
    expect(boundary.receipts.size).toBe(0);
  });

  it('preserves debt and history during a zero-debt pull and late directory ack', async () => {
    const reviewed = await migration.preview({ licenseKey });
    const original = structuredClone((await historicalCreditSnapshot.list())[0]);
    const create = boundary.upsert.getMockImplementation();
    boundary.upsert.mockImplementationOnce(async (request) => {
      const response = await create(request);
      await customerLocalRepository.applyCloudCustomer(response.customer);
      await customerLocalRepository.applyCloudCustomer(response.customer, { source: 'mutation_ack', operationId: 'late-ack' });
      return response;
    });
    await migration.prepareDirectory({ licenseKey, reviewedHash: reviewed.hash });
    expect(await db.table(STORES.CUSTOMERS).get(local.id)).toMatchObject({ debt: '10', debtCents: 1000, conflictReason: 'HISTORICAL_DEBT_PRESERVATION_REQUIRED' });
    expect(await db.table(STORES.CUSTOMER_LEDGER).get(movement.id)).toEqual(movement);
    expect((await historicalCreditSnapshot.list())[0]).toEqual(original);
    expect(boundary.receipts.size).toBe(0);
  });

  it('rejects invalid directory data before any create', async () => {
    await db.table(STORES.CUSTOMERS).update(local.id, { phone: '' });
    const reviewed = await migration.preview({ licenseKey });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: reviewed.hash })).rejects.toThrow('HISTORICAL_DIRECTORY_FIELDS_REQUIRED');
    expect(boundary.upsert).not.toHaveBeenCalled();
  });

  it('rejects Staff and a changed tenant, license or session', async () => {
    const reviewed = await migration.preview({ licenseKey });
    boundary.actorType = 'staff';
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: reviewed.hash })).rejects.toThrow('REJECTED_AUTHORITY');
    boundary.actorType = 'admin';
    await expect(migration.prepareDirectory({ licenseKey: 'another-license', reviewedHash: reviewed.hash })).rejects.toThrow('HISTORICAL_DIRECTORY_CONTEXT_CHANGED');
    const refreshed = await migration.preview({ licenseKey });
    boundary.rpc.mockResolvedValueOnce({ success: true, tenant_id: 'other-tenant' });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: refreshed.hash })).rejects.toThrow('HISTORICAL_DIRECTORY_CONTEXT_CHANGED');
    boundary.rpc.mockImplementationOnce(async () => { boundary.generation++; return { success: true, tenant_id: tenant }; });
    await expect(migration.prepareDirectory({ licenseKey, reviewedHash: refreshed.hash })).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(boundary.upsert).not.toHaveBeenCalled();
  });
});
