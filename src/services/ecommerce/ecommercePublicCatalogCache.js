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
const FORBIDDEN_KEY_PATTERN = /(customer|client|phone|address|note|order|idempot|token|secret|license|staff|cost|supplier|provider)/i;

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asInteger = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value));
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

const sanitizePublicObject = (value, depth = 0) => {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) => sanitizePublicObject(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== 'object') {
    if (typeof value === 'string') return value.slice(0, 2_000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return null;
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (!key || FORBIDDEN_KEY_PATTERN.test(key)) return result;
    result[key] = sanitizePublicObject(item, depth + 1);
    return result;
  }, {});
};

const sanitizeProduct = (rawProduct) => {
  const product = rawProduct && typeof rawProduct === 'object' ? rawProduct : {};
  const id = asText(product.id);
  if (!id) return null;

  const stock = product.stock && typeof product.stock === 'object' ? product.stock : {};
  const stockMode = ['hidden', 'status', 'exact'].includes(stock.mode) ? stock.mode : 'hidden';
  const quantity = stockMode === 'exact' && Number.isFinite(Number(stock.quantity))
    ? Math.max(0, Math.floor(Number(stock.quantity)))
    : null;

  return {
    id,
    name: asText(product.name) || 'Producto',
    description: asText(product.description),
    categoryName: asText(product.categoryName),
    price: Math.max(0, Number(product.price) || 0),
    currency: (asText(product.currency) || 'MXN').toUpperCase(),
    imageUrl: asText(product.imageUrl),
    isAvailable: product.isAvailable === true,
    displayOrder: Number(product.displayOrder) || 0,
    stock: {
      mode: stockMode,
      status: stock.status === 'available' || stock.status === 'out_of_stock'
        ? stock.status
        : null,
      quantity
    },
    options: sanitizePublicObject(product.options || {}) || {}
  };
};

const sanitizeCatalogPage = (page, expectedRevision) => {
  const source = page && typeof page === 'object' ? page : {};
  const revision = asRevision(source.catalogRevision ?? expectedRevision);
  const rawItems = Array.isArray(source.items) ? source.items : null;
  const pagination = source.pagination && typeof source.pagination === 'object'
    ? source.pagination
    : null;

  if (!revision || !rawItems || !pagination) return null;

  const items = rawItems.map(sanitizeProduct).filter(Boolean);
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
  const source = result && typeof result === 'object' ? result : {};
  const portal = source.portal && typeof source.portal === 'object' ? source.portal : null;
  const revision = asRevision(source.catalogRevision);
  if (!portal || !asText(portal.slug) || !revision) return null;

  return {
    portal: sanitizePublicObject(portal) || {},
    hours: sanitizePublicObject(source.hours || {}) || {},
    features: sanitizePublicObject(source.features || {}) || {},
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
  sanitizeProduct,
  sanitizePublicObject,
  cloneJson,
  FORBIDDEN_KEY_PATTERN
});
