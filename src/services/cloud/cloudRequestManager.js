import { assertNonCriticalCloudRequestRpc } from './cloudCriticalRpcGuards';
import {
  CLOUD_REQUEST_BACKOFF,
  CLOUD_REQUEST_CACHE,
  ENABLE_CLOUD_REQUEST_DEBUG
} from './cloudRequestConstants';
import { hashCloudContextPart } from './cloudRequestKeys';

const cache = new Map();
const inFlight = new Map();
const backoff = new Map();
const versions = new Map();
const lastStartedAt = new Map();
const responseAudit = [];

const stats = {
  requestsStarted: 0,
  cacheHits: 0,
  deduped: 0,
  errors: 0,
  backoffHits: 0,
  staleDiscarded: 0
};

let lastCleanupAt = 0;
let requestSequence = 0;

const RATE_LIMITED_ERROR_CODE = 'RATE_LIMITED';
export const CLOUD_REQUEST_RESPONSE_STALE_CODE = 'CLOUD_REQUEST_RESPONSE_STALE';
export const CLOUD_RESPONSE_ORIGINS = Object.freeze({
  NETWORK: 'network',
  CACHE: 'cache',
  IN_FLIGHT: 'in-flight',
  STALE: 'stale/discarded'
});
const STALE_RESPONSE_ERROR_CODE = CLOUD_REQUEST_RESPONSE_STALE_CODE;
const RESPONSE_ORIGINS = CLOUD_RESPONSE_ORIGINS;
const MAX_RESPONSE_AUDIT_ENTRIES = 250;

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

const isBrowserOnline = () => (
  typeof navigator === 'undefined' || navigator.onLine !== false
);

const keyHash = (key) => hashCloudContextPart(key);

const debug = (message, payload = {}) => {
  if (!ENABLE_CLOUD_REQUEST_DEBUG) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(`[cloudRequest] ${message}`, payload);
  } catch {
    // noop
  }
};

const recordResponseOrigin = ({
  requestKey,
  rpcName = null,
  requestId,
  generation,
  connectionGeneration,
  origin,
  reason = null,
  sourceRequestId = null,
  startedAt = null,
  startedOnline = null,
  completedAt = now(),
  errorCode = null
} = {}) => {
  const entry = Object.freeze({
    requestId: requestId || null,
    generation: Number(generation) || 0,
    connectionGeneration: Number(connectionGeneration) || 0,
    origin: origin || null,
    reason: reason || null,
    sourceRequestId: sourceRequestId || null,
    rpcName: rpcName || null,
    keyHash: requestKey ? keyHash(requestKey) : null,
    startedAt: startedAt || null,
    startedOnline: startedOnline === null ? null : Boolean(startedOnline),
    completedAt,
    errorCode: errorCode || null
  });

  responseAudit.push(entry);
  if (responseAudit.length > MAX_RESPONSE_AUDIT_ENTRIES) responseAudit.shift();
  debug('response', entry);
  return entry;
};

const attachResponseMetadata = (value, metadata) => {
  if (!value || typeof value !== 'object') return value;

  const decorated = Array.isArray(value) ? [...value] : { ...value };
  Object.defineProperty(decorated, 'cloudRequestMeta', {
    value: Object.freeze({ ...metadata }),
    enumerable: false,
    configurable: false,
    writable: false
  });
  return decorated;
};

const attachErrorMetadata = (error, metadata) => {
  const decorated = error instanceof Error ? error : new Error(String(error || 'Cloud request failed'));
  try {
    decorated.requestId = metadata.requestId;
    decorated.generation = metadata.generation;
    decorated.connectionGeneration = metadata.connectionGeneration;
    decorated.origin = metadata.origin;
    decorated.responseOrigin = metadata.origin;
    decorated.cloudRequestMeta = metadata;
  } catch {
    // Some third-party errors can be immutable. The audit entry still keeps
    // the redacted request evidence for diagnostics.
  }
  return decorated;
};

const isStaleResponseError = (error) => error?.code === STALE_RESPONSE_ERROR_CODE;

const buildStaleResponseError = (record, reason) => {
  stats.staleDiscarded += 1;
  const metadata = recordResponseOrigin({
    requestKey: record.requestKey,
    rpcName: record.rpcName,
    requestId: record.requestId,
    generation: record.generation,
    connectionGeneration: record.connectionGeneration,
    origin: RESPONSE_ORIGINS.STALE,
    reason,
    startedAt: record.startedAt,
    startedOnline: record.startedOnline,
    errorCode: STALE_RESPONSE_ERROR_CODE
  });
  const error = new Error(STALE_RESPONSE_ERROR_CODE);
  error.code = STALE_RESPONSE_ERROR_CODE;
  error.origin = RESPONSE_ORIGINS.STALE;
  error.requestId = record.requestId;
  error.generation = record.generation;
  error.connectionGeneration = record.connectionGeneration;
  error.reason = reason;
  error.cloudRequestMeta = metadata;
  return error;
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

const getPayloadCode = (payload) => String(
  payload?.code ||
  payload?.error?.code ||
  payload?.response?.code ||
  ''
).trim();

const isRateLimitedPayload = (payload) => (
  payload?.success === false && getPayloadCode(payload) === RATE_LIMITED_ERROR_CODE
);

const buildRateLimitedError = (payload = {}) => {
  const retryAfterSeconds = Number(
    payload.retry_after_seconds ??
    payload.retryAfterSeconds ??
    0
  ) || 0;

  const message = payload.message || 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.';
  const error = new Error(
    retryAfterSeconds > 0
      ? `${message} Intenta de nuevo en ${retryAfterSeconds} s.`
      : message
  );

  error.code = RATE_LIMITED_ERROR_CODE;
  error.retryAfterSeconds = retryAfterSeconds;
  error.retryAfterMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  error.payload = payload;
  error.response = payload;

  return error;
};

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

const getErrorChain = (error) => {
  const chain = [];
  const visited = new Set();
  let current = error;

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = current.cause || current.originalError || current.error || null;
  }

  return chain;
};

const isCriticalOrBusinessError = (error) => {
  const code = getErrorCode(error);
  if (CRITICAL_ERROR_CODES.has(code)) return true;
  return Array.from(CRITICAL_ERROR_CODES).some((criticalCode) => code.includes(criticalCode));
};

export const isTemporaryCloudRequestError = (error) => {
  if (isCriticalOrBusinessError(error)) return false;
  if (getErrorCode(error) === RATE_LIMITED_ERROR_CODE) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error?.name === 'TypeError') return true;

  const code = String(error?.code || error?.status || error?.statusCode || '').toLowerCase();
  const message = stringifyError(error);

  return (
    code === 'cash_network_unavailable' ||
    code === '57014' ||
    code === '408' ||
    code === '429' ||
    code === 'rate_limited' ||
    code.startsWith('08') ||
    code.startsWith('53') ||
    code.startsWith('5') ||
    message.includes('err_connection_closed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('canceling statement due to statement timeout') ||
    message.includes('statement timeout') ||
    message.includes('query timeout') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('too many requests') ||
    message.includes('demasiadas solicitudes') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
};

// This narrower predicate advances the shared connectivity generation. A
// 429 is retryable but is not evidence that an older successful response is
// unsafe, so it deliberately does not advance the generation.
const isTransportUnavailableError = (error) => {
  if (!isBrowserOnline()) return true;

  return getErrorChain(error).some((candidate) => {
    const status = Number(candidate?.status || candidate?.statusCode || candidate?.response?.status || 0);
    if (status === 408 || (status >= 500 && status <= 599)) return true;

    const text = stringifyError(candidate);
    return (
      candidate?.name === 'TypeError'
      || text.includes('err_connection_closed')
      || text.includes('failed to fetch')
      || text.includes('networkerror')
      || text.includes('network request failed')
      || text.includes('fetch failed')
      || text.includes('load failed')
      || text.includes('connection closed')
      || text.includes('connection reset')
      || text.includes('cash_network_unavailable')
    );
  });
};

let connectionGeneration = 0;

const advanceConnectionGeneration = (reason) => {
  connectionGeneration += 1;
  debug('connection generation advanced', {
    connectionGeneration,
    reason
  });
  return connectionGeneration;
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
  const retryAfterMs = Number(error?.retryAfterMs || 0);
  const delayMs = retryAfterMs > 0
    ? Math.min(retryAfterMs, CLOUD_REQUEST_BACKOFF.MAX_MS)
    : buildBackoffDelay(attempts);

  backoff.set(key, {
    attempts,
    until: now() + delayMs,
    delayMs,
    error
  });

  debug('backoff', { keyHash: keyHash(key), attempts, delayMs });
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
  debug('cooldown cache hit', { keyHash: keyHash(key), cooldownMs });
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
  error.retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
  error.cause = backoffRecord.error;
  debug('backoff hit', { keyHash: keyHash(key), retryAfterMs: error.retryAfterMs });
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
    allowCache = true,
    tags = [],
    fn
  } = {}) {
    assertNonCriticalCloudRequestRpc(rpcName);

    const requestKey = normalizeKey(key);
    if (typeof fn !== 'function') throw new Error('CLOUD_REQUEST_FN_REQUIRED');

    // `force` is a generation boundary, not merely a cache bypass. The old
    // in-flight entry intentionally remains reachable by its caller so it
    // can settle, but it can no longer be deduped or write into this key.
    if (force) invalidateKey(requestKey);

    const time = now();
    cleanupCache(false);
    const requestGeneration = currentVersion(requestKey);
    const requestId = `cloud-${++requestSequence}`;
    const requestConnectionGeneration = connectionGeneration;

    const freshCache = allowCache && !force ? getFreshCache(requestKey, time) : null;
    if (freshCache) {
      stats.cacheHits += 1;
      const metadata = recordResponseOrigin({
        requestKey,
        rpcName,
        requestId,
        generation: requestGeneration,
        connectionGeneration: requestConnectionGeneration,
        origin: RESPONSE_ORIGINS.CACHE,
        reason: 'fresh-cache',
        sourceRequestId: freshCache.requestId,
        startedAt: freshCache.startedAt,
        startedOnline: freshCache.startedOnline
      });
      debug('cache hit', { keyHash: keyHash(requestKey), requestId, generation: requestGeneration });
      return attachResponseMetadata(freshCache.value, metadata);
    }

    const existingInFlight = inFlight.get(requestKey);
    if (dedupe && existingInFlight && existingInFlight.generation === requestGeneration) {
      stats.deduped += 1;
      debug('dedupe in-flight', {
        keyHash: keyHash(requestKey),
        requestId,
        generation: requestGeneration,
        sourceRequestId: existingInFlight.requestId
      });
      return existingInFlight.promise.then((result) => {
        const metadata = recordResponseOrigin({
          requestKey,
          rpcName,
          requestId,
          generation: requestGeneration,
          connectionGeneration: existingInFlight.connectionGeneration,
          origin: RESPONSE_ORIGINS.IN_FLIGHT,
          reason: 'deduped-request',
          sourceRequestId: existingInFlight.requestId,
          startedAt: existingInFlight.startedAt,
          startedOnline: existingInFlight.startedOnline
        });
        return attachResponseMetadata(result, metadata);
      });
    }

    assertCanStartRequest({ key: requestKey, force, time });

    const cooldownValue = allowCache
      ? maybeReturnCooldownCache({ key: requestKey, cooldownMs, force, time })
      : null;
    if (cooldownValue) {
      const metadata = recordResponseOrigin({
        requestKey,
        rpcName,
        requestId,
        generation: requestGeneration,
        connectionGeneration: requestConnectionGeneration,
        origin: RESPONSE_ORIGINS.CACHE,
        reason: 'cooldown-cache',
        startedOnline: isBrowserOnline()
      });
      return attachResponseMetadata(cooldownValue, metadata);
    }

    const requestTags = normalizeTags(tags);
    stats.requestsStarted += 1;
    lastStartedAt.set(requestKey, time);
    const requestRecord = {
      requestKey,
      rpcName,
      requestId,
      generation: requestGeneration,
      connectionGeneration: requestConnectionGeneration,
      startedAt: time,
      startedOnline: isBrowserOnline(),
      tags: requestTags
    };
    debug('fetch', {
      keyHash: keyHash(requestKey),
      rpcName,
      requestId,
      generation: requestGeneration,
      ttlMs,
      cooldownMs,
      allowCache,
      tags: requestTags
    });

    const promise = Promise.resolve()
      .then(fn)
      .then((result) => {
        if (currentVersion(requestKey) !== requestGeneration) {
          throw buildStaleResponseError(requestRecord, 'generation_changed');
        }
        if (connectionGeneration !== requestConnectionGeneration) {
          throw buildStaleResponseError(requestRecord, 'connection_lost');
        }
        if (!isBrowserOnline()) {
          throw buildStaleResponseError(requestRecord, 'browser_offline');
        }
        if (isRateLimitedPayload(result)) {
          throw buildRateLimitedError(result);
        }

        backoff.delete(requestKey);

        if (allowCache && Number(ttlMs) > 0 && currentVersion(requestKey) === requestGeneration) {
          const completedAt = now();
          cache.set(requestKey, {
            value: result,
            tags: requestTags,
            createdAt: completedAt,
            lastAccessedAt: completedAt,
            expiresAt: completedAt + Number(ttlMs),
            requestId,
            generation: requestGeneration,
            connectionGeneration: requestConnectionGeneration,
            startedAt: time,
            startedOnline: requestRecord.startedOnline
          });
          cleanupCache(false);
        }

        return result;
      })
      .catch((error) => {
        if (isStaleResponseError(error)) throw error;
        if (currentVersion(requestKey) !== requestGeneration) {
          throw buildStaleResponseError(requestRecord, 'generation_changed_after_error');
        }
        if (connectionGeneration !== requestConnectionGeneration) {
          throw buildStaleResponseError(requestRecord, 'connection_lost_after_error');
        }
        if (isTransportUnavailableError(error)) {
          advanceConnectionGeneration('transport_error');
          const metadata = recordResponseOrigin({
            requestKey,
            rpcName,
            requestId,
            generation: requestGeneration,
            connectionGeneration: requestConnectionGeneration,
            origin: RESPONSE_ORIGINS.NETWORK,
            reason: 'transport-error',
            startedAt: time,
            startedOnline: requestRecord.startedOnline,
            errorCode: error?.code || error?.name || 'CLOUD_TRANSPORT_ERROR'
          });
          error = attachErrorMetadata(error, metadata);
        }
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
      generation: requestGeneration,
      version: requestGeneration,
      requestId,
      connectionGeneration: requestConnectionGeneration,
      startedOnline: requestRecord.startedOnline
    });

    return promise.then((result) => {
      const metadata = recordResponseOrigin({
        requestKey,
        rpcName,
        requestId,
        generation: requestGeneration,
        connectionGeneration: requestConnectionGeneration,
        origin: RESPONSE_ORIGINS.NETWORK,
        reason: null,
        startedAt: time,
        startedOnline: requestRecord.startedOnline
      });
      return attachResponseMetadata(result, metadata);
    });
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
    responseAudit.length = 0;
    debug('clear', { count: keys.size });
    return keys.size;
  },

  getStats() {
    return {
      ...stats,
      activeInFlight: inFlight.size,
      cacheSize: cache.size,
      backoffSize: backoff.size,
      connectionGeneration,
      responseOrigins: responseAudit.reduce((counts, entry) => {
        if (entry.origin) counts[entry.origin] = (counts[entry.origin] || 0) + 1;
        return counts;
      }, {})
    };
  },

  getResponseAudit({ key = null, rpcName = null, limit = 50 } = {}) {
    const keyHashFilter = key ? keyHash(normalizeKey(key)) : null;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_RESPONSE_AUDIT_ENTRIES);
    return responseAudit
      .filter((entry) => (!keyHashFilter || entry.keyHash === keyHashFilter)
        && (!rpcName || entry.rpcName === rpcName))
      .slice(-safeLimit)
      .map((entry) => ({ ...entry }));
  },

  _cleanupForTests() {
    cleanupCache(true);
  }
};

export default cloudRequestManager;
