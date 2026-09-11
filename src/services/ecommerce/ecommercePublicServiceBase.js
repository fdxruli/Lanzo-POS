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
import {
  formatEcommerceDeliveryAddress,
  isEcommerceDeliveryAddressRecord,
  normalizeEcommerceDeliveryAddress
} from '../../utils/ecommerceDeliveryAddress';
import { normalizeEcommerceSiteDocument } from '../../utils/ecommerceSiteDocument';

const PUBLIC_RPC_TIMEOUT_MS = 12_000;
const PUBLIC_READ_MAX_ATTEMPTS = 2;
const PUBLIC_READ_RETRY_DELAY_MS = 120;
const DEFAULT_CURRENCY = 'MXN';
const STORE_REQUEST_MESSAGE = 'No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.';
const CONFIGURATION_REQUEST_MESSAGE = 'No se pudieron cargar las opciones de este producto.';
const CHECKOUT_REQUEST_MESSAGE = 'No pudimos confirmar el pedido. Inténtalo nuevamente más tarde.';
const CHECKOUT_NETWORK_MESSAGE = 'No hay conexión con el servidor. Revisa tu conexión e inténtalo nuevamente.';
const CHECKOUT_AUTH_MESSAGE = 'Tu sesión no está autorizada para confirmar este pedido. Recarga la tienda e inténtalo nuevamente.';
const CHECKOUT_VALIDATION_MESSAGE = 'Revisa la información del pedido e inténtalo nuevamente.';
const CHECKOUT_CONFLICT_MESSAGE = 'El pedido ya está siendo procesado o ya fue registrado. Verifica tus pedidos antes de intentarlo nuevamente.';
const CHECKOUT_SERVER_MESSAGE = 'No pudimos procesar el pedido en este momento. Inténtalo nuevamente más tarde.';
const CONFIGURATION_REVISION_PATTERN = /^[a-f0-9]{64}$/;

const STOCK_INSUFFICIENT_CODES = new Set([
  'STOCK_INSUFFICIENT',
  'ECOMMERCE_INSUFFICIENT_STOCK',
  'ECOMMERCE_STOCK_LIMIT_EXCEEDED'
]);
const STOCK_UNAVAILABLE_CODES = new Set([
  'ECOMMERCE_PRODUCT_NOT_AVAILABLE',
  'ECOMMERCE_PRODUCT_UNAVAILABLE',
  'ECOMMERCE_VARIANT_UNAVAILABLE'
]);
const CHECKOUT_VALIDATION_CODES = new Set([
  'ECOMMERCE_CUSTOMER_NAME_REQUIRED',
  'ECOMMERCE_CUSTOMER_PHONE_REQUIRED',
  'ECOMMERCE_INVALID_FULFILLMENT_METHOD',
  'ECOMMERCE_DELIVERY_ADDRESS_REQUIRED',
  'ECOMMERCE_DELIVERY_STREET_REQUIRED',
  'ECOMMERCE_DELIVERY_NEIGHBORHOOD_REQUIRED',
  'ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED',
  'ECOMMERCE_DELIVERY_STATE_REQUIRED',
  'ECOMMERCE_DELIVERY_POSTAL_CODE_REQUIRED',
  'ECOMMERCE_DELIVERY_POSTAL_CODE_INVALID',
  'ECOMMERCE_DELIVERY_ADDRESS_INVALID',
  'ECOMMERCE_EMPTY_CART',
  'ECOMMERCE_INVALID_QUANTITY',
  'ECOMMERCE_CONFIGURATION_REQUIRED',
  'ECOMMERCE_VARIANT_REQUIRED',
  'ECOMMERCE_OPTION_GROUP_REQUIRED',
  'ECOMMERCE_OPTION_SELECTION_TOO_FEW',
  'ECOMMERCE_OPTION_SELECTION_TOO_MANY',
  'ECOMMERCE_CONFIGURATION_INVALID'
]);
const CHECKOUT_CONFLICT_CODES = new Set([
  'ECOMMERCE_IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'ORDER_ALREADY_PROCESSING'
]);
const GENERIC_POSTGREST_CODES = new Set([
  'P0001',
  'PGRST001',
  'PGRST003',
  'PGRST301',
  'PGRST302'
]);

const CHECKOUT_ERROR_MESSAGES = Object.freeze({
  ECOMMERCE_ORDERING_DISABLED: 'Este negocio no está recibiendo pedidos por ahora.',
  ECOMMERCE_ORDERS_PAUSED: 'Este negocio pausó temporalmente la recepción de pedidos.',
  ECOMMERCE_STORE_CLOSED: 'Este negocio está cerrado en este momento.',
  ECOMMERCE_SCHEDULE_NOT_CONFIGURED: 'Este negocio no puede recibir pedidos por ahora.',
  ECOMMERCE_CUSTOMER_NAME_REQUIRED: 'Escribe tu nombre para continuar.',
  ECOMMERCE_CUSTOMER_PHONE_REQUIRED: 'Escribe un teléfono válido para continuar.',
  ECOMMERCE_INVALID_FULFILLMENT_METHOD: 'Selecciona una modalidad válida para recibir tu pedido.',
  ECOMMERCE_DELIVERY_ADDRESS_REQUIRED: 'Escribe la dirección de entrega para continuar.',
  ECOMMERCE_DELIVERY_STREET_REQUIRED: 'Escribe la calle, avenida o camino de entrega.',
  ECOMMERCE_DELIVERY_NEIGHBORHOOD_REQUIRED: 'Escribe la colonia, barrio, ejido o localidad.',
  ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED: 'Escribe el municipio o ciudad de entrega.',
  ECOMMERCE_DELIVERY_STATE_REQUIRED: 'Escribe el estado de entrega.',
  ECOMMERCE_DELIVERY_POSTAL_CODE_REQUIRED: 'Escribe el código postal de entrega.',
  ECOMMERCE_DELIVERY_POSTAL_CODE_INVALID: 'Escribe un código postal válido de 5 dígitos.',
  ECOMMERCE_DELIVERY_ADDRESS_INVALID: 'Revisa los datos de la dirección de entrega.',
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
  ECOMMERCE_IDEMPOTENCY_CONFLICT: CHECKOUT_CONFLICT_MESSAGE,
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
  ECOMMERCE_ORDER_CREATE_FAILED: CHECKOUT_SERVER_MESSAGE,
  ECOMMERCE_PUBLIC_TIMEOUT: CHECKOUT_NETWORK_MESSAGE,
  ECOMMERCE_PUBLIC_NETWORK_ERROR: CHECKOUT_NETWORK_MESSAGE
});

export const ecommercePublicClient = supabasePublicClient;

export class EcommercePublicError extends Error {
  constructor(code, message, cause = null, metadata = {}) {
    super(message);
    this.name = 'EcommercePublicError';
    this.code = code;
    this.cause = cause;
    Object.assign(this, asObject(metadata));
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

const asHttpStatus = (value) => {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
};
const parseStructuredValue = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    return asObject(JSON.parse(value));
  } catch {
    return {};
  }
};
const asKnownDomainCode = (value) => {
  const code = asText(value).toUpperCase();
  if (!code || GENERIC_POSTGREST_CODES.has(code)) return '';
  return /^[A-Z][A-Z0-9_]{2,127}$/.test(code) ? code : '';
};
const isKnownCheckoutCode = (code) => (
  STOCK_INSUFFICIENT_CODES.has(code)
  || STOCK_UNAVAILABLE_CODES.has(code)
  || CHECKOUT_VALIDATION_CODES.has(code)
  || CHECKOUT_CONFLICT_CODES.has(code)
  || Object.prototype.hasOwnProperty.call(CHECKOUT_ERROR_MESSAGES, code)
);

function getCheckoutFailureDetails(data, error) {
  const response = asObject(data);
  const responseError = asObject(response.error);
  const transport = asObject(error);
  const transportBody = parseStructuredValue(transport.body);
  const transportDetails = parseStructuredValue(transport.details);
  const candidates = [
    responseError,
    parseStructuredValue(responseError.details),
    response,
    transportBody,
    transportDetails,
    transport
  ];
  const code = candidates
    .map((candidate) => asKnownDomainCode(candidate.code || candidate.errorCode))
    .find(Boolean)
    || (() => {
      const fallback = asText(transport.message).toUpperCase();
      return isKnownCheckoutCode(fallback) ? fallback : '';
    })();
  const status = candidates
    .map((candidate) => asHttpStatus(candidate.status || candidate.statusCode))
    .find(Boolean)
    || null;
  const available = candidates
    .map((candidate) => candidate.availableQuantity ?? candidate.available_quantity ?? candidate.available)
    .map((value) => Number(value))
    .find((value) => Number.isSafeInteger(value) && value >= 0);
  return { code, status, available: available ?? null, responseError, transport };
}

function isNetworkFailure(error, status) {
  if (status) return false;
  const source = asObject(error);
  if (source.name === 'AbortError' || source.name === 'TypeError') return true;
  const message = asText(source.message).toLowerCase();
  return /(?:failed to fetch|fetch failed|network(?:\s+request)?\s+failed|network error|connection closed|err_connection_closed|timeout|timed out|offline)/iu.test(message);
}

function createCheckoutError(code, message, cause, metadata = {}) {
  return new EcommercePublicError(code, message, cause, {
    retryable: false,
    preserveCart: true,
    action: 'review_order',
    ...metadata
  });
}

function normalizeCheckoutFailure(data, error) {
  const details = getCheckoutFailureDetails(data, error);
  const { code, status, available } = details;

  if (STOCK_INSUFFICIENT_CODES.has(code)) {
    const userMessage = available === 0
      ? 'Este producto ya no está disponible. Actualiza tu carrito e inténtalo nuevamente.'
      : Number.isSafeInteger(available)
        ? `No hay existencias suficientes para la cantidad solicitada. Disponibles: ${available}.`
        : 'No hay existencias suficientes para la cantidad solicitada.';
    return createCheckoutError(code, userMessage, error || data, {
      category: 'business',
      availableQuantity: available,
      action: 'adjust_quantity'
    });
  }

  if (STOCK_UNAVAILABLE_CODES.has(code)) {
    return createCheckoutError(code, 'Este producto ya no está disponible. Actualiza tu carrito e inténtalo nuevamente.', error || data, {
      category: 'business',
      availableQuantity: available,
      action: 'adjust_quantity'
    });
  }

  if (status === 401 || status === 403) {
    return createCheckoutError(code || 'ECOMMERCE_PUBLIC_AUTH_ERROR', CHECKOUT_AUTH_MESSAGE, error || data, {
      category: 'auth',
      status,
      action: 'refresh_store'
    });
  }

  if (status === 409 || CHECKOUT_CONFLICT_CODES.has(code)) {
    return createCheckoutError(code || 'ECOMMERCE_IDEMPOTENCY_CONFLICT', CHECKOUT_CONFLICT_MESSAGE, error || data, {
      category: 'conflict',
      status,
      action: 'check_orders'
    });
  }

  if (status && status >= 500) {
    return createCheckoutError(code || 'ECOMMERCE_PUBLIC_SERVER_ERROR', CHECKOUT_SERVER_MESSAGE, error || data, {
      category: 'server',
      status,
      retryable: true,
      action: 'retry_later'
    });
  }

  if (status === 400 || status === 422) {
    return createCheckoutError(code || 'ECOMMERCE_PUBLIC_VALIDATION_ERROR', CHECKOUT_VALIDATION_MESSAGE, error || data, {
      category: 'validation',
      status,
      action: 'review_order'
    });
  }

  if (CHECKOUT_VALIDATION_CODES.has(code)) {
    return createCheckoutError(code, getSafeMessage(code, 'checkout'), error || data, {
      category: 'validation'
    });
  }

  if (code && Object.prototype.hasOwnProperty.call(CHECKOUT_ERROR_MESSAGES, code)) {
    return createCheckoutError(code, getSafeMessage(code, 'checkout'), error || data, {
      category: 'business'
    });
  }

  if (isNetworkFailure(error, status)) {
    return createCheckoutError('ECOMMERCE_PUBLIC_NETWORK_ERROR', CHECKOUT_NETWORK_MESSAGE, error, {
      category: 'network',
      retryable: true,
      action: 'retry_connection'
    });
  }

  return createCheckoutError(code || 'ECOMMERCE_PUBLIC_REQUEST_FAILED', CHECKOUT_REQUEST_MESSAGE, error || data, {
    category: 'unknown',
    status
  });
}

function normalizeRpcFailure(data, error, operation = 'store') {
  if (operation === 'checkout') return normalizeCheckoutFailure(data, error);
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
    contactEmail: asText(portal.contactEmail),
    address: asText(portal.address),
    addressStreet: asText(portal.addressStreet),
    addressNeighborhood: asText(portal.addressNeighborhood),
    addressMunicipality: asText(portal.addressMunicipality),
    addressState: asText(portal.addressState),
    addressPostalCode: asText(portal.addressPostalCode),
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
  const siteSchemaVersion = Number(rawSite.schemaVersion) === 1 ? 1 : 2;
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
      schemaVersion: siteSchemaVersion,
      versionId: asText(rawSite.versionId),
      versionNumber: siteVersionNumber,
      documentMode: rawSite.documentMode === 'custom' ? 'custom' : 'default',
      document: siteSchemaVersion === 1 ? rawSite.document : normalizeEcommerceSiteDocument(rawSite.document, {
        templateCode: normalizedPortal.templateCode, theme: normalizedPortal.theme,
        logoUrl: normalizedPortal.logoUrl, coverImageUrl: normalizedPortal.coverImageUrl
      })
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
      wholesaleEnabled: item.wholesaleEnabled === true,
      wholesaleTiers: asArray(item.wholesaleTiers).map((tier) => ({
        sourceTierRef: asText(tier?.sourceTierRef),
        minQuantity: Math.max(1, Math.floor(asNumber(tier?.minQuantity, 1))),
        unitPrice: Math.max(0, asNumber(tier?.unitPrice, 0))
      })).sort((left, right) => left.minQuantity - right.minQuantity),
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
  const hasStructuredAddress = Object.prototype.hasOwnProperty.call(source, 'deliveryAddress');
  const deliveryAddress = fulfillmentMethod === 'delivery' && hasStructuredAddress
    ? (isEcommerceDeliveryAddressRecord(source.deliveryAddress)
      ? normalizeEcommerceDeliveryAddress(source.deliveryAddress)
      : null)
    : null;
  return {
    name: asText(source.name).slice(0, 120),
    phone: asText(source.phone).slice(0, 40),
    address: fulfillmentMethod === 'delivery'
      ? deliveryAddress
        ? formatEcommerceDeliveryAddress(deliveryAddress)
        : asText(source.address).slice(0, 500)
      : '',
    notes: asText(source.notes).slice(0, 1000),
    fulfillmentMethod,
    ...(fulfillmentMethod === 'delivery' && hasStructuredAddress
      ? { deliveryAddress }
      : {})
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
        ? CHECKOUT_NETWORK_MESSAGE
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

function isTransientPublicReadError(error) {
  if (['ECOMMERCE_PUBLIC_NETWORK_ERROR', 'ECOMMERCE_PUBLIC_TIMEOUT'].includes(error?.code)) {
    return true;
  }
  const message = asText(error?.cause?.message || error?.message).toLowerCase();
  return /(?:connection closed|fetch failed|network error|network request failed|timeout)/iu.test(message);
}

const waitForPublicReadRetry = (delayMs) => new Promise((resolve) => {
  globalThis.setTimeout(resolve, delayMs);
});

async function executePublicReadRpc(client, rpcName, params, {
  retryDelayMs = PUBLIC_READ_RETRY_DELAY_MS,
  retryDelay = waitForPublicReadRetry,
} = {}) {
  for (let attempt = 1; attempt <= PUBLIC_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await executeRpc(client, rpcName, params);
    } catch (error) {
      if (attempt === PUBLIC_READ_MAX_ATTEMPTS || !isTransientPublicReadError(error)) throw error;
      await retryDelay(Math.max(0, Number(retryDelayMs) || 0));
    }
  }
  throw new Error('Public read retry exhausted unexpectedly.');
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
const PUBLIC_CATALOG_CACHE_STRATEGIES = new Set([
  'cache-first',
  'network-first',
  'stale-while-revalidate'
]);
const normalizeCatalogCacheStrategy = (value) => (
  PUBLIC_CATALOG_CACHE_STRATEGIES.has(value) ? value : 'cache-first'
);

export function createEcommercePublicService(
  client = ecommercePublicClient,
  {
    cache = ecommercePublicCatalogCache,
    configurationCache = ecommercePublicConfigurationCache,
    publicReadRetryDelayMs = PUBLIC_READ_RETRY_DELAY_MS,
    publicReadRetryDelay = waitForPublicReadRetry,
    publicPortalRpcName = 'ecommerce_get_portal_by_slug_v2',
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
        const data = await executePublicReadRpc(client, publicPortalRpcName, {
          p_slug: normalizedSlug
        }, { retryDelayMs: publicReadRetryDelayMs, retryDelay: publicReadRetryDelay });
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
      const cacheStrategy = normalizeCatalogCacheStrategy(options.cacheStrategy);
      if (
        cacheStrategy !== 'network-first'
        && cache
        && options.cache !== false
        && catalogRevision
      ) {
        const cached = await safely(() => cache.getPage({
          slug: normalizedSlug,
          catalogRevision,
          offset,
          limit,
          cachePolicy,
          allowStale: true
        }));
        if (cached) {
          if (cacheStrategy === 'stale-while-revalidate' && options.offline !== true) {
            void this.getPublicCatalog(normalizedSlug, {
              ...options,
              cacheStrategy: 'network-first'
            }).then((fresh) => options.onRevalidated?.(fresh)).catch(() => {});
          }
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
          data = await executePublicReadRpc(client, 'ecommerce_get_catalog', params, {
            retryDelayMs: publicReadRetryDelayMs,
            retryDelay: publicReadRetryDelay,
          });
        } catch (error) {
          if (!catalogRevision || !isLegacyCatalogSignatureError(error)) throw error;
          data = await executePublicReadRpc(client, 'ecommerce_get_catalog', {
            p_slug: normalizedSlug,
            p_limit: limit,
            p_offset: offset
          }, { retryDelayMs: publicReadRetryDelayMs, retryDelay: publicReadRetryDelay });
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
  normalizeCustomer,
  normalizeOrderItems,
  isLegacyCatalogSignatureError,
  normalizeCatalogCacheStrategy
});
