import Dexie from 'dexie';
import { createOperationalLanzoDatabase } from './dexie';
import { setActiveTenantStorageNamespace, clearActiveTenantStorageNamespace, markTenantStorageReady, hydrateTenantStorageConsumers } from '../tenant/tenantScopedStorage';

const DIRECTORY_DB = 'LanzoTenantDirectory';
const DIRECTORY_STORE = 'tenants';
const directory = new Dexie(DIRECTORY_DB);
directory.version(1).stores({ [DIRECTORY_STORE]: 'opaqueId, *aliases' });

export class TenantRuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
export const isTenantRuntimeError = (error) => error instanceof TenantRuntimeError || String(error?.code || '').startsWith('TENANT_RUNTIME_');
let active = null;
let generation = 0;
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lanzo-tenant-runtime-v1');
channel?.addEventListener('message', (event) => {
  if (event?.data?.type !== 'tenant_context_changed') return;
  // A different tab changed tenant context. Closing is conservative: every
  // compatibility-proxy operation now fails instead of writing under B.
  if (active?.opaqueId && event.data.opaqueId !== active.opaqueId) closeTenantRuntime();
});

const hex = (bytes) => Array.from(bytes).map((x) => x.toString(16).padStart(2, '0')).join('');
const digest = async (value) => hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

const resolveDirectory = async (identity) => {
  const aliases = await Promise.all((identity?.aliases || []).map(digest));
  if (!aliases.length) throw new TenantRuntimeError('TENANT_IDENTITY_MISSING');
  const prior = (await directory.table(DIRECTORY_STORE).where('aliases').anyOf(aliases).toArray())[0];
  const opaqueId = prior?.opaqueId || `t_${aliases[0].slice(0, 32)}`;
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
  const opaqueId = await resolveDirectory(identity);
  if (active?.opaqueId === opaqueId && active.database.isOpen()) return active;
  if (active?.database) active.database.close();
  clearActiveTenantStorageNamespace();
  const database = createOperationalLanzoDatabase(`LanzoDB_t_${opaqueId}`);
  await database.open();
  active = { opaqueId, database, generation: ++generation };
  setActiveTenantStorageNamespace(opaqueId);
  channel?.postMessage({ type: 'tenant_context_changed', opaqueId });
  return active;
};

export const markTenantRuntimeReady = async () => { markTenantStorageReady(); await hydrateTenantStorageConsumers(); };
export const closeTenantRuntime = () => { if (active?.database) active.database.close(); active = null; generation += 1; clearActiveTenantStorageNamespace(); };
