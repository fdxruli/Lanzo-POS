// Temporary, opt-in incident capture. Only fixed codes and local generations
// may cross this boundary. It stays available when commercial UI unmounts.
const fields = {
  tenant_open: 'start success failed',
  tenant_close: 'broadcast storage tenant_transition tenant_runtime_switch license_session_cleared browser_storage_unavailable tenant_storage_hydration_failed other',
  dexie: 'versionchange close blocked',
  indexeddb: 'close blocked',
  proxy_error: 'missing closed reopening',
  runtime_state: 'open closed missing reopening',
  actor: 'locked authenticating handoff_check granted',
  tenant: 'disabled locked granted mismatch legacy_unresolved',
  tenant_reason: 'application_bootstrap tenant_transition tenant_runtime_recovery tenant_context_changed tenant_runtime_switch browser_storage_unavailable tenant_storage_hydration_failed license_session_cleared other',
  prepare: 'start deferred success failed rejected',
  reopen: 'start joined success rejected authority native_activity incompatible failed',
  catalog_skip: 'pos inventory',
  resume: 'visibility resume pageshow focus online',
  health: 'runtime_unavailable',
  session: 'bootstrap verifying retry inconclusive',
  incident: 'global_error unhandled_rejection other'
};
const consumers = ['db_proxy', 'table_handle', 'database_getter', 'hydration'];
const limit = 64;
const lifetime = 10 * 60 * 1000;
let capture = null;
let timeout;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

export const subscribeTenantRuntimeTrace = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const stopTenantRuntimeTrace = () => {
  clearTimeout(timeout);
  capture = null;
  notify();
};

export const traceTenantRuntime = (event, detail, generation, consumer) => {
  if (!capture) return;
  if (!Object.hasOwn(fields, event)) return;
  if (!fields[event].split(' ').includes(detail)) {
    if (event !== 'tenant_reason') return;
    detail = 'other';
  }
  const entry = { event, detail, ms: Date.now() - capture.started };
  if (Number.isSafeInteger(generation) && generation >= 0) entry.generation = generation;
  if (event === 'runtime_state') {
    const previousState = capture.runtimeState;
    if (previousState?.detail === detail && previousState.generation === generation) return;
    capture.runtimeState = entry;
  }
  if (event === 'proxy_error') {
    entry.code = 'TENANT_RUNTIME_NOT_READY';
    if (consumers.includes(consumer)) entry.consumer = consumer;
  }
  const previous = capture.entries.at(-1);
  if (previous?.event === event && previous.detail === detail && previous.generation === entry.generation
    && previous.consumer === entry.consumer && entry.ms - previous.ms < 1000) return;
  if (capture.entries.length === limit) capture.entries.shift();
  capture.entries.push(entry);
};

export const isTenantRuntimeTraceActive = () => capture !== null;

export const startTenantRuntimeTrace = () => {
  if (capture) return;
  capture = { started: Date.now(), entries: [] };
  timeout = setTimeout(stopTenantRuntimeTrace, lifetime);
  notify();
};

export const readTenantRuntimeTrace = () => capture?.entries.map((entry) => ({ ...entry })) || [];
