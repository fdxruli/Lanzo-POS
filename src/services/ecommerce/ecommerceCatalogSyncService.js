import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import {
  getEcommercePortal,
  listPublishedProducts,
  syncPublishedCatalog
} from './ecommerceAdminService';
import { ecommercePublishedStockLocalSource } from './ecommercePublishedStockLocalSource';
import {
  ecommercePublishedStockAlertServiceInternals
} from './ecommercePublishedStockAlertService';
import { getEcommercePublishedStockAlertContextKey } from './ecommercePublishedStockAlertService';
import {
  ecommerceCatalogSyncOutbox,
  hashEcommerceCatalogSyncScope
} from './ecommerceCatalogSyncOutbox';

export const ECOMMERCE_CATALOG_SYNC_STATUS_EVENT = 'lanzo:ecommerce-catalog-sync-status';
export const ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT = 'lanzo:ecommerce-catalog-sync-request';

const DEFAULT_DEBOUNCE_MS = 900;
const RPC_BATCH_SIZE = 200;
const SOURCE_FIELDS = Object.freeze(['name', 'description', 'category', 'price', 'image']);

const asText = (value) => String(value || '').trim();
const uniqueRefs = (values = []) => Array.from(new Set(
  values.map(asText).filter(Boolean)
));
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getNowIso = () => new Date().toISOString();
const chunk = (values, size) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const getCategoryId = (product = {}) => asText(
  product.categoryId || product.category_id
);

const getSourceRevision = (product = {}) => asText(
  product.serverVersion
  || product.server_version
  || product.updatedAt
  || product.updated_at
  || product.lastModified
  || product.last_modified
  || product.syncVersion
  || product.sync_version
  || 'local'
).slice(0, 160);

const getPublicImage = (product = {}) => {
  const value = asText(product.imageUrl || product.image_url || product.image);
  return /^https?:\/\//i.test(value) ? value : null;
};

const getPublicDescription = (product = {}) => {
  const value = asText(product.description || product.publicDescription);
  return value ? value.slice(0, 1_000) : null;
};

const getPublicName = (product = {}) => asText(product.name).slice(0, 160) || 'Producto';

const getPublicPrice = (product = {}) => {
  const price = Number(product.price);
  return Number.isFinite(price) && price >= 0 ? Number(price.toFixed(2)) : 0;
};

const statusToSourceAvailability = (status) => {
  if (status === 'in_stock' || status === 'not_tracked') return true;
  if (status === 'out_of_stock' || status === 'source_missing' || status === 'inactive_source') {
    return false;
  }
  return null;
};

const buildProjection = ({
  publishedProduct,
  localProduct,
  category,
  evaluation
}) => ({
  publishedProductId: asText(publishedProduct.id),
  localProductRef: asText(publishedProduct.localProductRef),
  sourceRevision: localProduct ? getSourceRevision(localProduct) : 'missing',
  sourceState: evaluation.status,
  sourceAvailable: statusToSourceAvailability(evaluation.status),
  stockSnapshot: Number.isFinite(Number(evaluation.availableStock))
    ? Math.max(0, Number(evaluation.availableStock))
    : null,
  fields: {
    name: localProduct ? getPublicName(localProduct) : null,
    description: localProduct ? getPublicDescription(localProduct) : null,
    category: localProduct
      ? (asText(category?.name || localProduct.category) || null)
      : null,
    price: localProduct ? getPublicPrice(localProduct) : null,
    image: localProduct ? getPublicImage(localProduct) : null
  }
});

const getScopeIdentity = (state = {}) => {
  const licenseKey = getLicenseKeyFromDetails(state.licenseDetails || {});
  const contextKey = getEcommercePublishedStockAlertContextKey(state);
  if (!licenseKey || !contextKey) return null;
  return `${licenseKey}:${contextKey}`;
};

const createInitialStatus = () => ({
  state: 'idle',
  reason: null,
  pendingCount: 0,
  errorCount: 0,
  reviewCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  catalogRevision: null,
  lastAttemptAt: null,
  lastSyncedAt: null,
  code: null
});

const dispatchStatus = (snapshot) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ECOMMERCE_CATALOG_SYNC_STATUS_EVENT, {
    detail: snapshot
  }));
};

export const createEcommerceCatalogSyncService = ({
  getState = () => useAppStore.getState(),
  getPortal = getEcommercePortal,
  getPublishedProducts = listPublishedProducts,
  syncBatch = syncPublishedCatalog,
  localSource = ecommercePublishedStockLocalSource,
  outbox = ecommerceCatalogSyncOutbox,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  online = isOnline,
  nowIso = getNowIso
} = {}) => {
  let timer = null;
  let activeDrain = null;
  let dirty = false;
  let pendingFullReconcile = false;
  let pendingReason = 'catalog-change';
  let pendingProductRefs = new Set();
  let contextEpoch = 0;
  let status = createInitialStatus();
  let lastEligibleContext = null;

  const publishStatus = (patch) => {
    status = { ...status, ...patch };
    dispatchStatus(status);
    return status;
  };

  const getStatus = () => ({ ...status });

  const isContextCurrent = (contextKey, epoch) => (
    contextEpoch === epoch
    && getEcommercePublishedStockAlertContextKey(getState() || {}) === contextKey
  );

  const rememberPending = ({ productRefs, fullReconcile, reason }) => {
    uniqueRefs(productRefs).forEach((productRef) => pendingProductRefs.add(productRef));
    pendingFullReconcile = pendingFullReconcile || fullReconcile === true || productRefs?.length === 0;
    pendingReason = asText(reason) || pendingReason;
  };

  const enqueueOffline = async ({
    scopeIdentity,
    portalId,
    productRefs,
    fullReconcile,
    reason
  }) => {
    const count = await outbox.enqueue({
      scopeIdentity,
      portalId,
      productRefs,
      fullReconcile,
      reason
    });
    publishStatus({
      state: 'pending',
      pendingCount: Math.max(status.pendingCount, count),
      lastAttemptAt: nowIso(),
      code: 'ECOMMERCE_CATALOG_SYNC_OFFLINE'
    });
    return { success: true, queued: true, count };
  };

  const resolveOfflinePortalId = async ({ scopeIdentity, contextKey }) => {
    if (lastEligibleContext?.contextKey === contextKey) {
      return lastEligibleContext.portalId;
    }
    try {
      return await outbox.getRememberedPortal({ scopeIdentity });
    } catch {
      return null;
    }
  };

  const buildProjections = async ({ publishedProducts, requestedRefs, fullReconcile }) => {
    const linkedProducts = publishedProducts.filter((product) => (
      product?.isPublished === true && asText(product.localProductRef)
    ));
    const selectedProducts = fullReconcile
      ? linkedProducts
      : linkedProducts.filter((product) => requestedRefs.has(asText(product.localProductRef)));
    const localRefs = uniqueRefs(selectedProducts.map((product) => product.localProductRef));
    if (localRefs.length === 0) return [];

    let localProductsById;
    try {
      localProductsById = await localSource.getProductsByIds(localRefs);
    } catch {
      localProductsById = new Map();
    }

    const categoryIds = uniqueRefs(Array.from(localProductsById.values()).map(getCategoryId));
    let categoriesById = new Map();
    try {
      categoriesById = await localSource.getCategoriesByIds(categoryIds);
    } catch {
      categoriesById = new Map();
    }

    const batchManagedIds = localRefs.filter((productRef) => {
      const product = localProductsById.get(productRef);
      return product && ecommercePublishedStockAlertServiceInternals.isBatchManaged(product);
    });
    let batchesByProductId = new Map();
    let batchReadFailed = false;
    if (batchManagedIds.length > 0) {
      try {
        batchesByProductId = await localSource.getBatchesByProductIds(batchManagedIds);
      } catch {
        batchReadFailed = true;
      }
    }

    const now = new Date();
    return selectedProducts.map((publishedProduct) => {
      const localProductRef = asText(publishedProduct.localProductRef);
      const localProduct = localProductsById.get(localProductRef);
      const evaluation = ecommercePublishedStockAlertServiceInternals.classifyProduct({
        publishedProduct,
        localProduct,
        batches: batchesByProductId.get(localProductRef) || [],
        batchReadFailed,
        now
      });
      return buildProjection({
        publishedProduct,
        localProduct,
        category: localProduct ? categoriesById.get(getCategoryId(localProduct)) : null,
        evaluation
      });
    });
  };

  const executeOnce = async (request) => {
    const state = getState() || {};
    const contextKey = getEcommercePublishedStockAlertContextKey(state);
    const scopeIdentity = getScopeIdentity(state);
    const requestEpoch = contextEpoch;
    if (!contextKey || !scopeIdentity) {
      return publishStatus({
        state: 'idle',
        code: 'ECOMMERCE_CATALOG_SYNC_CONTEXT_REQUIRED',
        lastAttemptAt: nowIso()
      });
    }

    if (!online()) {
      const rememberedPortalId = await resolveOfflinePortalId({ scopeIdentity, contextKey });
      if (rememberedPortalId) {
        return enqueueOffline({
          scopeIdentity,
          portalId: rememberedPortalId,
          productRefs: request.productRefs,
          fullReconcile: request.fullReconcile,
          reason: request.reason
        });
      }
    }

    publishStatus({
      state: 'syncing',
      reason: request.reason,
      lastAttemptAt: nowIso(),
      code: null
    });

    const portalResult = await getPortal();
    if (portalResult?.success !== true) {
      if (!online()) {
        const rememberedPortalId = await resolveOfflinePortalId({ scopeIdentity, contextKey });
        if (rememberedPortalId) {
          return enqueueOffline({
            scopeIdentity,
            portalId: rememberedPortalId,
            productRefs: request.productRefs,
            fullReconcile: request.fullReconcile,
            reason: request.reason
          });
        }
      }
      return publishStatus({
        state: 'error',
        errorCount: 1,
        code: portalResult?.code || 'ECOMMERCE_CATALOG_SYNC_PORTAL_FAILED'
      });
    }

    const portal = portalResult.portal;
    const eligible = (
      portal
      && portalResult.plan?.code === 'pro_monthly'
      && portalResult.features?.cloudCatalogSource === true
    );
    if (!eligible) {
      return publishStatus({
        state: 'manual',
        pendingCount: 0,
        errorCount: 0,
        code: 'ECOMMERCE_CATALOG_SYNC_NOT_ENABLED'
      });
    }

    lastEligibleContext = {
      contextKey,
      portalId: asText(portal.id),
      scopeIdentity
    };

    if (!isContextCurrent(contextKey, requestEpoch)) {
      return { success: false, stale: true };
    }

    await outbox.rememberPortal({ scopeIdentity, portalId: portal.id });

    const productsResult = await getPublishedProducts();
    if (productsResult?.success !== true) {
      return publishStatus({
        state: 'error',
        errorCount: 1,
        code: productsResult?.code || 'ECOMMERCE_CATALOG_SYNC_PRODUCTS_FAILED'
      });
    }

    const queued = await outbox.list({ scopeIdentity, portalId: portal.id });
    const requestedRefs = new Set(uniqueRefs([
      ...request.productRefs,
      ...queued.productRefs
    ]));
    const fullReconcile = request.fullReconcile || queued.fullReconcile;
    const projections = await buildProjections({
      publishedProducts: productsResult.products || [],
      requestedRefs,
      fullReconcile
    });

    if (!isContextCurrent(contextKey, requestEpoch)) {
      return { success: false, stale: true };
    }

    if (projections.length === 0) {
      await outbox.acknowledge({
        scopeIdentity,
        portalId: portal.id,
        entries: queued.entries
      });
      return publishStatus({
        state: 'synced',
        pendingCount: 0,
        errorCount: 0,
        reviewCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        catalogRevision: portal.catalogRevision || null,
        lastSyncedAt: nowIso(),
        code: null
      });
    }

    let expectedCatalogRevision = Number(portal.catalogRevision) || null;
    let updatedCount = 0;
    let skippedCount = 0;
    let reviewCount = 0;

    for (const [batchIndex, projectionsBatch] of chunk(projections, RPC_BATCH_SIZE).entries()) {
      const signature = projectionsBatch.map((projection) => ({
        id: projection.publishedProductId,
        ref: projection.localProductRef,
        revision: projection.sourceRevision,
        state: projection.sourceState
      }));
      const signatureHash = await hashEcommerceCatalogSyncScope(JSON.stringify(signature));
      const result = await syncBatch({
        projections: projectionsBatch,
        idempotencyKey: `ecom-catalog-sync:${portal.id}:${batchIndex}:${signatureHash}`,
        expectedCatalogRevision
      });

      if (!isContextCurrent(contextKey, requestEpoch)) {
        return { success: false, stale: true };
      }
      if (result?.success !== true) {
        if (result?.code === 'ECOMMERCE_CATALOG_REVISION_CHANGED') dirty = true;
        Logger.warn('[Ecommerce/CatalogSync] Batch failed', {
          operation: 'sync_published_catalog',
          code: result?.code || 'ECOMMERCE_CATALOG_SYNC_FAILED',
          count: projectionsBatch.length,
          revision: expectedCatalogRevision
        });
        return publishStatus({
          state: 'error',
          pendingCount: projections.length,
          errorCount: 1,
          code: result?.code || 'ECOMMERCE_CATALOG_SYNC_FAILED'
        });
      }

      updatedCount += Number(result.updatedCount || 0);
      skippedCount += Number(result.skippedCount || 0);
      reviewCount += Number(result.reviewCount || 0);
      expectedCatalogRevision = Number(result.catalogRevision) || expectedCatalogRevision;
    }

    await outbox.acknowledge({
      scopeIdentity,
      portalId: portal.id,
      entries: queued.entries
    });
    void outbox.cleanup();

    Logger.log('[Ecommerce/CatalogSync] Sync completed', {
      operation: 'sync_published_catalog',
      count: projections.length,
      revision: expectedCatalogRevision,
      source: request.reason
    });
    return publishStatus({
      state: reviewCount > 0 ? 'review' : 'synced',
      pendingCount: 0,
      errorCount: 0,
      reviewCount,
      updatedCount,
      skippedCount,
      catalogRevision: expectedCatalogRevision,
      lastSyncedAt: nowIso(),
      code: null
    });
  };

  const takePendingRequest = () => {
    const request = {
      productRefs: Array.from(pendingProductRefs),
      fullReconcile: pendingFullReconcile,
      reason: pendingReason
    };
    pendingProductRefs = new Set();
    pendingFullReconcile = false;
    return request;
  };

  const drain = async () => {
    let request = takePendingRequest();
    let result = await executeOnce(request);

    if (dirty || pendingFullReconcile || pendingProductRefs.size > 0) {
      dirty = false;
      request = takePendingRequest();
      result = await executeOnce(request);
    }

    if (dirty || pendingFullReconcile || pendingProductRefs.size > 0) {
      dirty = false;
      scheduleSync({ reason: 'consolidated-follow-up' });
    }
    return result;
  };

  const startDrain = () => {
    if (activeDrain) {
      dirty = true;
      return activeDrain;
    }
    activeDrain = drain();
    const release = () => {
      activeDrain = null;
    };
    activeDrain.then(release, release);
    return activeDrain;
  };

  const scheduleSync = ({
    productIds = [],
    fullReconcile = false,
    reason = 'catalog-change',
    immediate = false
  } = {}) => {
    rememberPending({ productRefs: productIds, fullReconcile, reason });
    if (activeDrain) {
      dirty = true;
      return activeDrain;
    }
    if (timer) globalThis.clearTimeout(timer);

    if (immediate) return startDrain();
    timer = globalThis.setTimeout(() => {
      timer = null;
      void startDrain();
    }, debounceMs);
    return null;
  };

  const syncNow = (options = {}) => scheduleSync({
    ...options,
    fullReconcile: options.fullReconcile !== false,
    reason: options.reason || 'manual',
    immediate: true
  });

  const invalidateContext = () => {
    contextEpoch += 1;
    if (timer) globalThis.clearTimeout(timer);
    timer = null;
    pendingProductRefs = new Set();
    pendingFullReconcile = false;
    dirty = false;
    publishStatus(createInitialStatus());
  };

  return {
    scheduleSync,
    syncNow,
    invalidateContext,
    getStatus,
    SOURCE_FIELDS
  };
};

export const ecommerceCatalogSyncService = createEcommerceCatalogSyncService();

export const ecommerceCatalogSyncServiceInternals = Object.freeze({
  uniqueRefs,
  chunk,
  buildProjection,
  getSourceRevision,
  statusToSourceAvailability,
  getScopeIdentity,
  RPC_BATCH_SIZE
});
