import { ecommercePublicClient } from './ecommercePublicService';

export const ECOMMERCE_TRACKING_POLL_MS = 45_000;
const TRACKING_REQUEST_MESSAGE = 'No se pudo actualizar el seguimiento. Revisa tu conexión e intenta nuevamente.';
const TRACKING_NOT_FOUND_MESSAGE = 'No se pudo encontrar este seguimiento.';
const ALLOWED_STATUSES = new Set([
  'received',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'attention',
  'rejected'
]);

export class EcommerceTrackingError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'EcommerceTrackingError';
    this.code = code;
    this.cause = cause;
  }
}

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const asBoolean = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSlug = (value) => asText(value).toLowerCase().slice(0, 160);
const normalizeToken = (value) => {
  const token = asText(value).slice(0, 128);
  return /^trk1_[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
};

function normalizeTracking(data) {
  const source = asObject(data?.tracking);
  const status = ALLOWED_STATUSES.has(source.status) ? source.status : 'received';
  const fulfillmentMethod = source.fulfillmentMethod === 'delivery' ? 'delivery' : 'pickup';
  const items = asArray(source.items).map((item) => ({
    name: asText(item?.name, 'Producto').slice(0, 200),
    quantity: Math.max(0, Math.floor(asNumber(item?.quantity, 0)))
  })).filter((item) => item.quantity > 0);
  const realtime = asObject(source.realtime);
  const topic = asText(realtime.topic);

  return {
    orderCode: asText(source.orderCode, 'Pedido'),
    status,
    fulfillmentMethod,
    createdAt: asText(source.createdAt),
    updatedAt: asText(source.updatedAt),
    total: Math.max(0, asNumber(source.total, 0)),
    currency: asText(source.currency, 'MXN').toUpperCase().slice(0, 8),
    items,
    publicMessage: asText(source.publicMessage).slice(0, 280),
    version: Math.max(0, Math.floor(asNumber(source.version, 0))),
    paymentRegistered: asBoolean(source.paymentRegistered, false),
    storefrontAvailable: asBoolean(source.storefrontAvailable, false),
    realtime: {
      enabled: asBoolean(realtime.enabled, false) && /^ecom-track:[a-f0-9]{48}$/.test(topic),
      topic: /^ecom-track:[a-f0-9]{48}$/.test(topic) ? topic : ''
    }
  };
}

const fallbackHash = (value) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
};

async function hashCacheIdentity(slug, token) {
  const identity = `${slug}:${token}`;
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return fallbackHash(identity);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity)
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function getCacheKey(slug, token) {
  const identity = await hashCacheIdentity(slug, token);
  return identity ? `lanzo:ecommerce-tracking:${identity}` : null;
}

export async function readTrackingCache(slug, token) {
  try {
    const key = await getCacheKey(normalizeSlug(slug), normalizeToken(token));
    if (!key || !globalThis.sessionStorage) return null;
    const parsed = JSON.parse(globalThis.sessionStorage.getItem(key) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      tracking: normalizeTracking({ tracking: parsed.tracking }),
      cachedAt: Number(parsed.cachedAt) || null
    };
  } catch {
    return null;
  }
}

export async function writeTrackingCache(slug, token, tracking) {
  try {
    const key = await getCacheKey(normalizeSlug(slug), normalizeToken(token));
    if (!key || !globalThis.sessionStorage) return false;
    globalThis.sessionStorage.setItem(key, JSON.stringify({
      tracking: normalizeTracking({ tracking }),
      cachedAt: Date.now()
    }));
    return true;
  } catch {
    return false;
  }
}

export async function clearTrackingCache(slug, token) {
  try {
    const key = await getCacheKey(normalizeSlug(slug), normalizeToken(token));
    if (!key || !globalThis.sessionStorage) return false;
    globalThis.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function createEcommerceOrderTrackingService(client = ecommercePublicClient) {
  return {
    async getTracking(slug, trackingToken) {
      const normalizedSlug = normalizeSlug(slug);
      const normalizedToken = normalizeToken(trackingToken);
      if (!normalizedSlug || !normalizedToken) {
        throw new EcommerceTrackingError('ECOMMERCE_TRACKING_NOT_FOUND', TRACKING_NOT_FOUND_MESSAGE);
      }
      if (!client) {
        throw new EcommerceTrackingError('ECOMMERCE_PUBLIC_CONFIG_MISSING', TRACKING_REQUEST_MESSAGE);
      }

      let response;
      try {
        response = await client.rpc('ecommerce_get_order_tracking', {
          p_slug: normalizedSlug,
          p_tracking_token: normalizedToken
        });
      } catch (error) {
        throw new EcommerceTrackingError('ECOMMERCE_TRACKING_NETWORK_ERROR', TRACKING_REQUEST_MESSAGE, error);
      }

      const { data, error } = response || {};
      if (error) {
        throw new EcommerceTrackingError('ECOMMERCE_TRACKING_NETWORK_ERROR', TRACKING_REQUEST_MESSAGE, error);
      }
      if (data?.success !== true) {
        const code = asText(data?.error?.code, 'ECOMMERCE_TRACKING_NOT_FOUND');
        const message = code === 'ECOMMERCE_TRACKING_NOT_FOUND'
          ? TRACKING_NOT_FOUND_MESSAGE
          : TRACKING_REQUEST_MESSAGE;
        throw new EcommerceTrackingError(code, message);
      }
      return normalizeTracking(data);
    },

    subscribeToSignals({ topic, onSignal } = {}) {
      if (!client || !/^ecom-track:[a-f0-9]{48}$/.test(asText(topic)) || typeof onSignal !== 'function') {
        return () => {};
      }

      const channel = client
        .channel(topic, { config: { private: true, broadcast: { self: false } } })
        .on('broadcast', { event: 'tracking_changed' }, () => onSignal())
        .subscribe();

      return () => {
        try {
          void client.removeChannel(channel);
        } catch {
          // La RPC y el polling siguen siendo la fuente de verdad.
        }
      };
    }
  };
}

const defaultService = createEcommerceOrderTrackingService();
export const getPublicOrderTracking = (slug, token) => defaultService.getTracking(slug, token);
export const subscribeToPublicTrackingSignals = (options) => defaultService.subscribeToSignals(options);

export const ecommerceOrderTrackingInternals = Object.freeze({
  normalizeSlug,
  normalizeToken,
  normalizeTracking,
  hashCacheIdentity,
  fallbackHash
});
