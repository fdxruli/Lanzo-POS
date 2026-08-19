/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveActiveTenantIdentity } from '../../tenant/localTenantGuard';
import {
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  localTenantAccessController
} from '../../tenant/localTenantPolicy';
import { createOperationalLanzoDatabase } from '../dexie';
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
import { CURRENT_NATIVE_DATABASE_VERSION } from '../databaseSchema';

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

const tenantPhysicalName = () => `LanzoDB_t_t_${crypto.randomUUID().replace(/-/g, '')}`;

const createBoundOperationalTenantDatabase = async (identity, databaseName, product = null) => {
  const database = createOperationalLanzoDatabase(databaseName);
  await database.open();
  await database.table(LOCAL_TENANT_BINDING_STORE).put({
    key: LOCAL_TENANT_BINDING_KEY,
    tenantIdentity: identity.primary,
    tenantAliases: [...identity.aliases],
    authority: identity.authority,
    bindingVersion: 1,
    source: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (product) await database.table('menu').put(product);
  database.close();
  return databaseName;
};

const createUnboundOperationalTenantDatabase = async (databaseName, { binding = null, product = null } = {}) => {
  const database = createOperationalLanzoDatabase(databaseName);
  await database.open();
  if (binding) await database.table(LOCAL_TENANT_BINDING_STORE).put(binding);
  if (product) await database.table('menu').put(product);
  database.close();
  return databaseName;
};

const deletePhysicalDatabase = async (databaseName) => {
  const database = new Dexie(databaseName);
  await database.delete();
};

const deleteDirectoryEntry = async (opaqueId) => {
  const directory = new Dexie('LanzoTenantDirectory');
  directory.version(1).stores({ tenants: 'opaqueId, *aliases' });
  await directory.open();
  await directory.table('tenants').delete(opaqueId);
  directory.close();
};

describe('tenant runtime router', () => {
  afterEach(() => { closeTenantRuntime(); localTenantAccessController.reset(); clearDatabaseRecoveryState(); });

  it('publishes a real terminal preflight diagnostic before the tenant runtime activates', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `UNSUPPORTED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createNativeDatabase(databaseName, CURRENT_NATIVE_DATABASE_VERSION + 10);

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION',
      diagnostic: {
        detectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION + 10,
        expectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
        isRetryable: false
      }
    });

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      databaseName,
      detectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION + 10,
      expectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
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
    await createLegacyTenantDatabase(databaseName, { version: CURRENT_NATIVE_DATABASE_VERSION - 1 });

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
    await db.table(LOCAL_TENANT_BINDING_STORE).put({
      key: LOCAL_TENANT_BINDING_KEY,
      tenantIdentity: a.primary,
      tenantAliases: [...a.aliases],
      bindingVersion: 1
    });
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

  it('repairs a lost directory entry from exactly one trusted physical tenant binding', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `RECOVER-DIRECTORY-${crypto.randomUUID()}` });
    await openTenantRuntime(identity);
    const established = getActiveTenantRuntime();
    await db.table('menu').put({ id: 'recovered-product', name: 'Preserved' });
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
    closeTenantRuntime();
    await deleteDirectoryEntry(established.opaqueId);

    await openTenantRuntime(identity);
    expect(getActiveTenantRuntime()).toMatchObject({
      opaqueId: established.opaqueId,
      databaseName: established.databaseName
    });
    expect(await db.table('menu').get('recovered-product')).toMatchObject({ name: 'Preserved' });

    const directory = new Dexie('LanzoTenantDirectory');
    directory.version(1).stores({ tenants: 'opaqueId, *aliases' });
    await directory.open();
    expect(await directory.table('tenants').get(established.opaqueId)).toMatchObject({ opaqueId: established.opaqueId });
    directory.close();
  });

  it('keeps the same physical tenant after reauthentication without session storage', async () => {
    const licenseKey = `REAUTH-${crypto.randomUUID()}`;
    const identity = await resolveActiveTenantIdentity({ license_key: licenseKey });
    await openTenantRuntime(identity);
    const established = getActiveTenantRuntime();
    await db.table('menu').put({ id: 'reauth-product', name: 'Still here' });
    await db.table(LOCAL_TENANT_BINDING_STORE).put({
      key: LOCAL_TENANT_BINDING_KEY,
      tenantIdentity: identity.primary,
      tenantAliases: [...identity.aliases],
      bindingVersion: 1
    });
    closeTenantRuntime();
    localTenantAccessController.reset();

    const reauthenticated = await resolveActiveTenantIdentity({ license_key: licenseKey });
    await openTenantRuntime(reauthenticated);

    expect(getActiveTenantRuntime()).toMatchObject({
      opaqueId: established.opaqueId,
      databaseName: established.databaseName
    });
    expect(await db.table('menu').get('reauth-product')).toMatchObject({ name: 'Still here' });
  });

  it('does not adopt a trusted database bound to another tenant', async () => {
    const owner = await resolveActiveTenantIdentity({ license_key: `BOUND-OTHER-${crypto.randomUUID()}` });
    const candidateName = tenantPhysicalName();
    await createBoundOperationalTenantDatabase(owner, candidateName, { id: 'foreign', name: 'Foreign' });

    const requested = await resolveActiveTenantIdentity({ license_key: `BOUND-REQUESTED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(requested);

    expect(opaqueId).not.toBe(candidateName.slice('LanzoDB_t_'.length));
    expect(await resolveTenantRuntimeDirectory(owner)).toBe(candidateName.slice('LanzoDB_t_'.length));
  });

  it('fails closed when two physical tenant bindings claim the authenticated tenant', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `AMBIGUOUS-PHYSICAL-${crypto.randomUUID()}` });
    const firstName = tenantPhysicalName();
    const secondName = tenantPhysicalName();
    await createBoundOperationalTenantDatabase(identity, firstName);
    await createBoundOperationalTenantDatabase(identity, secondName);

    await expect(resolveTenantRuntimeDirectory(identity)).rejects.toMatchObject({
      code: 'TENANT_DIRECTORY_AMBIGUOUS'
    });
  });

  it('fails closed on a stale directory row without creating a replacement database', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `STALE-DIRECTORY-${crypto.randomUUID()}` });
    const staleOpaqueId = await resolveTenantRuntimeDirectory(identity);
    const boundCandidateName = tenantPhysicalName();
    await createBoundOperationalTenantDatabase(identity, boundCandidateName);

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({
      code: 'TENANT_DIRECTORY_CORRUPT'
    });
    expect(await Dexie.getDatabaseNames()).not.toContain(`LanzoDB_t_${staleOpaqueId}`);
    expect(await Dexie.getDatabaseNames()).toContain(boundCandidateName);
  });

  it('serializes concurrent allocation for a genuinely new tenant', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `CONCURRENT-NEW-${crypto.randomUUID()}` });
    const [left, right] = await Promise.all([
      resolveTenantRuntimeDirectory(identity),
      resolveTenantRuntimeDirectory(identity)
    ]);

    expect(left).toBe(right);
  });

  it('never treats LanzoDB1 as an isolated tenant candidate', async () => {
    await createLegacyTenantDatabase('LanzoDB1');
    const identity = await resolveActiveTenantIdentity({ license_key: `LEGACY-NO-FALLBACK-${crypto.randomUUID()}` });

    const opaqueId = await resolveTenantRuntimeDirectory(identity);

    expect(opaqueId).not.toBe('1');
    expect(await Dexie.getDatabaseNames()).toContain('LanzoDB1');
  });

  it('blocks B writes after its physical DB opens and before B receives a grant', async () => {
    const a = await resolveActiveTenantIdentity({ license_key: `LEASE-A-${crypto.randomUUID()}` });
    const b = await resolveActiveTenantIdentity({ license_key: `LEASE-B-${crypto.randomUUID()}` });
    localTenantAccessController.enable('test');
    await openTenantRuntime(a);
    localTenantAccessController.grant(a, 'A');
    await db.table('menu').put({ id: 'a', name: 'A' });
    await db.table(LOCAL_TENANT_BINDING_STORE).put({
      key: LOCAL_TENANT_BINDING_KEY,
      tenantIdentity: a.primary,
      tenantAliases: [...a.aliases],
      bindingVersion: 1
    });

    localTenantAccessController.lock('transition');
    await openTenantRuntime(b);
    await expect(db.table('menu').put({ id: 'b', name: 'B' })).rejects.toMatchObject({ code: 'LOCAL_TENANT_ACCESS_REQUIRED' });
    localTenantAccessController.grant(b, 'B');
    await db.table(LOCAL_TENANT_BINDING_STORE).put({
      key: LOCAL_TENANT_BINDING_KEY,
      tenantIdentity: b.primary,
      tenantAliases: [...b.aliases],
      bindingVersion: 1
    });
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

  it('fails closed on an unbound non-empty tenant database without allocating a replacement', async () => {
    const candidateName = tenantPhysicalName();
    await createUnboundOperationalTenantDatabase(candidateName, {
      product: { id: 'unknown-product', name: 'Preserve me' }
    });
    const identity = await resolveActiveTenantIdentity({ license_key: `UNKNOWN-OWNER-${crypto.randomUUID()}` });
    const databaseNamesBefore = await Dexie.getDatabaseNames();

    try {
      await expect(resolveTenantRuntimeDirectory(identity)).rejects.toMatchObject({
        code: 'TENANT_DATABASE_OWNERSHIP_UNRESOLVED'
      });
      expect(await Dexie.getDatabaseNames()).toContain(candidateName);
      expect(await Dexie.getDatabaseNames()).toEqual(databaseNamesBefore);
    } finally {
      await deletePhysicalDatabase(candidateName);
    }
  });

  it('fails closed on malformed binding plus tenant data instead of adopting or replacing it', async () => {
    const candidateName = tenantPhysicalName();
    const identity = await resolveActiveTenantIdentity({ license_key: `MALFORMED-OWNER-${crypto.randomUUID()}` });
    await createUnboundOperationalTenantDatabase(candidateName, {
      binding: {
        key: LOCAL_TENANT_BINDING_KEY,
        tenantIdentity: identity.primary,
        tenantAliases: [identity.primary],
        bindingVersion: 99
      },
      product: { id: 'malformed-product', name: 'Preserve malformed owner data' }
    });

    try {
      await expect(resolveTenantRuntimeDirectory(identity)).rejects.toMatchObject({
        code: 'TENANT_DATABASE_OWNERSHIP_UNRESOLVED'
      });
      expect(await Dexie.getDatabaseNames()).toContain(candidateName);
    } finally {
      await deletePhysicalDatabase(candidateName);
    }
  });

  it('ignores a demonstrably empty unbound database and allocates a new tenant destination', async () => {
    const emptyName = tenantPhysicalName();
    await createUnboundOperationalTenantDatabase(emptyName);
    const identity = await resolveActiveTenantIdentity({ license_key: `EMPTY-UNBOUND-${crypto.randomUUID()}` });

    try {
      const opaqueId = await resolveTenantRuntimeDirectory(identity);
      expect(`LanzoDB_t_${opaqueId}`).not.toBe(emptyName);
      expect(await Dexie.getDatabaseNames()).toContain(emptyName);
    } finally {
      await deletePhysicalDatabase(emptyName);
    }
  });

  it('does not ignore unknown non-empty data even when one trusted compatible binding exists', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `MATCH-PLUS-UNKNOWN-${crypto.randomUUID()}` });
    const compatibleName = tenantPhysicalName();
    const unknownName = tenantPhysicalName();
    await createBoundOperationalTenantDatabase(identity, compatibleName);
    await createUnboundOperationalTenantDatabase(unknownName, {
      product: { id: 'ambiguous-product', name: 'Unknown owner data' }
    });

    try {
      await expect(resolveTenantRuntimeDirectory(identity)).rejects.toMatchObject({
        code: 'TENANT_DATABASE_OWNERSHIP_UNRESOLVED'
      });
      expect(await Dexie.getDatabaseNames()).toEqual(expect.arrayContaining([compatibleName, unknownName]));
    } finally {
      await deletePhysicalDatabase(compatibleName);
      await deletePhysicalDatabase(unknownName);
    }
  });

  it('fails closed when physical database inspection fails before allocating a fresh database', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `INSPECTION-FAIL-${crypto.randomUUID()}` });
    const databasesSpy = vi.spyOn(globalThis.indexedDB, 'databases').mockRejectedValueOnce(new Error('forced inspection failure'));

    try {
      await expect(resolveTenantRuntimeDirectory(identity)).rejects.toMatchObject({
        code: 'TENANT_DATABASE_DISCOVERY_FAILED'
      });
    } finally {
      databasesSpy.mockRestore();
    }
  });
});
