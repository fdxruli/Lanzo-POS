import { afterEach, describe, expect, it } from 'vitest';
import { getDatabaseRecoveryState, DATABASE_RECOVERY_STATUS } from '../databaseRecoveryState';
import { prepareLocalDatabase } from '../databaseRuntime';
import { closeTenantRuntime, getActiveTenantRuntime } from '../tenantRuntimeRouter';

afterEach(() => closeTenantRuntime());

describe('database runtime pre-license bootstrap', () => {
  it('reaches recovery READY without opening a tenant or the legacy vault', async () => {
    expect(getActiveTenantRuntime()).toBeNull();
    await expect(prepareLocalDatabase()).resolves.toMatchObject({ ready: true, deferredTenantRuntime: true, databaseName: null });
    expect(getActiveTenantRuntime()).toBeNull();
    expect(getDatabaseRecoveryState()).toMatchObject({ status: DATABASE_RECOVERY_STATUS.READY, databaseName: null });
  });
});
