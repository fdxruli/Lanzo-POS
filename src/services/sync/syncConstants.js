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
  PREPARATION_STATION: 'preparation_station',
  RESTAURANT_ORDER: 'restaurant_order',
  RESTAURANT_ORDER_ITEM: 'restaurant_order_item',
  INVENTORY_MOVEMENT: 'inventory_movement',
  CASH: 'cash',
  CASH_SESSION: 'cash_session',
  CASH_MOVEMENT: 'cash_movement',
  SALE: 'sale',
  SALE_ITEM: 'sale_item',
  SALE_PAYMENT: 'sale_payment',
  SALE_CANCELLATION: 'sale_cancellation',
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
  CLOUD_COMMIT: 'cloud_commit',
  CANCEL: 'cancel',
  PULL_SNAPSHOT: 'pull_snapshot',
  PULL_CHANGES: 'pull_changes',
  TOGGLE_STATUS: 'toggle_status',
  STATUS_UPDATE: 'status_update',
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

export const POS_SYNC_REALTIME_PULL_DEBOUNCE_MS = 1000;
export const POS_SYNC_FOCUS_PULL_COOLDOWN_MS = 60 * 1000;
export const POS_SYNC_MAX_PULL_LIMIT = 500;

export const POS_BOOTSTRAP_JITTER_MS = Object.freeze({
  MIN: 500,
  MAX: 3500
});

export const POS_DEFERRED_SNAPSHOT_DELAY_MS = Object.freeze({
  PRODUCTS: 1500,
  CUSTOMERS: 2500,
  CASH: 2000,
  CREDIT: 3000,
  SALES: 4000,
  REPORTS: 5000
});

export const POS_BOOTSTRAP_RESOURCES = Object.freeze({
  POS: 'pos',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  CASH: 'cash',
  CREDIT: 'credit',
  SALES: 'sales',
  REPORTS: 'reports'
});

const BOOTSTRAP_DEFERRED_START_REASONS = new Set([
  'app_ready',
  'initial_bootstrap',
  'store_update',
  'state_change'
]);

export const shouldDeferPosBootstrapStartHook = (reason = '', { force = false } = {}) => {
  if (force) return false;
  return BOOTSTRAP_DEFERRED_START_REASONS.has(String(reason || '').toLowerCase());
};

export const SYNC_LIMITS = Object.freeze({
  DEFAULT_PULL_LIMIT: POS_SYNC_MAX_PULL_LIMIT,
  MAX_PULL_LIMIT: POS_SYNC_MAX_PULL_LIMIT,
  DEFAULT_OUTBOX_LIMIT: 50,
  STUCK_PROCESSING_MS: 2 * 60 * 1000
});

export const RETRY_CONFIG = Object.freeze({
  BASE_DELAY_MS: 1500,
  MAX_DELAY_MS: 60 * 1000,
  MAX_ATTEMPTS: 8
});

export const ENABLE_CLOUD_SALE_CANCELLATIONS =
  import.meta.env.VITE_ENABLE_CLOUD_SALE_CANCELLATIONS !== 'false';

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

export const isRestaurantOrdersCloudEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && features?.restaurant_orders_cloud !== false;
};

export const isCloudSalesCashierEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_sales_cashier');
};

export const isCloudSalesCreditEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_sales_cashier')
    && isFeatureEnabled(features, 'cloud_customer_credit_sync')
    && isFeatureEnabled(features, 'cloud_sales_credit');
};

export const isCloudSalesInventoryEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_products_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_sales_cashier')
    && isFeatureEnabled(features, 'cloud_sales_inventory');
};

export const isCloudSalesCancellationEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_sales_cashier')
    && isFeatureEnabled(features, 'cloud_sales_cancellations');
};

export const isCloudSalesReportsFinalEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'cloud_pos_sync')
    && isFeatureEnabled(features, 'cloud_reports_sync')
    && isFeatureEnabled(features, 'cloud_sales_sync_base')
    && isFeatureEnabled(features, 'cloud_cash_sync')
    && isFeatureEnabled(features, 'cloud_sales_cashier')
    && isFeatureEnabled(features, 'cloud_sales_reports_final');
};

export const isPreparationStationsEnabled = (licenseDetails = {}) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  return isFeatureEnabled(features, 'preparation_stations');
};

export const getLicenseKeyFromDetails = (licenseDetails = {}) => (
  licenseDetails?.license_key ||
  licenseDetails?.licenseKey ||
  licenseDetails?.details?.license_key ||
  null
);
