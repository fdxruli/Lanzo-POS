// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
const deferred = () => {
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
let database, pos, outbox, meta, scope, current, transport, channels;
const details = { license_key: 'synthetic-T', pos_realtime_topic: 'pos:synthetic-T', features: { cloud_pos_sync: true } };
beforeEach(async () => {
  vi.resetModules(); current = true; channels = [];
  database = new Dexie(`f012d1-${crypto.randomUUID()}`);
  database.version(1).stores({ sync_outbox: 'id,[status+createdAt],status,licenseKey', sync_meta: 'key' });
  await database.open();
  transport = {
    channel: vi.fn(() => {
      const channel = { on: vi.fn(() => channel), subscribe: vi.fn(callback => { channel.status = callback; return channel; }) };
      channels.push(channel); return channel;
    }), removeChannel: vi.fn(async () => 'ok')
  };
  vi.doMock('../../../src/services/db/dexie', () => ({ db: database }));
  vi.doMock('../../../src/services/db/databaseRuntime', () => ({ ensureLocalDatabaseReady: async () => database }));
  vi.doMock('../../../src/services/sync/syncDexieBootstrap', () => ({}));
  vi.doMock('../../../src/services/supabase', () => ({ supabaseClient: transport }));
  vi.doMock('../../../src/services/tenant/localTenantGuard', () => ({
    assertLocalTenantSyncAccess: async () => {},
    runWithLocalTenantSyncLease: async (_source, _options, fn) => fn(),
    isLocalTenantAccessError: () => false
  }));
  vi.doMock('../../../src/services/sync/posSyncClient', () => ({ posSyncClient: { pullSyncEvents: async () => ({ success: true, events: [], latestChangeSeq: 0 }) } }));
  ({ posSyncOrchestrator: pos } = await import('../../../src/services/sync/posSyncOrchestrator'));
  ({ syncOutboxService: outbox } = await import('../../../src/services/sync/syncOutboxService'));
  ({ syncMetaService: meta } = await import('../../../src/services/sync/syncMetaService'));
  scope = createSyncExecutionScope({ context: { actor: 'A', tenant: 'T', session: 'S' }, isContextCurrent: () => current });
  await pos.start({ licenseDetails: details, reason: 'initial_bootstrap', executionScope: scope });
  await vi.waitFor(() => expect(transport.channel).toHaveBeenCalledTimes(1));
});
afterEach(async () => {
  scope?.quiesce(); await scope?.settleObserved(); vi.restoreAllMocks();
  database?.close(); if (database) await Dexie.delete(database.name);
  for (const path of ['db/dexie', 'db/databaseRuntime', 'sync/syncDexieBootstrap', 'supabase', 'tenant/localTenantGuard', 'sync/posSyncClient']) {
    vi.doUnmock(`../../../src/services/${path}`);
  }
});
const enqueue = async () => outbox.enqueueOperation({
  licenseKey: 'synthetic-T', entityType: 'synthetic', operation: 'upsert', entityId: 'synthetic-id',
  idempotencyKey: 'synthetic-original-key', payload: { requestHash: 'synthetic-original-hash' }
});

it('D-14 real outbox preserves durable processing and identity after late handler result during quiesce', async () => {
  const d = deferred(), started = deferred(); await enqueue();
  const handler = vi.fn(() => { started.resolve(); return d.promise; });
  pos.registerEntitySyncHandler('synthetic', { pushOperation: handler });
  const result = pos.processOutbox(); await started.promise;
  expect(await database.table('sync_outbox').get('synthetic-original-key')).toMatchObject({ status: 'processing', attempts: 0 });
  scope.quiesce(); await flush(); expect(scope.getSnapshot().pending).toBeGreaterThan(0);
  d.resolve({ success: true }); await result;
  const final = await scope.settleObserved();
  expect(final.unknown).toContain('pos_handler_lifetime:push:synthetic');
  expect(await database.table('sync_outbox').get('synthetic-original-key')).toMatchObject({
    status: 'processing', attempts: 0, idempotencyKey: 'synthetic-original-key', payload: { requestHash: 'synthetic-original-hash' }
  });
  await expect(pos.processOutbox()).rejects.toThrow('QUIESCED'); expect(handler).toHaveBeenCalledTimes(1);
});

it('quiesce during real markProcessing does not start handler or convert local rejection into retry', async () => {
  await enqueue(); const d = deferred(), started = deferred();
  const original = outbox.markProcessing.bind(outbox);
  vi.spyOn(outbox, 'markProcessing').mockImplementation(async (...args) => {
    await original(...args); started.resolve(); await d.promise;
  });
  const handler = vi.fn(); pos.registerEntitySyncHandler('synthetic', { pushOperation: handler });
  const result = pos.processOutbox(); await started.promise; scope.quiesce(); d.resolve(); await result;
  expect(handler).not.toHaveBeenCalled();
  expect(await database.table('sync_outbox').get('synthetic-original-key')).toMatchObject({ status: 'processing', attempts: 0 });
  expect((await scope.settleObserved()).state).toBe('DRAINED');
});

it('late outbox rejection does not mutate durable attempts/retry after generation stop', async () => {
  const d = deferred(), started = deferred(); await enqueue();
  pos.registerEntitySyncHandler('synthetic', { pushOperation: () => { started.resolve(); return d.promise; } });
  const result = pos.processOutbox(), observed = result.catch(error => error);
  await started.promise; scope.quiesce(); await flush(); d.reject(new Error('late-rpc'));
  expect((await observed).message).toBe('late-rpc');
  expect(await database.table('sync_outbox').get('synthetic-original-key')).toMatchObject({ status: 'processing', attempts: 0 });
});

it('pending durable rows do not equal live executions and unknown providers stay unknown', async () => {
  await enqueue(); scope.quiesce();
  expect((await scope.drain()).state).toBe('DRAINED'); expect(await database.table('sync_outbox').count()).toBe(1);
  expect(await database.table('sync_outbox').get('synthetic-original-key')).toMatchObject({ status: 'pending' });
});

it('D-29 actual lower Realtime retains queued status through stop, without realtime UNKNOWN', async () => {
  const d = deferred(), started = deferred();
  const original = meta.setRealtimeStatus.bind(meta);
  vi.spyOn(meta, 'setRealtimeStatus').mockImplementation(async (...args) => { started.resolve(); await d.promise; return original(...args); });
  channels[0].status('SUBSCRIBED'); await started.promise; scope.quiesce(); await flush();
  expect(scope.getSnapshot().pending).toBeGreaterThan(0); d.resolve();
  const final = await scope.drain(); expect(final.unknown).toEqual([]); expect(final.state).toBe('DRAINED');
  expect(transport.removeChannel).toHaveBeenCalledTimes(1);
});
