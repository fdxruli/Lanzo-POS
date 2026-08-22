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
    handle: null,
    makeHandle,
    execute: async () => ({ success: true, receipt: 'server-result' }),
    receipt: async () => ({ status: 'NOT_FOUND' }),
    rpcCalls: []
  };
});

vi.mock('../../db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: { table: () => runtime.table }
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
      if (name === 'pos_execute_financial_operation_v1') return { data: await runtime.execute(args), error: null };
      if (name === 'pos_get_financial_operation_receipt') return { data: await runtime.receipt(args), error: null };
      throw new Error(`Unexpected RPC ${name}`);
    }
  }
}));

import {
  FINANCIAL_INTENT_STATUS,
  createFinancialIntent,
  executeFinancialIntent,
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
      .rejects.toThrow('FINANCIAL_OPERATION_ORIGIN_MISMATCH');
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
