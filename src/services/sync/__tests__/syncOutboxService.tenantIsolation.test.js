import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let database;
let syncOutboxService;
let activeLicenseKey;
let assertLocalTenantSyncAccess;

const row = ({ id, licenseKey, status = 'pending', updatedAt = '2026-01-01T00:00:00.000Z' }) => ({
  id,
  licenseKey,
  entityType: 'product',
  operation: 'upsert',
  entityId: id,
  payload: { id },
  status,
  idempotencyKey: id,
  attempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  nextRetryAt: null
});

beforeEach(async () => {
  vi.resetModules();
  activeLicenseKey = 'TENANT-B';
  assertLocalTenantSyncAccess = vi.fn(async (source) => {
    if (source?.license_key !== activeLicenseKey) {
      throw Object.assign(new Error('blocked'), { code: 'LOCAL_TENANT_SYNC_BLOCKED' });
    }
    return { status: 'pass' };
  });

  database = new Dexie(`lanzo-outbox-isolation-${crypto.randomUUID()}`);
  database.version(1).stores({
    sync_outbox: 'id,[status+createdAt],status,licenseKey'
  });
  await database.open();

  vi.doMock('../../db/dexie', () => ({ db: database }));
  vi.doMock('../syncDexieBootstrap', () => ({}));
  vi.doMock('../../tenant/localTenantGuard', () => ({
    assertLocalTenantSyncAccess,
    runWithLocalTenantSyncLease: async (source, _options, operation) => {
      await assertLocalTenantSyncAccess(source);
      return operation();
    },
    isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_')
  }));

  ({ syncOutboxService } = await import('../syncOutboxService'));
});

afterEach(async () => {
  const name = database?.name;
  database?.close();
  if (name) await Dexie.delete(name);
  vi.doUnmock('../../db/dexie');
  vi.doUnmock('../syncDexieBootstrap');
  vi.doUnmock('../../tenant/localTenantGuard');
});

describe('syncOutboxService tenant isolation', () => {
  it('returns only explicitly scoped operations for the active tenant', async () => {
    await database.table('sync_outbox').bulkPut([
      row({ id: 'operation-a', licenseKey: 'TENANT-A' }),
      row({ id: 'operation-b', licenseKey: 'TENANT-B' }),
      row({ id: 'operation-legacy', licenseKey: null })
    ]);

    const pending = await syncOutboxService.getPendingOperations({ licenseKey: 'TENANT-B' });

    expect(pending.map((operation) => operation.id)).toEqual(['operation-b']);
    expect(await database.table('sync_outbox').count()).toBe(3);
    expect(await database.table('sync_outbox').get('operation-legacy')).toMatchObject({
      status: 'pending',
      licenseKey: null
    });
  });

  it('resets stuck processing rows only for the active tenant', async () => {
    await database.table('sync_outbox').bulkPut([
      row({ id: 'processing-a', licenseKey: 'TENANT-A', status: 'processing' }),
      row({ id: 'processing-b', licenseKey: 'TENANT-B', status: 'processing' }),
      row({ id: 'processing-legacy', licenseKey: null, status: 'processing' })
    ]);

    await expect(syncOutboxService.resetStuckProcessing(0, {
      licenseKey: 'TENANT-B'
    })).resolves.toBe(1);

    expect(await database.table('sync_outbox').get('processing-a')).toMatchObject({
      status: 'processing'
    });
    expect(await database.table('sync_outbox').get('processing-b')).toMatchObject({
      status: 'pending'
    });
    expect(await database.table('sync_outbox').get('processing-legacy')).toMatchObject({
      status: 'processing'
    });
  });

  it('does not mutate another tenant or an unscoped legacy operation', async () => {
    await database.table('sync_outbox').bulkPut([
      row({ id: 'operation-a', licenseKey: 'TENANT-A' }),
      row({ id: 'operation-legacy', licenseKey: null })
    ]);

    await expect(syncOutboxService.markProcessing('operation-a', {
      licenseKey: 'TENANT-B'
    })).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });
    await expect(syncOutboxService.markProcessing('operation-legacy', {
      licenseKey: 'TENANT-B'
    })).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });

    expect(await database.table('sync_outbox').toArray()).toEqual([
      expect.objectContaining({ id: 'operation-a', status: 'pending' }),
      expect.objectContaining({ id: 'operation-legacy', status: 'pending' })
    ]);
  });

  it('fails before reading the queue when runtime tenant validation rejects', async () => {
    activeLicenseKey = 'TENANT-A';
    await database.table('sync_outbox').put(row({
      id: 'operation-b',
      licenseKey: 'TENANT-B'
    }));

    await expect(
      syncOutboxService.getPendingOperations({ licenseKey: 'TENANT-B' })
    ).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });
    expect(await database.table('sync_outbox').get('operation-b')).toMatchObject({
      status: 'pending'
    });
  });

  it('never overwrites an unscoped legacy row with a colliding idempotency key', async () => {
    const legacy = row({ id: 'shared-id', licenseKey: null });
    await database.table('sync_outbox').put(legacy);

    await expect(syncOutboxService.enqueueOperation({
      licenseKey: 'TENANT-B',
      entityType: 'product',
      operation: 'upsert',
      entityId: 'product-b',
      idempotencyKey: 'shared-id',
      payload: { id: 'product-b' }
    })).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });

    expect(await database.table('sync_outbox').get('shared-id')).toEqual(legacy);
  });
});
