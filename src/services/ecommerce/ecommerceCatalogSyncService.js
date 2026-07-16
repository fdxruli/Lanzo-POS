import { ecommerceCatalogSyncOutbox } from './ecommerceCatalogSyncOutbox';
import {
  ecommercePublishedStockLocalSource,
  ecommercePublishedStockLocalSourceInternals
} from './ecommercePublishedStockLocalSource';
import {
  ecommercePublishedStockAlertServiceInternals
} from './ecommercePublishedStockAlertService';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ECOMMERCE_CATALOG_SYNC_STATUS_EVENT,
  createEcommerceCatalogSyncService as createBaseEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from './ecommerceCatalogSyncServiceBase';

const OUTBOX_RETRY_SENTINEL = '__lanzo_catalog_outbox_retry__';
const MIN_RETRY_TIMER_MS = Math.min(...ecommerceCatalogSyncServiceInternals.RETRY_BACKOFF_MS) * 0.8;
const INGREDIENTS_KEY = ecommercePublishedStockLocalSourceInternals.ENRICHED_INGREDIENTS_KEY;

const defaultSetTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay);
const defaultClearTimeoutFn = (handle) => globalThis.clearTimeout(handle);
const asArray = (value) => (Array.isArray(value) ? value : []);

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

const decorateBatchForDependencySync = (batch = {}) => {
  const dependencyRevision = getRecordRevisionNumber(batch);
  if (dependencyRevision === null) return batch;
  return { ...batch, serverVersion: dependencyRevision };
};

const createDependencyAwareLocalSource = (sourceLocal = ecommercePublishedStockLocalSource) => ({
  ...sourceLocal,
  async getProductsByIds(productIds = []) {
    const products = await sourceLocal.getProductsByIds(productIds);
    return new Map(Array.from(products.entries()).map(([id, product]) => [
      id,
      decorateProductForDependencySync(product)
    ]));
  },
  async getBatchesByProductIds(productIds = []) {
    const batchesByProduct = await sourceLocal.getBatchesByProductIds(productIds);
    return new Map(Array.from(batchesByProduct.entries()).map(([id, batches]) => [
      id,
      asArray(batches).map(decorateBatchForDependencySync)
    ]));
  }
});

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
  const setTimeoutFn = options.setTimeoutFn || defaultSetTimeoutFn;
  const clearTimeoutFn = options.clearTimeoutFn || defaultClearTimeoutFn;
  let retryPersistenceMode = null;
  let service = null;

  const outbox = createRetryAwareOutbox({
    sourceOutbox,
    onRetryPersistence: (mode) => {
      retryPersistenceMode = mode;
    }
  });
  const localSource = createDependencyAwareLocalSource(sourceLocal);

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
  getRecordRevisionNumber,
  getDependencyAwareRevisionNumber,
  decorateProductForDependencySync,
  decorateBatchForDependencySync,
  createDependencyAwareLocalSource
});
