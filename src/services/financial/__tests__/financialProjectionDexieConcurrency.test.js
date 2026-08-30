import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  database: null,
  handle: {
    actorKey: 'admin:actor-a',
    actorType: 'admin',
    actorId: 'actor-a',
    sessionId: 'session-a',
    generation: 1,
    deviceRef: 'device-a',
    tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
    assertCurrent: vi.fn()
  }
}));

vi.mock('../../db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: {
    table: (name) => runtime.database.table(name),
    transaction: (...args) => runtime.database.transaction(...args)
  }
}));

vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: () => runtime.handle }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async () => ({
    licenseKey: 'fixture-license',
    deviceFingerprint: 'device-a',
    securityToken: 'fixture-security-token',
    staffSessionToken: 'fixture-staff-session'
  }))
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: vi.fn() }
}));

import {
  FINANCIAL_INTENT_STATUS,
  FINANCIAL_PROJECTION_STATUS,
  getFinancialIntent,
  runFinancialProjectionUnderLease
} from '../financialIntentLedger';
import { retryFinancialIntentProjection } from '../financialProjectionRepair';

const intentId = 'intent-projection-race';

const makeIntent = () => ({
  id: intentId,
  ledgerVersion: 1,
  operationType: 'sale.cashier',
  idempotencyKey: 'projection-race-k',
  requestHash: 'projection-race-h',
  requestContractVersion: 1,
  requestPayload: { sale: { id: 'sale-1' }, items: [], payments: [] },
  canonicalRequest: { sale: { id: 'sale-1' }, items: [], payments: [] },
  originActorKey: runtime.handle.actorKey,
  originActorType: runtime.handle.actorType,
  originActorId: runtime.handle.actorId,
  originActorSessionId: runtime.handle.sessionId,
  originActorGeneration: runtime.handle.generation,
  originTenantOpaqueId: runtime.handle.tenant.opaqueId,
  originTenantDatabaseName: runtime.handle.tenant.databaseName,
  originTenantGeneration: runtime.handle.tenant.generation,
  originDeviceRef: runtime.handle.deviceRef,
  cashSessionId: null,
  cashStationId: 'station-a',
  status: FINANCIAL_INTENT_STATUS.COMPLETED,
  dispatchAttemptCount: 1,
  projectionStatus: FINANCIAL_PROJECTION_STATUS.PENDING,
  projectionErrorCode: null,
  responsePayload: { success: true, sale: { id: 'cloud-sale-1' } },
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
  recoveryLeaseId: null,
  recoveryLeaseUntil: null,
  recoveryAttemptCount: 0,
  lastRecoveryAt: null,
  lastRecoveryCode: null
});

const seedIntent = async () => {
  await runtime.database.table('financial_intents').put(makeIntent());
};

const openDatabase = async () => {
  const name = `lanzo-projection-race-${crypto.randomUUID()}`;
  const database = new Dexie(name);
  database.version(1).stores({ financial_intents: 'id, &idempotencyKey' });
  await database.open();
  runtime.database = database;
  await seedIntent();
};

beforeEach(async () => {
  runtime.handle.assertCurrent.mockClear();
  await openDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  const database = runtime.database;
  runtime.database = null;
  if (database?.isOpen()) database.close();
  if (database) await Dexie.delete(database.name);
});

describe('financial projection real Dexie ownership', () => {
  it('blocks background repair while synchronous projection owns the lease', async () => {
    let releaseSynchronousProjection;
    let markSynchronousStarted;
    const synchronousStarted = new Promise((resolve) => { markSynchronousStarted = resolve; });
    const synchronousGate = new Promise((resolve) => { releaseSynchronousProjection = resolve; });
    let snapshotCalls = 0;
    let payloadCalls = 0;
    const synchronousProject = vi.fn(async () => {
      markSynchronousStarted();
      await synchronousGate;
      snapshotCalls += 1;
      payloadCalls += 1;
      return { owner: 'synchronous' };
    });
    const backgroundProject = vi.fn(async () => ({ owner: 'background' }));

    const synchronousPromise = runFinancialProjectionUnderLease({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      project: synchronousProject
    });
    await synchronousStarted;

    await expect(retryFinancialIntentProjection({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      project: backgroundProject
    })).resolves.toMatchObject({ outcome: 'lease_held' });
    expect(backgroundProject).not.toHaveBeenCalled();

    releaseSynchronousProjection();
    await expect(synchronousPromise).resolves.toMatchObject({ outcome: 'projection_applied' });

    expect(snapshotCalls).toBe(1);
    expect(payloadCalls).toBe(1);
    expect(await getFinancialIntent(intentId)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
      recoveryLeaseId: null
    });
  });

  it('blocks synchronous projection while background repair owns the lease', async () => {
    let releaseBackgroundProjection;
    let markBackgroundStarted;
    const backgroundStarted = new Promise((resolve) => { markBackgroundStarted = resolve; });
    const backgroundGate = new Promise((resolve) => { releaseBackgroundProjection = resolve; });
    let handlerCalls = 0;
    const backgroundProject = vi.fn(async () => {
      markBackgroundStarted();
      await backgroundGate;
      handlerCalls += 1;
      return { owner: 'background' };
    });
    const synchronousProject = vi.fn(async () => {
      handlerCalls += 1;
      return { owner: 'synchronous' };
    });

    const backgroundPromise = retryFinancialIntentProjection({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      project: backgroundProject
    });
    await backgroundStarted;

    await expect(runFinancialProjectionUnderLease({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      project: synchronousProject
    })).rejects.toMatchObject({ code: 'FINANCIAL_RECOVERY_LEASE_HELD' });
    expect(synchronousProject).not.toHaveBeenCalled();

    releaseBackgroundProjection();
    await expect(backgroundPromise).resolves.toMatchObject({ outcome: 'projection_applied' });
    expect(handlerCalls).toBe(1);
    expect(await getFinancialIntent(intentId)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
      recoveryLeaseId: null
    });
  });

  it('fails closed when a projection lease expires and another owner takes over', async () => {
    const baseTime = Date.now();
    let releaseStaleProjection;
    let markStaleStarted;
    const staleStarted = new Promise((resolve) => { markStaleStarted = resolve; });
    const staleGate = new Promise((resolve) => { releaseStaleProjection = resolve; });
    const staleProject = vi.fn(async () => {
      markStaleStarted();
      await staleGate;
      return { owner: 'stale' };
    });
    const replacementProject = vi.fn(async () => ({ owner: 'replacement' }));

    const stalePromise = runFinancialProjectionUnderLease({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 1000,
      currentTime: baseTime,
      project: staleProject
    });
    await staleStarted;

    await expect(runFinancialProjectionUnderLease({
      intentId,
      actorHandle: runtime.handle,
      leaseMs: 5000,
      currentTime: baseTime + 2000,
      project: replacementProject
    })).resolves.toMatchObject({ outcome: 'projection_applied' });

    releaseStaleProjection();
    await expect(stalePromise).rejects.toThrow('FINANCIAL_RECOVERY_LEASE_LOST');
    expect(await getFinancialIntent(intentId)).toMatchObject({
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
      recoveryLeaseId: null
    });
    expect(replacementProject).toHaveBeenCalledOnce();
  });
});
