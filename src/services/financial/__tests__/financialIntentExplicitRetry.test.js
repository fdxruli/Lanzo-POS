import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const rows = new Map();
  const rpcCalls = [];
  let transactionTail = Promise.resolve();

  const makeHandle = (overrides = {}) => {
    const handle = {
      actorKey: 'admin:actor-a',
      actorType: 'admin',
      actorId: 'actor-a',
      sessionId: 'session-a',
      generation: 1,
      deviceRef: 'device-a',
      tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
      stale: false,
      ...overrides
    };
    handle.assertCurrent = () => {
      if (handle.stale) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    };
    return handle;
  };

  const table = {
    async add(row) {
      if ([...rows.values()].some((candidate) => candidate.idempotencyKey === row.idempotencyKey)) {
        const error = new Error('ConstraintError');
        error.name = 'ConstraintError';
        throw error;
      }
      rows.set(row.id, structuredClone(row));
    },
    async get(id) {
      return rows.has(id) ? structuredClone(rows.get(id)) : undefined;
    },
    async update(id, changes) {
      if (!rows.has(id)) return 0;
      rows.set(id, { ...rows.get(id), ...structuredClone(changes) });
      return 1;
    },
    where(index) {
      if (index !== 'idempotencyKey') throw new Error(`Unexpected lookup index: ${index}`);
      return {
        equals(value) {
          return {
            async first() {
              return structuredClone([...rows.values()].find((row) => row.idempotencyKey === value));
            }
          };
        }
      };
    }
  };

  const state = {
    rows,
    rpcCalls,
    table,
    handle: null,
    stationId: 'station-a',
    receipt: vi.fn(),
    execute: vi.fn(),
    reset() {
      rows.clear();
      rpcCalls.splice(0);
      transactionTail = Promise.resolve();
      state.handle = makeHandle();
      state.stationId = 'station-a';
      state.receipt = vi.fn(async () => ({ status: 'NOT_FOUND' }));
      state.execute = vi.fn(async () => ({ success: true, sale: { id: 'cloud-sale-1' } }));
    },
    makeHandle
  };

  state.db = {
    table: () => table,
    transaction(...args) {
      const callback = args.at(-1);
      const run = transactionTail.then(() => callback());
      transactionTail = run.catch(() => {});
      return run;
    }
  };
  state.reset();
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
    deviceFingerprint: 'fixture-device',
    securityToken: 'fixture-security',
    staffSessionToken: 'fixture-staff'
  })
}));

vi.mock('../../supabase', () => ({
  supabaseClient: {
    async rpc(name, args) {
      runtime.rpcCalls.push({ name, args: structuredClone(args) });
      if (name === 'pos_get_cash_station_state') {
        return {
          data: {
            cash_station: { id: runtime.stationId },
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
  FINANCIAL_PROJECTION_STATUS,
  createFinancialIntent,
  executeNewFinancialIntent,
  getFinancialIntent,
  getFinancialIntentByIdempotencyKey
} from '../financialIntentLedger';
import {
  recoverFinancialIntent,
  retryExistingFinancialIntentExplicitly
} from '../financialIntentRecovery';

const SALE_OPERATION = 'sale.cashier_inventory';

const saleRequest = ({ oldNullBatches = false, total = '10' } = {}) => ({
  sale: {
    id: 'sale-retry-1',
    total,
    sold_at: '2026-08-29T12:34:56.000Z'
  },
  items: [{
    product_id: 'product-a',
    product_name: 'Producto A',
    quantity: '1',
    unit_price: total,
    ...(oldNullBatches ? { metadata: { batchesUsed: null } } : {})
  }],
  payments: [{ method: 'cash', amount: total }],
  cash_session_id: 'session-a',
  customer_id: null
});

const cashRequest = () => ({ opening_amount: '100', opening_origin: 'manual' });

const executeCalls = () => runtime.rpcCalls.filter(({ name }) => name === 'pos_execute_financial_operation_v1');
const receiptCalls = () => runtime.rpcCalls.filter(({ name }) => name === 'pos_get_financial_operation_receipt');

const seedIntent = async ({
  operationType = SALE_OPERATION,
  request = saleRequest(),
  idempotencyKey = 'sale-retry-k',
  projectionRequired = false,
  changes = {}
} = {}) => {
  const intent = await createFinancialIntent({
    operationType,
    request,
    licenseKey: 'fixture-license',
    idempotencyKey,
    cashSessionId: operationType.startsWith('sale.') ? 'session-a' : null,
    actorHandle: runtime.handle,
    projectionRequired
  });
  runtime.rows.set(intent.id, { ...runtime.rows.get(intent.id), ...structuredClone(changes) });
  return intent;
};

const explicitRetry = (intent, options = {}) => retryExistingFinancialIntentExplicitly({
  intentId: intent.id,
  candidateIntent: intent,
  licenseKey: 'fixture-license',
  actorHandle: runtime.handle,
  ...options
});

beforeEach(() => runtime.reset());

describe('explicit retry of an already-owned sale financial intent', () => {
  it('preserves the strict unique-K allocator with one local owner', async () => {
    await seedIntent();

    await expect(createFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED');

    expect(runtime.rows.size).toBe(1);
    expect(await getFinancialIntentByIdempotencyKey({ idempotencyKey: 'sale-retry-k', actorHandle: runtime.handle })).toBeTruthy();
  });

  it('recovers BLOCKED + exact K/H through NOT_FOUND with one controlled execute and no new row', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const before = await getFinancialIntent(intent.id);
    const response = { success: true, sale: { id: 'cloud-sale-retry-1' } };
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockResolvedValue(response);

    const result = await executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    });
    const after = await getFinancialIntent(intent.id);

    expect(result).toMatchObject({ intentId: intent.id, response });
    expect(runtime.rows.size).toBe(1);
    expect(after).toMatchObject({
      id: intent.id,
      idempotencyKey: before.idempotencyKey,
      requestHash: before.requestHash,
      requestPayload: before.requestPayload,
      canonicalRequest: before.canonicalRequest,
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 2,
      responsePayload: response
    });
    expect(receiptCalls()).toHaveLength(1);
    expect(executeCalls()).toHaveLength(1);
  });

  it('reuses the old durable null-batch request when the current equivalent request omits it', async () => {
    const oldRequest = saleRequest({ oldNullBatches: true });
    const intent = await seedIntent({ request: oldRequest, changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockResolvedValue({ success: true, sale: { id: 'cloud-sale-null-compatible' } });

    await executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    });

    expect(executeCalls()).toHaveLength(1);
    expect(executeCalls()[0].args.p_request).toEqual(oldRequest);
    expect((await getFinancialIntent(intent.id)).requestPayload).toEqual(oldRequest);
  });

  it('uses the existing completed receipt and repairs a pending projection without execute', async () => {
    const intent = await seedIntent({
      projectionRequired: true,
      changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 }
    });
    const response = { success: true, sale: { id: 'cloud-sale-completed-receipt' } };
    const project = vi.fn().mockResolvedValue({ ok: true });
    runtime.receipt.mockResolvedValue({ status: 'COMPLETED', result: response });

    await expect(explicitRetry(intent, { project })).resolves.toMatchObject({ intentId: intent.id, response });

    expect(executeCalls()).toHaveLength(0);
    expect(project).toHaveBeenCalledOnce();
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
      responsePayload: response
    });
  });

  it('keeps BLOCKED + PROCESSING receipt pending without execute', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'PROCESSING' });

    await expect(explicitRetry(intent)).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_RECEIPT_PENDING' });

    expect(executeCalls()).toHaveLength(0);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, lastReceiptStatus: 'PROCESSING' });
  });

  it('keeps BLOCKED + CONFLICT fail-closed without execute', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'CONFLICT' });

    await expect(explicitRetry(intent)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(executeCalls()).toHaveLength(0);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.CONFLICT });
  });

  it('keeps BLOCKED + unavailable receipt fail-closed without execute', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockRejectedValue(Object.assign(new TypeError('Failed to fetch'), { code: 'ERR_NETWORK' }));

    await expect(explicitRetry(intent)).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_RECEIPT_UNAVAILABLE' });

    expect(executeCalls()).toHaveLength(0);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.BLOCKED });
  });

  it('rejects a materially changed request hash before receipt or execute', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const before = await getFinancialIntent(intent.id);

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest({ total: '11' }),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_REQUEST_HASH_INVALID');

    const after = await getFinancialIntent(intent.id);
    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
    expect(after).toMatchObject({
      id: before.id,
      idempotencyKey: before.idempotencyKey,
      requestHash: before.requestHash,
      requestPayload: before.requestPayload,
      status: before.status,
      dispatchAttemptCount: before.dispatchAttemptCount
    });
  });

  it('rejects a different actor before receipt, lease or execute', async () => {
    await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const other = runtime.makeHandle({ actorKey: 'staff:actor-b', actorType: 'staff', actorId: 'actor-b' });

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: other,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');

    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
  });

  it('rejects a different device from adopting device-bound evidence', async () => {
    await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const otherDevice = runtime.makeHandle({ deviceRef: 'device-b' });

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: otherDevice,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_RECOVERY_DEVICE_MISMATCH');

    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
  });

  it('rejects a different tenant before receipt or execute', async () => {
    await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const otherTenant = runtime.makeHandle({ tenant: { opaqueId: 'tenant-b', databaseName: 'LanzoDB_t_tenant-b', generation: 1 } });

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: otherTenant,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');

    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
  });

  it.each([
    ['cash session', { cashSessionId: 'session-b' }],
    ['cash station', { cashStationId: 'station-b' }]
  ])('fails closed when the %s evidence differs', async (_label, change) => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });

    await expect(retryExistingFinancialIntentExplicitly({
      intentId: intent.id,
      candidateIntent: { ...intent, ...change },
      licenseKey: 'fixture-license',
      actorHandle: runtime.handle
    })).rejects.toThrow('FINANCIAL_OPERATION_ORIGIN_MISMATCH');

    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
  });

  it.each([FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, FINANCIAL_INTENT_STATUS.DISPATCHING])(
    'never resends an attempted %s intent after NOT_FOUND',
    async (status) => {
      const intent = await seedIntent({ changes: { status, dispatchAttemptCount: 1 } });
      runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(executeNewFinancialIntent({
        operationType: SALE_OPERATION,
        request: saleRequest(),
        licenseKey: 'fixture-license',
        idempotencyKey: 'sale-retry-k',
        cashSessionId: 'session-a',
        actorHandle: runtime.handle,
        projectionRequired: false
      })).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_RECEIPT_PENDING' });

      expect(receiptCalls()).toHaveLength(1);
      expect(executeCalls()).toHaveLength(0);
      expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, dispatchAttemptCount: 1 });
    }
  );

  it('reuses a completed duplicate without receipt or execute', async () => {
    const response = { success: true, sale: { id: 'cloud-sale-already-complete' } };
    const intent = await seedIntent({ changes: {
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 1,
      responsePayload: response
    } });

    const result = await executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    });

    expect(result).toMatchObject({ intentId: intent.id, response });
    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
  });

  it('returns BLOCKED after a controlled deterministic rejection and does not auto-execute again', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockResolvedValue({ success: false, code: 'BATCH_ALLOCATION_INVALID', message: 'invalid batch allocation' });

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).rejects.toMatchObject({ code: 'BATCH_ALLOCATION_INVALID' });

    expect(executeCalls()).toHaveLength(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 2 });

    await expect(recoverFinancialIntent({ intentId: intent.id, licenseKey: 'fixture-license', actorHandle: runtime.handle })).resolves.toMatchObject({ outcome: 'terminal_skipped' });
    expect(executeCalls()).toHaveLength(1);
  });

  it('moves a controlled ambiguous transport failure to PENDING_RECEIPT with no second execute', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).rejects.toThrow('Failed to fetch');

    expect(executeCalls()).toHaveLength(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, dispatchAttemptCount: 2 });

    await expect(recoverFinancialIntent({ intentId: intent.id, licenseKey: 'fixture-license', actorHandle: runtime.handle })).resolves.toMatchObject({ outcome: 'receipt_not_found_no_resend' });
    expect(executeCalls()).toHaveLength(1);
  });

  it('allows the existing zero-attempt PREPARED recovery edge without creating a duplicate', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.PREPARED, dispatchAttemptCount: 0 } });
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockResolvedValue({ success: true, sale: { id: 'cloud-sale-prepared' } });

    await expect(executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).resolves.toMatchObject({ intentId: intent.id });

    expect(executeCalls()).toHaveLength(1);
    expect(runtime.rows.size).toBe(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.COMPLETED, dispatchAttemptCount: 1 });
  });

  it('fences two simultaneous explicit retries to at most one execute RPC', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { success: true, sale: { id: 'cloud-sale-concurrent' } };
    });
    const options = {
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    };

    const results = await Promise.allSettled([
      executeNewFinancialIntent(options),
      executeNewFinancialIntent(options)
    ]);

    expect(executeCalls()).toHaveLength(1);
    expect(runtime.rows.size).toBe(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.COMPLETED });
  });

  it('keeps all immutable financial evidence unchanged after controlled retry', async () => {
    const intent = await seedIntent({ changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 } });
    const before = await getFinancialIntent(intent.id);
    const immutableFields = [
      'id', 'idempotencyKey', 'requestHash', 'requestContractVersion', 'requestPayload',
      'canonicalRequest', 'originActorKey', 'originActorType', 'originActorId',
      'originActorSessionId', 'originActorGeneration', 'originTenantOpaqueId',
      'originTenantDatabaseName', 'originTenantGeneration', 'originDeviceRef',
      'cashSessionId', 'cashStationId', 'createdAt'
    ];
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });

    await executeNewFinancialIntent({
      operationType: SALE_OPERATION,
      request: saleRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'sale-retry-k',
      cashSessionId: 'session-a',
      actorHandle: runtime.handle,
      projectionRequired: false
    });

    const after = await getFinancialIntent(intent.id);
    for (const field of immutableFields) expect(after[field]).toEqual(before[field]);
  });

  it('does not change cash BLOCKED recovery semantics or adopt a cash owner', async () => {
    const intent = await seedIntent({
      operationType: 'cash.open',
      request: cashRequest(),
      idempotencyKey: 'cash-retry-k',
      changes: { status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 }
    });

    await expect(recoverFinancialIntent({ intentId: intent.id, licenseKey: 'fixture-license', actorHandle: runtime.handle }))
      .resolves.toMatchObject({ outcome: 'terminal_skipped' });
    await expect(recoverFinancialIntent({
      intentId: intent.id,
      licenseKey: 'fixture-license',
      actorHandle: runtime.handle,
      explicitRetry: true,
      candidateIntent: intent
    })).rejects.toThrow('FINANCIAL_RECOVERY_EXPLICIT_RETRY_UNSUPPORTED');
    await expect(executeNewFinancialIntent({
      operationType: 'cash.open',
      request: cashRequest(),
      licenseKey: 'fixture-license',
      idempotencyKey: 'cash-retry-k',
      actorHandle: runtime.handle,
      projectionRequired: false
    })).rejects.toThrow('FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED');

    expect(receiptCalls()).toHaveLength(0);
    expect(executeCalls()).toHaveLength(0);
    expect(await getFinancialIntent(intent.id)).toMatchObject({ status: FINANCIAL_INTENT_STATUS.BLOCKED, dispatchAttemptCount: 1 });
  });
});
