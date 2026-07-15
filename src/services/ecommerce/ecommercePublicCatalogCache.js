import Dexie from 'dexie';

export const ECOMMERCE_PUBLIC_CACHE_DB_NAME = 'lanzo-public-store-cache';
export const ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION = 1;
export const ECOMMERCE_PUBLIC_CACHE_POLICY = Object.freeze({
  schemaVersion: ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION,
  freshSeconds: 300,
  maxStaleSeconds: 86_400
});

const DEFAULT_MAX_STORES = 12;
const DEFAULT_MAX_PAGES = 240;
const PUBLIC_OPTION_COLLECTION_KEYS = Object.freeze([
  'groups', 'items', 'values', 'choices', 'options', 'variants',
  'modifiers', 'addOns', 'sizes', 'flavors'
]);
const PUBLIC_OPTION_SCALAR_KEYS = Object.freeze([
  'id', 'name', 'label', 'description', 'publicLabel', 'price', 'priceDelta',
  'isAvailable', 'displayOrder', 'minSelections', 'maxSelections',
  'minQuantity', 'maxQuantity', 'required', 'multiple', 'defaultSelected'
]);
const PUBLIC_SETTING_KEYS = Object.freeze([
  'currency', 'locale', 'timezone', 'orderLeadMinutes', 'scheduledOrderLeadMinutes',
  'estimatedPickupMinutes', 'estimatedDeliveryMinutes', 'pickupInstructions',
  'deliveryInstructions', 'deliveryFee', 'freeDeliveryMinimum', 'primaryColor',
  'accentColor', 'showBusinessAddress', 'allowOrderNotes'
]);
const PUBLIC_THEME_KEYS = Object.freeze([
  'primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor',
  'textColor', 'fontFamily', 'borderRadius', 'mode'
]);

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asInteger = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asRevision = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const trimText = (value, maxLength = 2_000) => asText(value).slice(0, maxLength);

const sanitizeScalar = (value, key) => {
  if (value === null) return null;
  if (['isAvailable', 'required', 'multiple', 'defaultSelected', 'showBusinessAddress', 'allowOrderNotes'].includes(key)) {
    return value === true;
  }
  if ([
    'price', 'priceDelta', 'displayOrder', 'minSelections', 'maxSelections',
    'minQuantity', 'maxQuantity', 'orderLeadMinutes', 'scheduledOrderLeadMinutes',
    'estimatedPickupMinutes', 'estimatedDeliveryMinutes', 'deliveryFee',
    'freeDeliveryMinimum', 'borderRadius'
  ].includes(key)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === 'string') return trimText(value);
  return null;
};

const sanitizeAllowlistedObject = (value, keys) => {
  if (!isRecord(value)) return {};
  return keys.reduce((result, key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return result;
    const sanitized = sanitizeScalar(value[key], key);
    if (sanitized !== null) result[key] = sanitized;
    return result;
  }, {});
};

const sanitizePublicTheme = (value) => sanitizeAllowlistedObject(value, PUBLIC_THEME_KEYS);
const sanitizePublicSettings = (value) => sanitizeAllowlistedObject(value, PUBLIC_SETTING_KEYS);

const sanitizeBusinessType = (value) => {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => trimText(item, 80)).filter(Boolean);
  }
  const text = trimText(value, 80);
  return text ? [text] : [];
};

const sanitizePublicOptions = (value, depth = 0) => {
  if (!isRecord(value) || depth > 5) return {};
  const result = {};

  PUBLIC_OPTION_SCALAR_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return;
    const sanitized = sanitizeScalar(value[key], key);
    if (sanitized !== null) result[key] = sanitized;
  });

  PUBLIC_OPTION_COLLECTION_KEYS.forEach((key) => {
    if (!Array.isArray(value[key])) return;
    result[key] = value[key]
      .slice(0, 100)
      .map((item) => sanitizePublicOptions(item, depth + 1))
      .filter((item) => Object.keys(item).length > 0);
  });

  return result;
};

const sanitizePublicPortal = (rawPortal) => {
  const portal = isRecord(rawPortal) ? rawPortal : {};
  const slug = trimText(portal.slug, 80).toLowerCase();
  if (!slug) return null;

  return {
    slug,
    name: trimText(portal.name, 160),
    headline: trimText(portal.headline, 240),
    description: trimText(portal.description, 2_000),
    templateCode: trimText(portal.templateCode, 80),
    customizationLevel: trimText(portal.customizationLevel, 80),
    theme: sanitizePublicTheme(portal.theme),
    logoUrl: trimText(portal.logoUrl, 2_000),
    coverImageUrl: trimText(portal.coverImageUrl, 2_000),
    whatsappPhone: trimText(portal.whatsappPhone, 40),
    address: trimText(portal.address, 500),
    businessType: sanitizeBusinessType(portal.businessType),
    orderingEnabled: portal.orderingEnabled === true,
    pickupEnabled: portal.pickupEnabled === true,
    deliveryEnabled: portal.deliveryEnabled === true,
    scheduledOrdersEnabled: portal.scheduledOrdersEnabled === true,
    minOrderTotal: Math.max(0, asNumber(portal.minOrderTotal, 0)),
    maxOrderItems: Math.max(0, asInteger(portal.maxOrderItems, 0)),
    maxItemQuantity: Math.max(0, asInteger(portal.maxItemQuantity, 0)),
    stockMode: ['hidden', 'status', 'exact'].includes(portal.stockMode)
      ? portal.stockMode
      : 'hidden',
    settings: sanitizePublicSettings(portal.settings)
  };
};

const sanitizePublicHours = (rawHours) => {
  const hours = isRecord(rawHours) ? rawHours : {};
  const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
  const exceptions = Array.isArray(hours.exceptions) ? hours.exceptions : [];

  return {
    weekly: weekly.slice(0, 14).map((item) => ({
      weekday: Math.min(6, Math.max(0, asInteger(item?.weekday, 0))),
      isOpen: item?.isOpen === true,
      opensAt: trimText(item?.opensAt, 16) || null,
      closesAt: trimText(item?.closesAt, 16) || null
    })),
    exceptions: exceptions.slice(0, 366).map((item) => ({
      date: trimText(item?.date, 16),
      isOpen: item?.isOpen === true,
      opensAt: trimText(item?.opensAt, 16) || null,
      closesAt: trimText(item?.closesAt, 16) || null,
      reason: trimText(item?.reason, 240) || null
    })).filter((item) => item.date)
  };
};

const sanitizePublicAvailability = (rawAvailability) => {
  const value = isRecord(rawAvailability) ? rawAvailability : {};
  return {
    acceptingOrders: value.acceptingOrders === true,
    code: trimText(value.code, 80),
    timezone: trimText(value.timezone, 120),
    evaluatedAt: trimText(value.evaluatedAt, 80),
    localDate: trimText(value.localDate, 16),
    opensAt: trimText(value.opensAt, 16),
    closesAt: trimText(value.closesAt, 16),
    nextOpenAt: trimText(value.nextOpenAt, 80),
    nextCloseAt: trimText(value.nextCloseAt, 80),
    nextChangeAt: trimText(value.nextChangeAt, 80),
    pauseReason: trimText(value.pauseReason, 300),
    pauseUntil: trimText(value.pauseUntil, 80),
    scheduleSource: trimText(value.scheduleSource, 24),
    legacy: value.legacy === true
  };
};

const sanitizePublicFeatures = (rawFeatures) => {
  const features = isRecord(rawFeatures) ? rawFeatures : {};
  return {
    whatsappCheckout: features.whatsappCheckout === true,
    orderInbox: features.orderInbox === true,
    customSlug: features.customSlug === true,
    brandingCustomization: typeof features.brandingCustomization === 'boolean'
      ? features.brandingCustomization
      : trimText(features.brandingCustomization, 80),
    layoutCustomization: typeof features.layoutCustomization === 'boolean'
      ? features.layoutCustomization
      : trimText(features.layoutCustomization, 80),
    businessHours: features.businessHours === true,
    deliveryPickupSettings: typeof features.deliveryPickupSettings === 'boolean'
      ? features.deliveryPickupSettings
      : trimText(features.deliveryPickupSettings, 80),
    stockVisibility: features.stockVisibility === true,
    realtimeOrders: features.realtimeOrders === true
  };
};

const sanitizePublicProduct = (rawProduct) => {
  const product = isRecord(rawProduct) ? rawProduct : {};
  const id = trimText(product.id, 160);
  if (!id) return null;

  const stock = isRecord(product.stock) ? product.stock : {};
  const stockMode = ['hidden', 'status', 'exact'].includes(stock.mode) ? stock.mode : 'hidden';
  const quantity = stockMode === 'exact' && Number.isFinite(Number(stock.quantity))
    ? Math.max(0, Math.floor(Number(stock.quantity)))
    : null;

  return {
    id,
    name: trimText(product.name, 160) || 'Producto',
    description: trimText(product.description, 1_000),
    categoryName: trimText(product.categoryName, 120),
    price: Math.max(0, asNumber(product.price, 0)),
    currency: (trimText(product.currency, 8) || 'MXN').toUpperCase(),
    imageUrl: trimText(product.imageUrl, 2_000),
    isAvailable: product.isAvailable === true,
    displayOrder: asInteger(product.displayOrder, 0),
    stock: {
      mode: stockMode,
      status: stock.status === 'available' || stock.status === 'out_of_stock'
        ? stock.status
        : null,
      quantity
    },
    options: sanitizePublicOptions(product.options)
  };
};

const sanitizeCatalogPage = (page, expectedRevision) => {
  const source = isRecord(page) ? page : {};
  const revision = asRevision(source.catalogRevision ?? expectedRevision);
  const rawItems = Array.isArray(source.items) ? source.items : null;
  const pagination = isRecord(source.pagination) ? source.pagination : null;

  if (!revision || !rawItems || !pagination) return null;

  const items = rawItems.map(sanitizePublicProduct).filter(Boolean);
  if (items.length !== rawItems.length) return null;

  return {
    catalogRevision: revision,
    items,
    pagination: {
      limit: Math.min(100, Math.max(1, asInteger(pagination.limit, 100))),
      offset: Math.max(0, asInteger(pagination.offset, 0)),
      hasMore: pagination.hasMore === true
    }
  };
};

const sanitizePortalResult = (result) => {
  const source = isRecord(result) ? result : {};
  const portal = sanitizePublicPortal(source.portal);
  const revision = asRevision(source.catalogRevision);
  if (!portal || !revision) return null;

  return {
    portal,
    hours: sanitizePublicHours(source.hours),
    availability: sanitizePublicAvailability(source.availability),
    features: sanitizePublicFeatures(source.features),
    catalogRevision: revision,
    cachePolicy: normalizeCachePolicy(source.cachePolicy)
  };
};

export const normalizeCachePolicy = (policy = {}) => ({
  schemaVersion: Math.max(1, asInteger(
    policy.schemaVersion,
    ECOMMERCE_PUBLIC_CACHE_POLICY.schemaVersion
  )),
  freshSeconds: Math.max(0, asInteger(
    policy.freshSeconds,
    ECOMMERCE_PUBLIC_CACHE_POLICY.freshSeconds
  )),
  maxStaleSeconds: Math.max(1, asInteger(
    policy.maxStaleSeconds,
    ECOMMERCE_PUBLIC_CACHE_POLICY.maxStaleSeconds
  ))
});

export const buildPublicCatalogCacheKey = ({
  slug,
  catalogRevision,
  offset,
  limit,
  schemaVersion
}) => [
  encodeURIComponent(asText(slug).toLowerCase()),
  asRevision(catalogRevision) || 0,
  Math.max(0, asInteger(offset, 0)),
  Math.min(100, Math.max(1, asInteger(limit, 100))),
  Math.max(1, asInteger(schemaVersion, ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION))
].join(':');

export const createEcommercePublicCatalogDatabase = (name = ECOMMERCE_PUBLIC_CACHE_DB_NAME) => {
  const database = new Dexie(name);
  database.version(1).stores({
    pages: '&key, slug, catalogRevision, schemaVersion, offset, limit, createdAt, lastAccess, [slug+catalogRevision]',
    portals: '&slug, catalogRevision, schemaVersion, createdAt, lastAccess'
  });
  return database;
};

const defaultDatabase = createEcommercePublicCatalogDatabase();

export const createEcommercePublicCatalogCache = ({
  database = defaultDatabase,
  now = () => Date.now(),
  maxStores = DEFAULT_MAX_STORES,
  maxPages = DEFAULT_MAX_PAGES
} = {}) => {
  const ensureOpen = async () => {
    if (!database.isOpen()) await database.open();
  };

  const getAgeSeconds = (record) => Math.max(0, (now() - Number(record?.createdAt || 0)) / 1000);

  const getPage = async ({
    slug,
    catalogRevision,
    offset = 0,
    limit = 100,
    cachePolicy = ECOMMERCE_PUBLIC_CACHE_POLICY,
    allowStale = true
  }) => {
    const normalizedSlug = asText(slug).toLowerCase();
    const revision = asRevision(catalogRevision);
    const policy = normalizeCachePolicy(cachePolicy);
    if (!normalizedSlug || !revision || policy.schemaVersion !== ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION) {
      return null;
    }

    await ensureOpen();
    const key = buildPublicCatalogCacheKey({
      slug: normalizedSlug,
      catalogRevision: revision,
      offset,
      limit,
      schemaVersion: policy.schemaVersion
    });
    const record = await database.table('pages').get(key);
    if (!record) return null;

    const ageSeconds = getAgeSeconds(record);
    if (ageSeconds > policy.maxStaleSeconds || (!allowStale && ageSeconds > policy.freshSeconds)) {
      await database.table('pages').delete(key);
      return null;
    }

    const page = sanitizeCatalogPage(record.page, revision);
    if (!page || page.pagination.offset !== Math.max(0, asInteger(offset, 0))) {
      await database.table('pages').delete(key);
      return null;
    }

    void database.table('pages').update(key, { lastAccess: now() });
    return {
      page,
      fresh: ageSeconds <= policy.freshSeconds,
      stale: ageSeconds > policy.freshSeconds,
      ageSeconds
    };
  };

  const putPage = async ({
    slug,
    catalogRevision,
    offset = 0,
    limit = 100,
    cachePolicy = ECOMMERCE_PUBLIC_CACHE_POLICY,
    page
  }) => {
    const normalizedSlug = asText(slug).toLowerCase();
    const revision = asRevision(catalogRevision);
    const policy = normalizeCachePolicy(cachePolicy);
    const safePage = sanitizeCatalogPage(page, revision);
    if (
      !normalizedSlug
      || !revision
      || policy.schemaVersion !== ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION
      || !safePage
      || safePage.catalogRevision !== revision
    ) {
      return false;
    }

    await ensureOpen();
    const createdAt = now();
    const key = buildPublicCatalogCacheKey({
      slug: normalizedSlug,
      catalogRevision: revision,
      offset,
      limit,
      schemaVersion: policy.schemaVersion
    });
    await database.table('pages').put({
      key,
      slug: normalizedSlug,
      catalogRevision: revision,
      schemaVersion: policy.schemaVersion,
      offset: Math.max(0, asInteger(offset, 0)),
      limit: Math.min(100, Math.max(1, asInteger(limit, 100))),
      page: safePage,
      createdAt,
      lastAccess: createdAt
    });
    return true;
  };

  const getPortal = async ({
    slug,
    maxStaleSeconds = ECOMMERCE_PUBLIC_CACHE_POLICY.maxStaleSeconds
  }) => {
    const normalizedSlug = asText(slug).toLowerCase();
    if (!normalizedSlug) return null;
    await ensureOpen();
    const record = await database.table('portals').get(normalizedSlug);
    if (!record || record.schemaVersion !== ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION) return null;
    if (getAgeSeconds(record) > Math.max(1, asInteger(maxStaleSeconds, 86_400))) {
      await database.table('portals').delete(normalizedSlug);
      return null;
    }
    const result = sanitizePortalResult(record.result);
    if (!result) {
      await database.table('portals').delete(normalizedSlug);
      return null;
    }
    void database.table('portals').update(normalizedSlug, { lastAccess: now() });
    return result;
  };

  const putPortal = async ({ slug, result }) => {
    const normalizedSlug = asText(slug).toLowerCase();
    const safeResult = sanitizePortalResult(result);
    if (!normalizedSlug || !safeResult || safeResult.portal.slug !== normalizedSlug) return false;
    await ensureOpen();
    const createdAt = now();
    await database.table('portals').put({
      slug: normalizedSlug,
      catalogRevision: safeResult.catalogRevision,
      schemaVersion: ECOMMERCE_PUBLIC_CACHE_SCHEMA_VERSION,
      result: safeResult,
      createdAt,
      lastAccess: createdAt
    });
    return true;
  };

  const deleteObsoleteRevisions = async ({ slug, keepRevision }) => {
    const normalizedSlug = asText(slug).toLowerCase();
    const revision = asRevision(keepRevision);
    if (!normalizedSlug || !revision) return 0;
    await ensureOpen();
    const keys = await database.table('pages')
      .where('slug')
      .equals(normalizedSlug)
      .filter((record) => record.catalogRevision !== revision)
      .primaryKeys();
    if (keys.length > 0) await database.table('pages').bulkDelete(keys);
    return keys.length;
  };

  const cleanup = async () => {
    await ensureOpen();
    const cutoff = now() - (ECOMMERCE_PUBLIC_CACHE_POLICY.maxStaleSeconds * 1000);
    await database.table('pages').where('lastAccess').below(cutoff).delete();
    await database.table('portals').where('lastAccess').below(cutoff).delete();

    const portals = await database.table('portals').orderBy('lastAccess').reverse().toArray();
    const allowedSlugs = new Set(portals.slice(0, maxStores).map((record) => record.slug));
    if (portals.length > maxStores) {
      const staleSlugs = portals.slice(maxStores).map((record) => record.slug);
      await database.table('portals').bulkDelete(staleSlugs);
      const pageKeys = await database.table('pages')
        .filter((record) => !allowedSlugs.has(record.slug))
        .primaryKeys();
      if (pageKeys.length > 0) await database.table('pages').bulkDelete(pageKeys);
    }

    const pages = await database.table('pages').orderBy('lastAccess').reverse().toArray();
    if (pages.length > maxPages) {
      await database.table('pages').bulkDelete(
        pages.slice(maxPages).map((record) => record.key)
      );
    }
  };

  const clear = async () => {
    await ensureOpen();
    await database.transaction('rw', database.table('pages'), database.table('portals'), async () => {
      await database.table('pages').clear();
      await database.table('portals').clear();
    });
  };

  return {
    getPage,
    putPage,
    getPortal,
    putPortal,
    deleteObsoleteRevisions,
    cleanup,
    clear,
    database
  };
};

export const ecommercePublicCatalogCache = createEcommercePublicCatalogCache();

export const ecommercePublicCatalogCacheInternals = Object.freeze({
  sanitizeCatalogPage,
  sanitizePortalResult,
  sanitizePublicPortal,
  sanitizePublicHours,
  sanitizePublicAvailability,
  sanitizePublicFeatures,
  sanitizePublicProduct,
  sanitizePublicOptions,
  sanitizePublicSettings,
  cloneJson,
  PUBLIC_OPTION_COLLECTION_KEYS,
  PUBLIC_OPTION_SCALAR_KEYS,
  PUBLIC_SETTING_KEYS
});
