import { assertNonCriticalCloudRequestRpc } from './cloudCriticalRpcGuards';
import {
  CLOUD_REQUEST_BACKOFF,
  CLOUD_REQUEST_CACHE,
  ENABLE_CLOUD_REQUEST_DEBUG
} from './cloudRequestConstants';

const cache = new Map();
const inFlight = new Map();
const backoff = new Map();
const versions = new Map();
const lastStartedAt = new Map();

const stats = {
  requestsStarted: 0,
  cacheHits: 0,
  deduped: 0,
  errors: 0,
  backoffHits: 0
};

let lastCleanupAt = 0;

const CRITICAL_ERROR_CODES = new Set([
  'LICENSE_REQUIRED',
  'STAFF_LOGIN_REQUIRED',
  'DEVICE_NOT_ALLOWED',
  'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE',
  'CASH_SESSION_REQUIRED',
  'INSUFFICIENT_STOCK',
  'INSUFFICIENT_CLOUD_STOCK',
  'NO_PERMISSION',
  'POS_PERMISSION_DENIED',
  'CUSTOMER_HAS_DEBT',
  'CLOUD_SALES_CASHIER_DISABLED',
  'CLOUD_SALES_CREDIT_DISABLED',
  'CLOUD_SALES_INVENTORY_DISABLED',
  'CLOUD_CASH_SESSION_REQUIRED'
]);

const now = () => Date.now();

const debug = (message, payload = {}) => {
  if (!ENABLE_CLOUD_REQUEST_DEBUG) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(`[cloudRequest] ${message}`, payload);
  } catch {
    // noop
  }
};

const normalizeKey = (key) => {
  const safeKey = String(key || '').trim();
  if (!safeKey) throw new Error('CLOUD_REQUEST_KEY_REQUIRED');
  return safeKey;
};

const normalizeTags = (tags = []) => Array.from(new Set(
  (Array.isArray(tags) ? tags : [tags])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
));

const getErrorCode = (error) => String(
  error?.code ||
  error?.error?.code ||
  error?.response?.code ||
  error?.message ||
  ''
).trim();

const stringifyError = (error) => {
  const values = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    error?.status,
    error?.statusCode,
    error?.name,
    error?.error_description,
    error?.error
  ].filter((value) => value !== null && value !== undefined);

  return values.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ').toLowerCase();
};

const isCriticalOrBusinessError = (error) => {
  const code = getErrorCode(error);
  if (CRITICAL_ERROR_CODES.has(code)) return true;
  return Array.from(CRITICAL_ERROR_CODES).some((criticalCode) => code.includes(criticalCode));
};

export const isTemporaryCloudRequestError = (error) => {
  if (isCriticalOrBusinessError(error)) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error?.name === 'TypeError') return true;

  const code = String(error?.code || error?.status || error?.statusCode || '').toLowerCase();
  const message = stringifyError(error);

  return (
    code === '57014' ||
    code === '429' ||
    code.startsWith('08') ||
    code.startsWith('53') ||
    code.startsWith('5') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('canceling statement due to statement timeout') ||
    message.includes('statement timeout') ||
    message.includes('query timeout') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('too many requests') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
};

const bumpVersion = (key) => {
  versions.set(key, (versions.get(key) || 0) + 1);
};

const currentVersion = (key) => versions.get(key) || 0;

const shouldCleanup = (time) => time - lastCleanupAt >= CLOUD_REQUEST_CACHE.CLEANUP_INTERVAL_MS;

const cleanupCache = (force = false) => {
  const time = now();
  if (!force && !shouldCleanup(time)) return;
  lastCleanupAt = time;

  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= time) {
      cache.delete(key);
    }
  }

  if (cache.size <= CLOUD_REQUEST_CACHE.MAX_ENTRIES) return;

  const entriesByAccess = Array.from(cache.entries())
    .sort(([, a], [, b]) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));

  const overflow = cache.size - CLOUD_REQUEST_CACHE.MAX_ENTRIES;
  entriesByAccess.slice(0, overflow).forEach(([key]) => cache.delete(key));
};

const buildBackoffDelay = (attempts) => Math.min(
  CLOUD_REQUEST_BACKOFF.BASE_MS * (2 ** Math.max(attempts - 1, 0)),
  CLOUD_REQUEST_BACKOFF.MAX_MS
);

const registerBackoff = (key, error) => {
  if (!isTemporaryCloudRequestError(error)) {
    backoff.delete(key);
    return;
  }

  const previous = backoff.get(key);
  const attempts = Math.min((previous?.attempts || 0) + 1, CLOUD_REQUEST_BACKOFF.MAX_ATTEMPTS);
  const delayMs = buildBackoffDelay(attempts);

  backoff.set(key, {
    attempts,
    until: now() + delayMs,
    delayMs,
    error
  });

  debug('backoff', { key, attempts, delayMs });
};

const getFreshCache = (key, time) => {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= time) return null;
  entry.lastAccessedAt = time;
  return entry;
};

const maybeReturnCooldownCache = ({ key, cooldownMs, force, time }) => {
  if (force || !Number.isFinite(Number(cooldownMs)) || Number(cooldownMs) <= 0) return null;

  const lastStarted = lastStartedAt.get(key) || 0;
  if (!lastStarted || time - lastStarted >= Number(cooldownMs)) return null;

  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= time) return null;

  entry.lastAccessedAt = time;
  stats.cacheHits += 1;
  debug('cooldown cache hit', { key, cooldownMs });
  return entry.value;
};

const assertCanStartRequest = ({ key, force, time }) => {
  if (force) return;

  const backoffRecord = backoff.get(key);
  if (!backoffRecord || backoffRecord.until <= time) return;

  stats.backoffHits += 1;
  const error = new Error('CLOUD_REQUEST_BACKOFF_ACTIVE');
  error.code = 'CLOUD_REQUEST_BACKOFF_ACTIVE';
  error.retryAfterMs = backoffRecord.until - time;
  error.cause = backoffRecord.error;
  debug('backoff hit', { key, retryAfterMs: error.retryAfterMs });
  throw error;
};

const invalidateKey = (key) => {
  bumpVersion(key);
  cache.delete(key);
  backoff.delete(key);
};

const hasTag = (entry, tag) => entry?.tags?.includes(tag);

export const cloudRequestManager = {
  async request({
    key,
    rpcName = null,
    ttlMs = 0,
    cooldownMs = 0,
    dedupe = true,
    force = false,
    tags = [],
    fn
  } = {}) {
    assertNonCriticalCloudRequestRpc(rpcName);

    const requestKey = normalizeKey(key);
    if (typeof fn !== 'function') throw new Error('CLOUD_REQUEST_FN_REQUIRED');

    const time = now();
    cleanupCache(false);

    const freshCache = !force ? getFreshCache(requestKey, time) : null;
    if (freshCache) {
      stats.cacheHits += 1;
      debug('cache hit', { key: requestKey });
      return freshCache.value;
    }

    const requestVersion = currentVersion(requestKey);
    const existingInFlight = inFlight.get(requestKey);
    if (dedupe && existingInFlight && existingInFlight.version === requestVersion) {
      stats.deduped += 1;
      debug('dedupe in-flight', { key: requestKey });
      return existingInFlight.promise;
    }

    assertCanStartRequest({ key: requestKey, force, time });

    const cooldownValue = maybeReturnCooldownCache({ key: requestKey, cooldownMs, force, time });
    if (cooldownValue) return cooldownValue;

    const requestTags = normalizeTags(tags);
    stats.requestsStarted += 1;
    lastStartedAt.set(requestKey, time);
    debug('fetch', { key: requestKey, rpcName, ttlMs, cooldownMs, tags: requestTags });

    const promise = Promise.resolve()
      .then(fn)
      .then((result) => {
        backoff.delete(requestKey);

        if (Number(ttlMs) > 0 && currentVersion(requestKey) === requestVersion) {
          const completedAt = now();
          cache.set(requestKey, {
            value: result,
            tags: requestTags,
            createdAt: completedAt,
            lastAccessedAt: completedAt,
            expiresAt: completedAt + Number(ttlMs)
          });
          cleanupCache(false);
        } else if (currentVersion(requestKey) !== requestVersion) {
          debug('obsolete result ignored for cache', { key: requestKey });
        }

        return result;
      })
      .catch((error) => {
        stats.errors += 1;
        registerBackoff(requestKey, error);
        throw error;
      })
      .finally(() => {
        if (inFlight.get(requestKey)?.promise === promise) {
          inFlight.delete(requestKey);
        }
      });

    inFlight.set(requestKey, {
      promise,
      tags: requestTags,
      startedAt: time,
      version: requestVersion
    });

    return promise;
  },

  invalidateByTag(tag) {
    const safeTag = String(tag || '').trim();
    if (!safeTag) return 0;

    let count = 0;
    const keys = new Set([
      ...Array.from(cache.entries()).filter(([, entry]) => hasTag(entry, safeTag)).map(([key]) => key),
      ...Array.from(inFlight.entries()).filter(([, entry]) => hasTag(entry, safeTag)).map(([key]) => key)
    ]);

    keys.forEach((key) => {
      invalidateKey(key);
      count += 1;
    });

    debug('invalidate tag', { tag: safeTag, count });
    return count;
  },

  invalidateByPrefix(prefix) {
    const safePrefix = String(prefix || '').trim();
    if (!safePrefix) return 0;

    let count = 0;
    const keys = new Set([
      ...Array.from(cache.keys()).filter((key) => key.startsWith(safePrefix)),
      ...Array.from(inFlight.keys()).filter((key) => key.startsWith(safePrefix))
    ]);

    keys.forEach((key) => {
      invalidateKey(key);
      count += 1;
    });

    debug('invalidate prefix', { prefix: safePrefix, count });
    return count;
  },

  clear() {
    const keys = new Set([...cache.keys(), ...inFlight.keys(), ...backoff.keys(), ...lastStartedAt.keys()]);
    keys.forEach((key) => bumpVersion(key));
    cache.clear();
    backoff.clear();
    lastStartedAt.clear();
    debug('clear', { count: keys.size });
    return keys.size;
  },

  getStats() {
    return {
      ...stats,
      activeInFlight: inFlight.size,
      cacheSize: cache.size,
      backoffSize: backoff.size
    };
  },

  _cleanupForTests() {
    cleanupCache(true);
  }
};

export default cloudRequestManager;
