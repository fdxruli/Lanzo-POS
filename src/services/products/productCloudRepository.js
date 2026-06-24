import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
};

const normalizeLimit = (limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT) => Math.min(
  Math.max(Number(limit) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1),
  SYNC_LIMITS.MAX_PULL_LIMIT
);

const buildBaseRpcArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });

  if (!context.licenseKey || !context.deviceFingerprint || !context.securityToken) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    p_security_token: context.securityToken,
    p_staff_session_token: context.staffSessionToken || null
  };
};

const callRpc = async (name, args) => {
  assertSupabase();
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return parseRpcPayload(data);
};

export const productCloudRepository = {
  async upsertCategory({ licenseKey, category, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_upsert_category', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_category: category,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async deleteCategory({ licenseKey, categoryId, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_delete_category', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_category_id: categoryId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async upsertProduct({ licenseKey, product, initialBatches = [], expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_upsert_product', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product: product,
      p_initial_batches: initialBatches,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async deleteProduct({ licenseKey, productId, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_delete_product', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: productId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async toggleProductStatus({ licenseKey, productId, isActive, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_toggle_product_status', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: productId,
      p_is_active: Boolean(isActive),
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async upsertProductBatch({ licenseKey, batch, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_upsert_product_batch', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_batch: batch,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async deleteProductBatch({ licenseKey, batchId, expectedVersion = null, idempotencyKey }) {
    return callRpc('pos_delete_product_batch', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_batch_id: batchId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
  },

  async pullCatalogSnapshot({
    licenseKey,
    entityType = 'all',
    limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT,
    offset = 0,
    includeDeleted = true
  }) {
    return callRpc('pos_pull_product_catalog_snapshot', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_entity_type: entityType,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_include_deleted: Boolean(includeDeleted)
    });
  },

  async pullCatalogChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    return callRpc('pos_pull_product_catalog_changes', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
  },

  async migrateLocalCatalog({ licenseKey, categories = [], products = [], batches = [], batchId }) {
    return callRpc('pos_migrate_local_product_catalog', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_categories: categories,
      p_products: products,
      p_batches: batches,
      p_batch_id: batchId
    });
  }
};

export default productCloudRepository;
