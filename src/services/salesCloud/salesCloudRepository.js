import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterSaleMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import {
  isCloudSalesBaseSyncEnabled,
  isCloudSalesCancellationEnabled,
  isCloudSalesCashierEnabled,
  isCloudSalesCreditEnabled,
  isCloudSalesInventoryEnabled,
  isCloudLayawaysEnabled,
  SYNC_LIMITS
} from '../sync/syncConstants';
import { executeNewFinancialIntent } from '../financial/financialIntentLedger';

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
  const authTokenKey = 'security' + 'Token';

  if (!context.licenseKey || !context.deviceFingerprint || !context[authTokenKey]) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    [`p_${'security'}_token`]: context[authTokenKey],
    p_staff_session_token: context.staffSessionToken || null
  };
};

const buildCloudCashierArgs = ({ baseArgs, sale, items, payments, cashSessionId, idempotencyKey }) => ({
  ...baseArgs,
  p_sale: sale || {},
  p_items: Array.isArray(items) ? items : [],
  p_payments: Array.isArray(payments) ? payments : [],
  p_cash_session_id: cashSessionId || null,
  p_idempotency_key: idempotencyKey || null
});

const buildCloudCreditArgs = ({ baseArgs, sale, items, payments, cashSessionId, customerId, idempotencyKey }) => ({
  ...buildCloudCashierArgs({ baseArgs, sale, items, payments, cashSessionId, idempotencyKey }),
  p_customer_id: customerId || sale?.customer_id || sale?.customerId || null
});

const invalidateAfterSaleSuccess = (licenseKey, response) => {
  if (response?.success !== false) {
    invalidateCloudCacheAfterSaleMutation(licenseKey);
  }
  return response;
};

const cachedSalesRpc = ({
  rpcName,
  licenseKey,
  baseArgs,
  params = {},
  ttlMs = CLOUD_REQUEST_TTL.MEDIUM,
  cooldownMs = CLOUD_REQUEST_COOLDOWN.SNAPSHOT,
  force = false,
  fn
}) => cloudRequestManager.request({
  rpcName,
  key: buildRpcRequestKey(rpcName, {
    ...buildBaseRpcContextFromArgs(licenseKey, baseArgs),
    params
  }),
  ttlMs,
  cooldownMs,
  force,
  tags: [
    CLOUD_REQUEST_TAGS.SALES,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName)
  ],
  fn
});

export const salesCloudRepository = {
  isCloudSalesBaseEnabled(licenseDetails = {}) {
    return isCloudSalesBaseSyncEnabled(licenseDetails);
  },

  isCloudSalesCashierEnabled(licenseDetails = {}) {
    return isCloudSalesCashierEnabled(licenseDetails);
  },

  isCloudSalesCreditEnabled(licenseDetails = {}) {
    return isCloudSalesCreditEnabled(licenseDetails);
  },

  isCloudSalesInventoryEnabled(licenseDetails = {}) {
    return isCloudSalesInventoryEnabled(licenseDetails);
  },

  isCloudSalesCancellationEnabled(licenseDetails = {}) {
    return isCloudSalesCancellationEnabled(licenseDetails);
  },

  isCloudLayawaysEnabled(licenseDetails = {}) {
    return isCloudLayawaysEnabled(licenseDetails);
  },

  // IMPORTANTE: estas RPCs son transaccionales/críticas y NO deben pasar por CloudRequestManager.
  async upsertSaleShadow({ licenseKey, sale, items = [], payments = [], idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);

    const { data, error } = await supabaseClient.rpc('pos_upsert_sale_shadow', {
      ...baseArgs,
      p_sale: sale || {},
      p_items: Array.isArray(items) ? items : [],
      p_payments: Array.isArray(payments) ? payments : [],
      p_idempotency_key: idempotencyKey || null
    });

    if (error) throw error;
    return invalidateAfterSaleSuccess(licenseKey, parseRpcPayload(data));
  },

  async createCloudCashierSale({ licenseKey, sale, items = [], payments = [], cashSessionId = null, idempotencyKey = null, actorHandle = null, project = null }) {
    const result = await executeNewFinancialIntent({ operationType: 'sale.cashier', request: { sale: sale || {}, items: Array.isArray(items) ? items : [], payments: Array.isArray(payments) ? payments : [], cash_session_id: cashSessionId, customer_id: null }, licenseKey, idempotencyKey, cashSessionId, actorHandle, project });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async createCloudCashierInventorySale({ licenseKey, sale, items = [], payments = [], cashSessionId = null, idempotencyKey = null, actorHandle = null, project = null }) {
    const result = await executeNewFinancialIntent({ operationType: 'sale.cashier_inventory', request: { sale: sale || {}, items: Array.isArray(items) ? items : [], payments: Array.isArray(payments) ? payments : [], cash_session_id: cashSessionId, customer_id: null }, licenseKey, idempotencyKey, cashSessionId, actorHandle, project });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async createCloudCreditSale({ licenseKey, sale, items = [], payments = [], cashSessionId = null, customerId = null, idempotencyKey = null, actorHandle = null, project = null }) {
    const result = await executeNewFinancialIntent({ operationType: 'sale.credit', request: { sale: sale || {}, items: Array.isArray(items) ? items : [], payments: Array.isArray(payments) ? payments : [], cash_session_id: cashSessionId, customer_id: customerId || sale?.customer_id || sale?.customerId || null }, licenseKey, idempotencyKey, cashSessionId, actorHandle, project });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async createCloudSplitTableSale({ licenseKey, split = {}, cashSessionId = null, idempotencyKey = null, actorHandle = null, project = null }) {
    const request = {
      ...(split || {}),
      cash_session_id: cashSessionId || split?.cash_session_id || split?.cashSessionId || null
    };
    const result = await executeNewFinancialIntent({
      operationType: 'sale.split',
      request,
      licenseKey,
      idempotencyKey,
      cashSessionId: request.cash_session_id,
      actorHandle,
      project
    });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async createCloudLayawayCompletion({ licenseKey, request = {}, idempotencyKey = null, actorHandle = null, project = null }) {
    const result = await executeNewFinancialIntent({
      operationType: 'sale.layaway_complete',
      request: request || {},
      licenseKey,
      idempotencyKey,
      cashSessionId: null,
      actorHandle,
      project
    });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async createCloudLayaway({
    licenseKey,
    layaway = {},
    initialPayment = null,
    cashSessionId = null,
    idempotencyKey = null,
    actorHandle = null,
    project = null
  }) {
    const payment = initialPayment && typeof initialPayment === 'object' ? initialPayment : null;
    const resolvedCashSessionId = cashSessionId
      || payment?.cash_session_id
      || payment?.cashSessionId
      || payment?.cajaId
      || null;
    const request = {
      layaway: layaway || {},
      initial_payment: payment,
      cash_session_id: resolvedCashSessionId
    };
    const result = await executeNewFinancialIntent({
      operationType: 'layaway.create',
      request,
      licenseKey,
      idempotencyKey,
      cashSessionId: resolvedCashSessionId,
      actorHandle,
      project
    });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async addCloudLayawayPayment({
    licenseKey,
    layawayId,
    payment = {},
    cashSessionId = null,
    idempotencyKey = null,
    actorHandle = null,
    project = null
  }) {
    const resolvedCashSessionId = cashSessionId
      || payment?.cash_session_id
      || payment?.cashSessionId
      || payment?.cajaId
      || null;
    const request = {
      layaway_id: layawayId,
      payment: payment || {},
      cash_session_id: resolvedCashSessionId
    };
    const result = await executeNewFinancialIntent({
      operationType: 'layaway.payment',
      request,
      licenseKey,
      idempotencyKey,
      cashSessionId: resolvedCashSessionId,
      actorHandle,
      project
    });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async cancelCloudLayaway({
    licenseKey,
    layawayId,
    reason = null,
    retainMoney = false,
    refundId = null,
    cashSessionId = null,
    idempotencyKey = null,
    actorHandle = null,
    project = null
  }) {
    const request = {
      layaway_id: layawayId,
      reason,
      retain_money: Boolean(retainMoney),
      refund_id: refundId,
      cash_session_id: cashSessionId
    };
    const result = await executeNewFinancialIntent({
      operationType: 'layaway.cancel',
      request,
      licenseKey,
      idempotencyKey,
      cashSessionId,
      actorHandle,
      project
    });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId, projection: result.projection || null };
  },

  async previewCloudSaleCancellation({ licenseKey, saleId, reason = null }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_preview_cloud_sale_cancellation', {
      ...baseArgs,
      p_sale_id: saleId,
      p_reason: reason || null
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async cancelCloudSale({ licenseKey, saleId, reason, idempotencyKey = null, actorHandle = null }) {
    const result = await executeNewFinancialIntent({ operationType: 'sale.cancel', request: { sale_id: saleId, reason }, licenseKey, idempotencyKey, actorHandle });
    return { ...invalidateAfterSaleSuccess(licenseKey, result.response), financialIntentId: result.intentId };
  },

  async validateCloudSaleIntegrity({ licenseKey, saleId }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_validate_cloud_sale_integrity', {
      ...baseArgs,
      p_sale_id: saleId
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getSale({ licenseKey, saleId, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = { p_sale_id: saleId };
    return cachedSalesRpc({
      rpcName: 'pos_get_sale',
      licenseKey,
      baseArgs,
      params,
      ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_get_sale', { ...baseArgs, ...params });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  async getLayaway({ licenseKey, layawayId, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = { p_layaway_id: layawayId };
    return cachedSalesRpc({
      rpcName: 'pos_get_layaway',
      licenseKey,
      baseArgs,
      params,
      ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_get_layaway', { ...baseArgs, ...params });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  async pullSalesSnapshot({ licenseKey, limit = 500, offset = 0, dateFrom = null, dateTo = null, includeDeleted = false, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = {
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_include_deleted: Boolean(includeDeleted)
    };
    return cachedSalesRpc({
      rpcName: 'pos_pull_sales_snapshot',
      licenseKey,
      baseArgs,
      params,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_pull_sales_snapshot', {
          ...baseArgs,
          ...params
        });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  async pullSalesChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_pull_sales_changes', {
      ...baseArgs,
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullLayawayChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_pull_layaway_changes', {
      ...baseArgs,
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  }
};

export default salesCloudRepository;
