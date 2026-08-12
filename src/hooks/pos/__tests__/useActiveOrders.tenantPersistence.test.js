/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveOrders, resetAndHydrateActiveOrdersForTenant } from '../useActiveOrders';
import { localTenantAccessController } from '../../../services/tenant/localTenantPolicy';
import { clearActiveTenantStorageNamespace, markTenantStorageReady, setActiveTenantStorageNamespace } from '../../../services/tenant/tenantScopedStorage';
import { closeTenantRuntime, getActiveTenantRuntime, markTenantRuntimeReady, openTenantRuntime } from '../../../services/db/tenantRuntimeRouter';
import { resolveActiveTenantIdentity } from '../../../services/tenant/localTenantGuard';

const opaque = 't_dddddddddddddddddddddddddddddddd';
const key = `lanzo:t:${opaque}:lanzo-active-orders-storage`;
const fixture = JSON.stringify({ state: { activeOrders: [['order-A', { id: 'order-A', items: [], total: 12 }]], currentOrderId: 'order-A' }, version: 0 });

afterEach(() => {
  localTenantAccessController.reset();
  closeTenantRuntime();
  clearActiveTenantStorageNamespace();
  localStorage.removeItem(key);
  useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null, isLoading: false });
});

describe('active orders tenant persistence', () => {
  it('hydrates a preseeded payload and never overwrites it during lock/logout reset', async () => {
    localStorage.setItem(key, fixture);
    setActiveTenantStorageNamespace(opaque);
    localTenantAccessController.enable('test');
    localTenantAccessController.grant({ aliases: ['license-key-sha256:test'], authority: 'license_key_sha256' });
    markTenantStorageReady();
    await resetAndHydrateActiveOrdersForTenant();
    expect(localStorage.getItem(key)).toBe(fixture);
    expect(useActiveOrders.getState().activeOrders.get('order-A')).toMatchObject({ id: 'order-A' });

    localTenantAccessController.lock('logout');
    expect(useActiveOrders.getState().activeOrders.size).toBe(0);
    expect(localStorage.getItem(key)).toBe(fixture);

    localTenantAccessController.grant({ aliases: ['license-key-sha256:test'], authority: 'license_key_sha256' });
    markTenantStorageReady();
    await resetAndHydrateActiveOrdersForTenant();
    expect(useActiveOrders.getState().activeOrders.get('order-A')).toMatchObject({ id: 'order-A' });
  });

  it('enables writes only after runtime hydration and restores a post-hydration change', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `PERSIST-A-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(identity);
    const runtime = getActiveTenantRuntime();
    const runtimeKey = `lanzo:t:${runtime.opaqueId}:lanzo-active-orders-storage`;
    const seeded = JSON.stringify({ state: { activeOrders: [['seed', { id: 'seed', items: [], total: 1 }]], currentOrderId: 'seed' }, version: 0 });
    localStorage.setItem(runtimeKey, seeded);

    await markTenantRuntimeReady();
    localTenantAccessController.grant(identity, 'ready');
    expect(useActiveOrders.getState().activeOrders.get('seed')).toMatchObject({ id: 'seed' });
    expect(localStorage.getItem(runtimeKey)).toBe(seeded);

    useActiveOrders.setState({
      activeOrders: new Map([['updated', { id: 'updated', items: [], total: 99 }]]),
      currentOrderId: 'updated'
    });
    const afterUpdate = localStorage.getItem(runtimeKey);
    expect(afterUpdate).toContain('updated');

    localTenantAccessController.lock('logout');
    expect(localStorage.getItem(runtimeKey)).toBe(afterUpdate);
    await markTenantRuntimeReady();
    localTenantAccessController.grant(identity, 'reopen');
    expect(useActiveOrders.getState().activeOrders.get('updated')).toMatchObject({ total: 99 });
  });
});
