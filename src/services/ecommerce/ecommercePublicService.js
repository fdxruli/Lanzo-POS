import { createClient } from '@supabase/supabase-js';

const PUBLIC_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_CURRENCY = 'MXN';
const STORE_REQUEST_MESSAGE = 'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.';
const CHECKOUT_REQUEST_MESSAGE = 'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.';

const CHECKOUT_ERROR_MESSAGES = {
  ECOMMERCE_ORDERING_DISABLED: 'Este negocio no está recibiendo pedidos por ahora.',
  ECOMMERCE_CUSTOMER_NAME_REQUIRED: 'Escribe tu nombre para continuar.',
  ECOMMERCE_CUSTOMER_PHONE_REQUIRED: 'Escribe un teléfono válido para continuar.',
  ECOMMERCE_INVALID_FULFILLMENT_METHOD: 'Selecciona una modalidad válida para recibir tu pedido.',
  ECOMMERCE_DELIVERY_ADDRESS_REQUIRED: 'Escribe la dirección de entrega para continuar.',
  ECOMMERCE_DELIVERY_NOT_AVAILABLE: 'Este negocio no tiene entrega a domicilio disponible.',
  ECOMMERCE_PICKUP_NOT_AVAILABLE: 'Este negocio no tiene recolección disponible.',
  ECOMMERCE_EMPTY_CART: 'Agrega al menos un producto para continuar.',
  ECOMMERCE_TOO_MANY_ITEMS: 'El pedido tiene demasiados productos distintos.',
  ECOMMERCE_DUPLICATE_PRODUCT: 'El carrito contiene productos repetidos. Actualízalo e intenta nuevamente.',
  ECOMMERCE_PRODUCT_NOT_FOUND: 'Uno de los productos ya no está disponible.',
  ECOMMERCE_PRODUCT_NOT_AVAILABLE: 'Uno de los productos ya no está disponible.',
  ECOMMERCE_INVALID_QUANTITY: 'Revisa las cantidades del carrito.',
  ECOMMERCE_STOCK_LIMIT_EXCEEDED: 'La cantidad solicitada supera la disponibilidad actual.',
  ECOMMERCE_MIN_ORDER_NOT_REACHED: 'El pedido no alcanza el mínimo requerido.',
  ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED: 'No se pudo preparar el envío seguro del pedido.',
  ECOMMERCE_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera unos minutos e intenta nuevamente.',
  ECOMMERCE_DAILY_ORDER_LIMIT_REACHED: 'Este negocio no puede recibir más pedidos por ahora.',
  ECOMMERCE_ORDER_CREATE_FAILED: CHECKOUT_REQUEST_MESSAGE,
  ECOMMERCE_PUBLIC_TIMEOUT: CHECKOUT_REQUEST_MESSAGE,
  ECOMMERCE_PUBLIC_NETWORK_ERROR: CHECKOUT_REQUEST_MESSAGE,
};

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

function withTimeout(promise, {
  timeoutMs = PUBLIC_RPC_TIMEOUT_MS,
  timeoutMessage = STORE_REQUEST_MESSAGE,
} = {}) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new EcommercePublicError('ECOMMERCE_PUBLIC_TIMEOUT', timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => globalThis.clearTimeout(timeoutId));
}

function getCheckoutMessage(code) {
  return CHECKOUT_ERROR_MESSAGES[code] || CHECKOUT_REQUEST_MESSAGE;
}

function normalizeRpcFailure(data, error, operation = 'store') {
  if (error) {
    return new EcommercePublicError(
      'ECOMMERCE_PUBLIC_NETWORK_ERROR',
      operation === 'checkout' ? CHECKOUT_REQUEST_MESSAGE : STORE_REQUEST_MESSAGE,
      error
    );
  }

  const responseError = asObject(data?.error);
  const responseCode = asText(responseError.code, 'ECOMMERCE_PUBLIC_REQUEST_FAILED');

  if (operation === 'checkout') {
    return new EcommercePublicError(responseCode, getCheckoutMessage(responseCode));
  }

  if (responseCode === 'ECOMMERCE_PORTAL_NOT_FOUND') {
    return new EcommercePublicError(responseCode, 'Esta tienda no está disponible.');
  }

  return new EcommercePublicError(responseCode, STORE_REQUEST_MESSAGE);
}

function normalizeFeatures(rawFeatures) {
  const features = asObject(rawFeatures);
  return {
    whatsappCheckout: asBoolean(features.whatsappCheckout, false),
    orderInbox: asBoolean(features.orderInbox, false),
    customSlug: asBoolean(features.customSlug, false),
    brandingCustomization: asText(features.brandingCustomization, 'basic'),
    layoutCustomization: asText(features.layoutCustomization, 'template_only'),
    businessHours: asBoolean(features.businessHours, true),
    deliveryPickupSettings: asText(features.deliveryPickupSettings, 'basic'),
    stockVisibility: asBoolean(features.stockVisibility, false),
    realtimeOrders: asBoolean(features.realtimeOrders, false),
  };
}

function normalizePortalResult(data) {
  const portal = asObject(data.portal);
  const hours = asObject(data.hours);

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
    features: normalizeFeatures(data.features),
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

function normalizeWhatsappUrl(value) {
  const rawUrl = asText(value);
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== 'wa.me'
      || parsed.port
      || parsed.username
      || parsed.password
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeOrderResult(data) {
  const order = asObject(data.order);
  const whatsapp = asObject(data.whatsapp);
  const total = Number(order.total);

  if (asText(order.id) === '' || asText(order.code) === '' || !Number.isFinite(total)) {
    throw new EcommercePublicError('ECOMMERCE_ORDER_CREATE_FAILED', CHECKOUT_REQUEST_MESSAGE);
  }

  return {
    success: true,
    idempotent: asBoolean(data.idempotent, false),
    order: {
      id: asText(order.id),
      code: asText(order.code),
      status: asText(order.status, 'new'),
      total: Number(total.toFixed(2)),
      currency: asText(order.currency, DEFAULT_CURRENCY).toUpperCase(),
      fulfillmentMethod: ['pickup', 'delivery'].includes(order.fulfillmentMethod)
        ? order.fulfillmentMethod
        : 'pickup',
      createdAt: asText(order.createdAt),
    },
    whatsapp: {
      phone: asText(whatsapp.phone),
      message: asText(whatsapp.message),
      url: normalizeWhatsappUrl(whatsapp.url),
    },
  };
}

function normalizeCustomer(customer) {
  const source = asObject(customer);
  const fulfillmentMethod = asText(source.fulfillmentMethod).toLowerCase();

  return {
    name: asText(source.name).slice(0, 120),
    phone: asText(source.phone).slice(0, 40),
    address: fulfillmentMethod === 'delivery' ? asText(source.address).slice(0, 500) : '',
    notes: asText(source.notes).slice(0, 1000),
    fulfillmentMethod,
  };
}

function normalizeOrderItems(items) {
  return asArray(items).map((item) => ({
    productId: asText(item?.productId || item?.product?.id),
    quantity: Number(item?.quantity),
  }));
}

async function executeRpc(client, rpcName, params, operation = 'store') {
  if (!client) {
    throw new EcommercePublicError(
      'ECOMMERCE_PUBLIC_CONFIG_MISSING',
      operation === 'checkout'
        ? 'No se pudo preparar el pedido en este momento.'
        : 'La tienda no está disponible temporalmente.'
    );
  }

  let response;
  try {
    response = await withTimeout(client.rpc(rpcName, params), {
      timeoutMessage: operation === 'checkout' ? CHECKOUT_REQUEST_MESSAGE : STORE_REQUEST_MESSAGE,
    });
  } catch (error) {
    if (error instanceof EcommercePublicError) throw error;
    throw normalizeRpcFailure(null, error, operation);
  }

  const { data, error } = response || {};
  if (error || data?.success !== true) {
    throw normalizeRpcFailure(data, error, operation);
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

    async createPublicOrder(slug, { customer, items, idempotencyKey } = {}) {
      const normalizedSlug = asText(slug);
      const normalizedIdempotencyKey = asText(idempotencyKey).slice(0, 160);
      if (!normalizedSlug) {
        throw new EcommercePublicError('ECOMMERCE_PORTAL_NOT_FOUND', 'Esta tienda no está disponible.');
      }

      const data = await executeRpc(client, 'ecommerce_create_order', {
        p_slug: normalizedSlug,
        p_customer: normalizeCustomer(customer),
        p_items: normalizeOrderItems(items),
        p_idempotency_key: normalizedIdempotencyKey,
      }, 'checkout');

      return normalizeOrderResult(data);
    },
  };
}

const defaultService = createEcommercePublicService();

export const getPublicPortalBySlug = (slug) => defaultService.getPublicPortalBySlug(slug);
export const getPublicCatalog = (slug, options) => defaultService.getPublicCatalog(slug, options);
export const createPublicOrder = (slug, payload) => defaultService.createPublicOrder(slug, payload);
