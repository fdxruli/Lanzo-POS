import Dexie from 'dexie';

export const ECOMMERCE_CATALOG_SYNC_OUTBOX_DB_NAME = 'lanzo-ecommerce-catalog-sync-outbox';
const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const asText = (value) => String(value || '').trim();
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
  return database;
};

const defaultDatabase = createEcommerceCatalogSyncOutboxDatabase();

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

  const enqueue = async ({
    scopeIdentity,
    portalId,
    productRefs = [],
    fullReconcile = false,
    reason = 'catalog-change'
  }) => {
    const normalizedPortalId = asText(portalId);
    if (!normalizedPortalId) return 0;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();

    const timestamp = now();
    const records = [];
    if (fullReconcile || uniqueRefs(productRefs).length === 0) {
      records.push({
        key: `${scopeHash}:${normalizedPortalId}:*`,
        scopeHash,
        portalId: normalizedPortalId,
        productRef: null,
        fullReconcile: true,
        reason: asText(reason).slice(0, 100),
        updatedAt: timestamp
      });
    } else {
      uniqueRefs(productRefs).forEach((productRef) => {
        records.push({
          key: `${scopeHash}:${normalizedPortalId}:${encodeURIComponent(productRef)}`,
          scopeHash,
          portalId: normalizedPortalId,
          productRef,
          fullReconcile: false,
          reason: asText(reason).slice(0, 100),
          updatedAt: timestamp
        });
      });
    }

    await database.table('changes').bulkPut(records);
    return records.length;
  };

  const list = async ({ scopeIdentity, portalId }) => {
    const normalizedPortalId = asText(portalId);
    if (!normalizedPortalId) return { entries: [], productRefs: [], fullReconcile: false };
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const entries = await database.table('changes')
      .where('[scopeHash+portalId]')
      .equals([scopeHash, normalizedPortalId])
      .toArray();
    return {
      entries,
      productRefs: uniqueRefs(entries.map((entry) => entry.productRef)),
      fullReconcile: entries.some((entry) => entry.fullReconcile === true)
    };
  };

  const acknowledge = async ({ scopeIdentity, portalId, entries = null }) => {
    const normalizedPortalId = asText(portalId);
    if (!normalizedPortalId) return 0;
    const scopeHash = await resolveScope(scopeIdentity);
    await ensureOpen();
    const keys = Array.isArray(entries)
      ? entries
          .filter((entry) => entry?.scopeHash === scopeHash && entry?.portalId === normalizedPortalId)
          .map((entry) => entry.key)
      : await database.table('changes')
          .where('[scopeHash+portalId]')
          .equals([scopeHash, normalizedPortalId])
          .primaryKeys();
    if (keys.length > 0) await database.table('changes').bulkDelete(keys);
    return keys.length;
  };

  const cleanup = async () => {
    await ensureOpen();
    return database.table('changes')
      .where('updatedAt')
      .below(now() - OUTBOX_MAX_AGE_MS)
      .delete();
  };

  const clear = async () => {
    await ensureOpen();
    await database.table('changes').clear();
  };

  return {
    enqueue,
    list,
    acknowledge,
    cleanup,
    clear,
    database
  };
};

export const ecommerceCatalogSyncOutbox = createEcommerceCatalogSyncOutbox();

export const ecommerceCatalogSyncOutboxInternals = Object.freeze({
  uniqueRefs,
  fallbackHash,
  OUTBOX_MAX_AGE_MS
});
