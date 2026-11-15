/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTOR_SCOPED_STORAGE_ERROR_CODES,
  activateActorScopedStorage,
  captureActorScopedStorageHandle,
  deriveActorStorageOpaqueId,
  getActorScopedStorageState,
  inspectActorScopedActiveOrderDraftCount,
  invalidateActorScopedStorage,
  prepareActorScopedStorage,
  resumeActorScopedStorageWrites
} from '../actorScopedStorage';
import {
  clearActiveTenantStorageNamespace,
  getTenantStorageItem,
  markTenantStorageReady,
  resumeTenantStorageWrites,
  setActiveTenantStorageNamespace,
  setTenantStorageItem
} from '../../tenant/tenantScopedStorage';

const CART_KEY = 'lanzo-active-orders-storage';
const TENANT_A = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 10
});
const TENANT_B = Object.freeze({
  opaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  databaseName: 'LanzoDB_t_t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  generation: 20
});

const granted = (tenant, actorKey, generation) => ({
  actorKey,
  generation,
  tenant
});

const mountTenant = (tenant) => {
  setActiveTenantStorageNamespace(tenant.opaqueId);
  markTenantStorageReady();
  resumeTenantStorageWrites();
};

const mountActor = async (tenant, actorKey, generation) => {
  await prepareActorScopedStorage({ tenant, actorKey, actorGeneration: generation });
  activateActorScopedStorage(granted(tenant, actorKey, generation));
  resumeActorScopedStorageWrites();
};

const writeCart = (value) => setTenantStorageItem(CART_KEY, JSON.stringify({
  state: {
    activeOrders: [[
      'draft-cart',
      {
        id: 'draft-cart',
        isSaved: false,
        ...value
      }
    ]],
    currentOrderId: 'draft-cart'
  },
  version: 0
}));
const readCart = () => {
  const raw = getTenantStorageItem(CART_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const order = parsed?.state?.activeOrders?.[0]?.[1];
  return order ? { items: order.items } : null;
};

beforeEach(() => {
  window.localStorage.clear();
  invalidateActorScopedStorage('test_reset');
  mountTenant(TENANT_A);
});

afterEach(() => {
  invalidateActorScopedStorage('test_cleanup');
  clearActiveTenantStorageNamespace();
  window.localStorage.clear();
});

describe('ActorScopedStorage cart ownership', () => {
  it('keeps Admin A and Staff B carts isolated inside the same tenant namespace', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    writeCart({ items: ['A1', 'A2'] });
    expect(readCart()).toEqual({ items: ['A1', 'A2'] });

    invalidateActorScopedStorage('admin_logout');
    await mountActor(TENANT_A, 'staff:staff-b', 3);
    expect(readCart()).toBeNull();
    writeCart({ items: ['B1'] });

    invalidateActorScopedStorage('staff_logout');
    await mountActor(TENANT_A, 'admin:admin-a', 5);
    expect(readCart()).toEqual({ items: ['A1', 'A2'] });

    invalidateActorScopedStorage('admin_logout_again');
    await mountActor(TENANT_A, 'staff:staff-b', 7);
    expect(readCart()).toEqual({ items: ['B1'] });
  });

  it('isolates Staff X from Staff Y and restores X after restart-style remount', async () => {
    await mountActor(TENANT_A, 'staff:staff-x', 1);
    writeCart({ items: ['X1'] });

    invalidateActorScopedStorage('browser_closed');
    await mountActor(TENANT_A, 'staff:staff-x', 3);
    expect(readCart()).toEqual({ items: ['X1'] });

    invalidateActorScopedStorage('staff_x_logout');
    await mountActor(TENANT_A, 'staff:staff-y', 5);
    expect(readCart()).toBeNull();
    writeCart({ items: ['Y1'] });

    invalidateActorScopedStorage('staff_y_logout');
    await mountActor(TENANT_A, 'staff:staff-x', 7);
    expect(readCart()).toEqual({ items: ['X1'] });
  });

  it('persists only actor-owned drafts and never serializes a tenant-shared SALES row', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);

    setTenantStorageItem(CART_KEY, JSON.stringify({
      state: {
        activeOrders: [
          ['draft-a', { id: 'draft-a', isSaved: false, items: ['A1'] }],
          ['shared-sale', { id: 'shared-sale', isSaved: true, items: ['BUSINESS'] }]
        ],
        currentOrderId: 'shared-sale'
      },
      version: 0
    }));

    const persisted = JSON.parse(getTenantStorageItem(CART_KEY));
    expect(persisted.state.activeOrders).toEqual([
      ['draft-a', expect.objectContaining({ id: 'draft-a', isSaved: false, items: ['A1'] })]
    ]);
    expect(persisted.state.currentOrderId).toBe('draft-a');
    expect(JSON.stringify(persisted)).not.toContain('shared-sale');
    expect(JSON.stringify(persisted)).not.toContain('BUSINESS');
  });

  it('fails closed instead of persisting malformed actor-sensitive payloads', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    setTenantStorageItem(CART_KEY, '{not-json');
    expect(getTenantStorageItem(CART_KEY)).toBeNull();
  });

  it('never auto-claims a legacy tenant-scoped cart', async () => {
    const legacyKey = `lanzo:t:${TENANT_A.opaqueId}:${CART_KEY}`;
    window.localStorage.setItem(legacyKey, JSON.stringify({ items: ['LEGACY'] }));

    const prepared = await prepareActorScopedStorage({
      tenant: TENANT_A,
      actorKey: 'staff:staff-b',
      actorGeneration: 1
    });

    expect(prepared.legacyUnresolvedKeys).toContain(CART_KEY);
    expect(getTenantStorageItem(CART_KEY)).toBeNull();
    expect(window.localStorage.getItem(legacyKey)).toContain('LEGACY');

    activateActorScopedStorage(granted(TENANT_A, 'staff:staff-b', 1));
    resumeActorScopedStorageWrites();
    expect(readCart()).toBeNull();
    expect(window.localStorage.getItem(legacyKey)).toContain('LEGACY');
  });

  it('uses an opaque actor namespace without raw actor ids in physical cart keys', async () => {
    const actorKey = 'admin:admin-sensitive-id';
    const opaque = await deriveActorStorageOpaqueId(TENANT_A.opaqueId, actorKey);
    expect(opaque).toMatch(/^[a-f0-9]{64}$/);

    await mountActor(TENANT_A, actorKey, 1);
    writeCart({ items: ['A1'] });

    const keys = Array.from({ length: window.localStorage.length }, (_, index) => (
      window.localStorage.key(index)
    )).filter(Boolean);
    const cartPhysicalKey = keys.find((key) => key.endsWith(`:${CART_KEY}`));

    expect(cartPhysicalKey).toContain(`lanzo:t:${TENANT_A.opaqueId}:a:${opaque}:`);
    expect(cartPhysicalKey).not.toContain('admin-sensitive-id');
  });

  it('reports only the aggregate draft count for actors in the active tenant', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    writeCart({ items: ['private-admin-draft'] });

    const staffOpaqueId = await deriveActorStorageOpaqueId(TENANT_A.opaqueId, 'staff:staff-b');
    const staffKey = `lanzo:t:${TENANT_A.opaqueId}:a:${staffOpaqueId}:${CART_KEY}`;
    window.localStorage.setItem(staffKey, JSON.stringify({
      state: {
        activeOrders: [['staff-draft', { id: 'staff-draft', isSaved: false, items: ['private-staff-draft'] }]],
        currentOrderId: 'staff-draft'
      },
      version: 0
    }));

    const otherTenantActor = await deriveActorStorageOpaqueId(TENANT_B.opaqueId, 'staff:tenant-b-staff');
    const otherTenantKey = `lanzo:t:${TENANT_B.opaqueId}:a:${otherTenantActor}:${CART_KEY}`;
    window.localStorage.setItem(otherTenantKey, JSON.stringify({
      state: {
        activeOrders: [['tenant-b-draft', { id: 'tenant-b-draft', isSaved: false, items: ['tenant-b-private'] }]],
        currentOrderId: 'tenant-b-draft'
      },
      version: 0
    }));

    const count = inspectActorScopedActiveOrderDraftCount(TENANT_A.opaqueId, TENANT_A.databaseName);
    expect(count).toBe(2);
    expect(JSON.stringify(count)).not.toContain('private-');
    expect(JSON.stringify(count)).not.toContain('staff-b');
    expect(JSON.stringify(count)).not.toContain('tenant-b');
  });

  it('does not count empty or saved-only actor order state', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    const actorOpaqueId = await deriveActorStorageOpaqueId(TENANT_A.opaqueId, 'admin:admin-a');
    const actorKey = `lanzo:t:${TENANT_A.opaqueId}:a:${actorOpaqueId}:${CART_KEY}`;
    window.localStorage.setItem(actorKey, JSON.stringify({
      state: {
        activeOrders: [['saved-sale', { id: 'saved-sale', isSaved: true }]],
        currentOrderId: null
      },
      version: 0
    }));
    expect(inspectActorScopedActiveOrderDraftCount(TENANT_A.opaqueId, TENANT_A.databaseName)).toBe(0);

    window.localStorage.setItem(actorKey, JSON.stringify({
      state: { activeOrders: [], currentOrderId: null },
      version: 0
    }));
    expect(inspectActorScopedActiveOrderDraftCount(TENANT_A.opaqueId, TENANT_A.databaseName)).toBe(0);
  });

  it('fails closed when an active-tenant actor order payload is malformed', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    const staffOpaqueId = await deriveActorStorageOpaqueId(TENANT_A.opaqueId, 'staff:staff-b');
    window.localStorage.setItem(`lanzo:t:${TENANT_A.opaqueId}:a:${staffOpaqueId}:${CART_KEY}`, '{broken');
    expect(() => inspectActorScopedActiveOrderDraftCount(TENANT_A.opaqueId, TENANT_A.databaseName))
      .toThrowError(expect.objectContaining({ code: ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED }));
  });

  it('invalidates an old storage handle on logout with ACTOR_CONTEXT_STALE', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    const oldHandle = captureActorScopedStorageHandle();
    oldHandle.setItem(CART_KEY, JSON.stringify({ items: ['A1'] }));

    invalidateActorScopedStorage('logout');

    expect(() => oldHandle.assertCurrent()).toThrowError(
      expect.objectContaining({ code: ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_STALE })
    );
  });

  it('invalidates the old tab when another tab publishes a different actor context', async () => {
    await mountActor(TENANT_A, 'admin:admin-a', 1);
    const oldHandle = captureActorScopedStorageHandle();
    const current = getActorScopedStorageState().active;
    const contextKey = Array.from({ length: window.localStorage.length }, (_, index) => (
      window.localStorage.key(index)
    )).find((key) => key?.endsWith(':actor-runtime-context:v1'));

    expect(contextKey).toBeTruthy();
    const foreignRecord = {
      version: 1,
      tenantOpaqueId: TENANT_A.opaqueId,
      actorOpaqueId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      actorGeneration: current.actorGeneration + 1,
      contextToken: 'other-tab-context-token',
      status: 'granted',
      updatedAt: '2026-08-19T01:30:00.000Z'
    };
    const oldValue = window.localStorage.getItem(contextKey);
    const newValue = JSON.stringify(foreignRecord);
    window.localStorage.setItem(contextKey, newValue);
    window.dispatchEvent(new StorageEvent('storage', {
      key: contextKey,
      oldValue,
      newValue,
      storageArea: window.localStorage
    }));

    expect(getActorScopedStorageState().writesSuspended).toBe(true);
    expect(() => oldHandle.assertCurrent()).toThrowError(
      expect.objectContaining({ code: ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_STALE })
    );
  });

  it('keeps actor namespaces distinct across tenants and restores A after A→B→A', async () => {
    await mountActor(TENANT_A, 'admin:shared-user-id', 1);
    writeCart({ items: ['TENANT-A'] });

    invalidateActorScopedStorage('tenant_switch');
    clearActiveTenantStorageNamespace();
    mountTenant(TENANT_B);
    await mountActor(TENANT_B, 'admin:shared-user-id', 1);
    expect(readCart()).toBeNull();
    writeCart({ items: ['TENANT-B'] });

    invalidateActorScopedStorage('tenant_switch_back');
    clearActiveTenantStorageNamespace();
    mountTenant(TENANT_A);
    await mountActor(TENANT_A, 'admin:shared-user-id', 3);
    expect(readCart()).toEqual({ items: ['TENANT-A'] });

    const state = getActorScopedStorageState();
    expect(state.active.tenantDatabaseName).toBe(TENANT_A.databaseName);
    expect(state.active.tenantOpaqueId).toBe(TENANT_A.opaqueId);
  });
  it('rejects obsolete preparation before replacing the current actor storage binding', async () => {
    await mountActor(TENANT_A, 'staff:current-staff', 8);
    writeCart({ items: ['CURRENT'] });
    await expect(prepareActorScopedStorage({
      tenant: TENANT_A, actorKey: 'admin:obsolete-admin', actorGeneration: 2,
      assertCurrent: () => { throw Object.assign(new Error('obsolete'), { code: 'ACTOR_CONTEXT_STALE' }); }
    })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(getActorScopedStorageState().active.actorKey).toBe('staff:current-staff');
    expect(getActorScopedStorageState().pending).toBeNull();
    expect(readCart()).toEqual({ items: ['CURRENT'] });
  });

});
