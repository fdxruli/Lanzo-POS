import {
  getActorStorageItem,
  invalidateActorScopedStorage,
  isActorScopedLogicalKey,
  removeActorStorageItem,
  setActorStorageItem
} from '../auth/actorScopedStorage';

const PREFIX = 'lanzo:t:';
const ACTOR_ACTIVE_ORDERS_KEY = 'lanzo-active-orders-storage';
let activeNamespace = null;
let ready = false;
let writesSuspended = false;
const listeners = new Set();
const hydrators = new Set();

const physicalKey = (logicalKey) => activeNamespace ? `${PREFIX}${activeNamespace}:${logicalKey}` : null;

export class TenantScopedStorageInspectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ActiveOrders mixes two contracts in memory: unsaved editing state and
// tenant-shared SALES rows loaded from Dexie. Only the former belongs in the
// actor namespace. Never serialize a committed/open business record as if it
// were private actor state merely because it is currently open in the POS UI.
const sanitizeActorScopedValue = (logicalKey, value) => {
  if (logicalKey !== ACTOR_ACTIVE_ORDERS_KEY) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    const state = parsed?.state;
    if (!state || !Array.isArray(state.activeOrders)) return null;

    const actorOrders = state.activeOrders.filter((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return false;
      const order = entry[1];
      return order?.isSaved !== true;
    });
    const actorOrderIds = new Set(actorOrders.map(([orderId]) => orderId));
    const currentOrderId = actorOrderIds.has(state.currentOrderId)
      ? state.currentOrderId
      : (actorOrders[0]?.[0] || null);

    return JSON.stringify({
      ...parsed,
      state: {
        ...state,
        activeOrders: actorOrders,
        currentOrderId
      }
    });
  } catch {
    // A malformed actor-sensitive payload must never fall back to the tenant
    // namespace or be persisted unsanitized.
    return null;
  }
};

// This is intentionally independent from READY. The local tenant guard needs
// to inspect the physical namespace before it binds a freshly opened runtime,
// while hydration and all writes must remain suspended.
export const inspectActiveTenantStorageSnapshot = () => {
  if (!activeNamespace) {
    throw new TenantScopedStorageInspectionError('TENANT_STORAGE_NAMESPACE_MISSING');
  }

  let browserStorage;
  try {
    browserStorage = globalThis.window?.localStorage || null;
  } catch {
    throw new TenantScopedStorageInspectionError('TENANT_STORAGE_ACCESS_DENIED');
  }
  if (!browserStorage) return { counts: {}, occupiedStores: [] };

  const prefix = `${PREFIX}${activeNamespace}:`;
  const counts = {};
  const occupiedStores = [];
  try {
    for (let index = 0; index < browserStorage.length; index += 1) {
      const key = browserStorage.key(index);
      // Do not read legacy keys or another tenant's namespace. Enumerating
      // names is the minimum Storage API operation needed to find this prefix.
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const rawValue = browserStorage.getItem(key);
      if (typeof rawValue !== 'string' || rawValue.length === 0) continue;
      const location = `localStorage:${key}`;
      counts[location] = 1;
      occupiedStores.push(location);
    }
  } catch {
    throw new TenantScopedStorageInspectionError('TENANT_STORAGE_INSPECTION_FAILED');
  }
  return { counts, occupiedStores: occupiedStores.sort() };
};

export const setActiveTenantStorageNamespace = (opaqueId) => {
  if (!/^t_[a-f0-9]{32}$/.test(String(opaqueId || ''))) throw new Error('TENANT_STORAGE_NAMESPACE_INVALID');
  invalidateActorScopedStorage('tenant_namespace_changed');
  activeNamespace = opaqueId;
  ready = false;
  writesSuspended = true;
  for (const listener of listeners) listener({ type: 'namespace', opaqueId });
};

export const markTenantStorageReady = () => {
  if (!activeNamespace) throw new Error('TENANT_STORAGE_NAMESPACE_MISSING');
  ready = true;
  for (const listener of listeners) listener({ type: 'ready', opaqueId: activeNamespace });
};
export const registerTenantStorageHydrator = (hydrate) => { hydrators.add(hydrate); return () => hydrators.delete(hydrate); };
export const hydrateTenantStorageConsumers = async () => Promise.all([...hydrators].map((hydrate) => hydrate()));

export const clearActiveTenantStorageNamespace = () => {
  const opaqueId = activeNamespace;
  invalidateActorScopedStorage('tenant_namespace_cleared');
  activeNamespace = null;
  ready = false;
  writesSuspended = true;
  for (const listener of listeners) listener({ type: 'cleared', opaqueId });
};

export const getTenantStorageState = () => ({ opaqueId: activeNamespace, ready, writesSuspended });
export const subscribeTenantStorage = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

const storage = () => {
  try {
    return globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
};
export const getTenantStorageItem = (logicalKey) => {
  if (!ready) return null;
  if (isActorScopedLogicalKey(logicalKey)) return getActorStorageItem(logicalKey);
  const key = physicalKey(logicalKey);
  if (!key || !storage()) return null;
  try { return storage().getItem(key); } catch { return null; }
};
export const setTenantStorageItem = (logicalKey, value) => {
  if (!ready) return;
  if (isActorScopedLogicalKey(logicalKey)) {
    const sanitizedValue = sanitizeActorScopedValue(logicalKey, value);
    if (sanitizedValue === null) return;
    setActorStorageItem(logicalKey, sanitizedValue);
    return;
  }
  const key = !writesSuspended && physicalKey(logicalKey);
  if (!key || !storage()) return;
  try { storage().setItem(key, value); } catch { /* storage quota/privacy must fail closed */ }
};
export const removeTenantStorageItem = (logicalKey) => {
  if (!ready) return;
  if (isActorScopedLogicalKey(logicalKey)) {
    removeActorStorageItem(logicalKey);
    return;
  }
  const key = !writesSuspended && physicalKey(logicalKey);
  if (!key || !storage()) return;
  try { storage().removeItem(key); } catch { /* never cascade a failed removal */ }
};

// Used during a tenant transition. Zustand reset actions are otherwise
// persisted immediately by its middleware and can overwrite a valid payload
// before explicit rehydration reads it.
export const suspendTenantStorageWrites = () => { writesSuspended = true; };
export const resumeTenantStorageWrites = () => {
  if (!activeNamespace || !ready) throw new Error('TENANT_STORAGE_NOT_READY');
  writesSuspended = false;
};

// Zustand receives logical names only. Actor-owned logical keys are routed to
// ActorScopedStorage; legacy tenant-scoped values remain physically preserved
// but are never auto-claimed by the current actor.
export const tenantScopedZustandStorage = {
  getItem: getTenantStorageItem,
  setItem: setTenantStorageItem,
  removeItem: removeTenantStorageItem
};
