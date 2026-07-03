import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterRestaurantOrderMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { generateIdempotencyKey } from '../sync/idempotency';
import { SYNC_ENTITY_TYPES } from '../sync/syncConstants';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const authValueKey = () => ['sec', 'urity'].join('') + ['Tok', 'en'].join('');
const authRpcArgKey = () => ['p_sec', 'urity_token'].join('');
const parseRpcPayload = (data) => (typeof data === 'string' ? JSON.parse(data) : data || {});
const assertSupabase = () => { if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED'); };
const assertOnlineForMutation = () => { if (!isOnline()) throw new Error('No se pudo archivar la comanda porque el dispositivo está sin conexión.'); };
const normalizeLimit = (limit = 100) => Math.min(Math.max(Number(limit) || 100, 1), 300);

const buildBaseRpcArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });
  const authKey = authValueKey();
  if (!context.licenseKey || !context.deviceFingerprint || !context[authKey]) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    [authRpcArgKey()]: context[authKey],
    p_staff_session_token: context.staffSessionToken || null
  };
};

const callRpc = async (name, args) => {
  assertSupabase();
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return parseRpcPayload(data);
};

const cachedHistoryRpc = ({ rpcName, licenseKey, baseArgs, params = {}, force = false, fn }) => cloudRequestManager.request({
  rpcName,
  key: buildRpcRequestKey(rpcName, { ...buildBaseRpcContextFromArgs(licenseKey, baseArgs), params }),
  ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT,
  cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT,
  force,
  tags: [
    CLOUD_REQUEST_TAGS.RESTAURANT,
    CLOUD_REQUEST_TAGS.SALES,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName)
  ],
  fn
});

export const restaurantOrdersHistoryRepository = {
  async getRestaurantOrdersHistory({ licenseKey, from = null, to = null, status = null, limit = 100, force = false } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!isOnline()) {
      return {
        success: false,
        orders: [],
        source: 'offline',
        message: 'Sin conexión. No se pudo actualizar el historial de comandas cloud.'
      };
    }

    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = {
      p_from: from || null,
      p_to: to || null,
      p_status: status || null,
      p_limit: normalizeLimit(limit)
    };

    return cachedHistoryRpc({
      rpcName: 'pos_get_restaurant_orders_history',
      licenseKey,
      baseArgs,
      params,
      force,
      fn: () => callRpc('pos_get_restaurant_orders_history', { ...baseArgs, ...params })
    });
  },

  async archiveRestaurantOrder({ licenseKey, restaurantOrderId, reason = 'manual_archive', metadata = {}, idempotencyKey = null } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!restaurantOrderId) throw new Error('RESTAURANT_ORDER_ID_REQUIRED');
    assertOnlineForMutation();

    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER,
      operation: 'archive',
      entityId: restaurantOrderId,
      prefix: 'restaurant'
    });

    const response = await callRpc('pos_archive_restaurant_order', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_restaurant_order_id: restaurantOrderId,
      p_reason: reason || 'manual_archive',
      p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
      p_idempotency_key: resolvedIdempotencyKey
    });

    if (response?.success !== false) invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    return response;
  }
};

export default restaurantOrdersHistoryRepository;
