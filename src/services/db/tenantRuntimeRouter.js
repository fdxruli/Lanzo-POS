import Dexie from 'dexie';
import {
  areLocalTenantAliasesCompatible,
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  LOCAL_TENANT_STATUS,
  localTenantAccessController
} from '../tenant/localTenantPolicy';
import { setActiveTenantStorageNamespace, clearActiveTenantStorageNamespace, markTenantStorageReady, hydrateTenantStorageConsumers, resumeTenantStorageWrites, suspendTenantStorageWrites } from '../tenant/tenantScopedStorage';
import { preflightAndRepairIndexedDb } from './indexedDbPreflightCoordinator';
import {
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  reportStructuralDatabaseErrorOnce,
  setDatabaseRecoveryState
} from './databaseRecoveryState';

const DIRECTORY_DB = 'LanzoTenantDirectory';
const DIRECTORY_STORE = 'tenants';
const TENANT_DATABASE_PREFIX = 'LanzoDB_t_';
const directory = new Dexie(DIRECTORY_DB);
directory.version(1).stores({ [DIRECTORY_STORE]: 'opaqueId, *aliases' });

export class TenantRuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
export const isTenantRuntimeError = (error) => error instanceof TenantRuntimeError || String(error?.code || '').startsWith('TENANT_RUNTIME_');
let active = null;
let generation = 0;
let tenantDatabaseFactory = null;

// The router deliberately owns no dependency on dexie.js. Keeping the
// operational database factory injected avoids evaluating the legacy-vault
// module while the tenant runtime is being initialized.
export const configureTenantRuntimeDatabaseFactory = (factory) => {
  if (typeof factory !== 'function') {
    throw new TenantRuntimeError('TENANT_RUNTIME_FACTORY_INVALID');
  }
  tenantDatabaseFactory = factory;
};
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lanzo-tenant-runtime-v1');
const invalidateForForeignTenant = (opaqueId) => {
  if (!active?.opaqueId || opaqueId === active.opaqueId) return;
  // A different tab changed tenant context. Closing is conservative: every
  // compatibility-proxy operation now fails instead of writing under B.
  localTenantAccessController.lock('tenant_context_changed');
  suspendTenantStorageWrites();
  closeTenantRuntime();
};
channel?.addEventListener('message', (event) => {
  if (event?.data?.type !== 'tenant_context_changed') return;
  invalidateForForeignTenant(event.data.opaqueId);
});
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('storage', (event) => {
  if (event.key !== 'lanzo:tenant-runtime-context:v1' || !event.newValue) return;
  try { invalidateForForeignTenant(JSON.parse(event.newValue).opaqueId); } catch { /* ignore malformed cross-tab signal */ }
});

const hex = (bytes) => Array.from(bytes).map((x) => x.toString(16).padStart(2, '0')).join('');
const digest = async (value) => hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

const aliasFingerprint = async (alias) => {
  const type = String(alias).startsWith('license-id:') ? 'license-id:'
    : String(alias).startsWith('license-key-sha256:') ? 'license-key-sha256:' : null;
  if (!type) throw new TenantRuntimeError('TENANT_IDENTITY_INVALID');
  return `${type}${await digest(alias)}`;
};

const listPhysicalDatabaseNames = async () => {
  try {
    if (typeof globalThis.indexedDB?.databases === 'function') {
      const databases = await globalThis.indexedDB.databases();
      return {
        available: true,
        names: new Set(databases.map(({ name }) => name).filter(Boolean))
      };
    }

    if (typeof Dexie.getDatabaseNames === 'function') {
      return {
        available: true,
        names: new Set((await Dexie.getDatabaseNames()).filter(Boolean))
      };
    }
  } catch (error) {
    const inspectionError = new TenantRuntimeError('TENANT_DATABASE_DISCOVERY_FAILED');
    inspectionError.cause = error;
    throw inspectionError;
  }

  throw new TenantRuntimeError('TENANT_DATABASE_DISCOVERY_UNAVAILABLE');
};

const readTenantBinding = (databaseName) => new Promise((resolve, reject) => {
  let createdDuringInspection = false;
  let nativeDatabase = null;
  const request = globalThis.indexedDB.open(databaseName);

  request.onupgradeneeded = () => {
    // Opening an unlisted database would create it. Abort that upgrade so the
    // discovery path remains strictly read-only and never manufactures a
    // physical tenant database as a side effect of inspection.
    createdDuringInspection = true;
    try { request.transaction?.abort(); } catch { /* best effort */ }
  };
  request.onerror = () => {
    if (createdDuringInspection && request.error?.name === 'AbortError') {
      resolve(null);
      return;
    }
    const inspectionError = new TenantRuntimeError('TENANT_DATABASE_INSPECTION_FAILED');
    inspectionError.cause = request.error || null;
    reject(inspectionError);
  };
  request.onblocked = () => {
    const inspectionError = new TenantRuntimeError('TENANT_DATABASE_INSPECTION_BLOCKED');
    reject(inspectionError);
  };
  request.onsuccess = () => {
    nativeDatabase = request.result;
    if (!nativeDatabase.objectStoreNames.contains(LOCAL_TENANT_BINDING_STORE)) {
      nativeDatabase.close();
      resolve(null);
      return;
    }

    const transaction = nativeDatabase.transaction([LOCAL_TENANT_BINDING_STORE], 'readonly');
    const bindingRequest = transaction.objectStore(LOCAL_TENANT_BINDING_STORE).get(LOCAL_TENANT_BINDING_KEY);
    let binding = null;
    bindingRequest.onsuccess = () => { binding = bindingRequest.result || null; };
    transaction.oncomplete = () => {
      nativeDatabase.close();
      resolve(binding);
    };
    transaction.onerror = () => {
      nativeDatabase.close();
      const inspectionError = new TenantRuntimeError('TENANT_DATABASE_INSPECTION_FAILED');
      inspectionError.cause = transaction.error || null;
      reject(inspectionError);
    };
    transaction.onabort = () => {
      nativeDatabase.close();
      const inspectionError = new TenantRuntimeError('TENANT_DATABASE_INSPECTION_ABORTED');
      inspectionError.cause = transaction.error || null;
      reject(inspectionError);
    };
  };
});

const normalizedBindingAliases = (binding) => [...new Set([
  binding?.tenantIdentity,
  ...(Array.isArray(binding?.tenantAliases) ? binding.tenantAliases : [])
].filter(Boolean))];

const isTrustedTenantBinding = (binding) => (
  binding?.key === LOCAL_TENANT_BINDING_KEY
  && Number(binding?.bindingVersion) === 1
  && normalizedBindingAliases(binding).length > 0
);

const discoverBoundTenantDatabases = async (identity, physicalNames) => {
  const candidateNames = [...physicalNames]
    .filter((name) => (
      typeof name === 'string'
      && name.startsWith(TENANT_DATABASE_PREFIX)
      && name.length > TENANT_DATABASE_PREFIX.length
    ))
    .sort();
  const inspected = await Promise.all(candidateNames.map(async (databaseName) => ({
    databaseName,
    binding: await readTenantBinding(databaseName)
  })));

  return inspected
    .filter(({ binding }) => (
      isTrustedTenantBinding(binding)
      && areLocalTenantAliasesCompatible(normalizedBindingAliases(binding), identity.aliases || [])
    ))
    .map(({ databaseName, binding }) => ({
      databaseName,
      opaqueId: databaseName.slice(TENANT_DATABASE_PREFIX.length),
      binding,
      bindingAliases: normalizedBindingAliases(binding)
    }));
};

const getDirectoryMatches = (aliases) => directory
  .table(DIRECTORY_STORE)
  .where('aliases')
  .anyOf(aliases)
  .toArray();

const getUniqueDestinations = (matches) => [...new Set(matches.map(({ opaqueId }) => opaqueId))];

const assertDirectoryMatchesAreCompatible = (matches, aliases) => {
  const destinations = getUniqueDestinations(matches);
  if (destinations.length > 1) throw new TenantRuntimeError('TENANT_DIRECTORY_AMBIGUOUS');
  const prior = matches[0] || null;
  if (prior && !areLocalTenantAliasesCompatible(prior.aliases || [], aliases)) {
    throw new TenantRuntimeError('TENANT_DIRECTORY_ALIAS_CONFLICT');
  }
  return prior;
};

const createOpaqueId = (aliases) => (
  `t_${(globalThis.crypto?.randomUUID?.() || aliases[0])
    .replace(/[^a-f0-9]/gi, '')
    .slice(0, 32)
    .padEnd(32, '0')}`
);

export const resolveTenantRuntimeDirectory = async (identity, { requirePhysicalDatabase = false } = {}) => {
  const aliases = await Promise.all((identity?.aliases || []).map(aliasFingerprint));
  if (!aliases.length) throw new TenantRuntimeError('TENANT_IDENTITY_MISSING');
  const initialMatches = await getDirectoryMatches(aliases);
  const prior = assertDirectoryMatchesAreCompatible(initialMatches, aliases);
  const physical = await listPhysicalDatabaseNames();
  const mappedDatabaseName = prior ? `${TENANT_DATABASE_PREFIX}${prior.opaqueId}` : null;
  const mappingIsMissing = !prior;
  const mappingIsCorrupt = Boolean(
    prior
    && requirePhysicalDatabase
    && physical.available
    && !physical.names.has(mappedDatabaseName)
  );

  if (mappingIsCorrupt) {
    // A stale directory row must not recreate a missing destination. The
    // directory contents are preserved by policy, so this cannot be silently
    // rewritten to a different primary key; recovery must resolve it
    // explicitly instead of opening a new empty database.
    const candidates = await discoverBoundTenantDatabases(identity, physical.names);
    if (candidates.length === 0) throw new TenantRuntimeError('TENANT_DIRECTORY_CORRUPT');
    if (candidates.length > 1) throw new TenantRuntimeError('TENANT_DIRECTORY_AMBIGUOUS');
    throw new TenantRuntimeError('TENANT_DIRECTORY_CORRUPT');
  }

  const candidates = mappingIsMissing
    ? await discoverBoundTenantDatabases(identity, physical.names)
    : [];
  if (candidates.length > 1) throw new TenantRuntimeError('TENANT_DIRECTORY_AMBIGUOUS');
  const adopted = candidates[0] || null;

  // The write is serialized with other tabs. The candidate scan is read-only
  // and happens before this transaction; rechecking aliases here prevents two
  // concurrent resolutions of a new tenant from allocating divergent IDs.
  return directory.transaction('rw', directory.table(DIRECTORY_STORE), async () => {
    const currentMatches = await getDirectoryMatches(aliases);
    const currentPrior = assertDirectoryMatchesAreCompatible(currentMatches, aliases);
    if (currentPrior) return currentPrior.opaqueId;

    const opaqueId = adopted?.opaqueId || createOpaqueId(aliases);
    const adoptedAliases = adopted
      ? await Promise.all(adopted.bindingAliases.map(aliasFingerprint))
      : [];
    await directory.table(DIRECTORY_STORE).put({
      opaqueId,
      // A conflict exits before this write. Aliases are opaque fingerprints
      // with their type retained solely for compatibility validation.
      aliases: [...new Set([...aliases, ...adoptedAliases])],
      updatedAt: new Date().toISOString()
    });
    return opaqueId;
  });
};

const current = () => {
  if (!active?.database?.isOpen()) throw new TenantRuntimeError('TENANT_RUNTIME_NOT_READY');
  return active;
};
const guardedTable = (table, capturedGeneration) => new Proxy(table, { get(target, prop) {
  const value = target[prop];
  if (typeof value !== 'function') return value;
  return (...args) => { if (current().generation !== capturedGeneration) throw new TenantRuntimeError('TENANT_RUNTIME_STALE_HANDLE'); return value.apply(target, args); };
} });

export const db = new Proxy({}, { get(_target, prop) {
  const runtime = current();
  if (prop === 'table') return (name) => guardedTable(runtime.database.table(name), runtime.generation);
  const value = runtime.database[prop];
  return typeof value === 'function' ? value.bind(runtime.database) : value;
} });

export const getActiveTenantDatabase = () => current().database;
export const getActiveTenantRuntime = () => active && ({ opaqueId: active.opaqueId, databaseName: active.database.name, generation: active.generation });

// Cache and event consumers need a non-throwing lifecycle probe.  It is
// deliberately separate from the db proxy: callers that reach the proxy
// without this authority must still fail closed with TENANT_RUNTIME_NOT_READY.
// A disabled controller is retained for isolated/unit consumers which do not
// bootstrap the production tenant guard; a real guarded runtime must be both
// GRANTED and physically open.
export const getTenantRuntimeReadiness = () => {
  const tenantState = localTenantAccessController.getState();
  if (!tenantState.enabled) return { ready: true, runtime: null };
  if (tenantState.status !== LOCAL_TENANT_STATUS.GRANTED || !active?.database?.isOpen()) {
    return { ready: false, runtime: null };
  }
  return {
    ready: true,
    runtime: {
      opaqueId: active.opaqueId,
      databaseName: active.database.name,
      generation: active.generation
    }
  };
};

// This is the authoritative boundary for the tenant's physical database
// opening. Catalog and sync callers can still report structural errors for
// logging, but only this boundary may replace runtime state with recovery.
const publishTenantDatabaseRecovery = (error, databaseName) => {
  const classification = classifyDatabaseError(error);
  if (!classification.structural) return false;

  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object'
    ? error.diagnostic
    : {};
  const isRetryable = typeof diagnostic.isRetryable === 'boolean'
    ? diagnostic.isRetryable
    : classification.retryable !== false;
  const requiresMigration = diagnostic.requiresMigration === true
    || classification.requiresMigration === true;

  setDatabaseRecoveryState({
    ...diagnostic,
    status: isRetryable === false
      ? DATABASE_RECOVERY_STATUS.FAILED
      : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
    errorCode: diagnostic.errorCode || classification.code,
    databaseName: diagnostic.databaseName || databaseName || null,
    isRetryable,
    requiresMigration,
    message: diagnostic.message || error?.message || null
  });
  return true;
};

export const openTenantRuntime = async (identity) => {
  if (!tenantDatabaseFactory) {
    throw new TenantRuntimeError('TENANT_RUNTIME_FACTORY_NOT_CONFIGURED');
  }
  const opaqueId = await resolveTenantRuntimeDirectory(identity, { requirePhysicalDatabase: true });
  if (active?.opaqueId === opaqueId && active.database.isOpen()) return active;
  // Callers must lock the controller before switching tenants. Keep this
  // defensive lock for direct router consumers as well, so B is never opened
  // while A remains granted.
  if (active?.database && active.opaqueId !== opaqueId) {
    localTenantAccessController.lock('tenant_runtime_switch');
    suspendTenantStorageWrites();
    active.database.close();
  }
  clearActiveTenantStorageNamespace();
  const database = tenantDatabaseFactory(`LanzoDB_t_${opaqueId}`);
  try {
    await preflightAndRepairIndexedDb({
      databaseName: database.name,
      onBlocked: (error) => publishTenantDatabaseRecovery(error, database.name),
      onProgress: (migration) => setDatabaseRecoveryState({
        status: DATABASE_RECOVERY_STATUS.MIGRATING,
        databaseName: database.name,
        isRetryable: true,
        requiresMigration: true,
        migration
      })
    });
    await database.open();
  } catch (error) {
    if (publishTenantDatabaseRecovery(error, database.name)) {
      reportStructuralDatabaseErrorOnce(error, 'preflight');
    }
    throw error;
  }
  active = { opaqueId, database, generation: ++generation };
  // A recovery state is cleared only after this tenant's complete
  // preparation succeeded. Do not put this in a finally: structural failures
  // must remain visible to DatabaseRecoveryGate.
  setDatabaseRecoveryState({
    status: DATABASE_RECOVERY_STATUS.READY,
    databaseName: database.name
  });
  setActiveTenantStorageNamespace(opaqueId);
  channel?.postMessage({ type: 'tenant_context_changed', opaqueId });
  try { window?.localStorage?.setItem('lanzo:tenant-runtime-context:v1', JSON.stringify({ opaqueId, at: Date.now() })); } catch { /* BroadcastChannel remains preferred */ }
  return active;
};

export const markTenantRuntimeReady = async () => {
  // Storage becomes readable first, but stays write-suspended until every
  // tenant-owned consumer has read its payload. This prevents a reset by one
  // Zustand consumer from overwriting another payload during hydration.
  markTenantStorageReady();
  try {
    await hydrateTenantStorageConsumers();
    resumeTenantStorageWrites();
  } catch (error) {
    // A partially hydrated tenant is never usable. Preserve its physical DB
    // and storage payload, lock access, then leave no active runtime handle.
    localTenantAccessController.lock('tenant_storage_hydration_failed');
    closeTenantRuntime();
    throw error;
  }
};
export const closeTenantRuntime = () => { suspendTenantStorageWrites(); if (active?.database) active.database.close(); active = null; generation += 1; clearActiveTenantStorageNamespace(); };
