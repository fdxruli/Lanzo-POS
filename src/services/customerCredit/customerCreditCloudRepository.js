import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { localAllocationsToCloud } from './customerCreditMapper';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
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

export const customerCreditCloudRepository = {
  async recordCustomerPayment({
    licenseKey,
    customerId,
    amount,
    paymentMethod = 'efectivo',
    cashSessionId = null,
    note = '',
    allocations = [],
    idempotencyKey
  }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_record_customer_payment', {
      ...baseArgs,
      p_customer_id: customerId,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_cash_session_id: cashSessionId,
      p_note: note,
      p_allocations: localAllocationsToCloud(allocations),
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getCustomerCreditSummary({ licenseKey, customerId }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_customer_credit_summary', {
      ...baseArgs,
      p_customer_id: customerId
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullCreditSnapshot({ licenseKey, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, offset = 0, customerId = null, includeDeleted = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_pull_customer_credit_snapshot', {
      ...baseArgs,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_customer_id: customerId,
      p_include_deleted: Boolean(includeDeleted)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullCreditChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_pull_customer_credit_changes', {
      ...baseArgs,
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async migrateLocalCredit({ licenseKey, ledgerEntries = [], customerBalances = [], batchId = null }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_migrate_local_customer_credit', {
      ...baseArgs,
      p_ledger_entries: ledgerEntries,
      p_customer_balances: customerBalances,
      p_batch_id: batchId
    });
    if (error) throw error;
    return parseRpcPayload(data);
  }
};

export default customerCreditCloudRepository;
