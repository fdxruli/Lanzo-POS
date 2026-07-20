import { supabasePublicClient } from '../supabasePublic';
import {
  ECOMMERCE_PUBLIC_CACHE_POLICY,
  ecommercePublicCatalogCache,
  normalizeCachePolicy
} from './ecommercePublicCatalogCache';
import { ecommercePublicConfigurationCache } from './ecommercePublicConfigurationCache';
import {
  buildMinimalConfiguredOrderItem,
  canonicalizeEcommerceSelections,
  normalizePublicProductConfiguration
} from '../../utils/ecommerceConfiguredProduct';
import { normalizeEcommerceSiteDocument } from '../../utils/ecommerceSiteDocument';

const PUBLIC_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_CURRENCY = 'MXN';
const STORE_REQUEST_MESSAGE = 'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.';
const CONFIGURATION_REQUEST_MESSAGE = 'No se pudieron cargar las opciones de este producto.';
const CHECKOUT_REQUEST_MESSAGE = 'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.';
const CONFIGURATION_REVISION_PATTERN = /^[a-f0-9]{64}$/;

const CHECKOUT_ERROR_MESSAGES = Object.freeze({
  ECOMMERCE_ORDERING_DISABLED: 'Este negocio no está recibiendo pedidos por ahora.',
  ECOMMERCE_ORDERS_PAUSED: 'Este negocio pausó temporalmente la recepción de pedidos.',
  ECOMMERCE_STORE_CLOSED: 'Este negocio está cerrado en este momento.',
  ECOMMERCE_SCHEDULE_NOT_CONFIGURED: 'Este negocio no puede recibir pedidos por ahora.',
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
  ECOMMERCE_PRODUCT_UNAVAILABLE: 'Uno de los productos ya no está disponible.',
  ECOMMERCE_INVALID_QUANTITY: 'Revisa las cantidades del carrito.',
  ECOMMERCE_STOCK_LIMIT_EXCEEDED: 'La cantidad solicitada supera la disponibilidad actual.',
  ECOMMERCE_INSUFFICIENT_STOCK: 'La cantidad solicitada supera la disponibilidad actual.',
  ECOMMERCE_MIN_ORDER_NOT_REACHED: 'El pedido no alcanza el mínimo requerido.',
  ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED: 'No se pudo preparar el envío seguro del pedido.',
  ECOMMERCE_IDEMPOTENCY_CONFLICT: CHECKOUT_REQUEST_MESSAGE,
  ECOMMERCE_RATE_LIMITED: 'Se realizaron demasiados intentos. Espera unos minutos e intenta nuevamente.',
  ECOMMERCE_DAILY_ORDER_LIMIT_REACHED: 'Este negocio no puede recibir más pedidos por ahora.',
  ECOMMERCE_CONFIGURATION_REQUIRED: 'Selecciona las opciones requeridas para continuar.',
  ECOMMERCE_VARIANT_REQUIRED: 'Selecciona una variante para continuar.',
  ECOMMERCE_VARIANT_NOT_FOUND: 'La variante seleccionada ya no está disponible.',
  ECOMMERCE_VARIANT_UNAVAILABLE: 'La variante seleccionada ya no está disponible.',
  ECOMMERCE_OPTION_GROUP_REQUIRED: 'Selecciona una opción requerida.',
  ECOMMERCE_OPTION_SELECTION_TOO_FEW: 'Faltan opciones requeridas.',
  ECOMMERCE_OPTION_SELECTION_TOO_MANY: 'Seleccionaste demasiadas opciones.',
  ECOMMERCE_OPTION_NOT_FOUND: 'Una opción seleccionada ya no está disponible.',
  ECOMMERCE_OPTION_UNAVAILABLE: 'Una opción seleccionada ya no está disponible.',
  ECOMMERCE_CONFIGURATION_INVALID: 'Revisa la configuración del producto.',
  ECOMMERCE_CONFIGURATION_CHANGED: 'La configuración del producto cambió. Vuelve a seleccionarla.',
  ECOMMERCE_ORDER_CREATE_FAILED: CHECKOUT_REQUEST_MESSAGE,
  ECOMMERCE_PUBLIC_TIMEOUT: CHECKOUT_REQUEST_MESSAGE,
  ECOMMERCE_PUBLIC_NETWORK_ERROR: CHECKOUT_REQUEST_MESSAGE
});

export const ecommercePublicClient = supabasePublicClient;

export class EcommercePublicError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'EcommercePublicError';
    this.code = code;
    this.cause = cause;
  }
}

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const asBoolean = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asRevision = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const asConfigurationRevision = (value) => {
  const revision = asText(value).toLowerCase();
  return CONFIGURATION_REVISION_PATTERN.test(revision) ? revision : '';
};

function withTimeout(promise, {
  timeoutMs = PUBLIC_RPC_TIMEOUT_MS,
  timeoutMessage = STORE_REQUEST_MESSAGE
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

function getSafeMessage(code, operation) {
  if (operation === 'checkout') return CHECKOUT_ERROR_MESSAGES[code] || CHECKOUT_REQUEST_MESSAGE;
  if (operation === 'configuration') {
    if (code === 'ECOMMERCE_PRODUCT_NOT_FOUND') return 'Este producto ya no está disponible.';
    if (code === 'ECOMMERCE_RATE_LIMITED') return 'Espera unos minutos antes de volver a cargar las opciones.';
    return CONFIGURATION_REQUEST_MESSAGE;
  }
  if (code === 'ECOMMERCE_PORTAL_NOT_FOUND') return 'Esta tienda no está disponible.';
  if (code === 'ECOMMERCE_CATALOG_REVISION_CHANGED') {
    return 'El catálogo cambió mientras se cargaba. Se actualizará automáticamente.';
  }
  return STORE_REQUEST_MESSAGE;
}

function normalizeRpcFailure(data, error, operation = 'store') {
  if (error) {
    return new EcommercePublicError(
      'ECOMMERCE_PUBLIC_NETWORK_ERROR',
      operation === 'checkout'
        ? CHECKOUT_REQUEST_MESSAGE
        : operation === 'configuration'
          ? CONFIGURATION_REQUEST_MESSAGE
          : STORE_REQUEST_MESSAGE,
      error
    );
  }
  const responseError = asObject(data?.error);
  const code = asText(responseError.code, 'ECOMMERCE_PUBLIC_REQUEST_FAILED');
  return new EcommercePublicError(code, getSafeMessage(code, operation));
}

function normalizeFeatures(rawFeatures) {
  const features = asObject(rawFeatures);
  return {
    whatsappCheckout: asBoolean(features.whatsappCheckout, false),
    orderInbox: asBoolean(features.orderInbox, false),
    customSlug: asBoolean(features.customSlug, false),
    brandingCustomization: typeof features.brandingCustomization === 'boolean'
      ? features.brandingCustomization
      : asText(features.brandingCustomization, 'basic'),
    layoutCustomization: typeof features.layoutCustomization === 'boolean'
      ? features.layoutCustomization
      : asText(features.layoutCustomization, 'template_only'),
    businessHours: asBoolean(features.businessHours, true),
    deliveryPickupSettings: typeof features.deliveryPickupSettings === 'boolean'
      ? features.deliveryPickupSettings
      : asText(features.deliveryPickupSettings, 'basic'),
    stockVisibility: asBoolean(features.stockVisibility, false),
    realtimeOrders: asBoolean(features.realtimeOrders, false)
  };
}

const AVAILABILITY_CODES = new Set([
  'OPEN',
  'ORDERING_DISABLED',
  'ORDERS_PAUSED',
  'OUTSIDE_BUSINESS_HOURS',
  'SCHEDULE_NOT_CONFIGURED',
  'PORTAL_NOT_PUBLISHED'
]);
const SCHEDULE_SOURCES = new Set(['exception', 'weekly', 'disabled', 'missing']);

function normalizeAvailability(rawAvailability, portal, isPresent) {
  if (!isPresent) {
    const acceptingOrders = asBoolean(portal.orderingEnabled, true);
    return {
      acceptingOrders,
      code: acceptingOrders ? 'OPEN' : 'ORDERING_DISABLED',
      timezone: 'America/Mexico_City',
      evaluatedAt: '',
      localDate: '',
      opensAt: '',
      closesAt: '',
      nextOpenAt: '',
      nextCloseAt: '',
      nextChangeAt: '',
      pauseReason: '',
      pauseUntil: '',
      scheduleSource: 'disabled',
      legacy: true
    };
  }
  const value = asObject(rawAvailability);
  const code = asText(value.code);
  const timezone = asText(value.timezone);
  const valid = typeof value.acceptingOrders === 'boolean'
    && AVAILABILITY_CODES.has(code)
    && Boolean(timezone);
  return {
    acceptingOrders: valid ? value.acceptingOrders === true : false,
    code: AVAILABILITY_CODES.has(code) ? code : 'SCHEDULE_NOT_CONFIGURED',
    timezone: timezone || 'America/Mexico_City',
    evaluatedAt: asText(value.evaluatedAt),
    localDate: /^\d{4}-\d{2}-\d{2}$/.test(asText(value.localDate))
      ? asText(value.localDate)
      : '',
    opensAt: asText(value.opensAt),
    closesAt: asText(value.closesAt),
    nextOpenAt: asText(value.nextOpenAt),
    nextCloseAt: asText(value.nextCloseAt),
    nextChangeAt: asText(value.nextChangeAt),
    pauseReason: asText(value.pauseReason),
    pauseUntil: asText(value.pauseUntil),
    scheduleSource: SCHEDULE_SOURCES.has(value.scheduleSource)
      ? value.scheduleSource
      : 'missing',
    legacy: false
  };
}

function normalizePortalResult(data) {
  const portal = asObject(data.portal);
  const hours = asObject(data.hours);
  const normalizedPortal = {
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
    settings: asObject(portal.settings)
  };
  const rawSite = asObject(data.site);
  const siteVersionNumber = asRevision(rawSite.versionNumber);
  return {
    portal: normalizedPortal,
    hours: {
      weekly: asArray(hours.weekly),
      exceptions: asArray(hours.exceptions)
    },
    features: normalizeFeatures(data.features),
    availability: normalizeAvailability(
      data.availability,
      normalizedPortal,
      Object.prototype.hasOwnProperty.call(data, 'availability')
    ),
    catalogRevision: asRevision(data.catalogRevision),
    cachePolicy: normalizeCachePolicy(data.cachePolicy || ECOMMERCE_PUBLIC_CACHE_POLICY),
    site: {
      schemaVersion: 1,
      versionId: asText(rawSite.versionId),
      versionNumber: siteVersionNumber,
      documentMode: rawSite.documentMode === 'custom' ? 'custom' : 'default',
      document: normalizeEcommerceSiteDocument(rawSite.document, { templateCode: normalizedPortal.templateCode })
    }
  };
}

function normalizeCatalogConfiguration(raw) {
  const source = asObject(raw);
  return {
    type: ['simple', 'recipe', 'variant_parent', 'configurable'].includes(source.type)
      ? source.type
      : 'simple',
    version: Math.max(1, Math.floor(asNumber(source.version, 1))),
    hasVariants: source.hasVariants === true,
    hasOptionGroups: source.hasOptionGroups === true,
    requiresConfiguration: source.requiresConfiguration === true
  };
}

function normalizeCatalogResult(data, expectedRevision = null) {
  const pagination = asObject(data.pagination);
  const items = asArray(data.items).map((rawItem) => {
    const item = asObject(rawItem);
    const stock = asObject(item.stock);
    const stockMode = ['hidden', 'status', 'exact'].includes(stock.mode)
      ? stock.mode
      : 'hidden';
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
      configuration: normalizeCatalogConfiguration(item.configuration),
      stock: {
        mode: stockMode,
        status: ['available', 'out_of_stock'].includes(stock.status) ? stock.status : null,
        quantity: stockMode === 'exact' && Number.isFinite(Number(stock.quantity))
          ? Math.max(0, Math.floor(Number(stock.quantity)))
          : null
      },
      options: asObject(item.options)
    };
  }).filter((item) => item.id);
  return {
    catalogRevision: asRevision(data.catalogRevision, asRevision(expectedRevision)),
    items,
    pagination: {
      limit: Math.min(100, Math.max(1, Math.floor(asNumber(pagination.limit, 100)))),
      offset: Math.max(0, Math.floor(asNumber(pagination.offset, 0))),
      hasMore: asBoolean(pagination.hasMore, false)
    }
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
    ) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeTrackingPath(value) {
  const path = asText(value);
  return /^\/tienda\/[^/?#]+\/pedido\/trk1_[A-Za-z0-9_-]{43}$/.test(path) ? path : '';
}

function normalizeOrderResult(data) {
  const order = asObject(data.order);
  const whatsapp = asObject(data.whatsapp);
  const total = Number(order.total);
  if (!asText(order.id) || !asText(order.code) || !Number.isFinite(total)) {
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
      trackingToken: /^trk1_[A-Za-z0-9_-]{43}$/.test(asText(order.trackingToken))
        ? asText(order.trackingToken)
        : '',
      trackingPath: normalizeTrackingPath(order.trackingPath)
    },
    whatsapp: {
      phone: asText(whatsapp.phone),
      message: asText(whatsapp.message),
      url: normalizeWhatsappUrl(whatsapp.url)
    }
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
    fulfillmentMethod
  };
}

function normalizeOrderItems(items) {
  return asArray(items).map(buildMinimalConfiguredOrderItem).map((item) => {
    const productId = asText(item.productId);
    const quantity = Number(item.quantity);
    const configured = Boolean(
      item.variantId
      || asArray(item.selections).length
      || asConfigurationRevision(item.configurationRevision)
    );
    if (!configured) return { productId, quantity };

    const configurationRevision = asConfigurationRevision(item.configurationRevision);
    return {
      productId,
      quantity,
      ...(item.variantId ? { variantId: asText(item.variantId) } : {}),
      ...(asArray(item.selections).length ? {
        selections: canonicalizeEcommerceSelections(item.selections)
      } : {}),
      configurationVersion: Math.max(1, Math.floor(Number(item.configurationVersion) || 1)),
      configurationRevision
    };
  });
}

async function executeRpc(client, rpcName, params, operation = 'store') {
  if (!client?.rpc) {
    throw new EcommercePublicError(
      'ECOMMERCE_PUBLIC_CONFIG_MISSING',
      getSafeMessage('', operation)
    );
  }
  let response;
  try {
    response = await withTimeout(client.rpc(rpcName, params), {
      timeoutMessage: operation === 'checkout'
        ? CHECKOUT_REQUEST_MESSAGE
        : operation === 'configuration'
          ? CONFIGURATION_REQUEST_MESSAGE
          : STORE_REQUEST_MESSAGE
    });
  } catch (error) {
    if (error instanceof EcommercePublicError) throw error;
    throw normalizeRpcFailure(null, error, operation);
  }
  const { data, error } = response || {};
  if (error || data?.success !== true) throw normalizeRpcFailure(data, error, operation);
  return data;
}

const isLegacyCatalogSignatureError = (error) => {
  const code = asText(error?.cause?.code || error?.code);
  const message = asText(error?.cause?.message).toLowerCase();
  return code === 'PGRST202'
    || code === '42883'
    || (message.includes('ecommerce_get_catalog') && message.includes('function'));
};
const safely = async (operation, fallback = null) => {
  try {
    return await operation();
  } catch {
    return fallback;
  }
};

export function createEcommercePublicService(
  client = ecommercePublicClient,
  {
    cache = ecommercePublicCatalogCache,
    configurationCache = ecommercePublicConfigurationCache
  } = {}
) {
  return {
    async getPublicPortalBySlug(slug, options = {}) {
      const normalizedSlug = asText(slug).toLowerCase();
      if (!normalizedSlug) {
        throw new EcommercePublicError(
          'ECOMMERCE_PORTAL_NOT_FOUND',
          'Esta tienda no está disponible.'
        );
      }
      try {
        const data = await executeRpc(client, 'ecommerce_get_portal_by_slug', {
          p_slug: normalizedSlug
        });
        const result = normalizePortalResult(data);
        if (cache && options.cache !== false && result.catalogRevision) {
          void safely(() => cache.putPortal({ slug: normalizedSlug, result }));
          void safely(() => cache.deleteObsoleteRevisions({
            slug: normalizedSlug,
            keepRevision: result.catalogRevision
          }));
          void safely(() => cache.cleanup());
        }
        return { ...result, source: 'network', offline: false };
      } catch (error) {
        if (
          !cache
          || options.cache === false
          || error?.code === 'ECOMMERCE_PORTAL_NOT_FOUND'
        ) throw error;
        const cached = await safely(() => cache.getPortal({
          slug: normalizedSlug,
          maxStaleSeconds: options.maxStaleSeconds
            || ECOMMERCE_PUBLIC_CACHE_POLICY.maxStaleSeconds
        }));
        if (!cached) throw error;
        return { ...cached, source: 'cache', offline: true };
      }
    },

    async getPublicCatalog(slug, options = {}) {
      const normalizedSlug = asText(slug).toLowerCase();
      if (!normalizedSlug) {
        throw new EcommercePublicError(
          'ECOMMERCE_PORTAL_NOT_FOUND',
          'Esta tienda no está disponible.'
        );
      }
      const limit = Math.min(100, Math.max(1, Math.floor(asNumber(options.limit, 100))));
      const offset = Math.max(0, Math.floor(asNumber(options.offset, 0)));
      const catalogRevision = asRevision(options.catalogRevision);
      const cachePolicy = normalizeCachePolicy(
        options.cachePolicy || ECOMMERCE_PUBLIC_CACHE_POLICY
      );
      if (cache && options.cache !== false && catalogRevision) {
        const cached = await safely(() => cache.getPage({
          slug: normalizedSlug,
          catalogRevision,
          offset,
          limit,
          cachePolicy,
          allowStale: true
        }));
        if (cached) {
          return {
            ...cached.page,
            source: 'cache',
            offline: options.offline === true,
            cacheFresh: cached.fresh,
            cacheAgeSeconds: cached.ageSeconds
          };
        }
      }
      const params = { p_slug: normalizedSlug, p_limit: limit, p_offset: offset };
      if (catalogRevision) params.p_catalog_revision = catalogRevision;
      try {
        let data;
        try {
          data = await executeRpc(client, 'ecommerce_get_catalog', params);
        } catch (error) {
          if (!catalogRevision || !isLegacyCatalogSignatureError(error)) throw error;
          data = await executeRpc(client, 'ecommerce_get_catalog', {
            p_slug: normalizedSlug,
            p_limit: limit,
            p_offset: offset
          });
        }
        const result = normalizeCatalogResult(data, catalogRevision);
        if (catalogRevision && result.catalogRevision !== catalogRevision) {
          throw new EcommercePublicError(
            'ECOMMERCE_CATALOG_REVISION_CHANGED',
            'El catálogo cambió mientras se cargaba. Se actualizará automáticamente.'
          );
        }
        if (cache && options.cache !== false && result.catalogRevision) {
          void safely(() => cache.putPage({
            slug: normalizedSlug,
            catalogRevision: result.catalogRevision,
            offset,
            limit,
            cachePolicy,
            page: result
          }));
          void safely(() => cache.cleanup());
        }
        return { ...result, source: 'network', offline: false };
      } catch (error) {
        if (!cache || options.cache === false || !catalogRevision) throw error;
        const cached = await safely(() => cache.getPage({
          slug: normalizedSlug,
          catalogRevision,
          offset,
          limit,
          cachePolicy,
          allowStale: true
        }));
        if (!cached) throw error;
        return {
          ...cached.page,
          source: 'cache',
          offline: true,
          cacheFresh: cached.fresh,
          cacheAgeSeconds: cached.ageSeconds
        };
      }
    },

    async getPublicProductConfiguration(slug, options = {}) {
      const normalizedSlug = asText(slug).toLowerCase();
      const productId = asText(options.productId);
      const catalogRevision = asRevision(options.catalogRevision);
      const configurationVersion = asRevision(options.configurationVersion);
      if (!normalizedSlug || !productId) {
        throw new EcommercePublicError(
          'ECOMMERCE_PRODUCT_NOT_FOUND',
          'Este producto ya no está disponible.'
        );
      }
      const key = configurationCache.buildKey({
        slug: normalizedSlug,
        productId,
        catalogRevision,
        configurationVersion
      });
      const cached = configurationCache.get(key, { allowStale: options.offline === true });
      if (cached && (cached.fresh || options.offline === true)) {
        return { ...cached.value, source: 'cache', offline: options.offline === true };
      }
      if (options.offline === true) {
        throw new EcommercePublicError(
          'ECOMMERCE_PUBLIC_NETWORK_ERROR',
          'Conéctate para confirmar las opciones vigentes de este producto.'
        );
      }
      return configurationCache.dedupe(key, async () => {
        try {
          const data = await executeRpc(client, 'ecommerce_get_product_configuration', {
            p_slug: normalizedSlug,
            p_product_id: productId
          }, 'configuration');
          const result = normalizePublicProductConfiguration(data);
          const configured = result.product.hasVariants
            || result.product.hasOptionGroups
            || result.product.requiresConfiguration;
          if (!result.product.id || result.product.id !== productId) {
            throw new EcommercePublicError(
              'ECOMMERCE_CONFIGURATION_INVALID',
              CONFIGURATION_REQUEST_MESSAGE
            );
          }
          if (configured && !result.product.configurationRevision) {
            throw new EcommercePublicError(
              'ECOMMERCE_CONFIGURATION_CHANGED',
              'La configuración cambió. Actualiza el catálogo.'
            );
          }
          if (
            catalogRevision
            && result.catalogRevision
            && result.catalogRevision !== catalogRevision
          ) {
            throw new EcommercePublicError(
              'ECOMMERCE_CONFIGURATION_CHANGED',
              'La configuración cambió. Actualiza el catálogo.'
            );
          }
          if (
            configurationVersion
            && result.product.configurationVersion !== configurationVersion
          ) {
            throw new EcommercePublicError(
              'ECOMMERCE_CONFIGURATION_CHANGED',
              'La configuración cambió. Actualiza el catálogo.'
            );
          }
          configurationCache.put(key, result);
          configurationCache.deleteObsolete({
            slug: normalizedSlug,
            productId,
            keepCatalogRevision: result.catalogRevision || catalogRevision,
            keepConfigurationVersion: result.product.configurationVersion,
            keepConfigurationRevision: result.product.configurationRevision
          });
          return { ...result, source: 'network', offline: false };
        } catch (error) {
          const stale = configurationCache.get(key, { allowStale: true });
          if (stale && options.allowStale === true) {
            return { ...stale.value, source: 'cache', offline: true };
          }
          throw error;
        }
      });
    },

    async createPublicOrder(slug, { customer, items, idempotencyKey } = {}) {
      const normalizedSlug = asText(slug);
      const normalizedIdempotencyKey = asText(idempotencyKey).slice(0, 160);
      if (!normalizedSlug) {
        throw new EcommercePublicError(
          'ECOMMERCE_PORTAL_NOT_FOUND',
          'Esta tienda no está disponible.'
        );
      }
      const data = await executeRpc(client, 'ecommerce_create_order', {
        p_slug: normalizedSlug,
        p_customer: normalizeCustomer(customer),
        p_items: normalizeOrderItems(items),
        p_idempotency_key: normalizedIdempotencyKey
      }, 'checkout');
      return normalizeOrderResult(data);
    }
  };
}

const defaultService = createEcommercePublicService();
export const getPublicPortalBySlug = (slug, options) => (
  defaultService.getPublicPortalBySlug(slug, options)
);
export const getPublicCatalog = (slug, options) => (
  defaultService.getPublicCatalog(slug, options)
);
export const getPublicProductConfiguration = (slug, options) => (
  defaultService.getPublicProductConfiguration(slug, options)
);
export const createPublicOrder = (slug, payload) => defaultService.createPublicOrder(slug, payload);

export const ecommercePublicServiceInternals = Object.freeze({
  normalizePortalResult,
  normalizeAvailability,
  normalizeCatalogResult,
  normalizeCatalogConfiguration,
  normalizeOrderResult,
  normalizeRpcFailure,
  normalizeOrderItems,
  isLegacyCatalogSignatureError
});
