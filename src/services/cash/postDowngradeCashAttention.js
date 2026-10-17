const STORAGE_PREFIX = 'lanzo_post_downgrade_cash_attention:v1';
export const POST_DOWNGRADE_CASH_ATTENTION_EVENT = 'lanzo:post-downgrade-cash-attention';

const memoryRecords = new Map();

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

const emptyRecord = () => ({
  version: 1,
  readAt: null,
  postponedAt: null
});

const normalizeRecord = (value) => {
  if (!value || value.version !== 1) return emptyRecord();
  return {
    version: 1,
    readAt: typeof value.readAt === 'string' ? value.readAt : null,
    postponedAt: typeof value.postponedAt === 'string' ? value.postponedAt : null
  };
};

const toHex = (buffer) => Array.from(new Uint8Array(buffer))
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

const normalizeTimestamp = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || '').trim() : parsed.toISOString();
};

/**
 * Creates an opaque storage key from the authenticated business/owner scope
 * and the downgrade boundary. The license key and actor identity are never
 * written to persistent storage.
 */
export async function buildPostDowngradeCashAttentionKey({
  scopeKey,
  downgradedAt
} = {}) {
  if (!scopeKey) return null;

  const transition = downgradedAt
    ? `at:${normalizeTimestamp(downgradedAt)}`
    : 'legacy-boundary';

  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi?.digest || typeof TextEncoder === 'undefined') return null;

  try {
    const input = `${STORAGE_PREFIX}\u0000${scopeKey}\u0000${transition}`;
    const digest = await cryptoApi.digest('SHA-256', new TextEncoder().encode(input));
    return `${STORAGE_PREFIX}:${toHex(digest)}`;
  } catch {
    return null;
  }
}

export function readPostDowngradeCashAttention(key) {
  if (!key) return emptyRecord();

  const storage = getLocalStorage();
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const record = normalizeRecord(JSON.parse(raw));
        memoryRecords.set(key, record);
        return record;
      }
    } catch {
      // Continue with the in-memory copy when storage is unavailable or corrupt.
    }
  }

  return normalizeRecord(memoryRecords.get(key));
}

const emitAttentionChange = (key, action, source) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const event = typeof CustomEvent === 'function'
    ? new CustomEvent(POST_DOWNGRADE_CASH_ATTENTION_EVENT, {
      detail: { key, action, source }
    })
    : new Event(POST_DOWNGRADE_CASH_ATTENTION_EVENT);
  window.dispatchEvent(event);
};

const saveRecord = (key, record, action, source) => {
  if (!key) return emptyRecord();
  const normalized = normalizeRecord(record);
  memoryRecords.set(key, normalized);
  const storage = getLocalStorage();

  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(normalized));
    } catch {
      // The in-memory preference remains usable when persistent storage is blocked.
    }
  }

  emitAttentionChange(key, action, source);
  return normalized;
};

export function markPostDowngradeCashAttentionDisplayed(key, now = new Date()) {
  const current = readPostDowngradeCashAttention(key);
  if (current.readAt) return current;
  return saveRecord(key, {
    ...current,
    readAt: now.toISOString()
  }, 'displayed', 'initial-notice');
}

export function markPostDowngradeCashAttentionRead(
  key,
  { now = new Date(), source = 'local-alerts' } = {}
) {
  const current = readPostDowngradeCashAttention(key);
  const next = current.readAt
    ? current
    : { ...current, readAt: now.toISOString() };
  return saveRecord(key, next, 'read', source);
}

export function postponePostDowngradeCashAttention(key, now = new Date()) {
  const current = readPostDowngradeCashAttention(key);
  return saveRecord(key, {
    ...current,
    readAt: current.readAt || now.toISOString(),
    postponedAt: now.toISOString()
  }, 'postponed', 'initial-notice');
}

export function clearPostDowngradeCashAttention(key) {
  if (!key) return;
  memoryRecords.delete(key);
  const storage = getLocalStorage();

  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // A stale preference cannot affect the authoritative pending count.
    }
  }

  emitAttentionChange(key, 'resolved', 'backend-confirmation');
}

export function resetPostDowngradeCashAttentionMemory() {
  memoryRecords.clear();
}
