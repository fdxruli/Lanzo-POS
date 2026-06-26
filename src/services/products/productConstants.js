import { SYNC_ENTITY_TYPES } from '../sync/syncConstants';

export const PRODUCT_SYNC_STATUS = Object.freeze({
  LOCAL: 'local',
  PENDING: 'pending',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error'
});

export const PRODUCT_SYNC_EVENT = 'lanzo:products-sync-updated';

export const PRODUCT_CATALOG_LAST_SEQ_KEY = 'products_catalog_last_change_seq';
export const PRODUCTS_MIGRATED_META_PREFIX = 'products_cloud_migrated_for_license';
export const PRODUCTS_MIGRATED_AT_META_KEY = 'products_cloud_migrated_at';
export const PRODUCTS_MIGRATION_WARNING_META_KEY = 'products_cloud_migration_warning';
export const PRODUCTS_LAST_SNAPSHOT_AT_META_KEY = 'products_last_snapshot_at';

export const PRODUCT_CATALOG_ENTITY_TYPES = new Set([
  SYNC_ENTITY_TYPES.CATEGORY,
  SYNC_ENTITY_TYPES.PRODUCT,
  SYNC_ENTITY_TYPES.PRODUCT_BATCH,
  SYNC_ENTITY_TYPES.INVENTORY_MOVEMENT
]);

export const PRODUCT_MIGRATION_BATCH_SIZE = 20;
export const PRODUCT_CLOUD_PHASE = 'fase2_products_catalog';

export const buildProductsMigratedMetaKey = (licenseKey) => (
  `${PRODUCTS_MIGRATED_META_PREFIX}:${licenseKey || 'unknown'}`
);
