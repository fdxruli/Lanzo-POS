// @vitest-environment node
// Boundary evidence, not an implementation of restricted POS bootstrap.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ database: null, handle: null, rpc: vi.fn() }));
vi.mock('../../../src/services/db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: {
    table: name => fixture.database.table(name),
    transaction: (...args) => fixture.database.transaction(...args),
  },
}));
vi.mock('../../../src/services/auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: () => fixture.handle },
}));
vi.mock('../../../src/services/sync/posSyncClient', () => ({
  buildPosSyncAuthContext: async () => ({ licenseKey: 'f012-fixture', deviceFingerprint: 'f012-device', securityToken: 'synthetic-only' }),
}));
vi.mock('../../../src/services/supabase', () => ({ supabaseClient: { rpc: (...args) => fixture.rpc(...args) } }));

import { createFinancialIntent, executeNewFinancialIntent, getFinancialIntent, listFinancialIntentsForRecovery } from '../../../src/services/financial/financialIntentLedger';
import { recoverFinancialIntent } from '../../../src/services/financial/financialIntentRecovery';
import { withFinancialTimeout } from '../../../src/services/financial/financialTimeout';

const traces = [];
let nativeGate;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(async () => {
  fixture.database = new Dexie(`f012-${crypto.randomUUID()}`);
  fixture.database.version(1).stores({ financial_intents: 'id, &idempotencyKey, originActorKey' });
  await fixture.database.open();
  fixture.handle = {
    actorKey: 'admin:f012-a', actorId: 'f012-a', actorType: 'admin', sessionId: 'f012-session',
    generation: 1, deviceRef: 'f012-device',
    tenant: { opaqueId: 'f012-tenant', databaseName: 'f012-db', generation: 1 },
    assertCurrent: vi.fn(),
  };
  fixture.rpc.mockReset();
});
afterEach(async () => {
  nativeGate?.resolve({ data: { success: true }, error: null });
  nativeGate = null;
  await fixture.database.delete();
});
afterAll(() => {
  const out = 'scripts/qa/single-instance-f012/evidence';
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/financial-traces.json`, JSON.stringify(traces, null, 2));
});

describe('F01-2 current-contract boundary probes; counterexamples remain failed guarantees', () => {
  it('CE-DRAIN-01: real financial timeout settles while its synthetic native task continues', async () => {
    nativeGate = deferred();
    let nativeSettled = false;
    const native = nativeGate.promise.then(() => { nativeSettled = true; });
    await expect(withFinancialTimeout(native, { timeoutMs: 10, ambiguous: true })).rejects.toMatchObject({ isFinancialOperationAmbiguous: true });
    expect(nativeSettled).toBe(false);
    traces.push({ id: 'CE-DRAIN-01', guarantee: 'public promise settlement proves native task settled', result: 'COUNTEREXAMPLE', nativeSettledAtPublicTimeout: nativeSettled });
    nativeGate.resolve(); await native;
    expect(nativeSettled).toBe(true);
  });

  it('CE-DRAIN-02: real ledger returns ambiguous and releases lease while dispatch is still in flight; receipt-first never resends', async () => {
    nativeGate = deferred();
    const started = deferred();
    let nativeActive = 0, nativeCompleted = 0, executeCount = 0, receipt = { status: 'PROCESSING' };
    fixture.rpc.mockImplementation(async name => {
      if (name === 'pos_get_cash_station_state') return { data: { cash_station: { id: 'f012-station' }, station_open_cash_session: { id: 'f012-cash' } }, error: null };
      if (name === 'pos_get_financial_operation_receipt') return { data: receipt, error: null };
      if (name === 'pos_execute_financial_operation_v1') {
        executeCount++; nativeActive++; started.resolve();
        const response = await nativeGate.promise;
        nativeActive--; nativeCompleted++;
        return response;
      }
      throw Error(`unexpected synthetic RPC: ${name}`);
    });
    const request = { sale: { id: 'f012-sale', total: '10' }, items: [], payments: [{ method: 'cash', amount: '10' }], cash_session_id: 'f012-cash' };
    const operation = executeNewFinancialIntent({
      operationType: 'sale.cashier_inventory', request, licenseKey: 'f012-fixture',
      cashSessionId: 'f012-cash', actorHandle: fixture.handle,
      idempotencyKey: 'f012-original-key', projectionRequired: false,
      timeouts: { DISPATCH_MS: 30, RECEIPT_MS: 1000 },
    });
    // Install rejection observer before waiting for transport (no unhandled rejection).
    const observed = operation.then(value => ({ value }), error => ({ error }));
    await started.promise;
    const { error } = await observed;
    expect(error).toMatchObject({ isFinancialOperationAmbiguous: true, financialStatus: 'PENDING_RECEIPT' });
    const rows = await fixture.database.table('financial_intents').toArray();
    expect(rows).toHaveLength(1);
    const original = rows[0];
    expect(original).toMatchObject({ status: 'PENDING_RECEIPT', dispatchAttemptCount: 1, recoveryLeaseId: null, idempotencyKey: 'f012-original-key' });
    expect(nativeActive).toBe(1); expect(nativeCompleted).toBe(0);
    traces.push({ id: 'CE-DRAIN-02', result: 'COUNTEREXAMPLE', guarantee: 'ledger promise/lease settlement proves transport drained', atPublicSettlement: { nativeActive, nativeCompleted, executeCount, intentStatus: original.status, lease: original.recoveryLeaseId } });

    const recovery = await recoverFinancialIntent({ intentId: original.id, licenseKey: 'f012-fixture', actorHandle: fixture.handle });
    expect(recovery.outcome).toBe('receipt_processing'); expect(executeCount).toBe(1);
    nativeGate.resolve({ data: { success: true, sale: { id: 'f012-sale' } }, error: null });
    await vi.waitFor(() => expect(nativeCompleted).toBe(1));
    expect((await getFinancialIntent(original.id)).status).toBe('PENDING_RECEIPT');
    receipt = { status: 'COMPLETED', result: { success: true, sale: { id: 'f012-sale' } } };
    await recoverFinancialIntent({ intentId: original.id, licenseKey: 'f012-fixture', actorHandle: fixture.handle });
    const completed = await getFinancialIntent(original.id);
    expect(completed.status).toBe('COMPLETED'); expect(executeCount).toBe(1);
    for (const key of ['id', 'idempotencyKey', 'requestHash', 'originActorKey', 'originActorSessionId', 'originTenantOpaqueId', 'originDeviceRef']) expect(completed[key]).toBe(original[key]);
    traces.push({ id: 'RECOVERY-PRESERVED', result: 'PASS', executeCount, rows: await fixture.database.table('financial_intents').count(), status: completed.status, identityPreserved: true });
  });

  it('CE-INVENTORY-01: legacy recovery query cannot establish whole-tenant absence', async () => {
    const common = { originActorKey: fixture.handle.actorKey, status: 'PENDING_RECEIPT', projectionStatus: 'PENDING' };
    const rows = Array.from({ length: 60 }, (_, i) => ({ ...common, id: `row-${i}`, idempotencyKey: `key-${i}`, createdAt: new Date(1000 + i).toISOString() }));
    rows.push({ ...common, id: 'blocked', idempotencyKey: 'blocked', status: 'BLOCKED' });
    rows.push({ ...common, id: 'conflict', idempotencyKey: 'conflict', status: 'CONFLICT' });
    rows.push({ ...common, id: 'other-actor', idempotencyKey: 'other-actor', originActorKey: 'admin:other' });
    await fixture.database.table('financial_intents').bulkAdd(rows);
    const found = await listFinancialIntentsForRecovery({ actorHandle: fixture.handle, limit: 1000 });
    expect(found).toHaveLength(50);
    expect(found.some(row => ['blocked', 'conflict', 'other-actor'].includes(row.id))).toBe(false);
    expect(await fixture.database.table('financial_intents').count()).toBe(63);
    traces.push({ id: 'CE-INVENTORY-01', result: 'COUNTEREXAMPLE', guarantee: 'ordinary recovery query is a complete tenant inventory', persisted: 63, returned: found.length, excluded: ['BLOCKED', 'CONFLICT', 'other actor', 'ten rows over limit'] });
  });

  it('CE-RECOVERY-04: real recovery first dispatch outlives its public promise with unchanged 35s timeout', async () => {
    nativeGate = deferred();
    let nativeActive = 0, executeCount = 0, receipts = 0;
    fixture.rpc.mockImplementation(async name => {
      if (name === 'pos_get_cash_station_state') return { data: { cash_station: { id: 'f012-station' }, station_open_cash_session: { id: 'f012-cash' } }, error: null };
      if (name === 'pos_get_financial_operation_receipt') return { data: { status: ++receipts === 1 ? 'NOT_FOUND' : 'PROCESSING' }, error: null };
      if (name === 'pos_execute_financial_operation_v1') {
        executeCount++; nativeActive++;
        const response = await nativeGate.promise;
        nativeActive--;
        return response;
      }
      throw Error(`unexpected synthetic RPC: ${name}`);
    });
    const intent = await createFinancialIntent({
      operationType: 'sale.cashier_inventory', request: { sale: { id: 'f012-recovery-sale', total: '10' }, items: [], payments: [], cash_session_id: 'f012-cash' },
      licenseKey: 'f012-fixture', cashSessionId: 'f012-cash', actorHandle: fixture.handle,
      idempotencyKey: 'f012-recovery-original-key', projectionRequired: false,
    });
    const began = Date.now();
    // 120s is the existing supported lease maximum. Default 35s dispatch and
    // 10s receipt timers are NOT patched, shortened, faked or bypassed here.
    await expect(recoverFinancialIntent({ intentId: intent.id, licenseKey: 'f012-fixture', actorHandle: fixture.handle, leaseMs: 120000 })).rejects.toMatchObject({ isFinancialOperationAmbiguous: true, financialStatus: 'PENDING_RECEIPT' });
    const durable = await getFinancialIntent(intent.id);
    expect(durable).toMatchObject({ status: 'PENDING_RECEIPT', dispatchAttemptCount: 1, recoveryLeaseId: null });
    expect(nativeActive).toBe(1); expect(executeCount).toBe(1);
    traces.push({ id: 'CE-RECOVERY-04', result: 'COUNTEREXAMPLE', guarantee: 'recoverFinancialIntent settlement proves native dispatch drained', elapsedMs: Date.now() - began, dispatchTimeoutMs: 35000, leaseMs: 120000, nativeActive, executeCount, receiptCount: receipts, intentStatus: durable.status, lease: durable.recoveryLeaseId });
    nativeGate.resolve({ data: { success: true }, error: null });
    await vi.waitFor(() => expect(nativeActive).toBe(0));
    expect((await getFinancialIntent(intent.id)).status).toBe('PENDING_RECEIPT');
  }, 45000);
});
