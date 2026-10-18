const PREFIX = 'lanzo_local_backup_attention:v1';
export const LOCAL_BACKUP_ATTENTION_EVENT = 'lanzo:local-backup-attention';
const CONDITIONS = new Set(['configure', 'unlock', 'permission', 'pending', 'error', 'drive-reauth']);
const memory = new Map();
const volatileKeys = new Map();
const memoryOnly = new Set();
let nextVolatileKey = 0;

const empty = () => ({ version: 1, presentedAt: null, readStates: [], errorReadAt: null, postponedAt: null });
const timestamp = (value) => (
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
);
const normalize = (value) => value?.version === 1 ? {
  version: 1,
  presentedAt: timestamp(value.presentedAt),
  readStates: [...new Set(Array.isArray(value.readStates) ? value.readStates : [])]
    .filter((key) => CONDITIONS.has(key)),
  errorReadAt: timestamp(value.errorReadAt),
  postponedAt: timestamp(value.postponedAt)
} : empty();
const isPersistentKey = (key) => new RegExp(`^${PREFIX}:[a-f0-9]{64}$`).test(key);
const isKey = (key) => typeof key === 'string' && (
  isPersistentKey(key) || /^backup-attention-memory:\d+$/.test(key)
);
const storage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

/** The physical tenant namespace is installation-specific. Nothing from the
 * actor, device or tenant identity is persisted in clear text. Session IDs and
 * runtime generations deliberately do not enter this durable preference key. */
export async function buildLocalBackupAttentionKey({ databaseName, actorKey, deviceRef } = {}) {
  if (!/^LanzoDB_t_t_[a-f0-9]{32}$/i.test(databaseName || '') || !actorKey || !deviceRef) return null;
  const scope = JSON.stringify([databaseName, actorKey, deviceRef]);
  try {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${PREFIX}\0${scope}`));
    const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${PREFIX}:${hash}`;
  } catch {
    // No raw-identity storage fallback when Web Crypto is unavailable.
    if (!volatileKeys.has(scope)) volatileKeys.set(scope, `backup-attention-memory:${++nextVolatileKey}`);
    return volatileKeys.get(scope);
  }
}

export function readLocalBackupAttention(key) {
  if (!isKey(key)) return empty();
  const local = storage();
  if (local && isPersistentKey(key)) {
    try {
      const raw = local.getItem(key);
      if (raw !== null) {
        const record = normalize(JSON.parse(raw));
        if (!memoryOnly.has(key)) memory.set(key, record);
      } else if (!memoryOnly.has(key)) memory.delete(key);
    } catch {
      // A blocked store cannot prevent use of the current in-memory decision.
    }
  }
  return normalize(memory.get(key));
}

export function updateLocalBackupAttention(key, action, condition, now = new Date()) {
  if (!isKey(key) || !['presented', 'read', 'postpone', 'resolved'].includes(action)) return empty();
  const record = readLocalBackupAttention(key);
  // Only a confirmed recovery clears error reading. Normal session locks keep
  // their reading history across successful copies and browser sessions.
  if (action === 'resolved' && condition !== 'error') return record;
  const at = now.toISOString();
  const next = normalize({
    ...record,
    // Reading in the bell is also a first presentation/acknowledgment, even if
    // the initial banner has never been mounted in this context.
    presentedAt: ['presented', 'postpone', 'read'].includes(action) ? record.presentedAt || at : record.presentedAt,
    readStates: action === 'resolved' ? record.readStates.filter((key) => key !== 'error')
      : action === 'read' && CONDITIONS.has(condition) ? [...record.readStates, condition] : record.readStates,
    errorReadAt: action === 'read' && condition === 'error' ? at
      : action === 'resolved' ? null : record.errorReadAt,
    postponedAt: action === 'postpone' ? at : record.postponedAt
  });
  if (JSON.stringify(next) === JSON.stringify(record)) return record;
  memory.set(key, next);
  const local = storage();
  if (local && isPersistentKey(key)) {
    try { local.setItem(key, JSON.stringify(next)); memoryOnly.delete(key); } catch { memoryOnly.add(key); }
  } else if (isPersistentKey(key)) {
    memoryOnly.add(key);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_BACKUP_ATTENTION_EVENT, { detail: { key } }));
  }
  return next;
}

export function resetLocalBackupAttentionMemory() {
  memory.clear();
  memoryOnly.clear();
  volatileKeys.clear();
}
