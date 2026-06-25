export const POS_SYNC_STORES = Object.freeze({
  OUTBOX: 'sync_outbox',
  META: 'sync_meta',
  CONFLICTS: 'sync_conflicts'
});

export const SYNC_STATUS = Object.freeze({
  DISABLED: 'disabled',
  ONLINE: 'online',
  OFFLINE: 'offline',
  DEGRADED: 'degraded',
  ERROR: 'error'
});

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict'
});

export const CONFLICT_STATUS = Object.freeze({
  PENDING: 'pending',
  RESOLVED: 'resolved',
  IGNORED: 'ignored'
});

export const SYNC_ENTITY_TYPES = Object.freeze({
  CUSTOMER: 'customer',
  CUSTOMER_LEDGER: 'customer_ledger',
  CUSTOMER_CREDIT: 'customer_credit',
  CUSTOMER_PAYMENT: 'customer_payment',
  CATEGORY: 'category',
  PRODUCT: 'product',
  PRODUCT_BATCH: 'product_batch',
  CASH: 'cash',
  CASH_SESSION: 'cash_session',
  CASH_MOVEMENT: 'cash_movement',
  SALE: 'sale',
  SALE_ITEM: 'sale_item',
  SALE_PAYMENT: 'sale_payment',
  REPORT: 'report',
  GENERIC: 'generic'
});

export const SYNC_OPERATIONS = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  RESTORE: 'restore',
  UPSERT: 'upsert',
  UPSERT_SHADOW: 'upsert_shadow',
  PULL_SNAPSHOT: 'pull_snapshot',
  PULL_CHANGES: 'pull_changes',
  TOGGLE_STATUS: 'toggle_status',
  OPEN: 'open',
  CLOSE: 'close',
  MOVEMENT: 'movement',
  ADJUST: 'adjust',
  UNKNOWN: 'unknown'
});

export const SYNC_META_KEYS = Object.freeze({
  LAST_CHANGE_SEQ: 'pos_last_change_seq',
  SYNC_ENABLED: 'pos_sync_enabled',
  LAST_FULL_PULL_AT: 'pos_last_full_pull_at',
  REALTIME_STATUS: 'pos_realtime_status',
  LAST_PULL_AT: 'pos_last_pull_at',
  LAST_PULL_ERROR: 'pos_last_pull_error'
});

export const SYNC_LIMITS = Object.freeze({
  DEFAULT_PULL_LIMIT: 500,
  MAX_PULL_LIMIT: 1000,
  DEFAULT_OUTBOX_LIMIT: 50,
  STUCK_PROCESSING_MS: 2 * 60 * 1000
});

export const RETRY_CONFIG = Object.freeze({
  BASE_DELAY_MS: 1500,
  MAX_DELAY_MS: 60 * 1000,
  MAX_ATTEMPTS: 8
});

export const isFeatureEnabled = (features = {}, featureName) => (
  features?.[featureName] === true || features?.[featureName] === 'true'
);

export const getPlanFeaturesFromLicenseDetails = (licenseDetails = {}) => (
  licenseDetails?.features || licenseDetails?.details?.features || {}
);

export const isCloudPosSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync');
};

export const isCloudProductsSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync') && isFeatureEnabled(features, 'cloud_products_sync');
};

export const isCloudCashSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync') && isFeatureEnabled(features, 'cloud_cash_sync');
};

export const isCloudCustomerCreditSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_customer_credit_sync');
};

export const isCloudSalesBaseSyncEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync') && isFeatureEnabled(features, 'cloud_sales_sync_base');
};

export const getLicenseKeyFromDetails = (licenseDetails = {}) => (
  licenseDetails?.license_key ||
  licenseDetails?.licenseKey ||
  licenseDetails?.details?.license_key ||
  null
);
