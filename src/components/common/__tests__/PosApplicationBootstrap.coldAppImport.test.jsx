// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('PosApplicationBootstrap cold administrative import', () => {
  afterEach(async () => {
    const { closeTenantRuntime } = await import('../../../services/db/tenantRuntimeRouter');
    closeTenantRuntime();
    const { clearDatabaseRecoveryState } = await import('../../../services/db/databaseRecoveryState');
    clearDatabaseRecoveryState();
    const { resetLocalTenantGuardForTests } = await import('../../../services/tenant/localTenantGuard');
    resetLocalTenantGuardForTests();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('loads the production App path while READY is locked before tenant identity, without opening a database', async () => {
    vi.resetModules();
    const open = vi.spyOn(Dexie.prototype, 'open');
    const { initializeLocalTenantGuard, getLocalTenantGuardState } = await import('../../../services/tenant/localTenantGuard');
    const { DATABASE_RECOVERY_STATUS, setDatabaseRecoveryState } = await import('../../../services/db/databaseRecoveryState');
    const router = await import('../../../services/db/tenantRuntimeRouter');

    initializeLocalTenantGuard('ready_runtime_loading');
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY });

    const { loadPosReadyRuntime } = await import('../PosApplicationBootstrap');
    await expect(loadPosReadyRuntime()).resolves.toMatchObject({
      ReadyApplication: expect.any(Function)
    });

    expect(router.getActiveTenantRuntime()).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(getLocalTenantGuardState()).toMatchObject({ status: 'locked' });
  });

  it('keeps direct tenant database access fail-closed before TenantRuntime activation', async () => {
    vi.resetModules();
    const { initializeLocalTenantGuard } = await import('../../../services/tenant/localTenantGuard');
    const { db } = await import('../../../services/db/tenantRuntimeRouter');

    initializeLocalTenantGuard('ready_runtime_loading');

    expect(() => db.table('sales')).toThrow('TENANT_RUNTIME_NOT_READY');
  });
});
