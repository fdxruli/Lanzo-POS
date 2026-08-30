import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const rows = new Map();
  const table = {
    async add(row) {
      if ([...rows.values()].some((candidate) => candidate.idempotencyKey === row.idempotencyKey)) {
        const error = new Error('ConstraintError');
        error.name = 'ConstraintError';
        throw error;
      }
      rows.set(row.id, structuredClone(row));
    },
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : undefined; },
    async update(id, changes) { rows.set(id, { ...rows.get(id), ...structuredClone(changes) }); },
    where() { return { anyOf: (...statuses) => ({ toArray: async () => [...rows.values()].filter((row) => statuses.includes(row.status)).map(structuredClone) }) }; }
  };
  const makeHandle = (actorKey = 'admin:actor-a') => {
    let current = true;
    return {
      actorKey,
      actorType: actorKey.split(':')[0],
      actorId: actorKey.split(':')[1],
      sessionId: 'session-a',
      generation: 1,
      deviceRef: 'device-a',
      tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
      assertCurrent() {
        if (!current) {
          const error = new Error('ACTOR_CONTEXT_STALE');
          error.code = 'ACTOR_CONTEXT_STALE';
          throw error;
        }
      },
      makeStale() { current = false; }
    };
  };
  return {
    rows,
    table,
    db: {
      table: () => table,
      transaction: async (...args) => args.at(-1)()
    },
    handle: null,
    makeHandle,
    execute: async () => ({ success: true, receipt: 'server-result' }),
    executeError: null,
    receipt: async () => ({ status: 'NOT_FOUND' }),
    rpcCalls: []
  };
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
    licenseKey: 'fixture-license-secret',
    deviceFingerprint: 'fixture-device',
    securityToken: 'fixture-security-secret',
    staffSessionToken: 'fixture-staff-secret'
  })
}));
vi.mock('../../supabase', () => ({
  supabaseClient: {
    rpc: async (name, args) => {
      runtime.rpcCalls.push({ name, args });
      if (name === 'pos_get_cash_station_state') return { data: { cash_station: { id: 'station-a' } }, error: null };
      if (name === 'pos_execute_financial_operation_v1') {
        if (runtime.executeError) return { data: null, error: runtime.executeError };
        return { data: await runtime.execute(args), error: null };
      }
      if (name === 'pos_get_financial_operation_receipt') return { data: await runtime.receipt(args), error: null };
      throw new Error(`Unexpected RPC ${name}`);
    }
  }
}));

import {
  FINANCIAL_INTENT_STATUS,
  createFinancialIntent,
  executeFinancialIntent,
  executePreparedFinancialIntentForRecovery,
  getFinancialIntent,
  markFinancialIntentProjectionApplied,
  markFinancialIntentProjectionFailed
} from '../financialIntentLedger';

const createOpenIntent = (options = {}) => createFinancialIntent({
  operationType: 'cash.open',
  request: { opening_amount: '100', opening_origin: 'manual' },
  licenseKey: 'fixture-license-secret',
  idempotencyKey: 'fixture-k',
  actorHandle: runtime.handle,
  ...options
});

describe('financial intent ledger', () => {
  beforeEach(() => {
    runtime.rows.clear();
    runtime.rpcCalls.splice(0);
    runtime.handle = runtime.makeHandle();
    runtime.execute = async () => ({ success: true, receipt: 'server-result' });
    runtime.executeError = null;
    runtime.receipt = async () => ({ status: 'NOT_FOUND' });
  });

  it('persists immutable intent evidence before any financial execution RPC', async () => {
    const intent = await createOpenIntent();
    expect(runtime.rpcCalls.map((call) => call.name)).toEqual(['pos_get_cash_station_state']);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      idempotencyKey: 'fixture-k',
      status: FINANCIAL_INTENT_STATUS.PREPARED,
      originActorKey: 'admin:actor-a',
      originDeviceRef: 'device-a'
    });

    await executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle });
    expect(runtime.rpcCalls.map((call) => call.name)).toEqual([
      'pos_get_cash_station_state',
      'pos_execute_financial_operation_v1'
    ]);
  });

  it('never stores auth material and rejects secret-bearing request payloads', async () => {
    const intent = await createOpenIntent();
    const serialized = JSON.stringify(await getFinancialIntent(intent.id));
    expect(serialized).not.toContain('fixture-license-secret');
    expect(serialized).not.toContain('fixture-security-secret');
    expect(serialized).not.toContain('fixture-staff-secret');
    await expect(createOpenIntent({ idempotencyKey: 'secret-k', request: { opening_amount: '1', security_token: 'forbidden' } }))
      .rejects.toThrow('FINANCIAL_INTENT_SECRET_FIELD_FORBIDDEN');
  });

  it('rejects access and refresh token fields recursively before persistence or RPC', async () => {
    for (const field of ['access_token', 'accessToken', 'refresh_token', 'refreshToken']) {
      const idempotencyKey = `secret-${field}`;
      const rowsBefore = runtime.rows.size;
      const rpcCallsBefore = runtime.rpcCalls.length;

      await expect(createOpenIntent({
        idempotencyKey,
        request: {
          opening_amount: '1',
          metadata: { auth: { [field]: 'obviously-fake-token' } }
        }
      })).rejects.toThrow('FINANCIAL_INTENT_SECRET_FIELD_FORBIDDEN');

      expect(runtime.rows.size).toBe(rowsBefore);
      expect(runtime.rpcCalls).toHaveLength(rpcCallsBefore);
      expect([...runtime.rows.values()].some((row) => row.idempotencyKey === idempotencyKey)).toBe(false);
    }
  });

  it('enforces one tenant-local owner for a supplied external idempotency key', async () => {
    await createOpenIntent();
    await expect(createOpenIntent()).rejects.toThrow('FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED');
    expect(runtime.rows.size).toBe(1);
  });

  it('keeps K, H, request and origin immutable across status and projection writes', async () => {
    const intent = await createOpenIntent();
    intent.requestPayload.opening_amount = '999';
    await executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle });
    await markFinancialIntentProjectionApplied({ intentId: intent.id, actorHandle: runtime.handle });
    const completed = await getFinancialIntent(intent.id);
    expect(completed).toMatchObject({
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash,
      requestPayload: { opening_amount: '100', opening_origin: 'manual' },
      originActorKey: intent.originActorKey,
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      projectionStatus: 'APPLIED'
    });
    expect(runtime.rpcCalls.find((call) => call.name === 'pos_execute_financial_operation_v1')?.args.p_request.opening_amount).toBe('100');
    await expect(markFinancialIntentProjectionFailed({ intentId: intent.id, actorHandle: runtime.makeHandle('admin:actor-b') }))
      .rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
  });

  it.each(['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED'])('preserves the full cash.admin_close %s review response as terminal evidence', async (code) => {
    const intent = await createOpenIntent({
      operationType: 'cash.admin_close',
      request: { cash_session_id: 'cash-session-1', expected_version: 7, close_mode: 'admin_audited' }
    });
    const reviewResponse = {
      success: false,
      code,
      message: 'La caja cambió y requiere revisión administrativa.',
      cash_session: {
        id: 'cash-session-1',
        actor_key: 'staff:historical-owner',
        status: 'open',
        server_version: 8,
        closing_counted_amount: null
      },
      current_totals: { expected_cash: '75.00' },
      result: { review_context: 'must-not-replace-the-envelope' }
    };
    runtime.execute = async () => reviewResponse;

    const execution = await executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle });

    expect(execution.response).toEqual(reviewResponse);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'COMPLETED',
      responsePayload: reviewResponse,
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it('preserves an admin review response at the PREPARED zero-attempt recovery dispatch edge', async () => {
    const intent = await createOpenIntent({
      operationType: 'cash.admin_close',
      request: { cash_session_id: 'cash-session-1', expected_version: 7, close_mode: 'admin_audited' }
    });
    const reviewResponse = {
      success: false,
      code: 'CASH_TOTALS_CHANGED',
      message: 'Los totales cambiaron.',
      cash_session: { id: 'cash-session-1', status: 'open', server_version: 8 },
      current_totals: { expected_cash: '75.00' }
    };
    runtime.execute = async () => reviewResponse;

    const execution = await executePreparedFinancialIntentForRecovery({
      intentId: intent.id,
      licenseKey: 'fixture-license-secret',
      actorHandle: runtime.handle
    });

    expect(execution.response).toEqual(reviewResponse);
    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'COMPLETED',
      responsePayload: reviewResponse,
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
  });

  it.each([
    ['cash.close', 'VERSION_CONFLICT'],
    ['cash.admin_close', 'UNEXPECTED_ADMIN_CLOSE_REJECTION']
  ])('does not grant the admin review exception to %s / %s', async (operationType, code) => {
    const intent = await createOpenIntent({ operationType, request: { cash_session_id: 'cash-session-1' } });
    runtime.execute = async () => ({
      success: false,
      code,
      message: 'Deterministic server rejection',
      cash_session: { id: 'cash-session-1', status: 'open' }
    });

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toMatchObject({ code });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1,
      responsePayload: null
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it('does not grant the admin review exception to another operation at the recovery dispatch edge', async () => {
    const intent = await createOpenIntent({ operationType: 'cash.close', request: { cash_session_id: 'cash-session-1' } });
    runtime.execute = async () => ({
      success: false,
      code: 'CASH_TOTALS_CHANGED',
      message: 'Deterministic close rejection',
      cash_session: { id: 'cash-session-1', status: 'open' }
    });

    await expect(executePreparedFinancialIntentForRecovery({
      intentId: intent.id,
      licenseKey: 'fixture-license-secret',
      actorHandle: runtime.handle
    })).rejects.toMatchObject({ code: 'CASH_TOTALS_CHANGED' });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1,
      responsePayload: null
    });
  });

  it('keeps an ambiguous dispatch pending, then records the authoritative completed receipt without resending', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw new TypeError('Failed to fetch'); };
    runtime.receipt = async () => ({ status: 'COMPLETED', result: { success: true, receipt: 'authoritative' } });
    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle })).rejects.toThrow('Failed to fetch');
    const row = await getFinancialIntent(intent.id);
    expect(row).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      responsePayload: { success: true, receipt: 'authoritative' },
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
  });

  it('keeps an explicit network failure receipt-first and pending after NOT_FOUND without resending', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw new TypeError('Failed to fetch'); };
    runtime.receipt = async () => ({ status: 'NOT_FOUND' });

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toThrow('Failed to fetch');

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND',
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(1);
  });

  it('fails closed on a structured PostgreSQL 42703 response without querying a receipt', async () => {
    const intent = await createOpenIntent();
    runtime.executeError = {
      code: '42703',
      message: 'column cash_sessions.closed_by_actor_key does not exist',
      details: null,
      hint: 'Perhaps you meant cash_sessions.closed_by_admin_user_id'
    };

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toMatchObject({ code: '42703' });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1,
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it.each([
    ['message', 'IDEMPOTENCY_CONFLICT', FINANCIAL_INTENT_STATUS.CONFLICT],
    ['details', 'FINANCIAL_REQUEST_HASH_INVALID', FINANCIAL_INTENT_STATUS.BLOCKED],
    ['hint', 'FINANCIAL_OPERATION_ORIGIN_MISMATCH', FINANCIAL_INTENT_STATUS.BLOCKED],
    ['causeCode', 'FINANCIAL_REQUEST_HASH_INVALID', FINANCIAL_INTENT_STATUS.BLOCKED],
    ['causeMessage', 'IDEMPOTENCY_CONFLICT', FINANCIAL_INTENT_STATUS.CONFLICT]
  ])('finds known protocol code %s inside a realistic P0001 envelope before SQLSTATE classification', async (field, code, expectedStatus) => {
    const intent = await createOpenIntent();
    const postgrestError = {
      code: 'P0001',
      message: 'cash operation rejected',
      details: 'The server rejected this request',
      hint: null
    };
    if (field === 'message' || field === 'details' || field === 'hint') postgrestError[field] = code;
    if (field === 'causeCode') postgrestError.cause = { code, message: 'wrapped database rejection' };
    if (field === 'causeMessage') postgrestError.cause = { code: 'WRAPPED_ERROR', message: code };
    runtime.executeError = postgrestError;

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toBe(postgrestError);

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: expectedStatus,
      dispatchAttemptCount: 1,
      lastProtocolCode: code
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it.each([
    ['P0001', { code: 'P0001', message: 'cash close implementation failed', details: 'raised by PL/pgSQL', hint: null }],
    ['PGRST202', { code: 'PGRST202', message: 'Could not find the function in the schema cache', details: null, hint: null, status: 404 }],
    ['PGRST003', { code: 'PGRST003', message: 'Timed out waiting for a database connection', details: null, hint: null, status: 504 }]
  ])('fails closed on deterministic structured database error %s', async (label, postgrestError) => {
    const intent = await createOpenIntent();
    expect(postgrestError.code).toBe(label);
    runtime.executeError = postgrestError;

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toBe(postgrestError);

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it('gives a deterministic HTTP 4xx response priority over transport-like text', async () => {
    const intent = await createOpenIntent();
    const clientError = { status: 400, message: 'Failed to fetch the requested deterministic resource' };
    runtime.executeError = clientError;

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toBe(clientError);

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it.each(['ECONNRESET', 'EPIPE'])('treats cause transport code %s as ambiguous without mistaking five-character codes for SQLSTATE', async (transportCode) => {
    const intent = await createOpenIntent();
    const transportError = Object.assign(new Error('wrapped fetch transport failure'), {
      cause: { code: transportCode, message: 'connection reset while awaiting the response' }
    });
    runtime.execute = async () => { throw transportError; };
    runtime.receipt = async () => ({ status: 'NOT_FOUND' });

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toBe(transportError);

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND'
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(1);
  });

  it.each([502, 503, 504])('keeps HTTP %s gateway ambiguity receipt-first after exactly one execute attempt', async (status) => {
    const intent = await createOpenIntent();
    const gatewayError = Object.assign(new Error(`HTTP ${status} upstream gateway failure`), {
      status,
      isDeterministicServerResponse: true
    });
    runtime.execute = async () => { throw gatewayError; };
    runtime.receipt = async () => ({ status: 'NOT_FOUND' });

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toBe(gatewayError);

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND',
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(1);
  });

  it('lets an explicit gateway status outrank the deterministic success:false response marker', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => ({
      success: false,
      status: 503,
      message: 'Upstream service unavailable before an authoritative response'
    });
    runtime.receipt = async () => ({ status: 'NOT_FOUND' });

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toMatchObject({ status: 503, isDeterministicServerResponse: true });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND'
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(1);
  });

  it('fails closed on a generic deterministic application exception', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw new Error('Unexpected deterministic application failure'); };

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toThrow('Unexpected deterministic application failure');

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it('does not treat a locally aborted business operation as transport ambiguity', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw new Error('Business operation aborted by validation'); };

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toThrow('Business operation aborted by validation');

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it.each([
    ['IDEMPOTENCY_CONFLICT', FINANCIAL_INTENT_STATUS.CONFLICT],
    ['FINANCIAL_REQUEST_HASH_INVALID', FINANCIAL_INTENT_STATUS.BLOCKED],
    ['FINANCIAL_OPERATION_ORIGIN_MISMATCH', FINANCIAL_INTENT_STATUS.BLOCKED]
  ])('preserves %s dispatch semantics as %s', async (code, expectedStatus) => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw Object.assign(new Error(code), { code }); };

    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle }))
      .rejects.toMatchObject({ code });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: expectedStatus,
      dispatchAttemptCount: 1,
      lastProtocolCode: code
    });
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
  });

  it('also fails closed on structured errors at the PREPARED zero-attempt recovery dispatch edge', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => {
      throw Object.assign(new Error('column cash_sessions.closed_by_actor_key does not exist'), {
        code: '42703',
        details: null,
        hint: null
      });
    };

    await expect(executePreparedFinancialIntentForRecovery({
      intentId: intent.id,
      licenseKey: 'fixture-license-secret',
      actorHandle: runtime.handle
    })).rejects.toMatchObject({ code: '42703' });

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.BLOCKED,
      dispatchAttemptCount: 1,
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
  });

  it('keeps genuine transport ambiguity pending at the recovery dispatch edge and cannot dispatch it again', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => { throw new TypeError('Network request failed'); };

    await expect(executePreparedFinancialIntentForRecovery({
      intentId: intent.id,
      licenseKey: 'fixture-license-secret',
      actorHandle: runtime.handle
    })).rejects.toThrow('Network request failed');

    expect(await getFinancialIntent(intent.id)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      dispatchAttemptCount: 1,
      idempotencyKey: intent.idempotencyKey,
      requestHash: intent.requestHash
    });
    await expect(executePreparedFinancialIntentForRecovery({
      intentId: intent.id,
      licenseKey: 'fixture-license-secret',
      actorHandle: runtime.handle
    })).rejects.toThrow('FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE');
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_execute_financial_operation_v1')).toHaveLength(1);
  });

  it('does not use a stale actor to query a receipt or mutate the old intent', async () => {
    const intent = await createOpenIntent();
    runtime.execute = async () => {
      runtime.handle.makeStale();
      throw new TypeError('network timeout');
    };
    await expect(executeFinancialIntent({ intent, licenseKey: 'fixture-license-secret', actorHandle: runtime.handle })).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(runtime.rpcCalls.filter((call) => call.name === 'pos_get_financial_operation_receipt')).toHaveLength(0);
    expect((await getFinancialIntent(intent.id)).status).toBe(FINANCIAL_INTENT_STATUS.DISPATCHING);
  });
});
