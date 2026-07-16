const CACHE_PREFIX = 'lanzo:ecommerce:configuration:v1:';
const MEMORY_TTL_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

const memoryEntries = new Map();
const inFlightRequests = new Map();

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asPositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export function buildPublicProductConfigurationCacheKey({
  slug,
  productId,
  catalogRevision,
  configurationVersion
} = {}) {
  return [
    CACHE_PREFIX,
    encodeURIComponent(asText(slug).toLowerCase()),
    encodeURIComponent(asText(productId)),
    asPositiveInteger(catalogRevision) || 0,
    asPositiveInteger(configurationVersion) || 0
  ].join(':');
}

const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const readSessionEntry = (key) => {
  try {
    const rawValue = globalThis.sessionStorage?.getItem(key);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeSessionEntry = (key, entry) => {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(entry));
  } catch {
    // La tienda sigue funcionando aunque el almacenamiento no esté disponible.
  }
};

const deleteSessionEntry = (key) => {
  try {
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    // No-op.
  }
};

export function getCachedPublicProductConfiguration(key, {
  allowStale = false,
  now = Date.now()
} = {}) {
  const entry = memoryEntries.get(key) || readSessionEntry(key);
  if (!entry || !entry.value || !Number.isFinite(Number(entry.createdAt))) return null;

  const ageMs = Math.max(0, now - Number(entry.createdAt));
  if (ageMs > MAX_STALE_MS || (!allowStale && ageMs > MEMORY_TTL_MS)) {
    memoryEntries.delete(key);
    deleteSessionEntry(key);
    return null;
  }

  memoryEntries.set(key, entry);
  return {
    value: cloneJson(entry.value),
    fresh: ageMs <= MEMORY_TTL_MS,
    ageSeconds: Math.floor(ageMs / 1000)
  };
}

export function putCachedPublicProductConfiguration(key, value, now = Date.now()) {
  const clonedValue = cloneJson(value);
  if (!key || !clonedValue) return false;
  const entry = { createdAt: now, value: clonedValue };
  memoryEntries.set(key, entry);
  writeSessionEntry(key, entry);
  return true;
}

export function deleteCachedPublicProductConfiguration(key) {
  memoryEntries.delete(key);
  deleteSessionEntry(key);
}

export function deleteObsoletePublicProductConfigurations({
  slug,
  productId,
  keepCatalogRevision,
  keepConfigurationVersion
} = {}) {
  const normalizedSlug = encodeURIComponent(asText(slug).toLowerCase());
  const normalizedProductId = encodeURIComponent(asText(productId));
  const keepRevision = asPositiveInteger(keepCatalogRevision) || 0;
  const keepVersion = asPositiveInteger(keepConfigurationVersion) || 0;
  const prefix = `${CACHE_PREFIX}:${normalizedSlug}:${normalizedProductId}:`;

  Array.from(memoryEntries.keys()).forEach((key) => {
    if (!key.startsWith(prefix)) return;
    const suffix = key.slice(prefix.length).split(':');
    if (Number(suffix[0]) !== keepRevision || Number(suffix[1]) !== keepVersion) {
      deleteCachedPublicProductConfiguration(key);
    }
  });

  try {
    for (let index = globalThis.sessionStorage?.length - 1; index >= 0; index -= 1) {
      const key = globalThis.sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length).split(':');
      if (Number(suffix[0]) !== keepRevision || Number(suffix[1]) !== keepVersion) {
        deleteCachedPublicProductConfiguration(key);
      }
    }
  } catch {
    // No-op.
  }
}

export function dedupePublicProductConfigurationRequest(key, requestFactory) {
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);
  const request = Promise.resolve()
    .then(requestFactory)
    .finally(() => {
      if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, request);
  return request;
}

export const ecommercePublicConfigurationCache = Object.freeze({
  buildKey: buildPublicProductConfigurationCacheKey,
  get: getCachedPublicProductConfiguration,
  put: putCachedPublicProductConfiguration,
  delete: deleteCachedPublicProductConfiguration,
  deleteObsolete: deleteObsoletePublicProductConfigurations,
  dedupe: dedupePublicProductConfigurationRequest
});
