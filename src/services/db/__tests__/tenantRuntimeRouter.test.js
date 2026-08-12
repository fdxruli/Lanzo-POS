/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveTenantIdentity } from '../../tenant/localTenantGuard';
import { localTenantAccessController } from '../../tenant/localTenantPolicy';
import { getTenantStorageState, registerTenantStorageHydrator } from '../../tenant/tenantScopedStorage';
import {
  closeTenantRuntime,
  db,
  getActiveTenantRuntime,
  markTenantRuntimeReady,
  openTenantRuntime,
  resolveTenantRuntimeDirectory
} from '../tenantRuntimeRouter';

describe('tenant runtime router', () => {
  afterEach(() => { closeTenantRuntime(); localTenantAccessController.reset(); });

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

  it('preserves alias-type compatibility and never mutates the directory on conflicts', async () => {
    const suffix = crypto.randomUUID();
    const a = { aliases: [`license-id:L1-${suffix}`, `license-key-sha256:K1-${suffix}`] };
    const sameByKey = { aliases: [`license-key-sha256:K1-${suffix}`] };
    const conflictLicense = { aliases: [`license-id:L2-${suffix}`, `license-key-sha256:K1-${suffix}`] };
    const conflictKey = { aliases: [`license-id:L1-${suffix}`, `license-key-sha256:K3-${suffix}`] };
    const directory = new Dexie('LanzoTenantDirectory');
    directory.version(1).stores({ tenants: 'opaqueId, *aliases' });
    await directory.open();

    const first = await resolveTenantRuntimeDirectory(a);
    expect(await resolveTenantRuntimeDirectory(sameByKey)).toBe(first);
    const before = await directory.table('tenants').toArray();
    await expect(resolveTenantRuntimeDirectory(conflictLicense)).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_ALIAS_CONFLICT' });
    await expect(resolveTenantRuntimeDirectory(conflictKey)).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_ALIAS_CONFLICT' });
    expect(await directory.table('tenants').toArray()).toEqual(before);
    directory.close();
  });

  it('enriches a key-only or id-only directory entry only through its matching alias type', async () => {
    const suffix = crypto.randomUUID();
    const byKey = await resolveTenantRuntimeDirectory({ aliases: [`license-key-sha256:K1-${suffix}`] });
    expect(await resolveTenantRuntimeDirectory({ aliases: [`license-id:L1-${suffix}`, `license-key-sha256:K1-${suffix}`] })).toBe(byKey);
    const byId = await resolveTenantRuntimeDirectory({ aliases: [`license-id:L2-${suffix}`] });
    expect(await resolveTenantRuntimeDirectory({ aliases: [`license-id:L2-${suffix}`, `license-key-sha256:K2-${suffix}`] })).toBe(byId);
  });

  it('fails closed if aliases resolve to more than one destination', async () => {
    const suffix = crypto.randomUUID();
    await resolveTenantRuntimeDirectory({ aliases: [`license-id:L1-${suffix}`, `license-key-sha256:K1-${suffix}`] });
    await resolveTenantRuntimeDirectory({ aliases: [`license-id:L2-${suffix}`, `license-key-sha256:K2-${suffix}`] });
    await expect(resolveTenantRuntimeDirectory({ aliases: [`license-id:L1-${suffix}`, `license-key-sha256:K2-${suffix}`] })).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_AMBIGUOUS' });
  });

  it('blocks B writes after its physical DB opens and before B receives a grant', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: `LEASE-A-${crypto.randomUUID()}` });
    const b = await resolveActiveTenantIdentity({ license_key: `LEASE-B-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(a);
    localTenantAccessController.grant(a, 'A');
    await db.table('menu').put({ id: 'a', name: 'A' });

    localTenantAccessController.lock('transition');
    await openTenantRuntime(b);
    await expect(db.table('menu').put({ id: 'b', name: 'B' })).rejects.toMatchObject({ code: 'LOCAL_TENANT_ACCESS_REQUIRED' });
    localTenantAccessController.grant(b, 'B');
    await expect(db.table('menu').put({ id: 'b', name: 'B' })).resolves.toBe('b');
  });

  it('locks a stale tab through the storage-event fallback without invalidating same-tenant messages', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: `TAB-A-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(a);
    localTenantAccessController.grant(a, 'A');
    const stale = db.table('menu');
    window.dispatchEvent(new StorageEvent('storage', { key: 'lanzo:tenant-runtime-context:v1', newValue: JSON.stringify({ opaqueId: getActiveTenantRuntime().opaqueId }) }));
    expect(getActiveTenantRuntime()).not.toBeNull();
    window.dispatchEvent(new StorageEvent('storage', { key: 'lanzo:tenant-runtime-context:v1', newValue: JSON.stringify({ opaqueId: 't_ffffffffffffffffffffffffffffffff' }) }));
    expect(getActiveTenantRuntime()).toBeNull();
    expect(localTenantAccessController.getState().status).toBe('locked');
    expect(getTenantStorageState()).toMatchObject({ ready: false });
    expect(() => stale.count()).toThrow('TENANT_RUNTIME_NOT_READY');
  });

  it('fails closed when a tenant storage hydrator throws and preserves its payload', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `HYDRATION-FAIL-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(identity);
    const opaqueId = getActiveTenantRuntime().opaqueId;
    const key = `lanzo:t:${opaqueId}:failure-payload`;
    localStorage.setItem(key, 'preserve-me');
    const unregister = registerTenantStorageHydrator(async () => { throw new Error('hydrator failed'); });
    try {
      await expect(markTenantRuntimeReady()).rejects.toThrow('hydrator failed');
      expect(localTenantAccessController.getState().status).not.toBe('granted');
      expect(getTenantStorageState()).toMatchObject({ ready: false, writesSuspended: true });
      expect(localStorage.getItem(key)).toBe('preserve-me');
      expect(() => db.table('menu').count()).toThrow('TENANT_RUNTIME_NOT_READY');
    } finally {
      unregister();
    }
  });
});
