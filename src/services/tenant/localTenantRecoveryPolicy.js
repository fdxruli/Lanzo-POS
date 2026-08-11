/**
 * Recovery.1 is intentionally a policy and planning layer only.  It never
 * makes a legacy database operational and it never grants access to a row.
 */
export const RECOVERY_PLAN_VERSION = 1;

export const RECOVERY_PLAN_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  INSPECTED: 'INSPECTED',
  PLAN_CREATED: 'PLAN_CREATED',
  USER_CONFIRMED: 'USER_CONFIRMED',
  COPY_IN_PROGRESS: 'COPY_IN_PROGRESS',
  VERIFIED: 'VERIFIED',
  ACTIVATED: 'ACTIVATED',
  QUARANTINED: 'QUARANTINED',
  FAILED_RESUMABLE: 'FAILED_RESUMABLE',
  CANCELLED: 'CANCELLED'
});

export const RECOVERY_ROW_CLASSIFICATION = Object.freeze({
  PROVEN_DIRECT: 'PROVEN_DIRECT',
  PROVEN_RELATIONAL: 'PROVEN_RELATIONAL',
  CLOUD_RECONCILABLE: 'CLOUD_RECONCILABLE',
  AMBIGUOUS: 'AMBIGUOUS',
  FOREIGN: 'FOREIGN',
  DERIVED_RECOMPUTE: 'DERIVED_RECOMPUTE',
  DO_NOT_MIGRATE: 'DO_NOT_MIGRATE',
  DEVICE_GLOBAL: 'DEVICE_GLOBAL'
});

export const RECOVERY_PROVENANCE_TIER = Object.freeze({
  A: 'TIER_A',
  B: 'TIER_B',
  C: 'TIER_C',
  D: 'TIER_D'
});

export const RECOVERY_DESTINATION_ACTION = Object.freeze({
  COPY_IF_PROVEN: 'COPY_IF_PROVEN',
  RECOMPUTE: 'RECOMPUTE',
  QUARANTINE: 'QUARANTINE',
  PRESERVE_VAULT: 'PRESERVE_VAULT',
  IGNORE_OPERATIONALLY: 'IGNORE_OPERATIONALLY'
});

const policy = (primaryKey, options = {}) => Object.freeze({
  primaryKey,
  relationshipFields: [],
  directProof: false,
  cloudReconciliation: false,
  relationalPropagation: false,
  destinationAction: RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN,
  scope: 'tenant_owned',
  ...options
});

/**
 * This is the sole registry for future recovery phases.  "copy" always means
 * copy to a future tenant-specific destination, never alter LanzoDB1.
 */
export const LEGACY_RECOVERY_STORE_POLICY = Object.freeze({
  menu: policy('id', {
    relationshipFields: ['categoryId', 'imageRef', 'recipe[].ingredientId', 'modifiers[].ingredientId'],
    cloudReconciliation: true
  }),
  product_batches: policy('id', {
    relationshipFields: ['productId'],
    cloudReconciliation: true,
    relationalPropagation: true
  }),
  categories: policy('id', { cloudReconciliation: true }),
  images: policy('id', {
    relationshipFields: ['menu.imageRef'],
    relationalPropagation: true
  }),
  ingredients: policy('id', {
    relationshipFields: ['menu.recipe[].ingredientId', 'menu.modifiers[].ingredientId'],
    relationalPropagation: true
  }),
  customers: policy('id', { cloudReconciliation: true }),
  customer_ledger: policy('id', {
    relationshipFields: ['customerId', 'cashSessionId', 'cashMovementId'],
    cloudReconciliation: true,
    relationalPropagation: true
  }),
  sales: policy('id', {
    relationshipFields: ['customerId', 'cash_session_id', 'cloudSaleId', 'items[].id', 'items[].parentId'],
    cloudReconciliation: true
  }),
  cajas: policy('id', { cloudReconciliation: true }),
  movimientos_caja: policy('id', {
    relationshipFields: ['caja_id', 'cash_session_id', 'saleId'],
    cloudReconciliation: true,
    relationalPropagation: true
  }),
  inventory_events: policy('id', {
    relationshipFields: ['saleId', 'productId'],
    relationalPropagation: true
  }),
  transaction_log: policy('id', {
    relationshipFields: ['saleId', 'cashSessionId', 'cashMovementId'],
    relationalPropagation: true
  }),
  waste_logs: policy('id', {
    relationshipFields: ['productId', 'batchId'],
    relationalPropagation: true
  }),
  daily_stats: policy('id', {
    destinationAction: RECOVERY_DESTINATION_ACTION.RECOMPUTE
  }),
  global_stats: policy('id', {
    destinationAction: RECOVERY_DESTINATION_ACTION.RECOMPUTE
  }),
  sequences: policy('id', {
    destinationAction: RECOVERY_DESTINATION_ACTION.IGNORE_OPERATIONALLY
  }),
  sync_outbox: policy('id', {
    relationshipFields: ['entityType', 'entityId'],
    directProof: true,
    destinationAction: RECOVERY_DESTINATION_ACTION.QUARANTINE
  }),
  sync_meta: policy('key', {
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT
  }),
  sync_conflicts: policy('id', {
    relationshipFields: ['entityType', 'entityId'],
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT
  }),
  sync_cache: policy('key', {
    scope: 'mixed_cache',
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT
  }),
  company: policy('id', {
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT
  }),
  layaways: policy('id', {
    relationshipFields: ['customerId', 'items[].id', 'items[].parentId', 'items[].batchId'],
    relationalPropagation: true
  }),
  deleted_menu: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT }),
  deleted_customers: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT }),
  deleted_sales: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT }),
  deleted_categories: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT }),
  processed_sales_log: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT }),
  theme: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.IGNORE_OPERATIONALLY }),
  corrupted_states: policy('id', { destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT })
});

export const LEGACY_RECOVERY_LOCAL_STORAGE_POLICY = Object.freeze({
  'lanzo-active-orders-storage': Object.freeze({
    scope: 'tenant_owned',
    primaryKey: 'localStorage key',
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT,
    classification: RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS
  }),
  'lanzo-cart-storage': Object.freeze({
    scope: 'tenant_owned',
    primaryKey: 'localStorage key',
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT,
    classification: RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS
  }),
  'lanzo-inventory-storage': Object.freeze({
    scope: 'tenant_owned',
    primaryKey: 'localStorage key',
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT,
    classification: RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS
  }),
  'lanzo:restaurant-order-close-pending:v1': Object.freeze({
    scope: 'tenant_owned',
    primaryKey: 'localStorage key',
    destinationAction: RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT,
    classification: RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS
  })
});

export const getLegacyRecoveryStorePolicy = (storeName) => (
  LEGACY_RECOVERY_STORE_POLICY[storeName] || policy('id')
);
