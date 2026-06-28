import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags
} from '../cloud';
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

const cachedCashRpc = ({
  rpcName,
  licenseKey,
  baseArgs,
  params = {},
  ttlMs = CLOUD_REQUEST_TTL.SHORT,
  cooldownMs = CLOUD_REQUEST_COOLDOWN.SHORT,
  tags = [],
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
    CLOUD_REQUEST_TAGS.CASH,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName),
    ...tags
  ],
  fn
});

export const cashCloudRepository = {
  async getCurrentCashSession({ licenseKey, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    return cachedCashRpc({
      rpcName: 'pos_get_current_cash_session',
      licenseKey,
      baseArgs,
      ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_get_current_cash_session', baseArgs);
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  // IMPORTANTE: estas RPCs de caja son transaccionales y NO deben pasar por CloudRequestManager.
  async openCashSession({ licenseKey, opening, idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_open_cash_session', {
      ...baseArgs,
      p_opening: opening,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async registerCashMovement({ licenseKey, cashSessionId, type, amount, concept, idempotencyKey, metadata = {} }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_register_cash_movement', {
      ...baseArgs,
      p_cash_session_id: cashSessionId,
      p_type: type,
      p_amount: amount,
      p_concept: concept,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async adjustInitialCashFund({ licenseKey, cashSessionId, newAmount, reason, expectedVersion = null, idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_adjust_initial_cash_fund', {
      ...baseArgs,
      p_cash_session_id: cashSessionId,
      p_new_opening_amount: newAmount,
      p_reason: reason,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async closeCashSession({ licenseKey, cashSessionId, closing, expectedVersion = null, idempotencyKey }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_close_cash_session', {
      ...baseArgs,
      p_cash_session_id: cashSessionId,
      p_closing: closing,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async pullCashSnapshot({ licenseKey, scope = 'mine', limit = 100, offset = 0, includeClosed = true, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = {
      p_scope: scope,
      p_limit: Math.min(normalizeLimit(limit), 500),
      p_offset: Math.max(Number(offset) || 0, 0),
      p_include_closed: Boolean(includeClosed)
    };
    return cachedCashRpc({
      rpcName: 'pos_pull_cash_snapshot',
      licenseKey,
      baseArgs,
      params,
      ttlMs: CLOUD_REQUEST_TTL.SHORT,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.SNAPSHOT,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_pull_cash_snapshot', {
          ...baseArgs,
          ...params
        });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  async pullCashChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_pull_cash_changes', {
      ...baseArgs,
      p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
      p_limit: normalizeLimit(limit)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async listCashSessionsForAudit({ licenseKey, status = null, staffUserId = null, dateFrom = null, dateTo = null, limit = 100, offset = 0, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = {
      p_status: status,
      p_staff_user_id: staffUserId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit: Math.min(normalizeLimit(limit), 500),
      p_offset: Math.max(Number(offset) || 0, 0)
    };
    return cachedCashRpc({
      rpcName: 'pos_admin_list_cash_sessions',
      licenseKey,
      baseArgs,
      params,
      ttlMs: CLOUD_REQUEST_TTL.MEDIUM,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_admin_list_cash_sessions', {
          ...baseArgs,
          ...params
        });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  },

  async getCashSessionDetailForAudit({ licenseKey, cashSessionId, force = false }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = { p_cash_session_id: cashSessionId };
    return cachedCashRpc({
      rpcName: 'pos_admin_get_cash_session_detail',
      licenseKey,
      baseArgs,
      params,
      ttlMs: CLOUD_REQUEST_TTL.SHORT,
      force,
      fn: async () => {
        const { data, error } = await supabaseClient.rpc('pos_admin_get_cash_session_detail', {
          ...baseArgs,
          ...params
        });
        if (error) throw error;
        return parseRpcPayload(data);
      }
    });
  }
};

export default cashCloudRepository;
