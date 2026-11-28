import { supabaseClient } from '../supabase';
import { invalidateCloudCacheAfterCatalogMutation } from '../cloud';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { assertProductInventoryMutationCurrent, captureProductInventoryMutation, hasInitialProductStock } from '../auth/productInventoryAuthority';
import { classifyActorAuthorityError } from '../auth/actorAuthorityErrors';
import { SYNC_LIMITS } from '../sync/syncConstants';
import {
  callCloudSnapshotRpc,
  CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY,
  negotiateCloudSnapshotContract,
  requireCloudSnapshotContract
} from '../sync/cloudSyncProtocolV2';
import { normalizeNameKey } from './productMapper';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const nowIso = () => new Date().toISOString();

const assertSupabase = () => {
  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
};

const normalizeLimit = (limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT) => Math.min(
  Math.max(Number(limit) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1),
  SYNC_LIMITS.MAX_PULL_LIMIT
);

const pharmacyExpiryTimestamp = (value) => {
  if (!value) return null;
  const calendarDate = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) return value;
  return `${calendarDate}T00:00:00.000Z`;
};

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

// IMPORTANTE: las mutaciones/migraciones de catálogo son críticas y NO deben pasar por CloudRequestManager.
const getMutationRequirementsForRpc = (rpcName, args = {}) => {
  if (rpcName === 'pos_upsert_category' || rpcName === 'pos_delete_category' || rpcName === 'pos_toggle_product_status'
    || rpcName === 'pos_upsert_active_ingredient_v1') {
    return { products: true };
  }
  if (rpcName === 'pos_upsert_product') {
    return { products: true, inventory: Array.isArray(args.p_initial_batches) && args.p_initial_batches.length > 0 };
  }
  if (rpcName === 'pos_delete_product') return { products: true, inventory: true };
  if (
    rpcName === 'pos_upsert_product_batch'
    || rpcName === 'pos_delete_product_batch'
    || rpcName === 'pos_add_inventory_entry'
    || rpcName === 'pos_receive_pharmacy_inventory_v1'
    || rpcName === 'pos_verify_legacy_pharmacy_receipt_v1'
  ) {
    return { inventory: true };
  }
  if (rpcName === 'pos_migrate_local_product_catalog') {
    return { products: true, inventory: (Array.isArray(args.p_batches) && args.p_batches.length > 0) || (Array.isArray(args.p_products) && args.p_products.some(hasInitialProductStock)) };
  }
  return {};
};

const callCatalogMutationRpc = async (rpcName, licenseKey, args, actorHandle = null, requirementsOverride = null, options = {}) => {
  const requirements = { ...getMutationRequirementsForRpc(rpcName, args), ...(requirementsOverride || {}) };
  const handle = actorHandle || captureProductInventoryMutation(requirements);
  assertProductInventoryMutationCurrent(handle, requirements);
  const response = await callRpc(rpcName, args);
  try {
    assertProductInventoryMutationCurrent(handle, requirements);
  } catch (error) {
    // The RPC has already returned a receipt. Preserve it only when its
    // idempotency identity matches the request; callers must not resubmit it.
    const authority = classifyActorAuthorityError(error);
    if (options.preserveConfirmedProductResponse === true
      && response?.success === true
      && args.p_idempotency_key
      && response.idempotency_key === args.p_idempotency_key
      && authority) {
      invalidateCloudCacheAfterCatalogMutation(licenseKey);
      return {
        ...response,
        clientLocalReconciliationPending: true,
        clientIdempotencyKey: args.p_idempotency_key,
        clientAuthorityErrorCode: authority.code,
        clientAuthorityErrorKind: authority.kind
      };
    }
    throw error;
  }
  if (response?.success !== false) invalidateCloudCacheAfterCatalogMutation(licenseKey);
  return response;
};

export const productCloudRepository = {
  async upsertActiveIngredient({ licenseKey, activeIngredient, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    const contract = await this.negotiateSnapshotProtocol({ licenseKey, actorHandle });
    if (!contract?.capabilities?.includes(CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY)) {
      return {
        success: false,
        code: 'CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY_REQUIRED',
        message: 'El catálogo farmacéutico aún no está instalado en Cloud.'
      };
    }
    return callCatalogMutationRpc('pos_upsert_active_ingredient_v1', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_active_ingredient: {
        id: activeIngredient.id,
        name: activeIngredient.name,
        name_key: normalizeNameKey(activeIngredient.name),
        is_active: activeIngredient.isActive !== false,
        created_at: activeIngredient.createdAt || nowIso()
      },
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async upsertCategory({ licenseKey, category, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_upsert_category', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_category: category,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async deleteCategory({ licenseKey, categoryId, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_delete_category', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_category_id: categoryId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async upsertProduct({ licenseKey, product, initialBatches = [], expectedVersion = null, idempotencyKey, actorHandle = null, isNewProduct = false }) {
    return callCatalogMutationRpc('pos_upsert_product', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product: product,
      p_initial_batches: initialBatches,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle, { inventory: (Array.isArray(initialBatches) && initialBatches.length > 0) || (isNewProduct && hasInitialProductStock(product)) }, {
      preserveConfirmedProductResponse: true
    });
  },

  async getLocalCatalogRecoveryContract({ licenseKey }) {
    return callRpc('pos_recover_local_product_group_v1', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product: null,
      p_batches: [],
      p_idempotency_key: null
    });
  },

  async recoverLocalProductGroup({ licenseKey, product, batches, idempotencyKey }) {
    return callCatalogMutationRpc('pos_recover_local_product_group_v1', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product: product,
      p_batches: batches,
      p_idempotency_key: idempotencyKey
    }, null, {
      products: true,
      inventory: !product.server_version && (batches.length > 0 || hasInitialProductStock(product))
    });
  },

  async deleteProduct({ licenseKey, productId, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_delete_product', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: productId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async toggleProductStatus({ licenseKey, productId, isActive, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_toggle_product_status', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: productId,
      p_is_active: Boolean(isActive),
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async upsertProductBatch({ licenseKey, batch, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_upsert_product_batch', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_batch: batch,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async deleteProductBatch({ licenseKey, batchId, expectedVersion = null, idempotencyKey, actorHandle = null }) {
    return callCatalogMutationRpc('pos_delete_product_batch', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_batch_id: batchId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async addInventoryEntry({ licenseKey, entry, idempotencyKey, actorHandle = null, cloudPharmacyReceipt = false, verifyLegacyPharmacyReceipt = false }) {
    const rpc = verifyLegacyPharmacyReceipt ? 'pos_verify_legacy_pharmacy_receipt_v1'
      : cloudPharmacyReceipt ? 'pos_receive_pharmacy_inventory_v1' : 'pos_add_inventory_entry';
    return callCatalogMutationRpc(rpc, licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: entry.productId,
      p_batch_id: entry.batchId || null,
      p_quantity: entry.quantity,
      p_input_unit: entry.inputUnit || null,
      p_base_quantity: entry.baseQuantity,
      p_base_unit: entry.baseUnit || null,
      p_unit_cost: entry.unitCost,
      p_supplier: entry.supplier || null,
      p_manufacturer_batch_id: entry.manufacturerBatchId || null,
      p_expiry_date: cloudPharmacyReceipt ? pharmacyExpiryTimestamp(entry.expiryDate) : (entry.expiryDate || null),
      p_occurred_at: entry.occurredAt || null,
      p_entry_kind: entry.entryKind || 'restock',
      p_metadata: entry.metadata || {},
      p_idempotency_key: idempotencyKey
    }, actorHandle);
  },

  async pullCatalogSnapshot({
    licenseKey,
    limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT,
    snapshotProtocol = null,
    snapshotReferenceChangeSeq = null,
    pageCursor = null,
    actorHandle = actorRuntimeController.capture()
  }) {
    actorHandle ||= actorRuntimeController.capture();
    actorHandle.assertCurrent();
    const protocol = requireCloudSnapshotContract(snapshotProtocol
      || await this.negotiateSnapshotProtocol({ licenseKey, actorHandle }));
    actorHandle.assertCurrent();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const rpcName = protocol.capabilities?.includes(CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY)
      ? 'pos_pull_product_catalog_snapshot_v3'
      : 'pos_pull_product_catalog_snapshot_v2';
    return callCloudSnapshotRpc({
      client: supabaseClient,
      rpcName,
      family: 'product_catalog',
      authArgs: baseArgs,
      params: {
        p_limit: Math.min(normalizeLimit(limit), 500),
        p_snapshot_reference_change_seq: snapshotReferenceChangeSeq,
        p_page_cursor: pageCursor
      },
      snapshotContract: protocol,
      actorHandle
    });
  },

  async negotiateSnapshotProtocol({ licenseKey, actorHandle = null } = {}) {
    return negotiateCloudSnapshotContract({
      client: supabaseClient,
      authArgs: await buildBaseRpcArgs(licenseKey),
      actorHandle
    });
  },

  async pullCatalogChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    return callRpc('pos_pull_product_catalog_changes', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
  },

  async listPharmacyInventoryReceipts({ licenseKey, productId, limit = 20, beforeAt = null, beforeId = null }) {
    return callRpc('pos_list_pharmacy_inventory_receipts', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_product_id: productId,
      p_limit: Math.min(Math.max(Number(limit) || 20, 1), 50),
      p_before_at: beforeAt,
      p_before_id: beforeId
    });
  },

  async completePharmacyInventoryCutover({ licenseKey, batchRoot, actorHandle = null }) {
    return callCatalogMutationRpc('pos_complete_pharmacy_inventory_cutover', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_batch_root: batchRoot
    }, actorHandle, { products: true, inventory: true });
  },

  async migrateLocalCatalog({ licenseKey, categories = [], products = [], batches = [], batchId, actorHandle = null }) {
    return callCatalogMutationRpc('pos_migrate_local_product_catalog', licenseKey, {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_categories: categories,
      p_products: products,
      p_batches: batches,
      p_batch_id: batchId
    }, actorHandle);
  }
};

export default productCloudRepository;
