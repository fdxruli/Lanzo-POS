import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { setTimeout as realDelay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActorRuntimeController } from '../../auth/actorRuntimeController';
import { createSyncExecutionScope } from '../syncExecutionScope';
import { OUTBOX_STATUS, RETRY_CONFIG, SYNC_LIMITS } from '../syncConstants';

const mocks = vi.hoisted(() => ({ database: null, actor: null, licenseKey: null }));

vi.mock('../../auth/actorRuntimeController', async (importOriginal) => ({
  ...(await importOriginal()),
  get actorRuntimeController() { return mocks.actor; }
}));
vi.mock('../../db/dexie', () => ({ get db() { return mocks.database; } }));
vi.mock('../syncDexieBootstrap', () => ({}));
vi.mock('../../posRealtime', () => ({
  buildPosRealtimeTopic: () => null,
  startPosRealtimeListener: vi.fn(),
  stopPosRealtimeListener: vi.fn()
}));
vi.mock('../posSyncClient', () => ({ posSyncClient: {} }));
vi.mock('../syncMetaService', () => ({
  syncMetaService: { setRealtimeStatus: vi.fn(), setSyncEnabled: vi.fn() }
}));
vi.mock('../../tenant/localTenantGuard', () => {
  const assertAccess = async ({ license_key }) => {
    if (license_key !== mocks.licenseKey) throw Object.assign(new Error('Tenant changed'), { code: 'LOCAL_TENANT_SYNC_BLOCKED' });
  };
  return {
    assertLocalTenantSyncAccess: assertAccess,
    runWithLocalTenantSyncLease: async (source, _options, job) => {
      await assertAccess(source);
      return job();
    },
    isLocalTenantAccessError: (error) => error?.code === 'LOCAL_TENANT_SYNC_BLOCKED'
  };
});
vi.mock('../../Logger', () => ({ default: { log: vi.fn(), warn: vi.fn() } }));

let orchestrator;
let service;
let table;
let push;
let events;
let readBatch;
let scope;

const start = () => orchestrator.start({
  licenseDetails: { license_key: mocks.licenseKey, features: { cloud_pos_sync: true } },
  reason: 'initial_bootstrap', executionScope: scope
});
const grant = (actorId, sessionId) => {
  mocks.actor.beginAuthentication({ actorType: 'staff' });
  mocks.actor.grant({ actorType: 'staff', actorId, sessionId, deviceRef: 'test-device', permissions: ['products'] });
};
const waitFor = async (assert) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await vi.advanceTimersByTimeAsync(1);
    try { return await assert(); }
    catch (error) {
      if (attempt === 199) throw error;
      await realDelay(1);
    }
  }
};
const enqueue = (id, options = {}) => service.enqueueOperation({
  licenseKey: mocks.licenseKey, entityType: 'product', operation: 'upsert', entityId: id,
  idempotencyKey: id, ...options
});
const advanceToRetry = async (id) => {
  const row = await table.get(id);
  expect(row.status).toBe(OUTBOX_STATUS.PENDING);
  const remaining = Date.parse(row.nextRetryAt) - Date.now();
  expect(remaining).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(remaining);
};

beforeEach(async () => {
  vi.resetModules();
  scope = null;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  mocks.licenseKey = 'TEST-A';
  mocks.actor = createActorRuntimeController({
    getTenantAuthority: () => ({ opaqueId: mocks.licenseKey, databaseName: mocks.licenseKey, generation: 1 })
  });
  grant('origin', 'session-one');
  mocks.database = new Dexie('outbox-drain-' + crypto.randomUUID());
  mocks.database.version(1).stores({ sync_outbox: 'id,[status+createdAt],status,licenseKey' });
  await mocks.database.open();
  table = mocks.database.table('sync_outbox');
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('navigator', { onLine: true });
  ({ syncOutboxService: service } = await import('../syncOutboxService'));
  ({ posSyncOrchestrator: orchestrator } = await import('../posSyncOrchestrator'));
  push = vi.fn(async () => ({ success: true }));
  orchestrator.registerEntitySyncHandler('product', { pushOperation: push });
  readBatch = vi.spyOn(service, 'getPendingOperations');
});

afterEach(async () => {
  await orchestrator.stop({ preserveStatus: true });
  if (scope) await scope.settleObserved();
  vi.useRealTimers();
  await mocks.database.delete();
  vi.unstubAllGlobals();
});

describe('POS Outbox con IndexedDB', () => {
  it.each(['legacy', 'scoped'])('A: wakes on enqueue and retries at the persisted deadline (%s)', async (mode) => {
    if (mode === 'scoped') scope = createSyncExecutionScope();
    await start();
    await orchestrator.processOutbox('bootstrap_outbox');
    push.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    if (mode === 'scoped') {
      const { buildSyncOutboxRecord } = await import('../syncOutboxService');
      await mocks.database.transaction('rw', table, () => table.put(buildSyncOutboxRecord({
        licenseKey: mocks.licenseKey, entityType: 'product', operation: 'upsert',
        entityId: 'retry-product', idempotencyKey: 'retry-product'
      })));
    } else {
      await enqueue('retry-product');
    }
    await waitFor(async () => expect(await table.get('retry-product')).toMatchObject({
      status: OUTBOX_STATUS.PENDING, attempts: 1
    }));
    const retryAt = Date.parse((await table.get('retry-product')).nextRetryAt);
    await vi.advanceTimersByTimeAsync(retryAt - Date.now() - 1);
    expect(push).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(async () => expect((await table.get('retry-product')).status).toBe(OUTBOX_STATUS.SYNCED));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls.map(([row]) => row.idempotencyKey)).toEqual(['retry-product', 'retry-product']);
  });

  it('B: drains 51 operations in ordered batches of at most 50', async () => {
    await start();
    const ids = Array.from({ length: 51 }, (_, index) => 'product-' + String(index).padStart(2, '0'));
    for (const id of ids) await enqueue(id);
    await expect(orchestrator.processOutbox('bootstrap_outbox')).resolves.toEqual({ processed: SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT });
    await waitFor(async () => expect(await table.where('status').equals(OUTBOX_STATUS.SYNCED).count()).toBe(51));
    expect(push.mock.calls.map(([row]) => row.id)).toEqual(ids);
  });

  it('C: bypasses unknown handlers, held actors, future retries and terminal statuses', async () => {
    await start();
    for (let index = 0; index < 51; index += 1) await enqueue('unknown-' + index, { entityType: 'unknown' });
    await enqueue('foreign-actor', { actorSensitive: true, originActor: { actorKey: 'staff:another' } });
    await enqueue('unresolved', { actorSensitive: true });
    await enqueue('future');
    await table.update('future', { nextRetryAt: new Date(Date.now() + 5000).toISOString() });
    for (const status of [OUTBOX_STATUS.FAILED, OUTBOX_STATUS.CONFLICT, OUTBOX_STATUS.UPDATE_REQUIRED]) {
      await enqueue(status);
      await table.update(status, { status });
    }
    await enqueue('valid');
    await orchestrator.processOutbox('bootstrap_outbox');
    await waitFor(async () => expect((await table.get('valid')).status).toBe(OUTBOX_STATUS.SYNCED));
    expect(push.mock.calls.map(([row]) => row.id)).toEqual(['valid']);
    await vi.advanceTimersByTimeAsync(100);
    const scans = readBatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(readBatch).toHaveBeenCalledTimes(scans);
    await advanceToRetry('future');
    await waitFor(async () => expect((await table.get('future')).status).toBe(OUTBOX_STATUS.SYNCED));
    expect(push.mock.calls.map(([row]) => row.id)).toEqual(['valid', 'future']);
  });

  it.each(['actor', 'session', 'tenant', 'stop'])('D: fences a running batch and its retry when changing %s', async (change) => {
    await start();
    await enqueue('a-retry', { actorSensitive: true, captureCurrentActor: true });
    await enqueue('b-in-flight');
    await enqueue('c-unsent', { actorSensitive: true, captureCurrentActor: true });
    let confirm;
    push.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const run = orchestrator.processOutbox('bootstrap_outbox');
    await waitFor(() => expect(confirm).toBeTypeOf('function'));
    if (change === 'tenant' || change === 'stop') {
      await orchestrator.stop({ preserveStatus: true });
      if (change === 'tenant') mocks.licenseKey = 'TEST-B';
    } else {
      mocks.actor.lock('test_authority_change');
      if (change === 'actor') grant('another', 'session-two');
    }
    confirm({ success: true });
    if (change === 'tenant') await expect(run).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });
    else await expect(run).resolves.toMatchObject({ skipped: true, reason: 'runtime_changed' });
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.BASE_DELAY_MS + 500);
    expect(push.mock.calls.map(([row]) => row.id)).toEqual(['a-retry', 'b-in-flight']);
    expect((await table.get('a-retry')).status).toBe(OUTBOX_STATUS.PENDING);
    expect((await table.get('c-unsent')).status).toBe(OUTBOX_STATUS.PENDING);
    if (change === 'session') {
      grant('origin', 'session-two');
      await waitFor(async () => expect((await table.get('a-retry')).status).toBe(OUTBOX_STATUS.SYNCED));
    }
  });

  it('E: coalesces concurrent triggers and never pushes an acknowledged operation again', async () => {
    await start();
    await enqueue('once');
    let confirm;
    push.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const run = orchestrator.processOutbox('bootstrap_outbox');
    await waitFor(() => expect(confirm).toBeTypeOf('function'));
    events.dispatchEvent(new Event('online'));
    events.dispatchEvent(new Event('online'));
    await orchestrator.processOutbox('overlapping');
    confirm({ success: true });
    await run;
    await enqueue('once');
    await orchestrator.processOutbox('after-confirmation');
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.MAX_DELAY_MS);
    expect(push).toHaveBeenCalledTimes(1);
    expect((await table.get('once')).status).toBe(OUTBOX_STATUS.SYNCED);
  });

  it('F: stops retrying at the existing attempt limit', async () => {
    await start();
    await enqueue('unreachable');
    push.mockRejectedValue(new TypeError('Failed to fetch'));
    await orchestrator.processOutbox('bootstrap_outbox');
    for (let attempt = 1; attempt < RETRY_CONFIG.MAX_ATTEMPTS; attempt += 1) {
      await waitFor(async () => expect(await table.get('unreachable')).toMatchObject({
        status: OUTBOX_STATUS.PENDING, attempts: attempt
      }));
      await advanceToRetry('unreachable');
    }
    await waitFor(async () => expect(await table.get('unreachable')).toMatchObject({
      status: OUTBOX_STATUS.FAILED, attempts: RETRY_CONFIG.MAX_ATTEMPTS, nextRetryAt: null
    }));
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.MAX_DELAY_MS * 2);
    await orchestrator.processOutbox('after-exhaustion');
    expect(push).toHaveBeenCalledTimes(RETRY_CONFIG.MAX_ATTEMPTS);
  });
});
