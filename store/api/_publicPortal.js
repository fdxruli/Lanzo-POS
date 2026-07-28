import {
  normalizeSocialText,
  truncateSocialText,
  validateStoreSlug,
} from './_socialMetadata.js';
import {
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme,
} from '../../src/utils/ecommercePortalTheme.js';

export const DEFAULT_PUBLIC_PORTAL_TIMEOUT_MS = 4_000;
export const MIN_PUBLIC_PORTAL_TIMEOUT_MS = 500;
export const MAX_PUBLIC_PORTAL_TIMEOUT_MS = 10_000;
export const MAX_PUBLIC_PORTAL_RESPONSE_BYTES = 256 * 1024;

const RPC_PATH = '/rest/v1/rpc/ecommerce_get_portal_by_slug';
const PORTAL_NOT_FOUND_CODE = 'ECOMMERCE_PORTAL_NOT_FOUND';
const DEFAULT_PORTAL_NAME = 'Tienda online';
const MAX_PORTAL_NAME_LENGTH = 80;
const MAX_PORTAL_HEADLINE_LENGTH = 200;
const MAX_PORTAL_DESCRIPTION_LENGTH = 500;
const MAX_BUSINESS_TYPES = 12;
const MAX_BUSINESS_TYPE_LENGTH = 80;
const MAX_IMAGE_URL_LENGTH = 2_048;
const TIMEOUT_SENTINEL = Symbol('PUBLIC_PORTAL_TIMEOUT');

const CONFIGURATION_MESSAGE = 'La configuración pública del portal no es válida.';

export class PublicPortalClientConfigurationError extends TypeError {
  constructor(code) {
    super(CONFIGURATION_MESSAGE);
    this.name = 'PublicPortalClientConfigurationError';
    this.code = code;
  }
}

const configurationError = (code) => new PublicPortalClientConfigurationError(code);

function normalizeSupabaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configurationError('INVALID_SUPABASE_URL');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw configurationError('INVALID_SUPABASE_URL');
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/+$/u.test(url.pathname)
  ) {
    throw configurationError('INVALID_SUPABASE_URL');
  }

  return url.origin;
}

function decodeJwtPayload(value) {
  const segments = value.split('.');
  if (segments.length !== 3 || typeof globalThis.atob !== 'function') return null;

  try {
    const base64 = segments[1].replace(/-/gu, '+').replace(/_/gu, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(globalThis.atob(`${base64}${padding}`));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function looksPrivileged(value) {
  const normalized = value.toLowerCase();
  if (
    normalized.startsWith('sb_secret_')
    || normalized.includes('service_role')
    || normalized.includes('supabase_service_role')
  ) {
    return true;
  }

  return decodeJwtPayload(value)?.role === 'service_role';
}

function normalizePublishableKey(value) {
  if (typeof value !== 'string') {
    throw configurationError('INVALID_PUBLISHABLE_KEY');
  }

  const key = value.trim();
  if (!key) throw configurationError('INVALID_PUBLISHABLE_KEY');
  if (looksPrivileged(key)) throw configurationError('PRIVILEGED_KEY_REJECTED');
  return key;
}

function normalizeTimeout(value) {
  if (
    !Number.isSafeInteger(value)
    || value < MIN_PUBLIC_PORTAL_TIMEOUT_MS
    || value > MAX_PUBLIC_PORTAL_TIMEOUT_MS
  ) {
    throw configurationError('INVALID_TIMEOUT');
  }
  return value;
}

function normalizeOptionalText(value, maximumLength) {
  return truncateSocialText(normalizeSocialText(value), maximumLength);
}

function normalizeBusinessType(value) {
  if (!Array.isArray(value)) return Object.freeze([]);

  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = normalizeOptionalText(item, MAX_BUSINESS_TYPE_LENGTH);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === MAX_BUSINESS_TYPES) break;
  }
  return Object.freeze(result);
}

function normalizeImageCandidate(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_IMAGE_URL_LENGTH) return '';

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeSiteVersionNumber(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function getContractErrorCode(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const remoteError = payload.error;
  if (!remoteError || typeof remoteError !== 'object' || Array.isArray(remoteError)) return '';
  return typeof remoteError.code === 'string' ? remoteError.code : '';
}

function hasDangerousOwnKeys(value) {
  if (!value || typeof value !== 'object') return false;
  const pending = [value];
  let visited = 0;

  while (pending.length) {
    const current = pending.pop();
    visited += 1;
    if (visited > 5_000) return true;

    for (const key of Object.keys(current)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
      const child = current[key];
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

function projectPortal(payload, requestedSlug) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || payload.success !== true
    || !payload.portal
    || typeof payload.portal !== 'object'
    || Array.isArray(payload.portal)
  ) {
    return null;
  }

  const returnedSlug = normalizeSocialText(payload.portal.slug);
  try {
    validateStoreSlug(returnedSlug);
  } catch {
    return null;
  }
  if (returnedSlug !== requestedSlug) return null;

  const site = payload.site && typeof payload.site === 'object' && !Array.isArray(payload.site)
    ? payload.site
    : {};
  const rawTheme = payload.portal.theme
    && typeof payload.portal.theme === 'object'
    && !Array.isArray(payload.portal.theme)
    ? payload.portal.theme
    : {};
  const theme = {
    primaryColor: typeof rawTheme.primaryColor === 'string' ? rawTheme.primaryColor : undefined,
    secondaryColor: typeof rawTheme.secondaryColor === 'string'
      ? rawTheme.secondaryColor
      : undefined,
    cornerStyle: typeof rawTheme.cornerStyle === 'string' ? rawTheme.cornerStyle : undefined,
    fontStyle: typeof rawTheme.fontStyle === 'string' ? rawTheme.fontStyle : undefined,
  };
  const name = normalizeOptionalText(payload.portal.name, MAX_PORTAL_NAME_LENGTH)
    || DEFAULT_PORTAL_NAME;

  return deepFreeze({
    status: 'ok',
    portal: {
      slug: returnedSlug,
      name,
      headline: normalizeOptionalText(payload.portal.headline, MAX_PORTAL_HEADLINE_LENGTH),
      description: normalizeOptionalText(
        payload.portal.description,
        MAX_PORTAL_DESCRIPTION_LENGTH,
      ),
      templateCode: normalizeEcommercePortalTemplate(payload.portal.templateCode),
      theme: normalizeEcommercePortalTheme(theme),
      logoUrl: normalizeImageCandidate(payload.portal.logoUrl),
      coverImageUrl: normalizeImageCandidate(payload.portal.coverImageUrl),
      businessType: normalizeBusinessType(payload.portal.businessType),
    },
    siteVersionNumber: normalizeSiteVersionNumber(site.versionNumber),
  });
}

function responseByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function readResponse(response) {
  const contentLength = response?.headers?.get?.('content-length');
  if (typeof contentLength === 'string' && /^\d+$/u.test(contentLength.trim())) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength > MAX_PUBLIC_PORTAL_RESPONSE_BYTES
    ) {
      return { oversized: true, payload: null };
    }
  }

  let text;
  try {
    text = await response.text();
  } catch {
    return { invalid: true, payload: null };
  }
  if (
    typeof text !== 'string'
    || responseByteLength(text) > MAX_PUBLIC_PORTAL_RESPONSE_BYTES
  ) {
    return { oversized: true, payload: null };
  }

  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { invalid: true, payload: null };
  }
}

const unavailable = (reason) => Object.freeze({ status: 'unavailable', reason });
const notFound = Object.freeze({ status: 'not_found' });

export function createPublicPortalSocialClient({
  supabaseUrl,
  publishableKey,
  fetchImpl,
  timeoutMs = DEFAULT_PUBLIC_PORTAL_TIMEOUT_MS,
} = {}) {
  const missingConfiguration = supabaseUrl == null
    || publishableKey == null
    || (
      fetchImpl == null
      && typeof globalThis.fetch !== 'function'
    )
    || typeof globalThis.AbortController !== 'function'
    || typeof globalThis.TextEncoder !== 'function';

  const normalizedUrl = supabaseUrl == null ? null : normalizeSupabaseUrl(supabaseUrl);
  const normalizedKey = publishableKey == null ? null : normalizePublishableKey(publishableKey);
  const normalizedTimeout = normalizeTimeout(timeoutMs);
  const requestFetch = fetchImpl == null ? globalThis.fetch?.bind(globalThis) : fetchImpl;

  if (fetchImpl != null && typeof fetchImpl !== 'function') {
    throw configurationError('INVALID_FETCH_IMPLEMENTATION');
  }

  const client = {
    async getPortalBySlug(slug) {
      const validSlug = validateStoreSlug(slug);
      if (missingConfiguration || !normalizedUrl || !normalizedKey || !requestFetch) {
        return unavailable('configuration_missing');
      }

      const controller = new AbortController();
      let timedOut = false;
      let timer;
      const timeout = new Promise((resolve, reject) => {
        timer = globalThis.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(TIMEOUT_SENTINEL);
        }, normalizedTimeout);
      });

      let response;
      let parsed;
      try {
        const rpcUrl = new URL(RPC_PATH, `${normalizedUrl}/`);
        response = await Promise.race([
          requestFetch(rpcUrl.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              apikey: normalizedKey,
              Authorization: `Bearer ${normalizedKey}`,
            },
            body: JSON.stringify({ p_slug: validSlug }),
            redirect: 'error',
            signal: controller.signal,
          }),
          timeout,
        ]);
        parsed = await Promise.race([readResponse(response), timeout]);
      } catch (error) {
        return unavailable(
          timedOut || error === TIMEOUT_SENTINEL ? 'timeout' : 'network',
        );
      } finally {
        globalThis.clearTimeout(timer);
      }

      if (timedOut) return unavailable('timeout');
      if (parsed.invalid || parsed.oversized) {
        return unavailable(response?.ok === false ? 'http_error' : 'invalid_response');
      }

      const remoteCode = getContractErrorCode(parsed.payload);
      if (hasDangerousOwnKeys(parsed.payload)) return unavailable('invalid_response');
      if (remoteCode === PORTAL_NOT_FOUND_CODE) return notFound;
      if (!response || response.ok !== true) return unavailable('http_error');
      if (parsed.payload?.success !== true) return unavailable('remote_error');

      const projected = projectPortal(parsed.payload, validSlug);
      return projected || unavailable('invalid_response');
    },
  };

  return Object.freeze(client);
}
