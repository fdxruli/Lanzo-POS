import { ecommerceCatalogSyncOutbox } from './ecommerceCatalogSyncOutbox';
import {
  ecommercePublishedStockLocalSource,
  ecommercePublishedStockLocalSourceInternals
} from './ecommercePublishedStockLocalSource';
import {
  ecommercePublishedStockAlertServiceInternals
} from './ecommercePublishedStockAlertService';
import { syncPublishedCatalog } from './ecommerceAdminService';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ECOMMERCE_CATALOG_SYNC_STATUS_EVENT,
  createEcommerceCatalogSyncService as createBaseEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from './ecommerceCatalogSyncServiceBase';
import {
  buildEcommerceProductConfigurationSyncPayload,
  getEcommerceConfigurationSourceRevision,
  serializeEcommerceProductConfigurationForSync
} from '../../utils/ecommerceProductConfigurationSync';
import {
  decorateProductWithEcommerceApparelProjection,
  getEcommerceApparelProjectionState,
  projectProductBatchesToEcommerceVariants
} from './ecommerceApparelVariants';

const OUTBOX_RETRY_SENTINEL = '__lanzo_catalog_outbox_retry__';
const MIN_RETRY_TIMER_MS = Math.min(...ecommerceCatalogSyncServiceInternals.RETRY_BACKOFF_MS) * 0.8;
const INGREDIENTS_KEY = ecommercePublishedStockLocalSourceInternals.ENRICHED_INGREDIENTS_KEY;
const MISSING_BATCH_SNAPSHOT_KEY = '__ecommerceBatchSnapshotMissing';

const defaultSetTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay);
const defaultClearTimeoutFn = (handle) => globalThis.clearTimeout(handle);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? '').trim();

const hashStableText = (value) => {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
};

const buildProjectedProductConfiguration = (product = {}) => {
  const baseConfiguration = buildEcommerceProductConfigurationSyncPayload(product);
  const apparelState = getEcommerceApparelProjectionState(product);
  if (!apparelState) return baseConfiguration;

  return serializeEcommerceProductConfigurationForSync({
    ...baseConfiguration,
    type: 'variant_parent',
    variants: asArray(product.variants),
    availabilitySource: 'variant_aggregate',
    availabilityReasonCode: apparelState.availabilityReasonCode,
    limitingSource: baseConfiguration.limitingSource
  });
};

const getPublicConfigurationRevision = (product = {}) => {
  try {
    const configuration = buildProjectedProductConfiguration(product);
    return `configuration:${hashStableText(JSON.stringify(configuration))}`;
  } catch {
    return getEcommerceConfigurationSourceRevision(product) || null;
  }
};

const getRecordRevisionNumber = (record = {}) => {
  const timestamp = Date.parse(String(
    record.updatedAt
    ?? record.updated_at
    ?? record.lastModified
    ?? record.last_modified
    ?? ''
  ));
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;

  const version = Number(
    record.serverVersion
    ?? record.server_version
    ?? record.syncVersion
    ?? record.sync_version
  );
  return Number.isFinite(version) && version >= 0 ? version : null;
};

const getDependencyAwareRevisionNumber = (records = []) => {
  const revisions = records
    .map(getRecordRevisionNumber)
    .filter((value) => value !== null);
  return revisions.length > 0 ? Math.max(...revisions) : null;
};

const getRawAvailableStock = (record = {}) => {
  const stockValue = record.stock ?? record.quantity;
  const committedValue = record.committedStock ?? record.committed_stock ?? 0;
  const stock = Number(stockValue);
  const committed = Number(committedValue);
  if (
    stockValue === null
    || stockValue === undefined
    || stockValue === ''
    || !Number.isFinite(stock)
    || !Number.isFinite(committed)
    || stock < 0
    || committed < 0
  ) {
    return null;
  }
  return Math.max(0, stock - committed);
};

const getBatchProductId = (batch = {}) => asText(batch.productId ?? batch.product_id);

const markMissingBatchSnapshots = (product = {}, batches = []) => {
  const ingredients = asArray(product[INGREDIENTS_KEY]);
  if (ingredients.length === 0) return product;

  const batchProductIds = new Set(asArray(batches).map(getBatchProductId).filter(Boolean));
  let changed = false;
  const nextIngredients = ingredients.map((ingredient) => {
    if (!ecommercePublishedStockAlertServiceInternals.isBatchManaged(ingredient)) {
      return ingredient;
    }

    const ingredientId = asText(ingredient.id);
    const rawAvailable = getRawAvailableStock(ingredient);
    if (!ingredientId || batchProductIds.has(ingredientId) || !(rawAvailable > 0)) {
      return ingredient;
    }

    changed = true;
    return {
      ...ingredient,
      stock: null,
      batchManagement: {
        ...(ingredient.batchManagement || ingredient.batch_management || {}),
        enabled: false
      },
      [MISSING_BATCH_SNAPSHOT_KEY]: true
    };
  });

  return changed
    ? { ...product, [INGREDIENTS_KEY]: nextIngredients }
    : product;
};

const decorateProductForDependencySync = (product = {}) => {
  const ingredients = asArray(product[INGREDIENTS_KEY]);
  if (ingredients.length === 0) return product;

  const dependencyRevision = getDependencyAwareRevisionNumber([product, ...ingredients]);
  const hasBatchManagedIngredient = ingredients.some(
    ecommercePublishedStockAlertServiceInternals.isBatchManaged
  );

  return {
    ...product,
    ...(dependencyRevision === null ? {} : { serverVersion: dependencyRevision }),
    ...(hasBatchManagedIngredient
      ? {
          batchManagement: {
            ...(product.batchManagement || product.batch_management || {}),
            enabled: true
          }
        }
      : {})
  };
};

const decorateProductWithApparelVariants = ({ product = {}, batches = [] } = {}) => {
  if (asArray(product.variants).length > 0) return product;
  const projection = projectProductBatchesToEcommerceVariants({ product, batches });
  return decorateProductWithEcommerceApparelProjection({ product, projection });
};

const decorateBatchForDependencySync = (batch = {}) => {
  const dependencyRevision = getRecordRevisionNumber(batch);
  if (dependencyRevision === null) return batch;
  return { ...batch, serverVersion: dependencyRevision };
};

const createDependencyAwareLocalSource = (
  sourceLocal = ecommercePublishedStockLocalSource,
  { onConfigurationProjection = () => {} } = {}
) => {
  const prefetchedBatches = new Map();

  return {
    ...sourceLocal,
    async getProductsByIds(productIds = []) {
      const products = await sourceLocal.getProductsByIds(productIds);
      const batchParentIds = [];

      products.forEach((product, id) => {
        const selfBatchManaged = ecommercePublishedStockAlertServiceInternals.isBatchManaged(product);
        const dependencyBatchManaged = asArray(product?.[INGREDIENTS_KEY]).some(
          ecommercePublishedStockAlertServiceInternals.isBatchManaged
        );
        if (selfBatchManaged || dependencyBatchManaged) {
          batchParentIds.push(asText(id));
        }
      });

      if (batchParentIds.length > 0) {
        try {
          const batchesByProduct = await sourceLocal.getBatchesByProductIds(batchParentIds);
          batchParentIds.forEach((id) => {
            prefetchedBatches.set(id, {
              batches: asArray(batchesByProduct.get(id)),
              error: null
            });
          });
        } catch (error) {
          batchParentIds.forEach((id) => {
            prefetchedBatches.set(id, { batches: [], error });
          });
        }
      }

      return new Map(Array.from(products.entries()).map(([id, product]) => {
        const productId = asText(id);
        const prefetched = prefetchedBatches.get(productId);
        const snapshotSafeProduct = prefetched?.error
          ? product
          : markMissingBatchSnapshots(product, prefetched?.batches || []);
        const dependencyAwareProduct = decorateProductForDependencySync(snapshotSafeProduct);
        const configuredProduct = prefetched?.error
          ? dependencyAwareProduct
          : decorateProductWithApparelVariants({
              product: dependencyAwareProduct,
              batches: prefetched?.batches || []
            });
        const configuration = buildProjectedProductConfiguration(configuredProduct);
        const apparelState = getEcommerceApparelProjectionState(configuredProduct);
        onConfigurationProjection(productId, {
          configuration,
          revision: `configuration:${hashStableText(JSON.stringify(configuration))}`,
          apparelState
        });
        return [id, configuredProduct];
      }));
    },
    async getBatchesByProductIds(productIds = []) {
      const ids = productIds.map(asText).filter(Boolean);
      const missingIds = ids.filter((id) => !prefetchedBatches.has(id));

      if (missingIds.length > 0) {
        const batchesByProduct = await sourceLocal.getBatchesByProductIds(missingIds);
        missingIds.forEach((id) => {
          prefetchedBatches.set(id, {
            batches: asArray(batchesByProduct.get(id)),
            error: null
          });
        });
      }

      const result = new Map();
      ids.forEach((id) => {
        const prefetched = prefetchedBatches.get(id);
        prefetchedBatches.delete(id);
        if (prefetched?.error) throw prefetched.error;
        result.set(id, asArray(prefetched?.batches).map(decorateBatchForDependencySync));
      });
      return result;
    }
  };
};

const patchConfigurationProjections = (
  projections = [],
  configurationsByProduct = new Map()
) => (
  asArray(projections).map((projection) => {
    const localProductRef = asText(projection?.localProductRef);
    const projected = configurationsByProduct.get(localProductRef);
    if (!localProductRef || !projected) return projection;

    const apparelState = projected.apparelState;
    return {
      ...projection,
      configuration: projected.configuration,
      configurationSourceRevision: projected.revision,
      ...(apparelState
        ? {
            sourceAvailable: apparelState.sourceAvailable === true,
            sourceState: apparelState.sourceAvailable === true ? 'in_stock' : 'out_of_stock',
            stockSnapshot: Math.max(0, Number(apparelState.stockSnapshot) || 0)
          }
        : {})
    };
  })
);

const getPortalIdFromBatchIdempotencyKey = (idempotencyKey) => {
  const prefix = 'ecom-catalog-sync:';
  const normalizedKey = asText(idempotencyKey);
  if (!normalizedKey.startsWith(prefix)) return null;

  const keyBody = normalizedKey.slice(prefix.length);
  const hashSeparator = keyBody.lastIndexOf(':');
  if (hashSeparator <= 0) return null;
  return asText(keyBody.slice(0, hashSeparator)) || null;
};

const prepareSyncBatchRequest = async (
  request = {},
  configurationsByProduct = new Map()
) => {
  const projections = patchConfigurationProjections(
    request.projections,
    configurationsByProduct
  );
  const portalId = getPortalIdFromBatchIdempotencyKey(request.idempotencyKey);
  if (!portalId) {
    return {
      ...request,
      projections
    };
  }

  const idempotencyKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
    portalId,
    projections
  });
  return {
    ...request,
    projections,
    idempotencyKey
  };
};

const patchConfigurationRevisions = (projections = [], revisionsByProduct = new Map()) => (
  asArray(projections).map((projection) => {
    const localProductRef = asText(projection?.localProductRef);
    if (!localProductRef || !revisionsByProduct.has(localProductRef)) return projection;
    return {
      ...projection,
      configurationSourceRevision: revisionsByProduct.get(localProductRef)
    };
  })
);

const createRetryAwareOutbox = ({ sourceOutbox, onRetryPersistence }) => {
  const wrappedOutbox = { ...sourceOutbox };

  const wrapPersistenceMethod = (methodName) => {
    if (typeof sourceOutbox?.[methodName] !== 'function') return;
    wrappedOutbox[methodName] = async (...args) => {
      try {
        const result = await sourceOutbox[methodName](...args);
        onRetryPersistence('outbox');
        return result;
      } catch (error) {
        onRetryPersistence('full-reconcile');
        throw error;
      }
    };
  };

  wrapPersistenceMethod('enqueue');
  wrapPersistenceMethod('replacePending');
  return wrappedOutbox;
};

export const createEcommerceCatalogSyncService = (options = {}) => {
  const sourceOutbox = options.outbox || ecommerceCatalogSyncOutbox;
  const sourceLocal = options.localSource || ecommercePublishedStockLocalSource;
  const sourceSyncBatch = options.syncBatch || syncPublishedCatalog;
  const setTimeoutFn = options.setTimeoutFn || defaultSetTimeoutFn;
  const clearTimeoutFn = options.clearTimeoutFn || defaultClearTimeoutFn;
  const configurationProjectionsByProduct = new Map();
  let retryPersistenceMode = null;
  let service = null;

  const outbox = createRetryAwareOutbox({
    sourceOutbox,
    onRetryPersistence: (mode) => {
      retryPersistenceMode = mode;
    }
  });
  const localSource = createDependencyAwareLocalSource(sourceLocal, {
    onConfigurationProjection: (productId, projection) => {
      configurationProjectionsByProduct.set(productId, projection);
    }
  });
  const syncBatch = async (request = {}) => sourceSyncBatch(
    await prepareSyncBatchRequest(request, configurationProjectionsByProduct)
  );

  const retrySafeSetTimeout = (callback, delay) => {
    const numericDelay = Number(delay);
    const retryMode = retryPersistenceMode;
    const isRetryTimer = (
      retryMode !== null
      && Number.isFinite(numericDelay)
      && numericDelay >= MIN_RETRY_TIMER_MS
    );

    if (!isRetryTimer) return setTimeoutFn(callback, delay);

    retryPersistenceMode = null;
    return setTimeoutFn(() => {
      if (!service) {
        callback();
        return;
      }

      if (retryMode === 'outbox') {
        void service.scheduleSync({
          productIds: [OUTBOX_RETRY_SENTINEL],
          fullReconcile: false,
          reason: 'retry-backoff',
          immediate: true
        });
        return;
      }

      void service.scheduleSync({
        fullReconcile: true,
        reason: 'retry-backoff-outbox-fallback',
        immediate: true
      });
    }, delay);
  };

  const retrySafeClearTimeout = (handle) => {
    retryPersistenceMode = null;
    return clearTimeoutFn(handle);
  };

  service = createBaseEcommerceCatalogSyncService({
    ...options,
    localSource,
    syncBatch,
    outbox,
    setTimeoutFn: retrySafeSetTimeout,
    clearTimeoutFn: retrySafeClearTimeout
  });
  return service;
};

export const ecommerceCatalogSyncService = createEcommerceCatalogSyncService();

export {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ECOMMERCE_CATALOG_SYNC_STATUS_EVENT,
  ecommerceCatalogSyncServiceInternals
};

export const ecommerceCatalogSyncRetryInternals = Object.freeze({
  OUTBOX_RETRY_SENTINEL,
  MIN_RETRY_TIMER_MS,
  createRetryAwareOutbox
});

export const ecommerceCatalogSyncDependencyInternals = Object.freeze({
  INGREDIENTS_KEY,
  MISSING_BATCH_SNAPSHOT_KEY,
  hashStableText,
  buildProjectedProductConfiguration,
  getPublicConfigurationRevision,
  getRecordRevisionNumber,
  getDependencyAwareRevisionNumber,
  getRawAvailableStock,
  markMissingBatchSnapshots,
  decorateProductForDependencySync,
  decorateProductWithApparelVariants,
  decorateBatchForDependencySync,
  createDependencyAwareLocalSource,
  patchConfigurationRevisions,
  patchConfigurationProjections,
  getPortalIdFromBatchIdempotencyKey,
  prepareSyncBatchRequest
});
