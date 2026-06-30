export const CLOUD_CRITICAL_RPC_NAMES = Object.freeze([
  'pos_upsert_sale_shadow',
  'pos_create_cloud_sale_cashier',
  'pos_create_cloud_sale_cashier_inventory',
  'pos_create_cloud_sale_credit',
  'pos_preview_cloud_sale_cancellation',
  'pos_cancel_cloud_sale',
  'pos_validate_cloud_sale_integrity',

  'pos_open_cash_session',
  'pos_register_cash_movement',
  'pos_adjust_initial_cash_fund',
  'pos_close_cash_session',

  'pos_record_customer_payment',

  'pos_upsert_category',
  'pos_delete_category',
  'pos_upsert_product',
  'pos_delete_product',
  'pos_toggle_product_status',
  'pos_upsert_product_batch',
  'pos_delete_product_batch',
  'pos_migrate_local_product_catalog',
  'pos_register_expiration_waste',

  'pos_upsert_customer',
  'pos_delete_customer',
  'pos_migrate_local_customers',

  'pos_migrate_local_customer_credit'
]);

export const isCriticalCloudRpcName = (rpcName) => CLOUD_CRITICAL_RPC_NAMES
  .includes(String(rpcName || '').trim());

export const assertNonCriticalCloudRequestRpc = (rpcName) => {
  if (!isCriticalCloudRpcName(rpcName)) return;

  const safeRpcName = String(rpcName || '').trim();
  const error = new Error(`CRITICAL_RPC_MUST_NOT_USE_CLOUD_REQUEST_MANAGER:${safeRpcName}`);
  error.code = 'CRITICAL_RPC_MUST_NOT_USE_CLOUD_REQUEST_MANAGER';
  error.rpcName = safeRpcName;
  throw error;
};