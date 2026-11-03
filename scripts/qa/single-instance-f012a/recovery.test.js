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

import { createFinancialIntent, executeNewFinancialIntent } from '../../../src/services/financial/financialIntentLedger';
import { recoverFinancialIntent } from '../../../src/services/financial/financialIntentRecovery';
import { observeFinancialExecution } from '../../../src/services/financial/financialExecutionLifetime';

const traces = [];
let nativeGate;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

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
  const out = 'scripts/qa/single-instance-f012a/evidence';
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/recovery-traces.json`, JSON.stringify(traces, null, 2));
});

const runExecutor = factory => Promise.resolve().then(factory);
const observe = operation => observeFinancialExecution(operation, { runExecutor });
const options = () => ({
  operationType: 'sale.cashier_inventory', request: { sale: { id: 'f012a-sale', total: '10' }, items: [], payments: [], cash_session_id: 'f012-cash' },
  licenseKey: 'f012-fixture', cashSessionId: 'f012-cash', actorHandle: fixture.handle,
  idempotencyKey: 'f012a-stable-key', projectionRequired: false,
  timeouts: { DISPATCH_MS: 20, RECEIPT_MS: 200, PREFLIGHT_MS: 1000 }, leaseMs: 120000,
});
const receipts = (receipt = { status: 'PROCESSING' }, execute = async () => ({ data: { success: true }, error: null })) => {
  fixture.rpc.mockImplementation(async name => {
    if (name === 'pos_get_cash_station_state') return { data: { cash_station: { id: 'f012-station' }, station_open_cash_session: { id: 'f012-cash' } }, error: null };
    if (name === 'pos_get_financial_operation_receipt') {
      if (receipt instanceof Error) throw receipt;
      return { data: typeof receipt === 'function' ? await receipt() : receipt, error: null };
    }
    if (name === 'pos_execute_financial_operation_v1') return execute();
    throw Error(`unexpected synthetic RPC: ${name}`);
  });
};
const dispatchCount = () => fixture.rpc.mock.calls.filter(([name]) => name === 'pos_execute_financial_operation_v1').length;
const row = async () => (await fixture.database.table('financial_intents').toArray())[0];
const recover = (id, scope, extra = {}) => recoverFinancialIntent({ intentId: id, licenseKey: 'f012-fixture', actorHandle: fixture.handle, executionScope: scope, ...extra });
const immutable = r => Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith('origin') || ['id', 'idempotencyKey', 'requestHash', 'requestPayload', 'canonicalRequest', 'cashSessionId', 'cashStationId'].includes(k)));

describe('F01-2A real ledger/recovery, Dexie fake-IDB, synthetic auth/actor/transport', () => {
  it('LIFE-05B completed receipt still waits for real projection lease lifecycle and cleanup', async () => {
    receipts({ status: 'COMPLETED', result: { success: true } });
    const intent = await createFinancialIntent({ ...options(), projectionRequired: true });
    nativeGate = deferred(); const started = deferred();
    const e = observe(scope => recover(intent.id, scope, { project: async () => { started.resolve(); await nativeGate.promise; } }));
    await started.promise;
    expect(await row()).toMatchObject({ status: 'COMPLETED', projectionStatus: 'PENDING' });
    expect((await row()).recoveryLeaseId).toBeTruthy(); expect(e.getSnapshot().closed).toBe(false);
    nativeGate.resolve(); expect((await e.result).outcome).toBe('projection_applied'); await e.settled;
    expect(await row()).toMatchObject({ projectionStatus: 'APPLIED', recoveryLeaseId: null }); expect(dispatchCount()).toBe(0);
  });
  it('LIFE-09B nested station/preflight work remains registered after the outer preflight timeout', async () => {
    nativeGate = deferred(); const started = deferred();
    fixture.rpc.mockImplementation(async name => {
      if (name !== 'pos_get_cash_station_state') throw Error('UNEXPECTED_DISPATCH');
      started.resolve(); return nativeGate.promise;
    });
    const e = observe(scope => createFinancialIntent({ ...options(), timeouts: { PREFLIGHT_MS: 20, STATION_RESOLUTION_MS: 1000 }, executionScope: scope }));
    const observed = expect(e.result).rejects.toMatchObject({ code: 'FINANCIAL_PREFLIGHT_TIMEOUT' });
    await started.promise; await observed; expect(e.getSnapshot()).toMatchObject({ closed: false, pendingTasks: 2 });
    nativeGate.resolve({ data: { cash_station: { id: 'f012-station' }, station_open_cash_session: { id: 'f012-cash' } }, error: null });
    await e.settled; expect(await fixture.database.table('financial_intents').count()).toBe(0); expect(dispatchCount()).toBe(0);
  });
  it('LIFE-13 actor changed during dispatch cannot write a late response', async () => {
    nativeGate = deferred(); const started = deferred(); receipts(undefined, () => { started.resolve(); return nativeGate.promise; });
    const e = observe(scope => executeNewFinancialIntent({ ...options(), executionScope: scope })); const observed = e.result.catch(error => error);
    await started.promise; fixture.handle.assertCurrent.mockImplementation(() => { throw Error('ACTOR_CONTEXT_STALE'); });
    nativeGate.resolve({ data: { success: true }, error: null }); expect((await observed).message).toBe('ACTOR_CONTEXT_STALE'); await e.settled;
    expect((await row()).status).toBe('DISPATCHING');
  });
  it('LIFE-14 tenant/generation changed while receipt pending cannot dispatch or mutate', async () => {
    nativeGate = deferred(); const started = deferred(); receipts(async () => { started.resolve(); return nativeGate.promise; });
    const intent = await createFinancialIntent(options()); const before = immutable(intent);
    const e = observe(scope => recover(intent.id, scope)); const observed = e.result.catch(error => error);
    await started.promise; fixture.handle.tenant = { ...fixture.handle.tenant, opaqueId: 'tenant-other', generation: 2 };
    nativeGate.resolve({ status: 'COMPLETED', result: { success: true } });
    expect((await observed).message).toBe('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); await e.settled;
    expect(immutable(await row())).toEqual(before); expect((await row()).status).toBe('PREPARED'); expect(dispatchCount()).toBe(0);
  });
  it('LIFE-15 receipt PROCESSING preserves ambiguity without dispatch', async () => {
    receipts(); const intent = await createFinancialIntent(options()); const e = observe(scope => recover(intent.id, scope));
    expect((await e.result).outcome).toBe('receipt_processing'); await e.settled; expect((await row()).status).toBe('PENDING_RECEIPT'); expect(dispatchCount()).toBe(0);
  });
  it('LIFE-16 late COMPLETED receipt confirms only through recovery and preserves immutable origin', async () => {
    nativeGate = deferred(); receipts(undefined, () => nativeGate.promise);
    const e = observe(scope => executeNewFinancialIntent({ ...options(), executionScope: scope }));
    await expect(e.result).rejects.toMatchObject({ isFinancialOperationAmbiguous: true }); const before = await row();
    nativeGate.resolve({ data: { success: true }, error: null }); await e.settled;
    expect((await row()).status).toBe('PENDING_RECEIPT');
    const count = dispatchCount(); receipts({ status: 'COMPLETED', result: { success: true } });
    const recovery = observe(scope => recover(before.id, scope)); await recovery.result; await recovery.settled;
    const after = await row(); expect(after.status).toBe('COMPLETED'); expect(immutable(after)).toEqual(immutable(before)); expect(dispatchCount()).toBe(count);
  });
  it('LIFE-17 receipt inaccessible never authorizes sending', async () => {
    receipts(new Error('synthetic offline')); const intent = await createFinancialIntent(options());
    const e = observe(scope => recover(intent.id, scope)); expect((await e.result).outcome).toBe('receipt_unavailable'); await e.settled;
    expect(dispatchCount()).toBe(0); expect((await row()).status).toBe('PREPARED');
  });
  it('LIFE-18 NOT_FOUND after an attempt never authorizes automatic redispatch', async () => {
    receipts({ status: 'NOT_FOUND' }); const intent = await createFinancialIntent(options());
    await fixture.database.table('financial_intents').update(intent.id, { status: 'PENDING_RECEIPT', dispatchAttemptCount: 1 });
    const e = observe(scope => recover(intent.id, scope)); expect((await e.result).outcome).toBe('receipt_not_found_no_resend'); await e.settled; expect(dispatchCount()).toBe(0);
  });
  it('LIFE-19 PREPARED/0 retains the one legitimate first dispatch', async () => {
    receipts({ status: 'NOT_FOUND' }); const intent = await createFinancialIntent(options()); const e = observe(scope => recover(intent.id, scope));
    expect((await e.result).outcome).toBe('first_dispatch'); await e.settled; expect(dispatchCount()).toBe(1); expect((await row()).status).toBe('COMPLETED');
  });
  it('LIFE-20 PREPARED with previous attempts requires receipt without dispatch', async () => {
    receipts({ status: 'NOT_FOUND' }); const intent = await createFinancialIntent(options());
    await fixture.database.table('financial_intents').update(intent.id, { dispatchAttemptCount: 1 });
    const e = observe(scope => recover(intent.id, scope)); expect((await e.result).outcome).toBe('inconsistent_prepared_receipt_required'); await e.settled;
    expect((await row()).status).toBe('PENDING_RECEIPT'); expect(dispatchCount()).toBe(0);
  });
  it('LIFE-21 financial lease is released at timeout while observer still retains client task; new recovery does not resend', async () => {
    nativeGate = deferred(); receipts(undefined, () => nativeGate.promise);
    const e = observe(scope => executeNewFinancialIntent({ ...options(), executionScope: scope }));
    await expect(e.result).rejects.toMatchObject({ isFinancialOperationAmbiguous: true }); const pending = await row();
    expect(pending).toMatchObject({ status: 'PENDING_RECEIPT', recoveryLeaseId: null }); expect(e.getSnapshot().closed).toBe(false);
    const r = observe(scope => recover(pending.id, scope)); expect((await r.result).outcome).toBe('receipt_processing'); await r.settled;
    expect(dispatchCount()).toBe(1); nativeGate.resolve({ data: { success: true }, error: null }); await e.settled;
    expect((await row()).status).toBe('PENDING_RECEIPT');
  });
  it('LIFE-22 expired lease cannot mutate ledger on late success; no lease extension for observation', async () => {
    nativeGate = deferred(); const started = deferred(); receipts(undefined, () => { started.resolve(); return nativeGate.promise; });
    const e = observe(scope => executeNewFinancialIntent({ ...options(), timeouts: { DISPATCH_MS: 1000 }, executionScope: scope })); const observed = e.result.catch(error => error);
    await started.promise; const pending = await row();
    await fixture.database.table('financial_intents').update(pending.id, { recoveryLeaseUntil: new Date(Date.now() - 1000).toISOString() });
    nativeGate.resolve({ data: { success: true }, error: null }); expect((await observed).message).toBe('FINANCIAL_RECOVERY_LEASE_EXPIRED'); await e.settled;
    expect((await row()).status).toBe('DISPATCHING'); expect(immutable(await row())).toEqual(immutable(pending));
  });
  it('LIFE-25 abrupt-document boundary model: reopen durable attempted row and require receipt, never resend', async () => {
    receipts({ status: 'NOT_FOUND' }); const intent = await createFinancialIntent(options());
    await fixture.database.table('financial_intents').update(intent.id, { status: 'PENDING_RECEIPT', dispatchAttemptCount: 1 });
    fixture.database.close(); await fixture.database.open(); const e = observe(scope => recover(intent.id, scope));
    expect((await e.result).outcome).toBe('receipt_not_found_no_resend'); await e.settled;
    expect(dispatchCount()).toBe(0); expect(immutable(await row())).toEqual(immutable(intent));
  });
  it('LIFE-30 legacy financial consumer retains identical receipt-first behavior without observer', async () => {
    receipts({ status: 'NOT_FOUND' }); const intent = await createFinancialIntent(options());
    expect((await recoverFinancialIntent({ intentId: intent.id, licenseKey: 'f012-fixture', actorHandle: fixture.handle })).outcome).toBe('first_dispatch');
    expect(dispatchCount()).toBe(1); expect((await row()).status).toBe('COMPLETED');
  });
  it('CE-RECOVERY-04 candidate: real unchanged 35s timeout retains underlying dispatch without confirming it', async () => {
    nativeGate = deferred(); let count = 0; receipts(() => ({ status: ++count === 1 ? 'NOT_FOUND' : 'PROCESSING' }), () => nativeGate.promise);
    const intent = await createFinancialIntent(options()); const began = Date.now();
    const e = observe(scope => recover(intent.id, scope, { leaseMs: 120000 }));
    await expect(e.result).rejects.toMatchObject({ isFinancialOperationAmbiguous: true }); const elapsedMs = Date.now() - began;
    expect(elapsedMs).toBeGreaterThanOrEqual(35000); expect(e.getSnapshot()).toMatchObject({ closed: false, pendingTasks: 1 });
    expect(await row()).toMatchObject({ status: 'PENDING_RECEIPT', recoveryLeaseId: null, dispatchAttemptCount: 1 });
    traces.push({ id: 'CE-RECOVERY-04', elapsedMs, dispatchTimeoutMs: 35000, result: 'PASS_CANDIDATE_LIFETIME', atTimeout: e.getSnapshot() });
    nativeGate.resolve({ data: { success: true }, error: null }); await e.settled; expect((await row()).status).toBe('PENDING_RECEIPT'); expect(dispatchCount()).toBe(1);
  }, 45000);
});
