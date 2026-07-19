const asText = (value) => String(value ?? '').trim();

// This is deliberately a non-cryptographic, stable correlation value. It lets
// support correlate one device/license without writing either secret to logs.
const anonymizeScope = (value, prefix) => {
  const text = asText(value);
  if (!text) return null;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
};

const safeCause = (cause) => {
  if (!cause) return null;
  return {
    code: asText(cause.code) || null,
    name: asText(cause.name) || null,
    message: asText(cause.message).slice(0, 500) || null
  };
};

export const createProductCatalogSyncError = (message, context = {}, cause = null) => {
  const error = new Error(message || context.code || 'PRODUCT_CATALOG_SYNC_FAILED');
  error.name = context.name || 'ProductCatalogSyncError';
  error.code = context.code || 'PRODUCT_CATALOG_SYNC_FAILED';
  error.catalogSyncContext = context;
  if (cause) error.cause = cause;
  return error;
};

export const serializeProductCatalogSyncError = (error, context = {}) => {
  const response = error?.response || error?.catalogSyncContext?.response || {};
  const errorContext = error?.catalogSyncContext || {};
  return {
    operation: context.operation || errorContext.operation || 'product_catalog_sync',
    phase: context.phase || errorContext.phase || 'unknown',
    code: asText(context.code || error?.code || response?.code) || 'PRODUCT_CATALOG_SYNC_FAILED',
    name: asText(error?.name) || null,
    message: asText(error?.message || response?.message).slice(0, 500) || null,
    entityType: context.entityType || errorContext.entityType || null,
    entityId: context.entityId ?? errorContext.entityId ?? null,
    store: context.store || errorContext.store || null,
    index: Number.isInteger(context.index ?? errorContext.index) ? (context.index ?? errorContext.index) : null,
    offset: Number.isFinite(Number(context.offset ?? errorContext.offset)) ? Number(context.offset ?? errorContext.offset) : null,
    retryable: context.retryable ?? errorContext.retryable ?? response?.retryable ?? false,
    licenseScope: anonymizeScope(context.licenseKey || errorContext.licenseKey, 'license'),
    deviceScope: anonymizeScope(context.deviceId || errorContext.deviceId, 'device'),
    cause: safeCause(error?.cause)
  };
};

export default serializeProductCatalogSyncError;
