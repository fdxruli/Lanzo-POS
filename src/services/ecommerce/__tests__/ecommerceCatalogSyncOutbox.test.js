// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEcommerceCatalogSyncOutbox,
  createEcommerceCatalogSyncOutboxDatabase,
  ecommerceCatalogSyncOutboxInternals
} from '../ecommerceCatalogSyncOutbox';

const databases = [];

const createOutbox = (name) => {
  const database = createEcommerceCatalogSyncOutboxDatabase(name);
  databases.push(database);
  return createEcommerceCatalogSyncOutbox({ database });
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('ecommerceCatalogSyncOutbox', () => {
  it('coalesces changes by license scope, portal and product ref', async () => {
    const outbox = createOutbox('catalog-outbox-coalesce');
    await outbox.enqueue({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a',
      productRefs: ['product-1', 'product-1', 'product-2']
    });
    await outbox.enqueue({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a',
      productRefs: ['product-2']
    });

    const queued = await outbox.list({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a'
    });
    expect(queued.productRefs.sort()).toEqual(['product-1', 'product-2']);
    expect(queued.entries).toHaveLength(2);
  });

  it('never executes entries from another license or portal', async () => {
    const outbox = createOutbox('catalog-outbox-isolation');
    await outbox.enqueue({
      scopeIdentity: 'license-a',
      portalId: 'portal-a',
      productRefs: ['product-a']
    });
    await outbox.enqueue({
      scopeIdentity: 'license-b',
      portalId: 'portal-b',
      productRefs: ['product-b']
    });

    expect((await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' })).productRefs)
      .toEqual(['product-a']);
    expect((await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-b' })).productRefs)
      .toEqual([]);
    expect(await outbox.getRememberedPortal({ scopeIdentity: 'license-a' })).toBe('portal-a');
    expect(await outbox.getRememberedPortal({ scopeIdentity: 'license-b' })).toBe('portal-b');
  });

  it('persists changes before the portal can be resolved and adopts them after authorization', async () => {
    const outbox = createOutbox('catalog-outbox-pending-portal');
    await outbox.enqueue({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: null,
      productRefs: ['product-1'],
      reason: 'portal-timeout'
    });

    const pendingRecords = await outbox.database.table('changes').toArray();
    expect(pendingRecords[0].portalId).toBe(
      ecommerceCatalogSyncOutboxInternals.PENDING_PORTAL_ID
    );

    await outbox.rememberPortal({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a'
    });
    const queued = await outbox.list({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a'
    });
    expect(queued.productRefs).toEqual(['product-1']);
  });

  it('persists the safe portal scope even before changes are enqueued', async () => {
    const outbox = createOutbox('catalog-outbox-remembered-portal');
    await outbox.rememberPortal({
      scopeIdentity: 'license-a:admin:device-a',
      portalId: 'portal-a'
    });

    expect(await outbox.getRememberedPortal({
      scopeIdentity: 'license-a:admin:device-a'
    })).toBe('portal-a');
    expect(await outbox.getRememberedPortal({
      scopeIdentity: 'license-b:admin:device-b'
    })).toBeNull();
  });

  it('stores hashes instead of raw license identities and no products or tokens', async () => {
    const outbox = createOutbox('catalog-outbox-private-data');
    await outbox.enqueue({
      scopeIdentity: 'SECRET-LICENSE:SECRET-TOKEN',
      portalId: 'portal-a',
      productRefs: ['product-1'],
      reason: 'offline-change'
    });

    const records = [
      ...await outbox.database.table('changes').toArray(),
      ...await outbox.database.table('scopes').toArray()
    ];
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('SECRET-LICENSE');
    expect(serialized).not.toContain('SECRET-TOKEN');
    expect(serialized).not.toContain('publicName');
    expect(records.some((record) => (
      record.portalId === 'portal-a' && record.productRef === 'product-1'
    ))).toBe(true);
  });

  it('acknowledges only confirmed entries', async () => {
    const outbox = createOutbox('catalog-outbox-ack');
    await outbox.enqueue({
      scopeIdentity: 'license-a',
      portalId: 'portal-a',
      productRefs: ['product-1']
    });
    const queued = await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' });
    expect(await outbox.acknowledge({
      scopeIdentity: 'license-a',
      portalId: 'portal-a',
      entries: queued.entries
    })).toBe(1);
    expect((await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' })).entries)
      .toHaveLength(0);
    expect(await outbox.getRememberedPortal({ scopeIdentity: 'license-a' })).toBe('portal-a');
  });

  it('atomically replaces confirmed chunks with only the remaining refs', async () => {
    const outbox = createOutbox('catalog-outbox-partial-replace');
    await outbox.enqueue({
      scopeIdentity: 'license-a',
      portalId: 'portal-a',
      productRefs: ['product-1', 'product-2', 'product-3']
    });
    const queued = await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' });

    expect(await outbox.replacePending({
      scopeIdentity: 'license-a',
      portalId: 'portal-a',
      entries: queued.entries,
      productRefs: ['product-3'],
      fullReconcile: false,
      reason: 'chunk-2-failed'
    })).toBe(1);

    const remaining = await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' });
    expect(remaining.productRefs).toEqual(['product-3']);
    expect(remaining.fullReconcile).toBe(false);
  });

  it('keeps full reconciliation semantics when no reliable refs exist', async () => {
    const outbox = createOutbox('catalog-outbox-full-reconcile');
    await outbox.enqueue({
      scopeIdentity: 'license-a',
      portalId: null,
      productRefs: [],
      fullReconcile: true,
      reason: 'list-timeout'
    });

    const queued = await outbox.list({ scopeIdentity: 'license-a', portalId: 'portal-a' });
    expect(queued.fullReconcile).toBe(true);
    expect(queued.productRefs).toEqual([]);
  });
});
