import Dexie from 'dexie';
import { areLocalTenantAliasesCompatible, localTenantAccessController } from '../tenant/localTenantPolicy';
import { setActiveTenantStorageNamespace, clearActiveTenantStorageNamespace, markTenantStorageReady, hydrateTenantStorageConsumers, resumeTenantStorageWrites, suspendTenantStorageWrites } from '../tenant/tenantScopedStorage';

const DIRECTORY_DB = 'LanzoTenantDirectory';
const DIRECTORY_STORE = 'tenants';
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

export const resolveTenantRuntimeDirectory = async (identity) => {
  const aliases = await Promise.all((identity?.aliases || []).map(aliasFingerprint));
  if (!aliases.length) throw new TenantRuntimeError('TENANT_IDENTITY_MISSING');
  const matches = await directory.table(DIRECTORY_STORE).where('aliases').anyOf(aliases).toArray();
  const destinations = [...new Set(matches.map(({ opaqueId }) => opaqueId))];
  if (destinations.length > 1) throw new TenantRuntimeError('TENANT_DIRECTORY_AMBIGUOUS');
  const prior = matches[0] || null;
  if (prior && !areLocalTenantAliasesCompatible(prior.aliases || [], aliases)) {
    throw new TenantRuntimeError('TENANT_DIRECTORY_ALIAS_CONFLICT');
  }
  const opaqueId = prior?.opaqueId || `t_${(globalThis.crypto?.randomUUID?.() || aliases[0]).replace(/[^a-f0-9]/gi, '').slice(0, 32).padEnd(32, '0')}`;
  // A conflict exits before this write. Aliases are opaque fingerprints with
  // their type retained solely for compatibility validation.
  await directory.table(DIRECTORY_STORE).put({ opaqueId, aliases: [...new Set([...(prior?.aliases || []), ...aliases])], updatedAt: new Date().toISOString() });
  return opaqueId;
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

export const openTenantRuntime = async (identity) => {
  if (!tenantDatabaseFactory) {
    throw new TenantRuntimeError('TENANT_RUNTIME_FACTORY_NOT_CONFIGURED');
  }
  const opaqueId = await resolveTenantRuntimeDirectory(identity);
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
  await database.open();
  active = { opaqueId, database, generation: ++generation };
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
