/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveTenantIdentity } from '../../tenant/localTenantGuard';
import { localTenantAccessController } from '../../tenant/localTenantPolicy';
import {
  captureActiveTenantWorkerContext,
  isActiveTenantWorkerContext,
  isTenantWorkerDatabaseName
} from '../../tenant/tenantWorkerContext';
import { getTenantStorageState, registerTenantStorageHydrator } from '../../tenant/tenantScopedStorage';
import {
  closeTenantRuntime,
  db,
  getActiveTenantRuntime,
  markTenantRuntimeReady,
  openTenantRuntime,
  resolveTenantRuntimeDirectory
} from '../tenantRuntimeRouter';
import {
  DATABASE_RECOVERY_STATUS,
  clearDatabaseRecoveryState,
  getDatabaseRecoveryState,
  setDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../databaseRecoveryState';

const createNativeDatabase = (name, version) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('sales', { keyPath: 'id' });
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});

const createLegacyTenantDatabase = (name, { keepOpen = false, version = 110 } = {}) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, version);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('sales', { keyPath: 'timestamp' });
    request.result.createObjectStore('deleted_sales', { keyPath: 'timestamp' });
    request.result.createObjectStore('menu', { keyPath: 'id' });
    request.result.createObjectStore('customers', { keyPath: 'id' });
    request.result.createObjectStore('cajas', { keyPath: 'id' });
    request.result.createObjectStore('movimientos_caja', { keyPath: 'id' });
  };
  request.onsuccess = () => {
    if (keepOpen) resolve(request.result);
    else {
      request.result.close();
      resolve(null);
    }
  };
});

const waitUntil = async (predicate) => {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('tenant runtime router', () => {
  afterEach(() => { closeTenantRuntime(); localTenantAccessController.reset(); clearDatabaseRecoveryState(); });

  it('publishes a real terminal preflight diagnostic before the tenant runtime activates', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `UNSUPPORTED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createNativeDatabase(databaseName, 320);

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION',
      diagnostic: {
        detectedNativeVersion: 320,
        expectedNativeVersion: 310,
        isRetryable: false
      }
    });

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      databaseName,
      detectedNativeVersion: 320,
      expectedNativeVersion: 310,
      isRetryable: false,
      requiresMigration: false
    });
    expect(getActiveTenantRuntime()).toBeNull();
  });

  it('keeps successful compatible tenant opens READY through A to B to A', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: `READY-A-${crypto.randomUUID()}` });
    const b = await resolveActiveTenantIdentity({ license_key: `READY-B-${crypto.randomUUID()}` });
    setDatabaseRecoveryState({ status: DATABASE_RECOVERY_STATUS.READY });

    await openTenantRuntime(a);
    expect(getActiveTenantRuntime()).not.toBeNull();
    expect(getDatabaseRecoveryState()).toMatchObject({ status: DATABASE_RECOVERY_STATUS.READY });

    await openTenantRuntime(b);
    expect(getActiveTenantRuntime()).not.toBeNull();
    expect(getDatabaseRecoveryState()).toMatchObject({ status: DATABASE_RECOVERY_STATUS.READY });

    await openTenantRuntime(a);
    expect(getActiveTenantRuntime()).not.toBeNull();
    expect(getDatabaseRecoveryState()).toMatchObject({ status: DATABASE_RECOVERY_STATUS.READY });
  });

  it('returns a blocked tenant preflight to READY when the same native operation completes', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `BLOCKED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    const blocker = await createLegacyTenantDatabase(databaseName, { keepOpen: true });
    const opening = openTenantRuntime(identity);

    await waitUntil(() => getDatabaseRecoveryState().errorCode === 'DB_BLOCKED');
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
      errorCode: 'DB_BLOCKED'
    });

    blocker.close();
    await expect(opening).resolves.toMatchObject({ database: { name: databaseName } });
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.READY,
      databaseName
    });
  });

  it('returns a successful tenant migration to READY after reporting progress', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `MIGRATION-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    const statuses = [];
    const unsubscribe = subscribeDatabaseRecoveryState((state) => statuses.push(state.status));
    await createLegacyTenantDatabase(databaseName);

    try {
      await expect(openTenantRuntime(identity)).resolves.toMatchObject({ database: { name: databaseName } });
      expect(statuses).toContain(DATABASE_RECOVERY_STATUS.MIGRATING);
      expect(getDatabaseRecoveryState()).toMatchObject({
        status: DATABASE_RECOVERY_STATUS.READY,
        databaseName
      });
    } finally {
      unsubscribe();
    }
  });

  it('does not clear a terminal migration preflight failure to READY', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `MIGRATION-FAIL-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createLegacyTenantDatabase(databaseName, { version: 309 });

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION',
      diagnostic: { requiresMigration: true, isRetryable: false }
    });
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      requiresMigration: true,
      isRetryable: false
    });
    expect(getActiveTenantRuntime()).toBeNull();
  });

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

  it('captures only the granted active tenant worker target and invalidates A after B', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: `WORKER-A-${crypto.randomUUID()}` });
    const b = await resolveActiveTenantIdentity({ license_key: `WORKER-B-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(a);
    localTenantAccessController.grant(a, 'A');
    const contextA = captureActiveTenantWorkerContext();

    expect(isTenantWorkerDatabaseName(contextA.databaseName)).toBe(true);
    expect(isTenantWorkerDatabaseName('LanzoDB1')).toBe(false);
    expect(isActiveTenantWorkerContext(contextA)).toBe(true);

    localTenantAccessController.lock('switch');
    await openTenantRuntime(b);
    localTenantAccessController.grant(b, 'B');
    expect(isActiveTenantWorkerContext(contextA)).toBe(false);
    expect(captureActiveTenantWorkerContext().databaseName).not.toBe(contextA.databaseName);
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
