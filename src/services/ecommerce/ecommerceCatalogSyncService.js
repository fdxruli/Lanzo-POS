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
const RETRY_BACKOFF_MS = Object.freeze([2_000, 5_000, 15_000, 30_000, 60_000]);
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ETIMEDOUT',
  'NETWORK_ERROR',
  'FETCH_ERROR',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
  'PGRST504',
  '40001',
  '40P01',
  '55P03',
  '57014',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01'
]);
const RETRYABLE_MESSAGE_PATTERN = /(failed to fetch|network request failed|networkerror|load failed|connection (?:reset|closed|refused)|timeout|timed out|temporar(?:y|ily)|service unavailable|gateway timeout|bad gateway|statement timeout)/i;

const asText = (value) => String(value ?? '').trim();
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

const normalizeVersionNumber = (value) => {
  const text = asText(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [integerPart, fractionPart = ''] = text.split('.');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fractionPart.replace(/0+$/, '');
  return normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
};

const compareVersionNumbers = (left, right) => {
  const [leftInteger, leftFraction = ''] = left.split('.');
  const [rightInteger, rightFraction = ''] = right.split('.');
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length - rightInteger.length;
  }
  const integerOrder = leftInteger.localeCompare(rightInteger);
  if (integerOrder !== 0) return integerOrder;
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction.padEnd(fractionLength, '0')
    .localeCompare(rightFraction.padEnd(fractionLength, '0'));
};

const normalizeSourceRevision = (product = {}, relatedRecords = []) => {
  const records = [product, ...relatedRecords].filter(Boolean);
  const versions = records
    .map((record) => normalizeVersionNumber(
      record.serverVersion
      ?? record.server_version
      ?? record.syncVersion
      ?? record.sync_version
    ))
    .filter((value) => value !== null)
    .sort(compareVersionNumbers);
  if (versions.length > 0) return `version:${versions.at(-1)}`;

  const timestamps = records
    .map((record) => (
      record.updatedAt
      ?? record.updated_at
      ?? record.lastModified
      ?? record.last_modified
    ))
    .map((value) => Date.parse(asText(value)))
    .filter(Number.isFinite);
  if (timestamps.length > 0) return `timestamp:${Math.max(...timestamps)}`;

  const opaque = records
    .map((record) => asText(
      record.serverVersion
      ?? record.server_version
      ?? record.syncVersion
      ?? record.sync_version
      ?? record.updatedAt
      ?? record.updated_at
      ?? record.lastModified
      ?? record.last_modified
    ))
    .find(Boolean);
  return opaque ? `opaque:${opaque.slice(0, 140)}` : null;
};

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
  categoryEvaluated = true,
  sourceRevision = null,
  evaluation
}) => {
  const fields = {};

  if (localProduct) {
    fields.name = getPublicName(localProduct);
    fields.description = getPublicDescription(localProduct);
    if (categoryEvaluated) {
      fields.category = asText(category?.name || localProduct.category) || null;
    }
    fields.price = getPublicPrice(localProduct);
    fields.image = getPublicImage(localProduct);
  }

  const stockValue = evaluation.availableStock;
  const hasConfirmedStock = (
    stockValue !== null
    && stockValue !== undefined
    && stockValue !== ''
    && Number.isFinite(Number(stockValue))
  );

  return {
    publishedProductId: asText(publishedProduct.id),
    localProductRef: asText(publishedProduct.localProductRef),
    sourceRevision: localProduct ? sourceRevision : null,
    sourceState: evaluation.status,
    sourceAvailable: statusToSourceAvailability(evaluation.status),
    stockSnapshot: hasConfirmedStock ? Math.max(0, Number(stockValue)) : null,
    fields
  };
};

const normalizeSignatureValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(normalizeSignatureValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value) : null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        const normalized = normalizeSignatureValue(value[key]);
        if (normalized !== undefined) result[key] = normalized;
        return result;
      }, {});
  }
  return null;
};

const normalizeProjectionForSignature = (projection = {}) => {
  const normalizedFields = {};
  SOURCE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(projection.fields || {}, field)) {
      normalizedFields[field] = normalizeSignatureValue(projection.fields[field]);
    }
  });

  return normalizeSignatureValue({
    publishedProductId: asText(projection.publishedProductId),
    localProductRef: asText(projection.localProductRef),
    sourceRevision: projection.sourceRevision === null
      ? null
      : asText(projection.sourceRevision),
    sourceState: asText(projection.sourceState),
    sourceAvailable: projection.sourceAvailable === null
      ? null
      : projection.sourceAvailable === true,
    stockSnapshot: projection.stockSnapshot === null
      ? null
      : Number(projection.stockSnapshot),
    fields: normalizedFields
  });
};

const stableStringify = (value) => JSON.stringify(normalizeSignatureValue(value));

const sortProjections = (projections = []) => [...projections].sort((left, right) => {
  const leftKey = `${asText(left.publishedProductId)}:${asText(left.localProductRef)}`;
  const rightKey = `${asText(right.publishedProductId)}:${asText(right.localProductRef)}`;
  return leftKey.localeCompare(rightKey);
});

const buildBatchIdempotencyKey = async ({ portalId, projections }) => {
  const normalized = sortProjections(projections).map(normalizeProjectionForSignature);
  const signatureHash = await hashEcommerceCatalogSyncScope(stableStringify(normalized));
  return `ecom-catalog-sync:${asText(portalId)}:${signatureHash}`;
};

const getFailureStatus = (failure = {}) => Number(
  failure.status
  ?? failure.statusCode
  ?? failure.httpStatus
  ?? failure.error?.status
  ?? failure.error?.statusCode
);

const getFailureCode = (failure = {}, fallbackCode) => asText(
  failure.code
  || failure.error?.code
  || failure.name
  || fallbackCode
).toUpperCase();

const getFailureMessage = (failure = {}) => asText(
  failure.message
  || failure.error?.message
  || failure.details
);

const isRetryableCatalogSyncError = (failure, online = isOnline) => {
  if (!online()) return true;
  if (failure?.retryable === true) return true;
  const status = getFailureStatus(failure);
  if (RETRYABLE_HTTP_STATUSES.has(status)) return true;

  const code = getFailureCode(failure);
  if (RETRYABLE_CODES.has(code)) return true;
  if (/^08[A-Z0-9]{3}$/.test(code)) return true;
  if (/^53[A-Z0-9]{3}$/.test(code)) return true;

  const name = asText(failure?.name);
  if (name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError') return true;
  return RETRYABLE_MESSAGE_PATTERN.test(getFailureMessage(failure));
};

const toFailure = (failure, fallbackCode, online = isOnline) => ({
  success: false,
  code: getFailureCode(failure, fallbackCode),
  message: getFailureMessage(failure),
  retryable: isRetryableCatalogSyncError(failure, online)
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
  staleCount: 0,
  conflictCount: 0,
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
  nowIso = getNowIso,
  random = Math.random,
  setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeoutFn = (handle) => globalThis.clearTimeout(handle)
} = {}) => {
  let timer = null;
  let retryTimer = null;
  let retryAttempt = 0;
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

  const clearRetryTimer = ({ resetAttempt = false } = {}) => {
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
    if (resetAttempt) retryAttempt = 0;
  };

  const scheduleRetry = () => {
    if (!online() || retryTimer) return;
    const baseDelay = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
    const jitter = 0.8 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4);
    const delay = Math.min(60_000, Math.round(baseDelay * jitter));
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      retryAttempt += 1;
      void scheduleSync({
        fullReconcile: false,
        reason: 'retry-backoff',
        immediate: true
      });
    }, delay);
  };

  const resolvePortalId = async ({ scopeIdentity, contextKey, portalId }) => {
    if (asText(portalId)) return asText(portalId);
    if (lastEligibleContext?.contextKey === contextKey) return lastEligibleContext.portalId;
    try {
      return await outbox.getRememberedPortal({ scopeIdentity });
    } catch {
      return null;
    }
  };

  const persistRetryable = async ({
    scopeIdentity,
    contextKey,
    portalId,
    request,
    queued = null,
    failure,
    remainingRefs = null,
    replaceQueued = false
  }) => {
    const resolvedPortalId = await resolvePortalId({ scopeIdentity, contextKey, portalId });
    const refs = uniqueRefs(remainingRefs || [
      ...(request?.productRefs || []),
      ...(queued?.productRefs || [])
    ]);
    const fullReconcile = remainingRefs
      ? false
      : Boolean(request?.fullReconcile || queued?.fullReconcile || refs.length === 0);
    const reason = asText(failure?.code || request?.reason || 'retryable-failure').slice(0, 100);

    let count = refs.length || 1;
    try {
      if (replaceQueued && typeof outbox.replacePending === 'function') {
        count = await outbox.replacePending({
          scopeIdentity,
          portalId: resolvedPortalId,
          entries: queued?.entries || [],
          productRefs: refs,
          fullReconcile,
          reason
        });
      } else {
        count = await outbox.enqueue({
          scopeIdentity,
          portalId: resolvedPortalId,
          productRefs: refs,
          fullReconcile,
          reason
        });
      }
    } catch (outboxError) {
      Logger.warn('[Ecommerce/CatalogSync] Retryable work could not be persisted', {
        operation: 'catalog_sync_outbox',
        code: getFailureCode(outboxError, 'ECOMMERCE_CATALOG_SYNC_OUTBOX_FAILED')
      });
    }

    scheduleRetry();
    return publishStatus({
      state: 'pending',
      pendingCount: Math.max(count, refs.length, 1),
      errorCount: 0,
      lastAttemptAt: nowIso(),
      code: failure?.code || 'ECOMMERCE_CATALOG_SYNC_RETRY_PENDING'
    });
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
    } catch (error) {
      const readError = new Error('No se pudo verificar el catálogo local.');
      readError.code = 'ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED';
      readError.retryable = true;
      readError.cause = error;
      throw readError;
    }

    const categoryIds = uniqueRefs(Array.from(localProductsById.values()).map(getCategoryId));
    let categoriesById = new Map();
    let categoryReadFailed = false;
    if (categoryIds.length > 0) {
      try {
        categoriesById = await localSource.getCategoriesByIds(categoryIds);
      } catch {
        categoryReadFailed = true;
      }
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
    return sortProjections(selectedProducts.map((publishedProduct) => {
      const localProductRef = asText(publishedProduct.localProductRef);
      const localProduct = localProductsById.get(localProductRef);
      const productBatches = batchesByProductId.get(localProductRef) || [];
      const batchManaged = localProduct
        && ecommercePublishedStockAlertServiceInternals.isBatchManaged(localProduct);
      const evaluation = ecommercePublishedStockAlertServiceInternals.classifyProduct({
        publishedProduct,
        localProduct,
        batches: productBatches,
        batchReadFailed,
        now
      });
      return buildProjection({
        publishedProduct,
        localProduct,
        category: localProduct ? categoriesById.get(getCategoryId(localProduct)) : null,
        categoryEvaluated: !categoryReadFailed,
        sourceRevision: localProduct
          ? normalizeSourceRevision(localProduct, batchManaged ? productBatches : [])
          : null,
        evaluation
      });
    }));
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
      return persistRetryable({
        scopeIdentity,
        contextKey,
        request,
        failure: { code: 'ECOMMERCE_CATALOG_SYNC_OFFLINE' }
      });
    }

    publishStatus({
      state: 'syncing',
      reason: request.reason,
      lastAttemptAt: nowIso(),
      code: null
    });

    let portalResult;
    try {
      portalResult = await getPortal();
    } catch (error) {
      portalResult = toFailure(error, 'ECOMMERCE_CATALOG_SYNC_PORTAL_FAILED', online);
    }
    if (portalResult?.success !== true) {
      const failure = toFailure(portalResult, 'ECOMMERCE_CATALOG_SYNC_PORTAL_FAILED', online);
      if (failure.retryable) {
        return persistRetryable({ scopeIdentity, contextKey, request, failure });
      }
      return publishStatus({
        state: 'error',
        errorCount: 1,
        code: failure.code
      });
    }

    const portal = portalResult.portal;
    const eligible = (
      portal
      && portalResult.plan?.code === 'pro_monthly'
      && portalResult.features?.cloudCatalogSource === true
    );
    if (!eligible) {
      clearRetryTimer({ resetAttempt: true });
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

    try {
      await outbox.rememberPortal({ scopeIdentity, portalId: portal.id });
    } catch (error) {
      Logger.warn('[Ecommerce/CatalogSync] Portal scope could not be remembered', {
        operation: 'catalog_sync_outbox',
        code: getFailureCode(error, 'ECOMMERCE_CATALOG_SYNC_OUTBOX_FAILED')
      });
    }

    let productsResult;
    try {
      productsResult = await getPublishedProducts();
    } catch (error) {
      productsResult = toFailure(error, 'ECOMMERCE_CATALOG_SYNC_PRODUCTS_FAILED', online);
    }
    if (productsResult?.success !== true) {
      const failure = toFailure(productsResult, 'ECOMMERCE_CATALOG_SYNC_PRODUCTS_FAILED', online);
      if (failure.retryable) {
        return persistRetryable({
          scopeIdentity,
          contextKey,
          portalId: portal.id,
          request,
          failure
        });
      }
      return publishStatus({
        state: 'error',
        errorCount: 1,
        code: failure.code
      });
    }

    let queued;
    try {
      queued = await outbox.list({ scopeIdentity, portalId: portal.id });
    } catch (error) {
      return publishStatus({
        state: 'error',
        errorCount: 1,
        code: getFailureCode(error, 'ECOMMERCE_CATALOG_SYNC_OUTBOX_FAILED')
      });
    }

    const requestedRefs = new Set(uniqueRefs([
      ...request.productRefs,
      ...queued.productRefs
    ]));
    const fullReconcile = request.fullReconcile || queued.fullReconcile;

    let projections;
    try {
      projections = await buildProjections({
        publishedProducts: productsResult.products || [],
        requestedRefs,
        fullReconcile
      });
    } catch (error) {
      const failure = toFailure(error, 'ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED', online);
      return persistRetryable({
        scopeIdentity,
        contextKey,
        portalId: portal.id,
        request,
        queued,
        failure
      });
    }

    if (!isContextCurrent(contextKey, requestEpoch)) {
      return { success: false, stale: true };
    }

    if (projections.length === 0) {
      await outbox.acknowledge({
        scopeIdentity,
        portalId: portal.id,
        entries: queued.entries
      });
      clearRetryTimer({ resetAttempt: true });
      return publishStatus({
        state: 'synced',
        pendingCount: 0,
        errorCount: 0,
        reviewCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        staleCount: 0,
        conflictCount: 0,
        catalogRevision: portal.catalogRevision || null,
        lastSyncedAt: nowIso(),
        code: null
      });
    }

    let expectedCatalogRevision = Number(portal.catalogRevision) || null;
    let updatedCount = 0;
    let skippedCount = 0;
    let reviewCount = 0;
    let staleCount = 0;
    let conflictCount = 0;
    const projectionBatches = chunk(projections, RPC_BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < projectionBatches.length; batchIndex += 1) {
      const projectionsBatch = projectionBatches[batchIndex];
      const idempotencyKey = await buildBatchIdempotencyKey({
        portalId: portal.id,
        projections: projectionsBatch
      });

      let result;
      try {
        result = await syncBatch({
          projections: projectionsBatch,
          idempotencyKey,
          expectedCatalogRevision
        });
      } catch (error) {
        result = toFailure(error, 'ECOMMERCE_CATALOG_SYNC_FAILED', online);
      }

      if (!isContextCurrent(contextKey, requestEpoch)) {
        return { success: false, stale: true };
      }
      if (result?.success !== true) {
        const failure = toFailure(result, 'ECOMMERCE_CATALOG_SYNC_FAILED', online);
        if (result?.code === 'ECOMMERCE_CATALOG_REVISION_CHANGED') dirty = true;

        Logger.warn('[Ecommerce/CatalogSync] Batch failed', {
          operation: 'sync_published_catalog',
          code: failure.code,
          count: projectionsBatch.length,
          revision: expectedCatalogRevision
        });

        if (failure.retryable) {
          const firstPendingIndex = batchIndex * RPC_BATCH_SIZE;
          const remainingRefs = projections
            .slice(firstPendingIndex)
            .map((projection) => projection.localProductRef);
          return persistRetryable({
            scopeIdentity,
            contextKey,
            portalId: portal.id,
            request,
            queued,
            failure,
            remainingRefs,
            replaceQueued: true
          });
        }

        return publishStatus({
          state: 'error',
          pendingCount: Math.max(queued.entries.length, projections.length - (batchIndex * RPC_BATCH_SIZE)),
          errorCount: 1,
          code: failure.code
        });
      }

      updatedCount += Number(result.updatedCount || 0);
      skippedCount += Number(result.skippedCount || 0);
      reviewCount += Number(result.reviewCount || 0);
      staleCount += Number(result.staleCount || 0);
      conflictCount += Number(result.conflictCount || 0);
      expectedCatalogRevision = Number(result.catalogRevision) || expectedCatalogRevision;
    }

    await outbox.acknowledge({
      scopeIdentity,
      portalId: portal.id,
      entries: queued.entries
    });
    void outbox.cleanup();
    clearRetryTimer({ resetAttempt: true });

    Logger.log('[Ecommerce/CatalogSync] Sync completed', {
      operation: 'sync_published_catalog',
      count: projections.length,
      revision: expectedCatalogRevision,
      source: request.reason,
      staleCount,
      conflictCount
    });
    return publishStatus({
      state: reviewCount > 0 || staleCount > 0 || conflictCount > 0 ? 'review' : 'synced',
      pendingCount: 0,
      errorCount: 0,
      reviewCount,
      updatedCount,
      skippedCount,
      staleCount,
      conflictCount,
      catalogRevision: expectedCatalogRevision,
      lastSyncedAt: nowIso(),
      code: staleCount > 0
        ? 'ECOMMERCE_CATALOG_SOURCE_STALE'
        : conflictCount > 0
          ? 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'
          : null
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
    if (timer) clearTimeoutFn(timer);

    if (immediate) return startDrain();
    timer = setTimeoutFn(() => {
      timer = null;
      void startDrain();
    }, debounceMs);
    return null;
  };

  const syncNow = (options = {}) => {
    if (options.reason === 'online' || options.reason === 'visibility' || options.reason === 'manual') {
      clearRetryTimer();
    }
    return scheduleSync({
      ...options,
      fullReconcile: options.fullReconcile !== false,
      reason: options.reason || 'manual',
      immediate: true
    });
  };

  const invalidateContext = () => {
    contextEpoch += 1;
    if (timer) clearTimeoutFn(timer);
    timer = null;
    clearRetryTimer({ resetAttempt: true });
    pendingProductRefs = new Set();
    pendingFullReconcile = false;
    dirty = false;
    lastEligibleContext = null;
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
  normalizeSourceRevision,
  normalizeVersionNumber,
  compareVersionNumbers,
  statusToSourceAvailability,
  normalizeProjectionForSignature,
  stableStringify,
  sortProjections,
  buildBatchIdempotencyKey,
  isRetryableCatalogSyncError,
  getScopeIdentity,
  RPC_BATCH_SIZE,
  RETRY_BACKOFF_MS
});
