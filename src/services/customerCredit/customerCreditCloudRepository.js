import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterCreditMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { localAllocationsToCloud } from './customerCreditMapper';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { callCloudSyncV2Rpc } from '../sync/cloudSyncProtocolV2';

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

const cachedCreditRpc = ({
  rpcName,
  licenseKey,
  baseArgs,
  params = {},
  cacheScope = null,
  ttlMs = CLOUD_REQUEST_TTL.MEDIUM,
  cooldownMs = CLOUD_REQUEST_COOLDOWN.SNAPSHOT,
  force = false,
  fn
}) => cloudRequestManager.request({
  rpcName,
  key: buildRpcRequestKey(rpcName, {
    ...buildBaseRpcContextFromArgs(licenseKey, baseArgs),
    params,
    cacheScope
  }),
  ttlMs,
  cooldownMs,
  force,
  tags: [
    CLOUD_REQUEST_TAGS.CUSTOMER_CREDIT,
    CLOUD_REQUEST_TAGS.CUSTOMERS,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName)
  ],
  fn
});

const invalidateAfterCreditSuccess = (licenseKey, response) => {
  if (response?.success !== false) {
    invalidateCloudCacheAfterCreditMutation(licenseKey);
  }
  return response;
};

export const customerCreditCloudRepository = {
  async historicalCreditBatch({ licenseKey, action, manifest = null, authorizationId = null, confirm = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_historical_credit_batch_v1', {
      ...baseArgs, p_action: action, p_manifest: manifest,
      p_authorization_id: authorizationId, p_confirm: confirm
    });
    if (error) throw error;
    return invalidateAfterCreditSuccess(licenseKey, parseRpcPayload(data));
  },
  // IMPORTANTE: abonos y migraciones de crédito son críticos y NO deben pasar por CloudRequestManager.
  async recordCustomerPayment({
    licenseKey,
    customerId,
    amount,
    paymentMethod = 'efectivo',
    cashSessionId = null,
    note = '',
    allocations = [],
    idempotencyKey,
    actorHandle = actorRuntimeController.capture('customers')
  }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const response = await callCloudSyncV2Rpc({
      client: supabaseClient,
      rpcName: 'pos_record_customer_payment_v2',
      authArgs: baseArgs,
      params: {
        p_customer_id: customerId,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_cash_session_id: cashSessionId,
        p_note: note,
        p_allocations: localAllocationsToCloud(allocations),
        p_idempotency_key: idempotencyKey
      },
      family: 'customer_credit',
      expectedCustomerId: customerId,
      expectedIdempotencyKey: idempotencyKey,
      actorHandle
    });
    actorHandle.assertCurrent();
    return invalidateAfterCreditSuccess(licenseKey, response);
  },

  async getCustomerCreditSummary({ licenseKey, customerId, force = false, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const params = { p_customer_id: customerId };
    const response = await cachedCreditRpc({
      rpcName: 'pos_get_customer_credit_summary_v2',
      licenseKey,
      baseArgs,
      params,
      cacheScope: { actorKey: actorHandle.actorKey, generation: actorHandle.generation },
      ttlMs: CLOUD_REQUEST_TTL.SHORT,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.SHORT,
      force,
      fn: async () => {
        const response = await callCloudSyncV2Rpc({
          client: supabaseClient,
          rpcName: 'pos_get_customer_credit_summary_v2',
          authArgs: baseArgs,
          params,
          family: 'customer_credit',
          expectedCustomerId: customerId,
          actorHandle
        });
        actorHandle.assertCurrent();
        return response;
      }
    });
    actorHandle.assertCurrent();
    return response;
  },

  async pullCreditSnapshot({ licenseKey, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, offset = 0, customerId = null, includeDeleted = false, force = false, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const params = {
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_customer_id: customerId,
      p_include_deleted: Boolean(includeDeleted)
    };
    const response = await cachedCreditRpc({
      rpcName: 'pos_pull_customer_credit_snapshot_v2',
      licenseKey,
      baseArgs,
      params,
      cacheScope: { actorKey: actorHandle.actorKey, generation: actorHandle.generation },
      force,
      fn: async () => {
        const response = await callCloudSyncV2Rpc({
          client: supabaseClient,
          rpcName: 'pos_pull_customer_credit_snapshot_v2',
          authArgs: baseArgs,
          params,
          family: 'customer_credit',
          expectedCustomerId: customerId,
          requireCursor: true,
          expectedOffset: params.p_offset,
          actorHandle
        });
        actorHandle.assertCurrent();
        return response;
      }
    });
    actorHandle.assertCurrent();
    return response;
  },

  async pullCreditChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const response = await callCloudSyncV2Rpc({
      client: supabaseClient,
      rpcName: 'pos_pull_customer_credit_changes_v2',
      authArgs: baseArgs,
      params: {
        p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
        p_limit: normalizeLimit(limit)
      },
      family: 'customer_credit',
      requireCursor: true,
      expectedChangeSeq: Math.max(Number(sinceChangeSeq) || 0, 0),
      actorHandle
    });
    actorHandle.assertCurrent();
    return response;
  },

  async migrateLocalCredit() {
    const error = new Error('CLOUD_CLIENT_UPDATE_REQUIRED');
    error.code = 'CLOUD_CLIENT_UPDATE_REQUIRED';
    error.family = 'customer_credit';
    error.retryable = false;
    throw error;
  }
};

export default customerCreditCloudRepository;
