/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tenant runtime circular-import boundary', () => {
  afterEach(async () => {
    const router = await import('../tenantRuntimeRouter');
    router.closeTenantRuntime();
    vi.restoreAllMocks();
  });

  it('loads the router without evaluating dexie.js and fails closed until a factory is registered', async () => {
    vi.resetModules();
    const router = await import('../tenantRuntimeRouter');

    await expect(router.openTenantRuntime({ aliases: ['license-id:router-only'] }))
      .rejects.toMatchObject({ code: 'TENANT_RUNTIME_FACTORY_NOT_CONFIGURED' });
    expect(router.getActiveTenantRuntime()).toBeNull();
  });

  it('loads dexie.js without a circular-init TDZ and registers its operational factory before opening a tenant', async () => {
    vi.resetModules();
    await expect(import('../dexie')).resolves.toBeDefined();
    const router = await import('../tenantRuntimeRouter');

    await expect(router.openTenantRuntime({ aliases: ['license-id:dexie-import'] }))
      .resolves.toMatchObject({ database: { name: expect.stringMatching(/^LanzoDB_t_t_/) } });
  });

  it('keeps cold admin bootstrap free of runtime and LanzoDB1 opening', async () => {
    vi.resetModules();
    const open = vi.spyOn(Dexie.prototype, 'open');
    await expect(import('../dexie')).resolves.toBeDefined();
    const { prepareLocalDatabase } = await import('../databaseRuntime');
    const { getActiveTenantRuntime } = await import('../tenantRuntimeRouter');

    await expect(prepareLocalDatabase()).resolves.toMatchObject({ ready: true, deferredTenantRuntime: true, databaseName: null });
    expect(getActiveTenantRuntime()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
