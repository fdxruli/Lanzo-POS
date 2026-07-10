import { createClient } from '@supabase/supabase-js';

const PUBLIC_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_CURRENCY = 'MXN';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const ecommercePublicClient = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export class EcommercePublicError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'EcommercePublicError';
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

function withTimeout(promise, timeoutMs = PUBLIC_RPC_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new EcommercePublicError(
        'ECOMMERCE_PUBLIC_TIMEOUT',
        'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.'
      ));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => window.clearTimeout(timeoutId));
}

function normalizeRpcFailure(data, error) {
  if (error) {
    return new EcommercePublicError(
      'ECOMMERCE_PUBLIC_NETWORK_ERROR',
      'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.',
      error
    );
  }

  const responseError = asObject(data?.error);
  const responseCode = asText(responseError.code, 'ECOMMERCE_PUBLIC_REQUEST_FAILED');

  if (responseCode === 'ECOMMERCE_PORTAL_NOT_FOUND') {
    return new EcommercePublicError(
      responseCode,
      'Esta tienda no está disponible.'
    );
  }

  return new EcommercePublicError(
    responseCode,
    'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.'
  );
}

function normalizePortalResult(data) {
  const portal = asObject(data.portal);
  const hours = asObject(data.hours);
  const features = asObject(data.features);

  return {
    portal: {
      slug: asText(portal.slug),
      name: asText(portal.name, 'Tienda online'),
      headline: asText(portal.headline),
      description: asText(portal.description),
      templateCode: asText(portal.templateCode, 'classic'),
      customizationLevel: asText(portal.customizationLevel, 'basic'),
      theme: asObject(portal.theme),
      logoUrl: asText(portal.logoUrl),
      coverImageUrl: asText(portal.coverImageUrl),
      whatsappPhone: asText(portal.whatsappPhone),
      address: asText(portal.address),
      businessType: asArray(portal.businessType).filter((item) => typeof item === 'string'),
      orderingEnabled: asBoolean(portal.orderingEnabled, true),
      pickupEnabled: asBoolean(portal.pickupEnabled, false),
      deliveryEnabled: asBoolean(portal.deliveryEnabled, false),
      scheduledOrdersEnabled: asBoolean(portal.scheduledOrdersEnabled, false),
      minOrderTotal: Math.max(0, asNumber(portal.minOrderTotal, 0)),
      maxOrderItems: Math.max(1, Math.floor(asNumber(portal.maxOrderItems, 30))),
      maxItemQuantity: Math.max(1, Math.floor(asNumber(portal.maxItemQuantity, 99))),
      stockMode: asText(portal.stockMode, 'hidden'),
      settings: asObject(portal.settings),
    },
    hours: {
      weekly: asArray(hours.weekly),
      exceptions: asArray(hours.exceptions),
    },
    features,
  };
}

function normalizeCatalogResult(data) {
  const pagination = asObject(data.pagination);
  const items = asArray(data.items).map((rawItem) => {
    const item = asObject(rawItem);
    const stock = asObject(item.stock);
    const stockMode = ['hidden', 'status', 'exact'].includes(stock.mode) ? stock.mode : 'hidden';
    const stockStatus = stock.status === 'available' || stock.status === 'out_of_stock'
      ? stock.status
      : null;

    return {
      id: asText(item.id),
      name: asText(item.name, 'Producto'),
      description: asText(item.description),
      categoryName: asText(item.categoryName),
      price: Math.max(0, asNumber(item.price, 0)),
      currency: asText(item.currency, DEFAULT_CURRENCY).toUpperCase(),
      imageUrl: asText(item.imageUrl),
      isAvailable: asBoolean(item.isAvailable, true),
      displayOrder: asNumber(item.displayOrder, 0),
      stock: {
        mode: stockMode,
        status: stockStatus,
        quantity: stockMode === 'exact' && Number.isFinite(Number(stock.quantity))
          ? Math.max(0, Math.floor(Number(stock.quantity)))
          : null,
      },
      options: asObject(item.options),
    };
  }).filter((item) => item.id);

  return {
    items,
    pagination: {
      limit: Math.min(100, Math.max(1, Math.floor(asNumber(pagination.limit, 100)))),
      offset: Math.max(0, Math.floor(asNumber(pagination.offset, 0))),
      hasMore: asBoolean(pagination.hasMore, false),
    },
  };
}

async function executeRpc(client, rpcName, params) {
  if (!client) {
    throw new EcommercePublicError(
      'ECOMMERCE_PUBLIC_CONFIG_MISSING',
      'La tienda no está disponible temporalmente.'
    );
  }

  let response;
  try {
    response = await withTimeout(client.rpc(rpcName, params));
  } catch (error) {
    if (error instanceof EcommercePublicError) throw error;
    throw normalizeRpcFailure(null, error);
  }

  const { data, error } = response || {};
  if (error || data?.success !== true) {
    throw normalizeRpcFailure(data, error);
  }

  return data;
}

export function createEcommercePublicService(client = ecommercePublicClient) {
  return {
    async getPublicPortalBySlug(slug) {
      const normalizedSlug = asText(slug);
      if (!normalizedSlug) {
        throw new EcommercePublicError('ECOMMERCE_PORTAL_NOT_FOUND', 'Esta tienda no está disponible.');
      }

      const data = await executeRpc(client, 'ecommerce_get_portal_by_slug', {
        p_slug: normalizedSlug,
      });

      return normalizePortalResult(data);
    },

    async getPublicCatalog(slug, options = {}) {
      const normalizedSlug = asText(slug);
      if (!normalizedSlug) {
        throw new EcommercePublicError('ECOMMERCE_PORTAL_NOT_FOUND', 'Esta tienda no está disponible.');
      }

      const limit = Math.min(100, Math.max(1, Math.floor(asNumber(options.limit, 100))));
      const offset = Math.max(0, Math.floor(asNumber(options.offset, 0)));
      const data = await executeRpc(client, 'ecommerce_get_catalog', {
        p_slug: normalizedSlug,
        p_limit: limit,
        p_offset: offset,
      });

      return normalizeCatalogResult(data);
    },
  };
}

const defaultService = createEcommercePublicService();

export const getPublicPortalBySlug = (slug) => defaultService.getPublicPortalBySlug(slug);
export const getPublicCatalog = (slug, options) => defaultService.getPublicCatalog(slug, options);
