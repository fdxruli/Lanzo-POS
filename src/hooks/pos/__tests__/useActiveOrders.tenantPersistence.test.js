/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveOrders, resetAndHydrateActiveOrdersForTenant } from '../useActiveOrders';
import {
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  localTenantAccessController
} from '../../../services/tenant/localTenantPolicy';
import {
  clearActiveTenantStorageNamespace,
  markTenantStorageReady,
  resumeTenantStorageWrites,
  setActiveTenantStorageNamespace
} from '../../../services/tenant/tenantScopedStorage';
import {
  activateActorScopedStorage,
  deriveActorStorageOpaqueId,
  invalidateActorScopedStorage,
  prepareActorScopedStorage,
  resumeActorScopedStorageWrites
} from '../../../services/auth/actorScopedStorage';
import { closeTenantRuntime, db, getActiveTenantRuntime, markTenantRuntimeReady, openTenantRuntime } from '../../../services/db/tenantRuntimeRouter';
import { DATABASE_RECOVERY_STATUS, getDatabaseRecoveryState } from '../../../services/db/databaseRecoveryState';
import { resolveActiveTenantIdentity } from '../../../services/tenant/localTenantGuard';

const opaque = 't_dddddddddddddddddddddddddddddddd';
const actorKey = 'admin:persistence-test';
const logicalKey = 'lanzo-active-orders-storage';
const fixture = JSON.stringify({
  state: {
    activeOrders: [['order-A', { id: 'order-A', isSaved: false, items: [], total: 12 }]],
    currentOrderId: 'order-A'
  },
  version: 0
});

const actorPhysicalKey = async (tenant) => {
  const actorOpaqueId = await deriveActorStorageOpaqueId(tenant.opaqueId, actorKey);
  return `lanzo:t:${tenant.opaqueId}:a:${actorOpaqueId}:${logicalKey}`;
};

const writeTrustedBindingToActiveRuntime = async (identity) => {
  await db.table(LOCAL_TENANT_BINDING_STORE).put({
    key: LOCAL_TENANT_BINDING_KEY,
    tenantIdentity: identity.primary,
    tenantAliases: [...identity.aliases],
    authority: identity.authority,
    bindingVersion: 1,
    source: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
};

// Production handoff prepares the actor namespace with writes suspended,
// hydrates through that pending binding, then activates/resumes only after
// ActorRuntime reaches GRANTED. Tests must preserve that order too.
const prepareActorStorage = async (tenant, actorGeneration) => {
  await prepareActorScopedStorage({ tenant, actorKey, actorGeneration });
};

const activatePreparedActorStorage = (tenant, actorGeneration) => {
  activateActorScopedStorage({
    actorKey,
    generation: actorGeneration,
    tenant
  });
  resumeActorScopedStorageWrites();
};

afterEach(() => {
  invalidateActorScopedStorage('test_cleanup');
  localTenantAccessController.reset();
  closeTenantRuntime();
  clearActiveTenantStorageNamespace();
  localStorage.clear();
  useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null, isLoading: false });
});

describe('active orders tenant persistence', () => {
  it('hydrates a preseeded payload and never overwrites it during lock/logout reset', async () => {
    const tenant = Object.freeze({
      opaqueId: opaque,
      databaseName: `LanzoDB_t_${opaque}`,
      generation: 1
    });
    setActiveTenantStorageNamespace(opaque);
    localTenantAccessController.enable('test');
    localTenantAccessController.grant({ aliases: ['license-key-sha256:test'], authority: 'license_key_sha256' });
    markTenantStorageReady();
    resumeTenantStorageWrites();
    await prepareActorStorage(tenant, 1);

    const key = await actorPhysicalKey(tenant);
    localStorage.setItem(key, fixture);
    await resetAndHydrateActiveOrdersForTenant();
    expect(localStorage.getItem(key)).toBe(fixture);
    expect(useActiveOrders.getState().activeOrders.get('order-A')).toMatchObject({ id: 'order-A' });
    activatePreparedActorStorage(tenant, 1);

    localTenantAccessController.lock('logout');
    invalidateActorScopedStorage('logout');
    expect(useActiveOrders.getState().activeOrders.size).toBe(0);
    expect(localStorage.getItem(key)).toBe(fixture);

    localTenantAccessController.grant({ aliases: ['license-key-sha256:test'], authority: 'license_key_sha256' });
    markTenantStorageReady();
    await prepareActorStorage(tenant, 3);
    await resetAndHydrateActiveOrdersForTenant();
    activatePreparedActorStorage(tenant, 3);
    expect(useActiveOrders.getState().activeOrders.get('order-A')).toMatchObject({ id: 'order-A' });
  });

  it('enables writes only after runtime hydration and restores a post-hydration change', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `PERSIST-A-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(identity);
    await writeTrustedBindingToActiveRuntime(identity);
    const runtime = getActiveTenantRuntime();
    const key = await actorPhysicalKey(runtime);
    const seeded = JSON.stringify({
      state: {
        activeOrders: [['seed', { id: 'seed', isSaved: false, items: [], total: 1 }]],
        currentOrderId: 'seed'
      },
      version: 0
    });

    await prepareActorStorage(runtime, 1);
    localStorage.setItem(key, seeded);
    await markTenantRuntimeReady();
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.READY);
    localTenantAccessController.grant(identity, 'ready');
    expect(useActiveOrders.getState().activeOrders.get('seed')).toMatchObject({ id: 'seed' });
    expect(localStorage.getItem(key)).toBe(seeded);
    activatePreparedActorStorage(runtime, 1);

    useActiveOrders.setState({
      activeOrders: new Map([['updated', { id: 'updated', isSaved: false, items: [], total: 99 }]]),
      currentOrderId: 'updated'
    });
    const afterUpdate = localStorage.getItem(key);
    expect(afterUpdate).toContain('updated');

    localTenantAccessController.lock('logout');
    invalidateActorScopedStorage('logout');
    expect(localStorage.getItem(key)).toBe(afterUpdate);

    localTenantAccessController.grant(identity, 'reopen');
    await prepareActorStorage(runtime, 3);
    await resetAndHydrateActiveOrdersForTenant();
    activatePreparedActorStorage(runtime, 3);
    expect(useActiveOrders.getState().activeOrders.get('updated')).toMatchObject({ total: 99 });
  });
});
