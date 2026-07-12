import Dexie from 'dexie';

export const ECOMMERCE_CATALOG_SYNC_OUTBOX_DB_NAME = 'lanzo-ecommerce-catalog-sync-outbox';
const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_PORTAL_ID = '__pending_portal__';

const asText = (value) => String(value ?? '').trim();
const uniqueRefs = (values = []) => Array.from(new Set(
  values.map(asText).filter(Boolean)
));

const fallbackHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `f${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const hashEcommerceCatalogSyncScope = async (value) => {
  const normalized = asText(value);
  if (!normalized) return null;
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const bytes = new TextEncoder().encode(normalized);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return fallbackHash(normalized);
    }
  }
  return fallbackHash(normalized);
};

export const createEcommerceCatalogSyncOutboxDatabase = (
  name = ECOMMERCE_CATALOG_SYNC_OUTBOX_DB_NAME
) => {
  const database = new Dexie(name);
  database.version(1).stores({
    changes: '&key, scopeHash, portalId, productRef, fullReconcile, updatedAt, [scopeHash+portalId]'
  });
  database.version(2).stores({
    changes: '&key, scopeHash, portalId, productRef, fullReconcile, updatedAt, [scopeHash+portalId]',
    scopes: '&scopeHash, portalId, updatedAt'
  });
  return database;
};

const defaultDatabase = createEcommerceCatalogSyncOutboxDatabase();

const buildRecords = ({
  scopeHash,
  portalId,
  productRefs,
  fullReconcile,
  reason,
  timestamp
}) => {
  const refs = uniqueRefs(productRefs);
  if (fullReconcile || refs.length === 0) {
    return [{
      key: `${scopeHash}:${portalId}:*`,
      scopeHash,
      portalId,
      productRef: null,
      fullReconcile: true,
      reason: asText(reason).slice(0, 100),
      updatedAt: timestamp
    }];
  }

  return refs.map((productRef) => ({
    key: `${scopeHash}:${portalId}:${encodeURIComponent(productRef)}`,
    scopeHash,
    portalId,
    productRef,
    fullReconcile: false,
    reason: asText(reason).slice(0, 100),
    updatedAt: timestamp
  }));
};

export const createEcommerceCatalogSyncOutbox = ({
  database = defaultDatabase,
  now = () => Date.now()
} = {}) => {
  const ensureOpen = async () => {
    if (!database.isOpen()) await database.open();
  };

  const resolveScope = async (scopeIdentity) => {
    const scopeHash = await hashEcommerceCatalogSyncScope(scopeIdentity);
    if (!scopeHash) throw new Error('ECOMMERCE_CATALOG_SYNC_SCOPE_REQUIRED');
    return scopeHash;
  };

  const rememberPortal = async ({ scopeIdentity, portalId }) => {
    const normalizedPortalId = asText(portalId);
    if (!normalizedPortalId || normalizedPortalId === PENDING_PORTAL_ID) return false;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    await database.table('scopes').put({
      scopeHash,
      portalId: normalizedPortalId,
      updatedAt: now()
    });
    return true;
  };

  const getRememberedPortal = async ({ scopeIdentity }) => {
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const record = await database.table('scopes').get(scopeHash);
    if (!record || record.updatedAt < now() - OUTBOX_MAX_AGE_MS) {
      if (record) await database.table('scopes').delete(scopeHash);
      return null;
    }
    return asText(record.portalId) || null;
  };

  const enqueue = async ({
    scopeIdentity,
    portalId,
    productRefs = [],
    fullReconcile = false,
    reason = 'catalog-change'
  }) => {
    const normalizedPortalId = asText(portalId) || PENDING_PORTAL_ID;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();

    const timestamp = now();
    const records = buildRecords({
      scopeHash,
      portalId: normalizedPortalId,
      productRefs,
      fullReconcile,
      reason,
      timestamp
    });

    await database.transaction('rw', database.table('changes'), database.table('scopes'), async () => {
      await database.table('changes').bulkPut(records);
      if (normalizedPortalId !== PENDING_PORTAL_ID) {
        await database.table('scopes').put({
          scopeHash,
          portalId: normalizedPortalId,
          updatedAt: timestamp
        });
      }
    });
    return records.length;
  };

  const readEntries = async ({ scopeHash, portalId }) => {
    const portalIds = [portalId];
    if (portalId !== PENDING_PORTAL_ID) portalIds.push(PENDING_PORTAL_ID);
    const groups = await Promise.all(portalIds.map((candidate) => (
      database.table('changes')
        .where('[scopeHash+portalId]')
        .equals([scopeHash, candidate])
        .toArray()
    )));
    return groups.flat();
  };

  const list = async ({ scopeIdentity, portalId }) => {
    const normalizedPortalId = asText(portalId) || PENDING_PORTAL_ID;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const entries = await readEntries({ scopeHash, portalId: normalizedPortalId });
    return {
      entries,
      productRefs: uniqueRefs(entries.map((entry) => entry.productRef)),
      fullReconcile: entries.some((entry) => entry.fullReconcile === true)
    };
  };

  const acknowledge = async ({ scopeIdentity, portalId, entries = null }) => {
    const normalizedPortalId = asText(portalId) || PENDING_PORTAL_ID;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const keys = Array.isArray(entries)
      ? entries
          .filter((entry) => (
            entry?.scopeHash === scopeHash
            && [normalizedPortalId, PENDING_PORTAL_ID].includes(entry?.portalId)
          ))
          .map((entry) => entry.key)
      : (await readEntries({ scopeHash, portalId: normalizedPortalId })).map((entry) => entry.key);
    if (keys.length > 0) await database.table('changes').bulkDelete(keys);
    return keys.length;
  };

  const replacePending = async ({
    scopeIdentity,
    portalId,
    entries = [],
    productRefs = [],
    fullReconcile = false,
    reason = 'retryable-failure'
  }) => {
    const normalizedPortalId = asText(portalId) || PENDING_PORTAL_ID;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const timestamp = now();
    const keys = entries
      .filter((entry) => entry?.scopeHash === scopeHash)
      .map((entry) => entry.key);
    const records = buildRecords({
      scopeHash,
      portalId: normalizedPortalId,
      productRefs,
      fullReconcile,
      reason,
      timestamp
    });

    await database.transaction('rw', database.table('changes'), database.table('scopes'), async () => {
      if (keys.length > 0) await database.table('changes').bulkDelete(keys);
      await database.table('changes').bulkPut(records);
      if (normalizedPortalId !== PENDING_PORTAL_ID) {
        await database.table('scopes').put({
          scopeHash,
          portalId: normalizedPortalId,
          updatedAt: timestamp
        });
      }
    });
    return records.length;
  };

  const cleanup = async () => {
    await ensureOpen();
    const cutoff = now() - OUTBOX_MAX_AGE_MS;
    const [changesDeleted, scopesDeleted] = await Promise.all([
      database.table('changes').where('updatedAt').below(cutoff).delete(),
      database.table('scopes').where('updatedAt').below(cutoff).delete()
    ]);
    return changesDeleted + scopesDeleted;
  };

  const clear = async () => {
    await ensureOpen();
    await database.transaction('rw', database.table('changes'), database.table('scopes'), async () => {
      await database.table('changes').clear();
      await database.table('scopes').clear();
    });
  };

  return {
    rememberPortal,
    getRememberedPortal,
    enqueue,
    list,
    acknowledge,
    replacePending,
    cleanup,
    clear,
    database
  };
};

export const ecommerceCatalogSyncOutbox = createEcommerceCatalogSyncOutbox();

export const ecommerceCatalogSyncOutboxInternals = Object.freeze({
  uniqueRefs,
  fallbackHash,
  buildRecords,
  PENDING_PORTAL_ID,
  OUTBOX_MAX_AGE_MS
});
