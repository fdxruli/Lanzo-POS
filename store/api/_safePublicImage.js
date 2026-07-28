import { Buffer } from 'node:buffer';

export const IMAGE_TIMEOUT_MS = 2_500;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const ALLOWED_STORAGE_PATHS = [
  '/storage/v1/object/public/',
  '/storage/v1/render/image/public/',
];
const TIMEOUT = Symbol('SAFE_PUBLIC_IMAGE_TIMEOUT');

function isIpv4(hostname) {
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every((part) => (
    /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255
  ));
}

function isForbiddenHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || isIpv4(normalized)
    || normalized.includes(':');
}

function normalizeSupabaseOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || url.search
      || url.hash
      || !/^\/+$/u.test(url.pathname)
      || isForbiddenHost(url.hostname)
    ) {
      return null;
    }
    return Object.freeze({ origin: url.origin, hostname: url.hostname.toLowerCase() });
  } catch {
    return null;
  }
}

export function resolveSafePublicImageUrl(candidate, supabaseUrl) {
  const configured = normalizeSupabaseOrigin(supabaseUrl);
  if (!configured || typeof candidate !== 'string') return null;

  try {
    const url = new URL(candidate);
    const pathAllowed = ALLOWED_STORAGE_PATHS.some((prefix) => url.pathname.startsWith(prefix));
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || isForbiddenHost(url.hostname)
      || url.hostname.toLowerCase() !== configured.hostname
      || !pathAllowed
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parseContentLength(response) {
  const value = response?.headers?.get?.('content-length');
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeContentType(response) {
  const value = response?.headers?.get?.('content-type');
  if (typeof value !== 'string') return '';
  return value.split(';', 1)[0].trim().toLowerCase();
}

function startsWithBytes(bytes, signature) {
  return bytes.byteLength >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

export function hasValidImageSignature(contentType, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return false;
  if (contentType === 'image/png') {
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === 'image/jpeg') {
    return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === 'image/webp') {
    return bytes.byteLength >= 12
      && startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50;
  }
  return false;
}

async function readLimitedBody(response, maximumBytes, signal, declaredLength) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 0
      || declaredLength > maximumBytes
      || typeof response?.arrayBuffer !== 'function'
    ) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maximumBytes && bytes.byteLength <= declaredLength
      ? bytes
      : null;
  }

  const chunks = [];
  let total = 0;
  let cancelled = false;
  const cancel = async () => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best-effort after timeout or limit rejection.
    }
  };
  const onAbort = () => {
    void cancel();
  };
  signal?.addEventListener?.('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await cancel();
        return null;
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await cancel();
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Reader implementations may already have released their lock.
    }
  }
}

export function createSafePublicImageLoader({
  supabaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = IMAGE_TIMEOUT_MS,
  maximumBytes = MAX_IMAGE_BYTES,
} = {}) {
  const configured = normalizeSupabaseOrigin(supabaseUrl);
  const validRuntime = typeof fetchImpl === 'function'
    && typeof globalThis.AbortController === 'function'
    && typeof Buffer?.from === 'function';
  const validLimits = Number.isSafeInteger(timeoutMs)
    && timeoutMs > 0
    && Number.isSafeInteger(maximumBytes)
    && maximumBytes > 0
    && maximumBytes <= MAX_IMAGE_BYTES;

  return async function loadSafePublicImage(candidate) {
    const safeUrl = configured
      ? resolveSafePublicImageUrl(candidate, configured.origin)
      : null;
    if (!safeUrl || !validRuntime || !validLimits) return null;

    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = globalThis.setTimeout(() => {
        controller.abort();
        reject(TIMEOUT);
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        fetchImpl(safeUrl, {
          method: 'GET',
          headers: { Accept: 'image/png,image/jpeg,image/webp' },
          redirect: 'error',
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (!response || response.ok !== true) return null;

      const contentType = normalizeContentType(response);
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) return null;
      const declaredLength = parseContentLength(response);
      if (declaredLength != null && declaredLength > maximumBytes) return null;

      const bytes = await Promise.race([
        readLimitedBody(response, maximumBytes, controller.signal, declaredLength),
        timeout,
      ]);
      if (!bytes?.byteLength || !hasValidImageSignature(contentType, bytes)) return null;
      return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
    } catch {
      return null;
    } finally {
      globalThis.clearTimeout(timer);
    }
  };
}
