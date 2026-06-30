import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterCatalogMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const toSafeDaysAhead = (daysAhead = 45) => Math.min(
  Math.max(Number(daysAhead) || 45, 1),
  365
);

const normalizeWasteQuantity = (quantity) => {
  if (quantity === null || quantity === undefined || quantity === '') return null;
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
  return parsed;
};

const buildBaseArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });
  const deviceSecret = context?.['security' + 'Token'];

  if (!context?.licenseKey || !context?.deviceFingerprint || !deviceSecret) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    [`p_${'security'}_${'token'}`]: deviceSecret,
    p_staff_session_token: context.staffSessionToken || null
  };
};

const callRpc = async (rpcName, args) => {
  assertSupabase();
  const { data, error } = await supabaseClient.rpc(rpcName, args);
  if (error) throw error;
  return parseRpcPayload(data);
};

const callCatalogMutationRpc = async (rpcName, licenseKey, args) => {
  const response = await callRpc(rpcName, args);
  if (response?.success !== false && response?.ok !== false) {
    invalidateCloudCacheAfterCatalogMutation(licenseKey);
  }
  return response;
};

export const registerCloudExpirationWaste = async ({
  licenseKey,
  batch,
  batchId = null,
  quantity = null,
  reason = 'caducidad',
  notes = '',
  idempotencyKey
}) => {
  const resolvedBatchId = batchId || batch?.id || batch?.batchId;
  const normalizedQuantity = normalizeWasteQuantity(quantity);

  if (!resolvedBatchId) {
    return { success: false, code: 'BATCH_ID_REQUIRED', message: 'Selecciona un lote para registrar merma.' };
  }

  if (Number.isNaN(normalizedQuantity)) {
    return { success: false, code: 'INVALID_WASTE_QUANTITY', message: 'La cantidad de merma no es válida.' };
  }

  return callCatalogMutationRpc('pos_register_expiration_waste', licenseKey, {
    ...(await buildBaseArgs(licenseKey)),
    p_batch_id: resolvedBatchId,
    p_quantity: normalizedQuantity,
    p_reason: reason,
    p_notes: notes || null,
    p_idempotency_key: idempotencyKey
  });
};

export const getCloudExpiringBatchesReport = async ({
  licenseKey,
  daysAhead = 45,
  includeInactive = false,
  force = false
}) => {
  const rpcName = 'pos_get_expiring_batches_report';
  const baseArgs = await buildBaseArgs(licenseKey);
  const params = {
    p_days_ahead: toSafeDaysAhead(daysAhead),
    p_include_inactive: Boolean(includeInactive)
  };

  return cloudRequestManager.request({
    rpcName,
    key: buildRpcRequestKey(rpcName, {
      ...buildBaseRpcContextFromArgs(licenseKey, baseArgs),
      params
    }),
    ttlMs: CLOUD_REQUEST_TTL.SHORT,
    cooldownMs: CLOUD_REQUEST_COOLDOWN.SHORT,
    force,
    tags: [
      CLOUD_REQUEST_TAGS.PRODUCTS,
      CLOUD_REQUEST_TAGS.REPORTS,
      cloudRequestTags.license(licenseKey),
      cloudRequestTags.rpc(rpcName)
    ],
    fn: () => callRpc(rpcName, {
      ...baseArgs,
      ...params
    })
  });
};

export default {
  registerCloudExpirationWaste,
  getCloudExpiringBatchesReport
};