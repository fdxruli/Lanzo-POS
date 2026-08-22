import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { canonicalFinancialRequestV1, financialRequestHashV1 } from './financialCanonicalV1';

export const FINANCIAL_INTENT_STATUS = Object.freeze({
  PREPARED: 'PREPARED',
  DISPATCHING: 'DISPATCHING',
  PENDING_RECEIPT: 'PENDING_RECEIPT',
  COMPLETED: 'COMPLETED',
  CONFLICT: 'CONFLICT',
  BLOCKED: 'BLOCKED'
});

export const FINANCIAL_PROJECTION_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  FAILED: 'FAILED'
});

const IMMUTABLE_FIELDS = new Set([
  'id', 'ledgerVersion', 'operationType', 'idempotencyKey', 'requestHash', 'requestContractVersion',
  'requestPayload', 'canonicalRequest', 'originActorKey', 'originActorType', 'originActorId',
  'originActorSessionId', 'originActorGeneration', 'originTenantOpaqueId', 'originTenantDatabaseName',
  'originTenantGeneration', 'originDeviceRef', 'cashSessionId', 'cashStationId', 'createdAt'
]);
const SECRET_FIELD = new Set(['licensekey', 'securitytoken', 'previoussecuritytoken', 'staffsessiontoken', 'adminsessionsecret', 'admintoken', 'adminsessiontoken', 'password', 'passwordhash', 'supabasetoken', 'serviceroletoken', 'jwt', 'authorization', 'accesstoken', 'refreshtoken']);
const now = () => new Date().toISOString();
const parseRpcPayload = (data) => typeof data === 'string' ? JSON.parse(data) : (data || {});

const assertNoSecretPayload = (value, path = '') => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecretPayload(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, item]) => {
    if (SECRET_FIELD.has(String(key).replace(/[^a-z]/gi, '').toLowerCase())) throw new Error(`FINANCIAL_INTENT_SECRET_FIELD_FORBIDDEN:${path}${key}`);
    assertNoSecretPayload(item, `${path}${key}.`);
  });
};

const secureKey = () => {
  if (!globalThis.crypto?.getRandomValues) throw new Error('FINANCIAL_SECURE_RANDOM_UNAVAILABLE');
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return `financial:v1:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const protocolCode = (error) => String(error?.code || error?.message || error || '').match(/(?:IDEMPOTENCY_CONFLICT|FINANCIAL_REQUEST_HASH_INVALID|FINANCIAL_OPERATION_ORIGIN_MISMATCH|FINANCIAL_[A-Z_]+|CASH_[A-Z_]+)/)?.[0] || null;
const isAmbiguousTransport = (error) => !protocolCode(error) || /(?:network|fetch|timeout|abort|offline|failed to fetch)/i.test(String(error?.message || error));

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const buildAuth = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });
  if (!context.licenseKey || !context.deviceFingerprint || !context.securityToken) throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    p_security_token: context.securityToken,
    p_staff_session_token: context.staffSessionToken || null
  };
};

const hasCapturedOrigin = (row, handle) => (
  row?.originActorKey === handle.actorKey
  && row?.originActorSessionId === handle.sessionId
  && row?.originActorGeneration === handle.generation
  && row?.originTenantOpaqueId === handle.tenant.opaqueId
  && row?.originTenantDatabaseName === handle.tenant.databaseName
  && row?.originTenantGeneration === handle.tenant.generation
);

const updateMutable = async (intentId, changes, handle) => {
  const keys = Object.keys(changes || {});
  if (keys.some((key) => IMMUTABLE_FIELDS.has(key))) throw new Error('FINANCIAL_INTENT_IMMUTABILITY_VIOLATION');
  handle.assertCurrent();
  const row = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (!hasCapturedOrigin(row, handle)) {
    throw new Error('FINANCIAL_OPERATION_ORIGIN_MISMATCH');
  }
  handle.assertCurrent();
  await db.table(STORES.FINANCIAL_INTENTS).update(intentId, { ...changes, updatedAt: now() });
};

const resolveStation = async ({ auth, cashSessionId, operationType }) => {
  if (operationType === 'sale.cancel') return null;
  const { data, error } = await supabaseClient.rpc('pos_get_cash_station_state', auth);
  if (error) throw error;
  const payload = parseRpcPayload(data);
  const stationId = payload?.cash_station?.id || payload?.cashStation?.id || null;
  if (!stationId) throw new Error('CASH_STATION_UNRESOLVED');
  if (cashSessionId) {
    const open = payload?.station_open_cash_session || payload?.stationOpenCashSession || null;
    if (!open?.id || String(open.id) !== String(cashSessionId)) throw new Error('CASH_SESSION_STATION_MISMATCH');
  }
  return stationId;
};

const recordReceipt = async ({ intentId, handle, receipt, status, code = null }) => {
  await updateMutable(intentId, {
    status,
    lastReceiptStatus: receipt?.status || status,
    lastProtocolCode: code || receipt?.code || null,
    ...(status === FINANCIAL_INTENT_STATUS.COMPLETED ? { responsePayload: receipt?.result || receipt, completedAt: now() } : {})
  }, handle);
};

const receiptForCurrentOrigin = async ({ intent, licenseKey, handle }) => {
  handle.assertCurrent();
  const auth = await buildAuth(licenseKey);
  handle.assertCurrent();
  const { data, error } = await supabaseClient.rpc('pos_get_financial_operation_receipt', {
    ...auth, p_idempotency_key: intent.idempotencyKey, p_request_hash: intent.requestHash
  });
  if (error) throw error;
  return parseRpcPayload(data);
};

const initialIntent = ({ operationType, request, idempotencyKey, requestHash, canonicalRequest, handle, cashSessionId, cashStationId, projectionStatus }) => ({
  id: secureKey(), ledgerVersion: 1, operationType, idempotencyKey, requestHash, requestContractVersion: 1,
  requestPayload: request, canonicalRequest,
  originActorKey: handle.actorKey, originActorType: handle.actorType, originActorId: handle.actorId,
  originActorSessionId: handle.sessionId, originActorGeneration: handle.generation,
  originTenantOpaqueId: handle.tenant.opaqueId, originTenantDatabaseName: handle.tenant.databaseName,
  originTenantGeneration: handle.tenant.generation, originDeviceRef: handle.deviceRef || null,
  cashSessionId: cashSessionId || null, cashStationId: cashStationId || null,
  status: FINANCIAL_INTENT_STATUS.PREPARED, dispatchAttemptCount: 0, firstDispatchAt: null, lastDispatchAt: null,
  lastReceiptStatus: null, lastProtocolCode: null, responsePayload: null,
  projectionStatus, projectionErrorCode: null, createdAt: now(), updatedAt: now(), completedAt: null
});

export const createFinancialIntent = async ({ operationType, request, licenseKey, idempotencyKey = null, cashSessionId = null, actorHandle = null, projectionRequired = true }) => {
  assertSupabase();
  const immutableRequest = JSON.parse(JSON.stringify(request));
  assertNoSecretPayload(immutableRequest);
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const auth = await buildAuth(licenseKey);
  handle.assertCurrent();
  const stationId = await resolveStation({ auth, cashSessionId, operationType });
  handle.assertCurrent();
  const { canonicalRequest, requestHash } = await financialRequestHashV1({ operationType, request: immutableRequest, actorKey: handle.actorKey, cashSessionId, cashStationId: stationId });
  const intent = initialIntent({ operationType, request: immutableRequest, idempotencyKey: idempotencyKey || secureKey(), requestHash, canonicalRequest, handle, cashSessionId, cashStationId: stationId, projectionStatus: projectionRequired ? FINANCIAL_PROJECTION_STATUS.PENDING : FINANCIAL_PROJECTION_STATUS.NOT_REQUIRED });
  handle.assertCurrent();
  try {
    await db.table(STORES.FINANCIAL_INTENTS).add(intent);
  } catch (error) {
    if (error?.name === 'ConstraintError') throw new Error('FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED');
    throw error;
  }
  return Object.freeze(intent);
};

export const executeFinancialIntent = async ({ intent, licenseKey, actorHandle = null }) => {
  if (!intent?.id || !intent?.idempotencyKey || !intent?.requestHash) throw new Error('FINANCIAL_INTENT_INVALID');
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const durableIntent = await db.table(STORES.FINANCIAL_INTENTS).get(intent.id);
  if (!durableIntent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (
    durableIntent.idempotencyKey !== intent.idempotencyKey
    || durableIntent.requestHash !== intent.requestHash
    || durableIntent.operationType !== intent.operationType
    || !hasCapturedOrigin(durableIntent, handle)
  ) {
    throw new Error('FINANCIAL_OPERATION_ORIGIN_MISMATCH');
  }
  await updateMutable(durableIntent.id, { status: FINANCIAL_INTENT_STATUS.DISPATCHING, dispatchAttemptCount: Number(durableIntent.dispatchAttemptCount || 0) + 1, firstDispatchAt: durableIntent.firstDispatchAt || now(), lastDispatchAt: now() }, handle);
  try {
    const auth = await buildAuth(licenseKey);
    handle.assertCurrent();
    const { data, error } = await supabaseClient.rpc('pos_execute_financial_operation_v1', {
      ...auth, p_idempotency_key: intent.idempotencyKey, p_request_hash: intent.requestHash,
      p_operation_type: durableIntent.operationType, p_request: durableIntent.requestPayload
    });
    if (error) throw error;
    const result = parseRpcPayload(data);
    if (result?.success === false) {
      const rejected = new Error(result.code || result.message || 'FINANCIAL_OPERATION_REJECTED');
      rejected.code = result.code || null;
      throw rejected;
    }
    await recordReceipt({ intentId: durableIntent.id, handle, receipt: result, status: FINANCIAL_INTENT_STATUS.COMPLETED });
    return { intentId: durableIntent.id, response: result };
  } catch (error) {
    const code = protocolCode(error);
    if (code === 'IDEMPOTENCY_CONFLICT') await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status: FINANCIAL_INTENT_STATUS.CONFLICT, code });
    else if (code === 'FINANCIAL_REQUEST_HASH_INVALID' || code === 'FINANCIAL_OPERATION_ORIGIN_MISMATCH') await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status: FINANCIAL_INTENT_STATUS.BLOCKED, code });
    else if (isAmbiguousTransport(error)) {
      await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, code });
      try {
        const receipt = await receiptForCurrentOrigin({ intent: durableIntent, licenseKey, handle });
        if (receipt?.status === 'COMPLETED') await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.COMPLETED });
        else if (receipt?.status === 'CONFLICT') await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.CONFLICT, code: 'IDEMPOTENCY_CONFLICT' });
        else await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
      } catch (receiptError) {
        // The original ambiguous intent remains durable; 5B never resends it.
      }
    } else await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status: FINANCIAL_INTENT_STATUS.BLOCKED, code });
    throw error;
  }
};

export const executeNewFinancialIntent = async (options) => {
  const intent = await createFinancialIntent(options);
  return { intent, ...(await executeFinancialIntent({ intent, licenseKey: options.licenseKey, actorHandle: options.actorHandle })) };
};

export const markFinancialIntentProjectionApplied = async ({ intentId, actorHandle = null }) => updateMutable(intentId, { projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED, projectionErrorCode: null }, actorHandle || actorRuntimeController.capture());
export const markFinancialIntentProjectionFailed = async ({ intentId, errorCode = 'LOCAL_PROJECTION_FAILED', actorHandle = null }) => updateMutable(intentId, { projectionStatus: FINANCIAL_PROJECTION_STATUS.FAILED, projectionErrorCode: errorCode }, actorHandle || actorRuntimeController.capture());
export const listUnresolvedFinancialIntents = async () => db.table(STORES.FINANCIAL_INTENTS).where('status').anyOf(FINANCIAL_INTENT_STATUS.PREPARED, FINANCIAL_INTENT_STATUS.DISPATCHING, FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, FINANCIAL_INTENT_STATUS.BLOCKED).toArray();
export const getFinancialIntent = async (intentId) => db.table(STORES.FINANCIAL_INTENTS).get(intentId);

export const financialIntentLedgerInternals = Object.freeze({ canonicalFinancialRequestV1, assertNoSecretPayload, secureKey, updateMutable, resolveStation });
