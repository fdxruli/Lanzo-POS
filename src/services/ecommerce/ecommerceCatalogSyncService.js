import { ecommerceCatalogSyncOutbox } from './ecommerceCatalogSyncOutbox';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ECOMMERCE_CATALOG_SYNC_STATUS_EVENT,
  createEcommerceCatalogSyncService as createBaseEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from './ecommerceCatalogSyncServiceBase';

const OUTBOX_RETRY_SENTINEL = '__lanzo_catalog_outbox_retry__';
const MIN_RETRY_TIMER_MS = Math.min(...ecommerceCatalogSyncServiceInternals.RETRY_BACKOFF_MS) * 0.8;

const defaultSetTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay);
const defaultClearTimeoutFn = (handle) => globalThis.clearTimeout(handle);

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
