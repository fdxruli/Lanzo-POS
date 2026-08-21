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

const readDirectoryEntry = async (opaqueId) => {
  const directory = new Dexie('LanzoTenantDirectory');
  directory.version(1).stores({ tenants: 'opaqueId, *aliases' });
  await directory.open();
  const entry = await directory.table('tenants').get(opaqueId);
  directory.close();
  return entry;
};

const writeDirectoryEntry = async (entry) => {
  const directory = new Dexie('LanzoTenantDirectory');
  directory.version(1).stores({ tenants: 'opaqueId, *aliases' });
  await directory.open();
  await directory.table('tenants').put(entry);
  directory.close();
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

const malformedLifecycleMutations = [
  ['unknown version', (entry) => ({ ...entry, directoryLifecycleVersion: 999, directoryState: 'ACTIVE' })],
  ['unknown state', (entry) => ({ ...entry, directoryLifecycleVersion: 1, directoryState: 'BROKEN' })],
  ['unknown version and state', (entry) => ({ ...entry, directoryLifecycleVersion: 999, directoryState: 'BROKEN' })],
  ['version only', (entry) => { const { directoryState, ...partial } = entry; return { ...partial, directoryLifecycleVersion: 1 }; }],
  ['state only', (entry) => { const { directoryLifecycleVersion, ...partial } = entry; return { ...partial, directoryState: 'PROVISIONING' }; }],
  ['explicit null lifecycle', (entry) => ({ ...entry, directoryLifecycleVersion: null, directoryState: null })]
];

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
    const reserved = await readDirectoryEntry(staleOpaqueId);
    await writeDirectoryEntry({
      ...reserved,
      directoryLifecycleVersion: 1,
      directoryState: 'ACTIVE'
    });
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

  it('reserves a fresh destination as PROVISIONING and promotes it only after binding and hydration', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-FRESH-${crypto.randomUUID()}` });

    await openTenantRuntime(identity);
    const runtime = getActiveTenantRuntime();
    expect(await readDirectoryEntry(runtime.opaqueId)).toMatchObject({
      opaqueId: runtime.opaqueId,
      directoryLifecycleVersion: 1,
      directoryState: 'PROVISIONING'
    });

    await writeTrustedBindingToActiveRuntime(identity);
    await markTenantRuntimeReady();

    expect(await readDirectoryEntry(runtime.opaqueId)).toMatchObject({
      opaqueId: runtime.opaqueId,
      directoryLifecycleVersion: 1,
      directoryState: 'ACTIVE'
    });
    expect(await Dexie.getDatabaseNames()).toContain(runtime.databaseName);
    expect(getDatabaseRecoveryState()).toMatchObject({ status: DATABASE_RECOVERY_STATUS.READY });
    expect(getTenantStorageState()).toMatchObject({ writesSuspended: false });
  });

  it.each(malformedLifecycleMutations)('fails closed on a %s directory lifecycle without changing its physical tenant', async (_label, mutate) => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-MALFORMED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const reserved = await readDirectoryEntry(opaqueId);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createBoundOperationalTenantDatabase(identity, databaseName);
    const malformed = mutate(reserved);
    await writeDirectoryEntry(malformed);

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_CORRUPT' });

    expect(getActiveTenantRuntime()).toBeNull();
    expect(await readDirectoryEntry(opaqueId)).toEqual(malformed);
    expect(await Dexie.getDatabaseNames()).toContain(databaseName);
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'TENANT_DIRECTORY_CORRUPT'
    });
  });

  it('fails closed when a provisioning lifecycle becomes malformed before readiness, without resuming writes', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-PROMOTION-MALFORMED-${crypto.randomUUID()}` });
    await openTenantRuntime(identity);
    const runtime = getActiveTenantRuntime();
    await writeTrustedBindingToActiveRuntime(identity);
    const reservation = await readDirectoryEntry(runtime.opaqueId);
    const malformed = { ...reservation, directoryLifecycleVersion: 999, directoryState: 'BROKEN' };
    await writeDirectoryEntry(malformed);

    await expect(markTenantRuntimeReady()).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_CORRUPT' });

    expect(await readDirectoryEntry(runtime.opaqueId)).toEqual(malformed);
    expect(getActiveTenantRuntime()).toBeNull();
    expect(getTenantStorageState()).toMatchObject({ ready: false, writesSuspended: true });
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'TENANT_DIRECTORY_CORRUPT'
    });
  });

  it('resumes a crash after directory reservation with the same opaqueId', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-RESERVE-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;

    expect(await Dexie.getDatabaseNames()).not.toContain(databaseName);
    await openTenantRuntime(identity);
    expect(getActiveTenantRuntime()).toMatchObject({ opaqueId, databaseName });
    await writeTrustedBindingToActiveRuntime(identity);
    await markTenantRuntimeReady();

    expect(await readDirectoryEntry(opaqueId)).toMatchObject({ directoryState: 'ACTIVE' });
    expect(await Dexie.getDatabaseNames()).toContain(databaseName);
  });

  it('resumes a provisioning database created before its first binding without allocating another database', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-PHYSICAL-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createUnboundOperationalTenantDatabase(databaseName);

    await openTenantRuntime(identity);
    await writeTrustedBindingToActiveRuntime(identity);
    await markTenantRuntimeReady();

    expect(getActiveTenantRuntime()).toMatchObject({ opaqueId, databaseName });
    expect(await readDirectoryEntry(opaqueId)).toMatchObject({ directoryState: 'ACTIVE' });
    expect((await Dexie.getDatabaseNames()).filter((name) => name.startsWith('LanzoDB_t_'))).toContain(databaseName);
  });

  it('resumes a matching bound provisioning database and preserves its business rows before ACTIVE', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-BOUND-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createBoundOperationalTenantDatabase(identity, databaseName, { id: 'preserved-before-active', name: 'Preserved' });

    await openTenantRuntime(identity);
    await markTenantRuntimeReady();

    expect(await db.table('menu').get('preserved-before-active')).toMatchObject({ name: 'Preserved' });
    expect(await readDirectoryEntry(opaqueId)).toMatchObject({ directoryState: 'ACTIVE' });
  });

  it('fails closed when an ACTIVE directory entry loses its physical database', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-ACTIVE-LOSS-${crypto.randomUUID()}` });
    await openTenantRuntime(identity);
    const runtime = getActiveTenantRuntime();
    await writeTrustedBindingToActiveRuntime(identity);
    await markTenantRuntimeReady();
    closeTenantRuntime();
    await Dexie.delete(runtime.databaseName);
    const before = await readDirectoryEntry(runtime.opaqueId);

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_CORRUPT' });

    expect(await Dexie.getDatabaseNames()).not.toContain(runtime.databaseName);
    expect(await readDirectoryEntry(runtime.opaqueId)).toEqual(before);
    expect(getActiveTenantRuntime()).toBeNull();
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'TENANT_DIRECTORY_CORRUPT',
      databaseName: null
    });
  });

  it('keeps a lifecycle-less missing directory entry fail-closed', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-LEGACY-LOSS-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const reserved = await readDirectoryEntry(opaqueId);
    await writeDirectoryEntry({
      opaqueId,
      aliases: reserved.aliases,
      updatedAt: reserved.updatedAt
    });

    await expect(openTenantRuntime(identity)).rejects.toMatchObject({ code: 'TENANT_DIRECTORY_CORRUPT' });
    expect(await readDirectoryEntry(opaqueId)).toEqual({
      opaqueId,
      aliases: reserved.aliases,
      updatedAt: reserved.updatedAt
    });
    expect(await Dexie.getDatabaseNames()).not.toContain(`LanzoDB_t_${opaqueId}`);
  });

  it('backfills a valid lifecycle-less directory entry to ACTIVE only after trusted preparation', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-LEGACY-VALID-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    const reserved = await readDirectoryEntry(opaqueId);
    await writeDirectoryEntry({ opaqueId, aliases: reserved.aliases, updatedAt: reserved.updatedAt });
    await createBoundOperationalTenantDatabase(identity, databaseName);

    await openTenantRuntime(identity);
    await markTenantRuntimeReady();

    expect(await readDirectoryEntry(opaqueId)).toMatchObject({
      opaqueId,
      directoryLifecycleVersion: 1,
      directoryState: 'ACTIVE'
    });
  });

  it('converges concurrent first opens on one provisioning reservation and physical database', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `LIFECYCLE-TWO-TAB-${crypto.randomUUID()}` });
    const [left, right] = await Promise.all([
      resolveTenantRuntimeDirectory(identity),
      resolveTenantRuntimeDirectory(identity)
    ]);
    expect(left).toBe(right);

    await openTenantRuntime(identity);
    await writeTrustedBindingToActiveRuntime(identity);
    await markTenantRuntimeReady();

    const row = await readDirectoryEntry(left);
    expect(row).toMatchObject({ opaqueId: left, directoryState: 'ACTIVE' });
    expect((await Dexie.getDatabaseNames()).filter((name) => name === `LanzoDB_t_${left}`)).toHaveLength(1);
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
