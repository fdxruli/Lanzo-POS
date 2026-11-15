/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activateActorScopedStorage,
  deriveActorStorageOpaqueId,
  inspectActorScopedActiveOrderDraftCount,
  invalidateActorScopedStorage,
  prepareActorScopedStorage,
  resumeActorScopedStorageWrites
} from '../../auth/actorScopedStorage';
import {
  clearActiveTenantStorageNamespace,
  getTenantStorageState,
  getTenantStorageItem,
  inspectActiveTenantBackupBrowserState,
  inspectActiveTenantStorageSnapshot,
  markTenantStorageReady,
  removeTenantStorageItem,
  resumeTenantStorageWrites,
  setActiveTenantStorageNamespace,
  setTenantStorageItem
} from '../tenantScopedStorage';

const TENANT_A = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 1
});
const TENANT_B = Object.freeze({
  opaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  databaseName: 'LanzoDB_t_t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  generation: 2
});
const ACTIVE_ORDERS_KEY = 'lanzo-active-orders-storage';

const mountTenantAndActor = async (tenant = TENANT_A, actorKey = 'admin:backup-test') => {
  setActiveTenantStorageNamespace(tenant.opaqueId);
  markTenantStorageReady();
  resumeTenantStorageWrites();
  await prepareActorScopedStorage({ tenant, actorKey, actorGeneration: 1 });
  activateActorScopedStorage({ tenant, actorKey, generation: 1 });
  resumeActorScopedStorageWrites();
};

describe('tenantScopedStorage', () => {
  beforeEach(() => {
    invalidateActorScopedStorage('test_reset');
    clearActiveTenantStorageNamespace();
    localStorage.clear();
  });

  afterEach(() => {
    invalidateActorScopedStorage('test_cleanup');
    clearActiveTenantStorageNamespace();
    localStorage.clear();
  });

  it('never reads or mutates an unscoped legacy key', () => {
    const opaqueId = 't_0123456789abcdef0123456789abcdef';
    const legacyTenantKey = `lanzo:t:${opaqueId}:lanzo-active-orders-storage`;
    localStorage.setItem('lanzo-active-orders-storage', '{"tenant":"legacy-A"}');
    setActiveTenantStorageNamespace(opaqueId);
    markTenantStorageReady();
    resumeTenantStorageWrites();

    expect(getTenantStorageItem('lanzo-active-orders-storage')).toBeNull();
    setTenantStorageItem('lanzo-active-orders-storage', JSON.stringify({
      state: {
        activeOrders: [['draft-b', { id: 'draft-b', isSaved: false }]],
        currentOrderId: 'draft-b'
      },
      version: 0
    }));

    // No actor is mounted, so actor-owned data fails closed. Neither the
    // historical unscoped key nor the old tenant-scoped ownership location is
    // mutated or claimed by the tenant storage layer.
    expect(localStorage.getItem('lanzo-active-orders-storage')).toBe('{"tenant":"legacy-A"}');
    expect(localStorage.getItem(legacyTenantKey)).toBeNull();
  });

  it('keeps A and B state physically separate and blocks pre-ready reads', () => {
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(getTenantStorageItem('cart')).toBeNull();
    markTenantStorageReady();
    resumeTenantStorageWrites();
    setTenantStorageItem('cart', 'A');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBeNull();
    setTenantStorageItem('cart', 'B');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBe('A');
  });

  it('inspects only the active physical namespace before READY', () => {
    const a = 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const legacyKey = 'lanzo-active-orders-storage';
    const aKey = `lanzo:t:${a}:active-orders`;
    const bKey = `lanzo:t:${b}:active-orders`;
    localStorage.setItem(legacyKey, 'legacy-payload');
    localStorage.setItem(aKey, 'A-payload');
    localStorage.setItem(bKey, 'B-payload');

    setActiveTenantStorageNamespace(a);
    expect(getTenantStorageState()).toMatchObject({ ready: false, writesSuspended: true });
    expect(inspectActiveTenantStorageSnapshot()).toEqual({
      counts: { [`localStorage:${aKey}`]: 1 },
      occupiedStores: [`localStorage:${aKey}`]
    });
    expect(localStorage.getItem(legacyKey)).toBe('legacy-payload');
    expect(localStorage.getItem(bKey)).toBe('B-payload');

    clearActiveTenantStorageNamespace();
    expect(() => inspectActiveTenantStorageSnapshot()).toThrow('TENANT_STORAGE_NAMESPACE_MISSING');
  });

  it('fails closed when browser storage throws without clearing another tenant payload', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing });
    setActiveTenantStorageNamespace('t_cccccccccccccccccccccccccccccccc');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBeNull();
    expect(() => setTenantStorageItem('cart', 'C')).not.toThrow();
    expect(() => removeTenantStorageItem('cart')).not.toThrow();
    Object.defineProperty(window, 'localStorage', original);
  });

  it('keeps writes suspended while readable, resumes explicitly, and locks them again', () => {
    const opaqueId = 't_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const key = `lanzo:t:${opaqueId}:post-ready-test`;
    setActiveTenantStorageNamespace(opaqueId);
    markTenantStorageReady();
    expect(getTenantStorageItem('post-ready-test')).toBeNull();
    setTenantStorageItem('post-ready-test', 'blocked');
    expect(localStorage.getItem(key)).toBeNull();
    resumeTenantStorageWrites();
    setTenantStorageItem('post-ready-test', 'A');
    expect(localStorage.getItem(key)).toBe('A');
    clearActiveTenantStorageNamespace();
    setTenantStorageItem('post-ready-test', 'B');
    expect(localStorage.getItem(key)).toBe('A');
  });

  it('detects actor drafts and tenant close retries without attributing another tenant', async () => {
    await mountTenantAndActor(TENANT_A);
    setTenantStorageItem(ACTIVE_ORDERS_KEY, JSON.stringify({
      state: {
        activeOrders: [['current-draft', { id: 'current-draft', isSaved: false, items: ['private-current'] }]],
        currentOrderId: 'current-draft'
      },
      version: 0
    }));
    setTenantStorageItem('lanzo:restaurant-order-close-pending:v1', JSON.stringify([
      { localOrderId: 'pending-close-a', idempotencyKey: 'close-a', privatePayload: 'do-not-return' }
    ]));

    const otherActorId = await deriveActorStorageOpaqueId(TENANT_A.opaqueId, 'staff:other-actor');
    localStorage.setItem(`lanzo:t:${TENANT_A.opaqueId}:a:${otherActorId}:${ACTIVE_ORDERS_KEY}`, JSON.stringify({
      state: {
        activeOrders: [['staff-draft', { id: 'staff-draft', isSaved: false, items: ['private-staff'] }]],
        currentOrderId: 'staff-draft'
      },
      version: 0
    }));

    const otherTenantActorId = await deriveActorStorageOpaqueId(TENANT_B.opaqueId, 'staff:tenant-b');
    localStorage.setItem(`lanzo:t:${TENANT_B.opaqueId}:a:${otherTenantActorId}:${ACTIVE_ORDERS_KEY}`, JSON.stringify({
      state: {
        activeOrders: [['tenant-b-draft', { id: 'tenant-b-draft', isSaved: false, items: ['tenant-b-private'] }]],
        currentOrderId: 'tenant-b-draft'
      },
      version: 0
    }));

    const summary = inspectActiveTenantBackupBrowserState(TENANT_A.databaseName);
    expect(summary).toMatchObject({
      inspectionComplete: true,
      counts: { activeOrders: 2, pendingOrderClosures: 1 }
    });
    expect(JSON.stringify(summary)).not.toContain('private-');
    expect(JSON.stringify(summary)).not.toContain('tenant-b');
    expect(inspectActorScopedActiveOrderDraftCount(TENANT_A.opaqueId, TENANT_A.databaseName)).toBe(2);
  });

  it('treats empty persisted browser states as complete with zero excluded operations', async () => {
    await mountTenantAndActor(TENANT_A);
    setTenantStorageItem(ACTIVE_ORDERS_KEY, JSON.stringify({
      state: { activeOrders: [], currentOrderId: null },
      version: 0
    }));
    setTenantStorageItem('lanzo-cart-storage', JSON.stringify({ state: { items: [] }, version: 0 }));
    setTenantStorageItem('lanzo-inventory-storage', JSON.stringify({ state: { adjustments: [] }, version: 0 }));
    setTenantStorageItem('lanzo:restaurant-order-close-pending:v1', JSON.stringify([]));
    setTenantStorageItem('ignored_expirations_ttl', JSON.stringify({}));

    expect(inspectActiveTenantBackupBrowserState(TENANT_A.databaseName)).toEqual({
      inspectionComplete: true,
      counts: {
        activeOrders: 0,
        unsavedCart: 0,
        unfinishedInventoryAdjustments: 0,
        pendingOrderClosures: 0,
        otherPendingBusinessState: 0
      }
    });
  });

  it('does not count empty legacy keys and leaves meaningful unscoped state unattributed', async () => {
    await mountTenantAndActor(TENANT_A);
    localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify({
      state: { activeOrders: [], currentOrderId: null },
      version: 0
    }));
    localStorage.setItem('lanzo-cart-storage', JSON.stringify({ state: { items: [] }, version: 0 }));
    expect(inspectActiveTenantBackupBrowserState(TENANT_A.databaseName).inspectionComplete).toBe(true);

    localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify({
      state: {
        activeOrders: [['legacy-private-draft', { id: 'legacy-private-draft', isSaved: false }]],
        currentOrderId: 'legacy-private-draft'
      },
      version: 0
    }));
    const summary = inspectActiveTenantBackupBrowserState(TENANT_A.databaseName);
    expect(summary).toMatchObject({ inspectionComplete: false, counts: { activeOrders: 0 } });
    expect(JSON.stringify(summary)).not.toContain('legacy-private-draft');
  });

  it('marks malformed state or unavailable browser storage as incomplete', async () => {
    await mountTenantAndActor(TENANT_A);
    setTenantStorageItem('lanzo-cart-storage', '{malformed');
    expect(inspectActiveTenantBackupBrowserState(TENANT_A.databaseName).inspectionComplete).toBe(false);

    removeTenantStorageItem('lanzo-cart-storage');
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('denied'); }
    });
    expect(inspectActiveTenantBackupBrowserState(TENANT_A.databaseName).inspectionComplete).toBe(false);
    Object.defineProperty(window, 'localStorage', original);
  });

  it('marks a missing tenant namespace or mismatched actor database as incomplete', async () => {
    await mountTenantAndActor(TENANT_A);
    expect(inspectActiveTenantBackupBrowserState(TENANT_B.databaseName).inspectionComplete).toBe(false);
    clearActiveTenantStorageNamespace();
    expect(inspectActiveTenantBackupBrowserState(TENANT_A.databaseName).inspectionComplete).toBe(false);
  });
});
