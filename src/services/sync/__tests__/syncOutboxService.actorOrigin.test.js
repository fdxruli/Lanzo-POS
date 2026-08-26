import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let database;
let syncOutboxService;
let currentActor;

const makeHandle = () => ({
  actorType: currentActor.actorType,
  actorId: currentActor.actorId,
  actorKey: currentActor.actorKey,
  generation: currentActor.generation,
  tenant: {
    opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    generation: 10
  },
  assertCurrent() {
    if (this.actorKey !== currentActor.actorKey || this.generation !== currentActor.generation) {
      const error = new Error('ACTOR_CONTEXT_STALE');
      error.code = 'ACTOR_CONTEXT_STALE';
      throw error;
    }
    return this;
  }
});

const legacyRow = ({ id, entityType = 'sale' }) => ({
  id,
  licenseKey: 'TENANT-A',
  entityType,
  operation: 'upsert',
  entityId: id,
  payload: { id },
  status: 'pending',
  idempotencyKey: id,
  attempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nextRetryAt: null
});

beforeEach(async () => {
  vi.resetModules();
  currentActor = {
    actorType: 'admin',
    actorId: 'admin-a',
    actorKey: 'admin:admin-a',
    generation: 5
  };

  database = new Dexie(`lanzo-outbox-actor-origin-${crypto.randomUUID()}`);
  database.version(1).stores({
    sync_outbox: 'id,[status+createdAt],status,licenseKey'
  });
  await database.open();

  vi.doMock('../../db/dexie', () => ({ db: database }));
  vi.doMock('../syncDexieBootstrap', () => ({}));
  vi.doMock('../../auth/actorRuntimeController', () => ({
    actorRuntimeController: {
      capture: vi.fn(() => makeHandle())
    }
  }));
  vi.doMock('../../tenant/localTenantGuard', () => ({
    assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
    runWithLocalTenantSyncLease: async (_source, _options, operation) => operation(),
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
  vi.doUnmock('../../auth/actorRuntimeController');
  vi.doUnmock('../../tenant/localTenantGuard');
});

describe('syncOutboxService actor origin', () => {
  it('captures immutable Admin origin when an actor-bound sale is enqueued', async () => {
    const row = await syncOutboxService.enqueueOperation({
      licenseKey: 'TENANT-A',
      entityType: 'sale',
      operation: 'upsert_shadow',
      entityId: 'sale-1',
      idempotencyKey: 'sale-1',
      actorSensitive: true,
      captureCurrentActor: true,
      payload: { id: 'sale-1' }
    });

    expect(row).toMatchObject({
      actorSensitivity: 'actor_bound',
      actorOwnershipStatus: 'bound',
      originActorType: 'admin',
      originActorId: 'admin-a',
      originActorKey: 'admin:admin-a',
      originActorGeneration: 5
    });
  });

  it('never rewrites an existing Admin row as Staff during idempotent retry', async () => {
    await syncOutboxService.enqueueOperation({
      licenseKey: 'TENANT-A',
      entityType: 'sale',
      operation: 'upsert_shadow',
      entityId: 'sale-2',
      idempotencyKey: 'sale-2',
      actorSensitive: true,
      captureCurrentActor: true,
      payload: { id: 'sale-2' }
    });

    currentActor = {
      actorType: 'staff',
      actorId: 'staff-b',
      actorKey: 'staff:staff-b',
      generation: 7
    };

    const existing = await syncOutboxService.enqueueOperation({
      licenseKey: 'TENANT-A',
      entityType: 'sale',
      operation: 'upsert_shadow',
      entityId: 'sale-2',
      idempotencyKey: 'sale-2',
      actorSensitive: true,
      captureCurrentActor: true,
      payload: { id: 'sale-2' }
    });

    expect(existing.originActorKey).toBe('admin:admin-a');
    expect(existing.originActorGeneration).toBe(5);
  });

  it('holds actor-bound work with unresolved legacy origin instead of claiming currentActor', async () => {
    await syncOutboxService.enqueueOperation({
      licenseKey: 'TENANT-A',
      entityType: 'sale',
      operation: 'upsert_shadow',
      entityId: 'legacy-unresolved',
      idempotencyKey: 'legacy-unresolved',
      actorSensitive: true,
      captureCurrentActor: false,
      payload: { id: 'legacy-unresolved' }
    });

    const stored = await database.table('sync_outbox').get('legacy-unresolved');
    expect(stored).toMatchObject({
      actorSensitivity: 'actor_bound',
      actorOwnershipStatus: 'legacy_unresolved',
      originActorKey: null
    });

    const pending = await syncOutboxService.getPendingOperations({ licenseKey: 'TENANT-A' });
    expect(pending.map((row) => row.id)).not.toContain('legacy-unresolved');
    expect(await database.table('sync_outbox').get('legacy-unresolved')).toMatchObject({ status: 'pending' });
  });

  it('holds pre-phase legacy sale and product rows without immutable actor origin', async () => {
    await database.table('sync_outbox').bulkPut([
      legacyRow({ id: 'legacy-sale', entityType: 'sale' }),
      legacyRow({ id: 'tenant-product', entityType: 'product' })
    ]);

    const pending = await syncOutboxService.getPendingOperations({ licenseKey: 'TENANT-A' });
    expect(pending.map((row) => row.id)).toEqual([]);
    expect(await database.table('sync_outbox').get('legacy-sale')).toMatchObject({
      id: 'legacy-sale',
      status: 'pending'
    });
  });
});
