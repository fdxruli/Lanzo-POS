import { actorRuntimeController } from './auth/actorRuntimeController';
import {
  captureActorScopedStorageHandle,
  registerActorScopedLogicalKey,
  subscribeActorScopedStorage
} from './auth/actorScopedStorage';
import { subscribeTenantStorage } from './tenant/tenantScopedStorage';
import { setDevConsoleRecording } from './devConsoleCapture';

const KEY = 'diagnostic-console-visible:v1';
let snapshot = Object.freeze({ authorized: false, enabled: false, persistenceError: false, revision: 0 });
const listeners = new Set();
let installed = false;
let refreshing = false;
let currentScope = null;
let sessionPreference = null;
let settingsAccess = () => false;

const publish = next => {
  if (Object.keys(next).every(key => snapshot[key] === next[key])) return;
  snapshot = Object.freeze(next);
  for (const listener of listeners) {
    try { listener(); } catch { /* diagnostics observers cannot interrupt POS */ }
  }
};

const captureAuthority = () => {
  // The verified Settings policy applies granular grants and legacy fallback.
  // Requiring the literal runtime key would reject legacy Staff with `settings`.
  const actor = actorRuntimeController.assertGranted();
  if (!settingsAccess(actor)) throw new Error('Diagnostic settings access denied');
  const storage = captureActorScopedStorageHandle();
  const binding = storage.assertCurrent();
  if (binding.actorKey !== actor.actorKey || binding.actorGeneration !== actor.generation
    || binding.tenantOpaqueId !== actor.tenant.opaqueId
    || binding.tenantGeneration !== actor.tenant.generation) throw new Error('Diagnostic context stale');
  return storage;
};

const refresh = () => {
  if (refreshing) return;
  refreshing = true;
  try {
    let storage = null;
    try { storage = captureAuthority(); } catch { /* locked or unauthorized */ }
    const scope = storage?.binding.contextToken || null;
    const changed = scope !== currentScope;
    if (changed) {
      currentScope = scope;
      sessionPreference = null;
      setDevConsoleRecording(Boolean(scope));
    }
    publish({
      authorized: Boolean(storage),
      enabled: Boolean(storage) && (sessionPreference ?? (storage.getItem(KEY) === 'true')),
      persistenceError: changed ? false : snapshot.persistenceError,
      revision: snapshot.revision + (changed ? 1 : 0)
    });
  } catch {
    currentScope = null;
    sessionPreference = null;
    setDevConsoleRecording(false);
    publish({ authorized: false, enabled: false, persistenceError: false, revision: snapshot.revision + 1 });
  } finally { refreshing = false; }
};

export const installDevConsolePreferences = ({ canAccessSettings, subscribeSettings } = {}) => {
  if (installed) return;
  installed = true;
  settingsAccess = canAccessSettings || (() => false);
  registerActorScopedLogicalKey(KEY);
  setDevConsoleRecording(false);
  actorRuntimeController.subscribe(refresh);
  subscribeActorScopedStorage(refresh);
  subscribeTenantStorage(refresh);
  subscribeSettings?.(refresh);
  window.addEventListener('storage', () => { sessionPreference = null; refresh(); });
  refresh();
};

export const getDevConsolePreference = () => snapshot;
export const subscribeDevConsolePreference = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setDevConsoleVisible = value => {
  try {
    const storage = captureAuthority();
    // Writes validate both authority and the existing cross-tab context fence.
    storage.setItem(KEY, value === true ? 'true' : 'false');
    sessionPreference = value === true;
    publish({ ...snapshot, enabled: sessionPreference, persistenceError: false });
  } catch {
    // Turning OFF always closes the panel, even if local storage is unavailable.
    if (value === false) sessionPreference = false;
    refresh();
    publish({ ...snapshot, enabled: value === false ? false : snapshot.enabled, persistenceError: true });
  }
};

export const isDevConsoleVisibleNow = () => { refresh(); return snapshot.enabled; };
