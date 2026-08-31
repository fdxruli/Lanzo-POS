import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const state = {
    database: null,
    handle: null,
    execute: vi.fn(),
    receipt: vi.fn(),
    rpcCalls: []
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

vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: () => runtime.handle }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: async () => ({
    licenseKey: 'fixture-license',
    deviceFingerprint: 'device-a',
    securityToken: 'fixture-security-token',
    staffSessionToken: 'fixture-staff-session'
  })
}));

vi.mock('../../supabase', () => ({
  supabaseClient: {
    async rpc(name, args) {
      runtime.rpcCalls.push({ name, args: structuredClone(args) });
      if (name === 'pos_get_cash_station_state') {
        return {
          data: {
            cash_station: { id: 'station-a' },
            station_open_cash_session: { id: 'session-a' }
          },
          error: null
        };
      }
      if (name === 'pos_get_financial_operation_receipt') {
        try {
          return { data: await runtime.receipt(args), error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
      if (name === 'pos_execute_financial_operation_v1') {
        try {
          return { data: await runtime.execute(args), error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  }
}));

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

const executeCalls = () => runtime.rpcCalls.filter(({ name }) => name === 'pos_execute_financial_operation_v1');

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
