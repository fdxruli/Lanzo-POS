import { supabaseClient } from './supabase';
import { buildPosSyncAuthContext } from './sync/posSyncClient';
import { SYNC_LIMITS } from './sync/syncConstants';

const parse = (data) => (typeof data === 'string' ? JSON.parse(data) : (data || {}));
const limitOf = (n) => Math.min(Math.max(Number(n) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1), SYNC_LIMITS.MAX_PULL_LIMIT);

async function base(licenseKey) {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
  const c = await buildPosSyncAuthContext({ licenseKey });
  if (!c.licenseKey || !c.deviceFingerprint || !c.securityToken) throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  return {
    p_license_key: c.licenseKey,
    p_device_fingerprint: c.deviceFingerprint,
    p_security_token: c.securityToken,
    p_staff_session_token: c.staffSessionToken || null
  };
}

async function rpc(name, args) {
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return parse(data);
}

export const productCloudRepository = {
  async upsertCategory({ licenseKey, category, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_upsert_category', { ...(await base(licenseKey)), p_category: category, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async deleteCategory({ licenseKey, categoryId, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_delete_category', { ...(await base(licenseKey)), p_category_id: categoryId, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async upsertProduct({ licenseKey, product, initialBatches = [], expectedVersion = null, idempotencyKey }) {
    return rpc('pos_upsert_product', { ...(await base(licenseKey)), p_product: product, p_initial_batches: initialBatches, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async deleteProduct({ licenseKey, productId, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_delete_product', { ...(await base(licenseKey)), p_product_id: productId, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async toggleProductStatus({ licenseKey, productId, isActive, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_toggle_product_status', { ...(await base(licenseKey)), p_product_id: productId, p_is_active: Boolean(isActive), p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async upsertProductBatch({ licenseKey, batch, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_upsert_product_batch', { ...(await base(licenseKey)), p_batch: batch, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async deleteProductBatch({ licenseKey, batchId, expectedVersion = null, idempotencyKey }) {
    return rpc('pos_delete_product_batch', { ...(await base(licenseKey)), p_batch_id: batchId, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey });
  },
  async pullCatalogSnapshot({ licenseKey, entityType = 'all', limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, offset = 0, includeDeleted = true }) {
    return rpc('pos_pull_product_catalog_snapshot', { ...(await base(licenseKey)), p_entity_type: entityType, p_limit: limitOf(limit), p_offset: Math.max(Number(offset) || 0, 0), p_include_deleted: Boolean(includeDeleted) });
  },
  async pullCatalogChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    return rpc('pos_pull_product_catalog_changes', { ...(await base(licenseKey)), p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0), p_limit: limitOf(limit) });
  },
  async migrateLocalCatalog({ licenseKey, categories = [], products = [], batches = [], batchId }) {
    return rpc('pos_migrate_local_product_catalog', { ...(await base(licenseKey)), p_categories: categories, p_products: products, p_batches: batches, p_batch_id: batchId });
  }
};

export default productCloudRepository;
