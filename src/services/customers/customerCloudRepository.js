import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
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

const normalizeLimit = (limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT) => Math.min(
  Math.max(Number(limit) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1),
  SYNC_LIMITS.MAX_PULL_LIMIT
);

export const customerCloudRepository = {
  async upsertCustomer({ licenseKey, customer, expectedVersion = null, idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_upsert_customer', {
      ...baseArgs,
      p_customer: customer,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });

    if (error) throw error;
    return parseRpcPayload(data);
  },

  async deleteCustomer({ licenseKey, customerId, expectedVersion = null, idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_delete_customer', {
      ...baseArgs,
      p_customer_id: customerId,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });

    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullCustomerSnapshot({ licenseKey, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, offset = 0, includeDeleted = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_pull_customers_snapshot', {
      ...baseArgs,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_include_deleted: Boolean(includeDeleted)
    });

    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullCustomerChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_pull_customer_changes', {
      ...baseArgs,
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });

    if (error) throw error;
    return parseRpcPayload(data);
  },

  async migrateLocalCustomers({ licenseKey, customers = [], batchId }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_migrate_local_customers', {
      ...baseArgs,
      p_customers: customers,
      p_batch_id: batchId
    });

    if (error) throw error;
    return parseRpcPayload(data);
  }
};

export default customerCloudRepository;
