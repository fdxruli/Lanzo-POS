/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveOrders, resetAndHydrateActiveOrdersForTenant } from '../useActiveOrders';
import { localTenantAccessController } from '../../../services/tenant/localTenantPolicy';
import { clearActiveTenantStorageNamespace, markTenantStorageReady, setActiveTenantStorageNamespace } from '../../../services/tenant/tenantScopedStorage';

const opaque = 't_dddddddddddddddddddddddddddddddd';
const key = `lanzo:t:${opaque}:lanzo-active-orders-storage`;
const fixture = JSON.stringify({ state: { activeOrders: [['order-A', { id: 'order-A', items: [], total: 12 }]], currentOrderId: 'order-A' }, version: 0 });

afterEach(() => {
  localTenantAccessController.reset();
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
});
