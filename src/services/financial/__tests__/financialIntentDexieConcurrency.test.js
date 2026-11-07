import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const state = {
    database: null,
    handle: null,
    execute: vi.fn(),
    receipt: vi.fn(),
    rpcCalls: [],
    onDiscovery: null
  };

  state.db = {
    table: (name) => state.database.table(name),
    transaction: (...args) => state.database.transaction(...args)
  };
  return state;
});

vi.mock('../../db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: runtime.db
}));

vi.mock('../../auth/actorRuntimeController', async importOriginal => ({
  ...await importOriginal(),
  actorRuntimeController: { capture: () => runtime.handle, getState: () => ({ status: 'granted', ...runtime.handle }), subscribe: () => () => {} }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: async () => ({
    licenseKey: 'fixture-license',
    deviceFingerprint: 'device-a',
    securityToken: 'fixture-security-token',
    staffSessionToken: 'fixture-staff-session'
  })
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({
  licenseDetails: { license_key: 'fixture-license', features: {
    cloud_pos_sync: true, cloud_sales_sync_base: true, cloud_cash_sync: true, cloud_sales_cashier: true
  } }
}) } }));

vi.mock('../../supabase', () => ({
  getStableDeviceId: async () => 'device-a',
  supabaseClient: {
    async rpc(name, args) {
      runtime.rpcCalls.push({ name, args: structuredClone(args) });
      const envelope = (payload) => ({
        contract_version: 2,
        tenant_id: 'tenant-a',
        endpoint: name,
        family: 'financial_operations',
    customer_projection_scope: 'OPERATION_RESULT',
        payload,
        customer_projections: [],
        operation: { idempotency_key: args.p_idempotency_key, request_hash: args.p_request_hash }
      });
      if (name === 'pos_fin01_sync_contract_v1') { runtime.onDiscovery?.(); return { data: {
        contract_version: 2,
        tenant_id: 'tenant-a',
        server_status: 'SUPPORTED',
        endpoint_families: ['financial_operations'],
        endpoints: ['pos_execute_financial_operation_v2', 'pos_get_financial_operation_receipt_v2'],
        capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'financial_operation_result_v1']
      }, error: null }; }
      if (name === 'pos_get_cash_station_state') {
        return {
          data: {
            cash_station: { id: 'station-a' },
            station_open_cash_session: { id: 'session-a' }
          },
          error: null
        };
      }
      if (name === 'pos_get_financial_operation_receipt_v2') {
        try {
          return { data: envelope(await runtime.receipt(args)), error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
      if (name === 'pos_execute_financial_operation_v2') {
        try {
          return { data: envelope(await runtime.execute(args)), error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  }
}));

import { recoverFinancialIntent } from '../financialIntentRecovery';
import {
  FINANCIAL_INTENT_STATUS,
  claimFinancialIntentRecovery,
  createFinancialIntent,
  executeNewFinancialIntent,
  getFinancialIntent,
  releaseFinancialIntentRecoveryClaim,
  updateFinancialIntentForRecovery
} from '../financialIntentLedger';

const SALE_OPERATION = 'sale.cashier_inventory';
const names = [];

const makeHandle = () => ({
  actorKey: 'admin:actor-a',
  actorType: 'admin',
  actorId: 'actor-a',
  sessionId: 'session-a',
  generation: 1,
  deviceRef: 'device-a',
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
  assertCurrent: vi.fn()
});

const saleRequest = () => ({
  sale: {
    id: 'sale-race-1',
    total: '10',
    sold_at: '2026-08-29T12:34:56.000Z',
    created_at: '2026-08-29T12:34:56.000Z'
  },
  items: [{
    product_id: 'product-a',
    product_name: 'Producto A',
    quantity: '1',
    unit_price: '10',
    line_total: '10'
  }],
  payments: [{ method: 'cash', amount: '10' }],
  cash_session_id: 'session-a',
  customer_id: null
});

const executeCalls = () => runtime.rpcCalls.filter(({ name }) => name === 'pos_execute_financial_operation_v2');

const createIntent = (idempotencyKey = 'race-k') => createFinancialIntent({
  operationType: SALE_OPERATION,
  request: saleRequest(),
  licenseKey: 'fixture-license',
  idempotencyKey,
  cashSessionId: 'session-a',
  actorHandle: runtime.handle,
  projectionRequired: false
});

beforeEach(async () => {
  const name = `lanzo-financial-concurrency-${crypto.randomUUID()}`;
  names.push(name);
  const database = new Dexie(name);
  database.version(1).stores({ financial_intents: 'id, &idempotencyKey' });
  await database.open();
  runtime.database = database;
  runtime.handle = makeHandle();
  runtime.execute.mockReset();
  runtime.receipt.mockReset();
  runtime.rpcCalls.splice(0);
  runtime.onDiscovery = null;
  runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
  runtime.execute.mockResolvedValue({ success: true, sale: { id: 'cloud-sale-race-1' } });
});

afterEach(async () => {
  if (runtime.database?.isOpen()) runtime.database.close();
  runtime.database = null;
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('financial intent real Dexie fencing', () => {
  it('rejects an expired owner write and preserves a replacement lease', async () => {
    const intent = await createIntent('lease-expiry-k');
    const base = Date.now();
    const first = await claimFinancialIntentRecovery({
      intentId: intent.id,
      actorHandle: runtime.handle,
      leaseMs: 1000,
      currentTime: base
    });

    await expect(updateFinancialIntentForRecovery(
      intent.id,
      { lastRecoveryCode: 'STALE_OWNER_WRITE' },
      runtime.handle,
      { recoveryLeaseId: first.recoveryLeaseId, currentTime: base + 2000 }
    )).rejects.toThrow('FINANCIAL_RECOVERY_LEASE_EXPIRED');

    const replacement = await claimFinancialIntentRecovery({
      intentId: intent.id,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      currentTime: base + 2000
    });

    await expect(releaseFinancialIntentRecoveryClaim({
      intentId: intent.id,
      leaseId: first.recoveryLeaseId,
      actorHandle: runtime.handle
    })).rejects.toThrow('FINANCIAL_RECOVERY_LEASE_LOST');

    await expect(updateFinancialIntentForRecovery(
      intent.id,
      { lastRecoveryCode: 'STALE_AFTER_REPLACEMENT' },
      runtime.handle,
      { recoveryLeaseId: first.recoveryLeaseId, currentTime: base + 2001 }
    )).rejects.toThrow('FINANCIAL_RECOVERY_LEASE_LOST');

    await updateFinancialIntentForRecovery(
      intent.id,
      { lastRecoveryCode: 'REPLACEMENT_OWNER_WRITE' },
      runtime.handle,
      { recoveryLeaseId: replacement.recoveryLeaseId, currentTime: base + 2001 }
    );
    await releaseFinancialIntentRecoveryClaim({
      intentId: intent.id,
      leaseId: replacement.recoveryLeaseId,
      actorHandle: runtime.handle
    });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      lastRecoveryCode: 'REPLACEMENT_OWNER_WRITE',
      recoveryLeaseId: null,
      recoveryLeaseUntil: null
    });
  });

  it('fences the initial allocator against a duplicate before either can execute', async () => {
    let releaseExecute;
    let markExecuteStarted;
    const executeStarted = new Promise((resolve) => { markExecuteStarted = resolve; });
    const executeGate = new Promise((resolve) => { releaseExecute = resolve; });
    runtime.execute.mockImplementation(async () => {
      markExecuteStarted();
      await executeGate;
      return { success: true, sale: { id: 'cloud-sale-race-1' } };
    });

    const options = {
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'initial-race-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    };

    const firstPromise = executeNewFinancialIntent(options);
    await executeStarted;

    const duplicatePromise = executeNewFinancialIntent(options);
    await expect(duplicatePromise).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_LEASE_HELD' });

    releaseExecute();
    await expect(firstPromise).resolves.toMatchObject({ response: { success: true } });

    const rows = await runtime.database.table('financial_intents').toArray();
    expect(rows).toHaveLength(1);
    expect(executeCalls()).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotencyKey: 'initial-race-k',
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 1,
      recoveryLeaseId: null
    });
  });

  it('serializes concurrent explicit retries of an existing blocked intent', async () => {
    let releaseExecute;
    let markExecuteStarted;
    const executeStarted = new Promise((resolve) => { markExecuteStarted = resolve; });
    const executeGate = new Promise((resolve) => { releaseExecute = resolve; });
    runtime.execute.mockImplementation(async () => {
      markExecuteStarted();
      await executeGate;
      return { success: true, sale: { id: 'cloud-sale-retry-race-1' } };
    });

    const intent = await createIntent('blocked-retry-race-k');
    await runtime.database.table('financial_intents').update(intent.id, {
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1
    });

    const options = {
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'blocked-retry-race-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    };

    const firstPromise = executeNewFinancialIntent(options);
    await executeStarted;

    const secondPromise = executeNewFinancialIntent(options);
    await expect(secondPromise).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_LEASE_HELD' });

    releaseExecute();
    await expect(firstPromise).resolves.toMatchObject({ response: { success: true } });

    expect(executeCalls()).toHaveLength(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 2,
      recoveryLeaseId: null
    });
  });
});


describe('Staff POS cloud boundary', () => {
  beforeEach(() => { runtime.handle.actorType = 'staff'; runtime.handle.actorKey = 'staff:actor-a'; });
  const options = () => ({ operationType: SALE_OPERATION, request: saleRequest(),
    licenseKey: 'fixture-license', idempotencyKey: 'staff-pos-k', cashSessionId: 'session-a',
    actorHandle: runtime.handle, projectionRequired: false });
  const denyPos = () => runtime.handle.assertCurrent.mockImplementation(permission => {
    if (permission === 'pos') throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
  });

  it('checks POS again after protocol discovery and before the mutation RPC', async () => {
    runtime.onDiscovery = denyPos;
    await expect(executeNewFinancialIntent(options())).rejects.toThrow();
    expect(executeCalls()).toHaveLength(0);
  });

  it('recognizes a confirmed sale after a permission-only revocation', async () => {
    runtime.execute.mockImplementation(async () => { denyPos(); return { success: true, sale: { id: 'confirmed-sale' } }; });
    const result = await executeNewFinancialIntent(options());
    expect(result.response.success).toBe(true);
    expect((await getFinancialIntent(result.intentId)).status).toBe('COMPLETED');
    expect(executeCalls()).toHaveLength(1);
  });

  it('does not dispatch a PREPARED checkout from a replacement session', async () => {
    const row = await createFinancialIntent(options());
    const replacement = { ...runtime.handle, sessionId: 'replacement', generation: 2 };
    await expect(recoverFinancialIntent({ intentId: row.id, licenseKey: 'fixture-license', actorHandle: replacement })).rejects.toThrow();
    expect(executeCalls()).toHaveLength(0);
  });

  it('does not allocate or send a new sale without POS', async () => {
    denyPos();
    await expect(executeNewFinancialIntent(options())).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(executeCalls()).toHaveLength(0);
    expect(await runtime.database.table('financial_intents').count()).toBe(0);
  });

  it('retains a validated confirmation when the session changes during its response', async () => {
    runtime.execute.mockImplementation(async () => {
      runtime.handle.assertCurrent.mockImplementation(() => {
        throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
      });
      return { success: true, sale: { id: 'confirmed-sale' } };
    });
    const result = await executeNewFinancialIntent(options());
    expect(result.response).toMatchObject({ success: true, sale: { id: 'confirmed-sale' } });
    expect(executeCalls()).toHaveLength(1);
    const row = await runtime.database.table('financial_intents').get(result.intentId);
    expect(row.idempotencyKey).toBe('staff-pos-k');
    expect(row.dispatchAttemptCount).toBe(1);
    // No stale-session projection or write is allowed; receipt recovery owns it.
    expect(result.projection.outcome).toBe('projection_deferred');
    // Simulate expiration of the old lease, then authenticate the same actor
    // in another session for receipt-only recovery. Immutable origin survives.
    await runtime.database.table('financial_intents').update(row.id, { recoveryLeaseUntil: new Date(Date.now() - 1000).toISOString() });
    const replacement = { ...runtime.handle, sessionId: 'replacement', generation: 2, assertCurrent: vi.fn() };
    runtime.receipt.mockResolvedValue({ status: 'COMPLETED', result: { success: true, sale: { id: 'confirmed-sale' } } });
    await recoverFinancialIntent({ intentId: row.id, licenseKey: 'fixture-license', actorHandle: replacement, project: null });
    expect((await getFinancialIntent(row.id)).status).toBe('COMPLETED');
    expect((await getFinancialIntent(row.id)).originActorSessionId).toBe(row.originActorSessionId);
    expect(executeCalls()).toHaveLength(1);
  });

  it('reconciles a lost response after POS revocation without redispatching', async () => {
    runtime.execute.mockImplementation(async () => { denyPos(); throw new Error('Failed to fetch'); });
    await expect(executeNewFinancialIntent(options())).rejects.toMatchObject({ isFinancialOperationAmbiguous: true });
    const [row] = await runtime.database.table('financial_intents').toArray();
    expect(row.status).toBe('PENDING_RECEIPT');
    await recoverFinancialIntent({ intentId: row.id, licenseKey: 'fixture-license', actorHandle: runtime.handle });
    expect(executeCalls()).toHaveLength(1);
    runtime.receipt.mockResolvedValue({ status: 'COMPLETED', result: { success: true, sale: { id: 'confirmed-sale' } } });
    await recoverFinancialIntent({ intentId: row.id, licenseKey: 'fixture-license', actorHandle: runtime.handle });
    expect((await getFinancialIntent(row.id)).status).toBe('COMPLETED');
    expect(executeCalls()).toHaveLength(1);
    await expect(executeNewFinancialIntent({ ...options(), idempotencyKey: 'another-k' }))
      .rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(executeCalls()).toHaveLength(1);
  });

  it.each(['actor', 'tenant', 'device'])('does not recover another %s origin', async changed => {
    runtime.execute.mockRejectedValue(new Error('Failed to fetch'));
    await expect(executeNewFinancialIntent(options())).rejects.toMatchObject({ isFinancialOperationAmbiguous: true });
    const [row] = await runtime.database.table('financial_intents').toArray();
    const foreign = makeHandle();
    if (changed === 'actor') { foreign.actorKey = 'staff:other'; foreign.actorId = 'other'; }
    if (changed === 'tenant') foreign.tenant = { ...foreign.tenant, opaqueId: 'other', databaseName: 'other' };
    if (changed === 'device') foreign.deviceRef = 'other';
    await expect(recoverFinancialIntent({ intentId: row.id, licenseKey: 'fixture-license', actorHandle: foreign })).rejects.toThrow();
    expect(executeCalls()).toHaveLength(1);
  });
});


it('carries a late confirmation through the real cashier, repository, protocol and ledger', async () => {
  vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
  runtime.handle.actorType = 'staff'; runtime.handle.actorKey = 'staff:actor-a';
  const { salesCloudCashierService } = await import('../../salesCloud/salesCloudCashierService');
  runtime.execute.mockImplementation(async () => {
    runtime.handle.assertCurrent.mockImplementation(() => { throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' }); });
    return { success: true, sale: { id: 'confirmed-sale' } };
  });
  try {
    const sale = { id: 'sale-race-1', timestamp: '2026-08-29T12:34:56.000Z', total: '10', subtotal: '10',
      status: 'closed', items: [{ id: 'product-a', name: 'Producto', quantity: 1, price: 10, cost: 4 }],
      paymentMethod: 'cash', abono: '10', saldoPendiente: '0' };
    const result = await salesCloudCashierService.processCloudCashierSale({ sale, processedItems: sale.items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-a' }, total: '10' });
    expect(result).toMatchObject({ success: true, projectionDeferred: true, response: { sale: { id: 'confirmed-sale' } } });
    expect(executeCalls()).toHaveLength(1);
    expect((await getFinancialIntent(result.financialIntentId)).status).toBe('DISPATCHING');
  } finally { vi.unstubAllEnvs(); }
});
