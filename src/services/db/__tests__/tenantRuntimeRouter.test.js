/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveTenantIdentity } from '../../tenant/localTenantGuard';
import {
  closeTenantRuntime,
  db,
  getActiveTenantRuntime,
  openTenantRuntime
} from '../tenantRuntimeRouter';

describe('tenant runtime router', () => {
  afterEach(() => closeTenantRuntime());

  it('reopens A, isolates B, and rejects a stale A table handle', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: 'FREE-A' });
    const b = await resolveActiveTenantIdentity({ license_key: 'FREE-B' });
    await openTenantRuntime(a);
    const aName = getActiveTenantRuntime().databaseName;
    const staleProducts = db.table('menu');
    await staleProducts.put({ id: 'a-product', name: 'A' });
    await openTenantRuntime(b);
    expect(getActiveTenantRuntime().databaseName).not.toBe(aName);
    expect(await db.table('menu').count()).toBe(0);
    expect(() => staleProducts.count()).toThrow('TENANT_RUNTIME_STALE_HANDLE');
    await openTenantRuntime(a);
    expect(getActiveTenantRuntime().databaseName).toBe(aName);
    expect(await db.table('menu').get('a-product')).toMatchObject({ name: 'A' });
  });
});
