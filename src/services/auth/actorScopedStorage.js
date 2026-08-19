const TENANT_PREFIX = 'lanzo:t:';
const ACTOR_CONTEXT_LOGICAL_KEY = 'actor-runtime-context:v1';
const ACTOR_CONTEXT_CHANNEL = 'lanzo-actor-storage-v1';
const ACTOR_STORAGE_VERSION = 1;

export const ACTOR_SCOPED_STORAGE_ERROR_CODES = Object.freeze({
  CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
  CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
  BINDING_INVALID: 'ACTOR_STORAGE_BINDING_INVALID',
  ACCESS_DENIED: 'ACTOR_STORAGE_ACCESS_DENIED'
});

export const ACTOR_SCOPED_LOGICAL_KEYS = Object.freeze([
  'lanzo-active-orders-storage'
]);

const actorScopedLogicalKeys = new Set(ACTOR_SCOPED_LOGICAL_KEYS);
const listeners = new Set();
let pendingBinding = null;
let activeBinding = null;
let writesSuspended = true;

export class ActorScopedStorageError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ActorScopedStorageError';
    this.code = code;
    this.details = details;
  }
}

const storage = () => {
  try {
    return globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
};

const assertTenantOpaqueId = (value) => {
  const normalized = String(value || '');
  if (!/^t_[a-f0-9]{32}$/.test(normalized)) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.BINDING_INVALID, {
      reason: 'tenant_opaque_id_invalid'
    });
  }
  return normalized;
};

const assertActorKey = (value) => {
  const normalized = String(value || '').trim();
  if (!/^(admin|staff):.+/.test(normalized)) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.BINDING_INVALID, {
      reason: 'actor_key_invalid'
    });
  }
  return normalized;
};

const assertGeneration = (value, reason) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.BINDING_INVALID, { reason });
  }
  return value;
};

const bytesToHex = (bytes) => Array.from(bytes)
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

const sha256 = async (value) => {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED, {
      reason: 'crypto_unavailable'
    });
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
};

export const deriveActorStorageOpaqueId = async (tenantOpaqueId, actorKey) => (
  sha256(`${assertTenantOpaqueId(tenantOpaqueId)}\u0000${assertActorKey(actorKey)}`)
);

const actorPhysicalKey = (binding, logicalKey) => (
  `${TENANT_PREFIX}${binding.tenantOpaqueId}:a:${binding.actorOpaqueId}:${logicalKey}`
);

const legacyTenantPhysicalKey = (tenantOpaqueId, logicalKey) => (
  `${TENANT_PREFIX}${tenantOpaqueId}:${logicalKey}`
);

const actorContextPhysicalKey = (tenantOpaqueId) => (
  `${TENANT_PREFIX}${tenantOpaqueId}:${ACTOR_CONTEXT_LOGICAL_KEY}`
);

const cloneBinding = (binding) => binding && Object.freeze({
  tenantOpaqueId: binding.tenantOpaqueId,
  tenantDatabaseName: binding.tenantDatabaseName,
  tenantGeneration: binding.tenantGeneration,
  actorKey: binding.actorKey,
  actorGeneration: binding.actorGeneration,
  actorOpaqueId: binding.actorOpaqueId,
  contextToken: binding.contextToken || null,
  legacyUnresolvedKeys: Object.freeze([...(binding.legacyUnresolvedKeys || [])])
});

const notify = (event) => {
  for (const listener of listeners) {
    try {
      listener(Object.freeze({ ...event }));
    } catch {
      // Observers never participate in the actor storage authority boundary.
    }
  }
};

const randomToken = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED, {
    reason: 'secure_random_unavailable'
  });
};

const parseContextRecord = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== ACTOR_STORAGE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

const readContextRecord = (tenantOpaqueId) => {
  const browserStorage = storage();
  if (!browserStorage) return null;
  try {
    return parseContextRecord(browserStorage.getItem(actorContextPhysicalKey(tenantOpaqueId)));
  } catch {
    return null;
  }
};

const writeContextRecord = (record) => {
  const browserStorage = storage();
  if (!browserStorage) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED, {
      reason: 'local_storage_unavailable'
    });
  }
  try {
    browserStorage.setItem(
      actorContextPhysicalKey(record.tenantOpaqueId),
      JSON.stringify(record)
    );
  } catch (error) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED, {
      reason: 'context_write_failed',
      cause: error?.name || null
    });
  }
};

let channel = null;
try {
  channel = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(ACTOR_CONTEXT_CHANNEL);
} catch {
  channel = null;
}

const publishContextRecord = (record) => {
  writeContextRecord(record);
  try {
    channel?.postMessage(record);
  } catch {
    // localStorage remains the durable same-device coordination record.
  }
};

const handleForeignContext = (record) => {
  if (
    !activeBinding
    || !record
    || record.tenantOpaqueId !== activeBinding.tenantOpaqueId
    || record.contextToken === activeBinding.contextToken
  ) {
    return;
  }

  writesSuspended = true;
  pendingBinding = null;
  notify({
    type: 'foreign_context',
    tenantOpaqueId: activeBinding.tenantOpaqueId,
    actorKey: activeBinding.actorKey,
    actorGeneration: activeBinding.actorGeneration
  });
};

channel?.addEventListener?.('message', (event) => handleForeignContext(event?.data || null));
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (!activeBinding || event.key !== actorContextPhysicalKey(activeBinding.tenantOpaqueId)) return;
    handleForeignContext(parseContextRecord(event.newValue));
  });
}

const inspectLegacyKeys = (tenantOpaqueId) => {
  const browserStorage = storage();
  if (!browserStorage) return [];
  const unresolved = [];
  for (const logicalKey of actorScopedLogicalKeys) {
    try {
      const raw = browserStorage.getItem(legacyTenantPhysicalKey(tenantOpaqueId, logicalKey));
      if (typeof raw === 'string' && raw.length > 0) unresolved.push(logicalKey);
    } catch {
      throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED, {
        reason: 'legacy_inspection_failed'
      });
    }
  }
  return unresolved.sort();
};

export const isActorScopedLogicalKey = (logicalKey) => actorScopedLogicalKeys.has(logicalKey);

export const registerActorScopedLogicalKey = (logicalKey) => {
  const normalized = String(logicalKey || '').trim();
  if (!normalized) throw new TypeError('logicalKey is required');
  actorScopedLogicalKeys.add(normalized);
  return () => actorScopedLogicalKeys.delete(normalized);
};

export const prepareActorScopedStorage = async ({
  tenant,
  actorKey,
  actorGeneration
} = {}) => {
  const tenantOpaqueId = assertTenantOpaqueId(tenant?.opaqueId);
  const tenantDatabaseName = String(tenant?.databaseName || '').trim();
  if (!tenantDatabaseName.startsWith('LanzoDB_t_')) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.BINDING_INVALID, {
      reason: 'tenant_database_name_invalid'
    });
  }
  const tenantGeneration = assertGeneration(tenant?.generation, 'tenant_generation_invalid');
  const normalizedActorKey = assertActorKey(actorKey);
  const normalizedActorGeneration = assertGeneration(actorGeneration, 'actor_generation_invalid');
  const actorOpaqueId = await deriveActorStorageOpaqueId(tenantOpaqueId, normalizedActorKey);

  writesSuspended = true;
  activeBinding = null;
  pendingBinding = {
    tenantOpaqueId,
    tenantDatabaseName,
    tenantGeneration,
    actorKey: normalizedActorKey,
    actorGeneration: normalizedActorGeneration,
    actorOpaqueId,
    contextToken: null,
    legacyUnresolvedKeys: inspectLegacyKeys(tenantOpaqueId)
  };

  const snapshot = cloneBinding(pendingBinding);
  notify({ type: 'prepared', binding: snapshot });
  return snapshot;
};

const assertBindingMatchesGrant = (binding, granted) => {
  if (
    !binding
    || granted?.actorKey !== binding.actorKey
    || granted?.generation !== binding.actorGeneration
    || granted?.tenant?.opaqueId !== binding.tenantOpaqueId
    || granted?.tenant?.databaseName !== binding.tenantDatabaseName
    || granted?.tenant?.generation !== binding.tenantGeneration
  ) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_STALE, {
      reason: 'prepared_binding_does_not_match_grant'
    });
  }
};

export const activateActorScopedStorage = (granted) => {
  assertBindingMatchesGrant(pendingBinding, granted);
  const contextToken = randomToken();
  activeBinding = { ...pendingBinding, contextToken };
  pendingBinding = null;
  writesSuspended = true;

  const record = {
    version: ACTOR_STORAGE_VERSION,
    tenantOpaqueId: activeBinding.tenantOpaqueId,
    actorOpaqueId: activeBinding.actorOpaqueId,
    actorGeneration: activeBinding.actorGeneration,
    contextToken,
    status: 'granted',
    updatedAt: new Date().toISOString()
  };
  publishContextRecord(record);
  const snapshot = cloneBinding(activeBinding);
  notify({ type: 'activated', binding: snapshot });
  return snapshot;
};

const assertActiveContextCurrent = () => {
  if (!activeBinding) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_LOCKED);
  }
  const current = readContextRecord(activeBinding.tenantOpaqueId);
  if (
    !current
    || current.status !== 'granted'
    || current.contextToken !== activeBinding.contextToken
    || current.actorOpaqueId !== activeBinding.actorOpaqueId
    || current.actorGeneration !== activeBinding.actorGeneration
  ) {
    writesSuspended = true;
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_STALE, {
      reason: 'actor_storage_context_changed'
    });
  }
  return activeBinding;
};

export const getActorScopedStorageState = () => Object.freeze({
  pending: cloneBinding(pendingBinding),
  active: cloneBinding(activeBinding),
  writesSuspended
});

export const getActorStorageItem = (logicalKey) => {
  if (!isActorScopedLogicalKey(logicalKey)) return null;
  const binding = pendingBinding || activeBinding;
  const browserStorage = storage();
  if (!binding || !browserStorage) return null;
  try {
    return browserStorage.getItem(actorPhysicalKey(binding, logicalKey));
  } catch {
    return null;
  }
};

export const setActorStorageItem = (logicalKey, value) => {
  if (!isActorScopedLogicalKey(logicalKey) || !activeBinding || writesSuspended) return;
  const binding = assertActiveContextCurrent();
  const browserStorage = storage();
  if (!browserStorage) return;
  try {
    browserStorage.setItem(actorPhysicalKey(binding, logicalKey), value);
  } catch {
    // Quota/privacy errors do not fall back to a tenant or legacy namespace.
  }
};

export const removeActorStorageItem = (logicalKey) => {
  if (!isActorScopedLogicalKey(logicalKey) || !activeBinding || writesSuspended) return;
  const binding = assertActiveContextCurrent();
  const browserStorage = storage();
  if (!browserStorage) return;
  try {
    browserStorage.removeItem(actorPhysicalKey(binding, logicalKey));
  } catch {
    // Never fall back to deleting another actor or legacy namespace.
  }
};

export const suspendActorScopedStorageWrites = () => {
  writesSuspended = true;
};

export const resumeActorScopedStorageWrites = () => {
  assertActiveContextCurrent();
  writesSuspended = false;
};

export const invalidateActorScopedStorage = (reason = 'actor_locked') => {
  const previous = activeBinding || pendingBinding;
  writesSuspended = true;
  pendingBinding = null;
  activeBinding = null;

  if (previous) {
    try {
      publishContextRecord({
        version: ACTOR_STORAGE_VERSION,
        tenantOpaqueId: previous.tenantOpaqueId,
        actorOpaqueId: null,
        actorGeneration: previous.actorGeneration + 1,
        contextToken: randomToken(),
        status: 'locked',
        reason,
        updatedAt: new Date().toISOString()
      });
    } catch {
      // Runtime authority is already removed; never restore it due to metadata I/O.
    }
  }
  notify({ type: 'invalidated', reason, tenantOpaqueId: previous?.tenantOpaqueId || null });
};

export const captureActorScopedStorageHandle = () => {
  const captured = activeBinding && cloneBinding(activeBinding);
  if (!captured) {
    throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_LOCKED);
  }

  const assertCurrent = () => {
    const current = assertActiveContextCurrent();
    if (
      current.contextToken !== captured.contextToken
      || current.actorKey !== captured.actorKey
      || current.actorGeneration !== captured.actorGeneration
      || current.tenantOpaqueId !== captured.tenantOpaqueId
      || current.tenantGeneration !== captured.tenantGeneration
    ) {
      throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_STALE);
    }
    return cloneBinding(current);
  };

  return Object.freeze({
    binding: captured,
    assertCurrent,
    getItem(logicalKey) {
      assertCurrent();
      if (!isActorScopedLogicalKey(logicalKey)) return null;
      const browserStorage = storage();
      return browserStorage?.getItem(actorPhysicalKey(captured, logicalKey)) || null;
    },
    setItem(logicalKey, value) {
      assertCurrent();
      if (writesSuspended) {
        throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_LOCKED);
      }
      const browserStorage = storage();
      if (!browserStorage) {
        throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.ACCESS_DENIED);
      }
      browserStorage.setItem(actorPhysicalKey(captured, logicalKey), value);
    },
    removeItem(logicalKey) {
      assertCurrent();
      if (writesSuspended) {
        throw new ActorScopedStorageError(ACTOR_SCOPED_STORAGE_ERROR_CODES.CONTEXT_LOCKED);
      }
      storage()?.removeItem(actorPhysicalKey(captured, logicalKey));
    }
  });
};

export const subscribeActorScopedStorage = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
