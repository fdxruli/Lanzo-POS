import {
  getActorStorageItem,
  inspectActorScopedActiveOrderDraftCount,
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

const EXCLUDED_BACKUP_BROWSER_STATE_KEYS = Object.freeze([
  ['lanzo-cart-storage', 'unsavedCart'],
  ['lanzo-inventory-storage', 'unfinishedInventoryAdjustments'],
  ['lanzo:restaurant-order-close-pending:v1', 'pendingOrderClosures'],
  ['ignored_expirations_ttl', 'otherPendingBusinessState']
]);
const LEGACY_UNSCOPED_BACKUP_STATE_KEYS = Object.freeze([
  'lanzo-active-orders-storage',
  ...EXCLUDED_BACKUP_BROWSER_STATE_KEYS.map(([key]) => key)
]);
const EXPIRATION_IGNORE_TTL_MS = 24 * 60 * 60 * 1000;

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const unwrapPersistedState = (value) => (
  isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'state') ? value.state : value
);

const hasMeaningfulState = (value) => {
  if (value === null || value === undefined || value === '' || value === false || value === 0) return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulState);
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => key !== 'version' && key !== '_persist')
      .some(([, entry]) => hasMeaningfulState(entry));
  }
  return true;
};

const countMeaningfulState = (value) => {
  if (Array.isArray(value)) return value.filter(hasMeaningfulState).length;
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => key !== 'version' && key !== '_persist' && hasMeaningfulState(value[key]))
      .reduce((total, [, entry]) => total + (Array.isArray(entry) ? entry.filter(hasMeaningfulState).length : 1), 0);
  }
  return hasMeaningfulState(value) ? 1 : 0;
};

const parseStoredValue = (logicalKey, rawValue) => {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    throw new TenantScopedStorageInspectionError('TENANT_STORAGE_BACKUP_STATE_MALFORMED');
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    throw new TenantScopedStorageInspectionError(`TENANT_STORAGE_BACKUP_STATE_MALFORMED:${logicalKey}`);
  }
};

const countTenantBrowserState = (logicalKey, rawValue) => {
  if (rawValue === null) return 0;
  const parsed = parseStoredValue(logicalKey, rawValue);

  if (logicalKey === 'lanzo:restaurant-order-close-pending:v1') {
    if (!Array.isArray(parsed)) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_BACKUP_STATE_MALFORMED:pendingOrderClosures');
    }
    for (const row of parsed) {
      const hasStableKey = isRecord(row) && [row.idempotencyKey, row.localOrderId]
        .some((value) => typeof value === 'string' && value.trim().length > 0);
      if (!hasStableKey) {
        throw new TenantScopedStorageInspectionError('TENANT_STORAGE_BACKUP_STATE_MALFORMED:pendingOrderClosures');
      }
    }
    return parsed.length;
  }

  const state = unwrapPersistedState(parsed);
  if (!isRecord(state) && !Array.isArray(state)) {
    throw new TenantScopedStorageInspectionError(`TENANT_STORAGE_BACKUP_STATE_MALFORMED:${logicalKey}`);
  }

  if (logicalKey === 'ignored_expirations_ttl') {
    if (!isRecord(state)) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_BACKUP_STATE_MALFORMED:ignored_expirations_ttl');
    }
    const now = Date.now();
    let activeCount = 0;
    for (const [id, timestamp] of Object.entries(state)) {
      if (!id || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        throw new TenantScopedStorageInspectionError('TENANT_STORAGE_BACKUP_STATE_MALFORMED:ignored_expirations_ttl');
      }
      if (now - timestamp < EXPIRATION_IGNORE_TTL_MS) activeCount += 1;
    }
    return activeCount;
  }

  return countMeaningfulState(state);
};

const hasUnscopedLegacyBusinessState = (browserStorage) => {
  for (const logicalKey of LEGACY_UNSCOPED_BACKUP_STATE_KEYS) {
    const rawValue = browserStorage.getItem(logicalKey);
    if (rawValue === null) continue;
    const parsed = parseStoredValue(logicalKey, rawValue);
    const state = unwrapPersistedState(parsed);
    if (!isRecord(state) && !Array.isArray(state)) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_UNSCOPED_BACKUP_STATE_MALFORMED');
    }
    if (logicalKey === 'lanzo-active-orders-storage') {
      if (!isRecord(state) || !Array.isArray(state.activeOrders)) {
        throw new TenantScopedStorageInspectionError('TENANT_STORAGE_UNSCOPED_BACKUP_STATE_MALFORMED');
      }
      if (
        state.activeOrders.length > 0
        || (state.currentOrderId !== null && state.currentOrderId !== undefined)
      ) return true;
      continue;
    }
    if (countTenantBrowserState(logicalKey, rawValue) > 0) return true;
  }
  return false;
};

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

export const inspectActiveTenantBackupBrowserState = (expectedDatabaseName = null) => {
  const emptyCounts = Object.fromEntries([
    ['activeOrders', 0],
    ...EXCLUDED_BACKUP_BROWSER_STATE_KEYS.map(([, label]) => [label, 0])
  ]);

  try {
    const namespace = getTenantStorageState();
    if (
      !/^t_[a-f0-9]{32}$/.test(String(namespace.opaqueId || ''))
      || !namespace.ready
      || namespace.writesSuspended
    ) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_NAMESPACE_UNAVAILABLE');
    }

    const browserStorage = storage();
    if (!browserStorage) throw new TenantScopedStorageInspectionError('TENANT_STORAGE_ACCESS_DENIED');
    const counts = { ...emptyCounts };
    counts.activeOrders = inspectActorScopedActiveOrderDraftCount(
      namespace.opaqueId,
      expectedDatabaseName
    );

    if (hasUnscopedLegacyBusinessState(browserStorage)) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_UNSCOPED_BACKUP_STATE_UNRESOLVED');
    }

    for (const [logicalKey, label] of EXCLUDED_BACKUP_BROWSER_STATE_KEYS) {
      const key = physicalKey(logicalKey);
      if (!key) throw new TenantScopedStorageInspectionError('TENANT_STORAGE_NAMESPACE_MISSING');
      counts[label] = countTenantBrowserState(logicalKey, browserStorage.getItem(key));
    }

    const finalNamespace = getTenantStorageState();
    if (
      finalNamespace.opaqueId !== namespace.opaqueId
      || !finalNamespace.ready
      || finalNamespace.writesSuspended
    ) {
      throw new TenantScopedStorageInspectionError('TENANT_STORAGE_NAMESPACE_CHANGED');
    }
    return { inspectionComplete: true, counts };
  } catch {
    return { inspectionComplete: false, counts: emptyCounts };
  }
};

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
  // Tenant suspension is the outer write fence for every browser-storage
  // consumer, including actor-routed logical keys. Hydration may still read a
  // prepared actor namespace, but a logout/tenant reset must never serialize
  // its empty in-memory reset over the actor's preserved payload.
  if (!ready || writesSuspended) return;
  if (isActorScopedLogicalKey(logicalKey)) {
    const sanitizedValue = sanitizeActorScopedValue(logicalKey, value);
    if (sanitizedValue === null) return;
    setActorStorageItem(logicalKey, sanitizedValue);
    return;
  }
  const key = physicalKey(logicalKey);
  if (!key || !storage()) return;
  try { storage().setItem(key, value); } catch { /* storage quota/privacy must fail closed */ }
};
export const removeTenantStorageItem = (logicalKey) => {
  if (!ready || writesSuspended) return;
  if (isActorScopedLogicalKey(logicalKey)) {
    removeActorStorageItem(logicalKey);
    return;
  }
  const key = physicalKey(logicalKey);
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
