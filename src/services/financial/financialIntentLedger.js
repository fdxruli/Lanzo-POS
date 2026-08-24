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

const TRANSPORT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECANCELED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EPIPE',
  'ESOCKETTIMEDOUT',
  'ETIME',
  'ETIMEDOUT',
  'ERR_ABORTED',
  'ERR_NETWORK',
  'ERR_NETWORK_CHANGED',
  'ERR_CANCELED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_TIMED_OUT',
  'FETCH_ERROR',
  'NETWORK_ERR',
  'NETWORK_ERROR',
  'NETWORK_UNAVAILABLE',
  'TIMEOUT_ERR',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);
const AMBIGUOUS_HTTP_STATUSES = new Set([502, 503, 504]);
const CASH_ADMIN_CLOSE_REVIEW_CODES = new Set(['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED']);
const PROTOCOL_CODE_PATTERN = /(?:IDEMPOTENCY_CONFLICT|FINANCIAL_REQUEST_HASH_INVALID|FINANCIAL_OPERATION_ORIGIN_MISMATCH|FINANCIAL_[A-Z_]+|CASH_[A-Z_]+)/i;
const TRANSPORT_MESSAGE_PATTERN = /(?:\bfailed to fetch\b|\bfetch failed\b|^load failed$|\bnetworkerror\b|\bnetwork (?:request )?(?:failed|failure|error|unavailable|offline|interrupted)\b|\b(?:network|request|connection|transport|fetch) (?:timed out|timeout|was aborted|aborted|was interrupted|interrupted)\b|\boperation (?:timed out|timeout)\b|\btimeout(?: of \S+)? (?:exceeded|expired)\b|^timeout$|\boffline\b|\bconnection (?:reset|aborted|interrupted|closed unexpectedly)\b|\bsocket hang up\b)/i;

const safeRead = (value, key) => {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? value[key]
      : undefined;
  } catch {
    return undefined;
  }
};

const safeText = (value) => {
  if (value === null || value === undefined) return '';
  try {
    return String(value).trim();
  } catch {
    return '';
  }
};

const validHttpStatus = (value) => {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
};

const extractDispatchErrorEvidence = (error) => {
  const cause = safeRead(error, 'cause');
  const response = safeRead(error, 'response');
  const directCode = safeText(safeRead(error, 'code')).toUpperCase();
  const causeCode = safeText(safeRead(cause, 'code')).toUpperCase();
  const texts = [
    typeof error === 'string' || typeof error === 'number' ? error : null,
    directCode,
    safeRead(error, 'message'),
    safeRead(error, 'details'),
    safeRead(error, 'hint'),
    causeCode,
    safeRead(cause, 'message')
  ].map(safeText).filter(Boolean);
  const status = [
    safeRead(error, 'status'),
    safeRead(error, 'statusCode'),
    safeRead(response, 'status'),
    /^\d{3}$/.test(directCode) ? directCode : null
  ].map(validHttpStatus).find((candidate) => candidate !== null) || null;
  return {
    codes: [directCode, causeCode].filter(Boolean),
    name: safeText(safeRead(error, 'name')),
    texts,
    status,
    deterministicServerResponse: safeRead(error, 'isDeterministicServerResponse') === true
  };
};

const protocolCode = (evidence) => {
  for (const text of evidence.texts) {
    const match = text.match(PROTOCOL_CODE_PATTERN);
    if (match) return match[0].toUpperCase();
  }
  return null;
};

const isDeterministicDatabaseCode = (code) => (
  /^PGRST[0-9A-Z]{3}$/.test(code)
  || (/^[0-9A-Z]{5}$/.test(code) && !TRANSPORT_ERROR_CODES.has(code))
);

const hasTransportEvidence = (evidence) => (
  evidence.codes.some((code) => TRANSPORT_ERROR_CODES.has(code))
  || /^(?:AbortError|NetworkError|TimeoutError)$/i.test(evidence.name)
  || evidence.texts.some((text) => TRANSPORT_MESSAGE_PATTERN.test(text))
);

const classifyDispatchFailure = (error) => {
  const evidence = extractDispatchErrorEvidence(error);
  const code = protocolCode(evidence);
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return { code, status: FINANCIAL_INTENT_STATUS.CONFLICT };
  }
  if (code) return { code, status: FINANCIAL_INTENT_STATUS.BLOCKED };
  if (evidence.codes.some(isDeterministicDatabaseCode)) {
    return { code: null, status: FINANCIAL_INTENT_STATUS.BLOCKED };
  }
  if (evidence.status >= 400 && evidence.status <= 499) {
    return { code: null, status: FINANCIAL_INTENT_STATUS.BLOCKED };
  }
  if (AMBIGUOUS_HTTP_STATUSES.has(evidence.status)) {
    return { code: null, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT };
  }
  if (evidence.deterministicServerResponse) {
    return { code: null, status: FINANCIAL_INTENT_STATUS.BLOCKED };
  }
  if (hasTransportEvidence(evidence)) return { code: null, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT };
  return { code: null, status: FINANCIAL_INTENT_STATUS.BLOCKED };
};

const isCashAdminCloseReviewResponse = (operationType, result) => (
  operationType === 'cash.admin_close'
  && result?.success === false
  && CASH_ADMIN_CLOSE_REVIEW_CODES.has(String(result?.code || '').trim().toUpperCase())
);

const rejectedFinancialResponseError = (result) => {
  const rejected = new Error(result?.code || result?.message || 'FINANCIAL_OPERATION_REJECTED');
  rejected.code = result?.code || null;
  rejected.details = result?.details ?? null;
  rejected.hint = result?.hint ?? null;
  if (result?.cause) rejected.cause = result.cause;
  const status = validHttpStatus(result?.status ?? result?.statusCode ?? result?.status_code);
  if (status !== null) rejected.status = status;
  rejected.isDeterministicServerResponse = true;
  return rejected;
};

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

// Recovery deliberately has a narrower authority rule than normal execution.
// A new login for the *same* actor has a new session/generation, but must never
// be allowed to adopt another actor's durable financial evidence.
export const assertFinancialIntentRecoveryAuthority = (row, handle) => {
  handle?.assertCurrent?.();
  if (
    !row
    || row.originActorKey !== handle?.actorKey
    || row.originActorType !== handle?.actorType
    || row.originActorId !== handle?.actorId
    || row.originTenantOpaqueId !== handle?.tenant?.opaqueId
    || row.originTenantDatabaseName !== handle?.tenant?.databaseName
  ) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
  if (row.originDeviceRef && handle?.deviceRef && row.originDeviceRef !== handle.deviceRef) {
    throw new Error('FINANCIAL_RECOVERY_DEVICE_MISMATCH');
  }
  return true;
};

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

/**
 * Cross-boot recovery mutation boundary.  Do not use this for ordinary 5B
 * execution: normal execution intentionally keeps its exact captured-origin
 * session/generation checks above.
 */
export const updateFinancialIntentForRecovery = async (intentId, changes, handle) => {
  const keys = Object.keys(changes || {});
  if (keys.some((key) => IMMUTABLE_FIELDS.has(key))) throw new Error('FINANCIAL_INTENT_IMMUTABILITY_VIOLATION');
  handle?.assertCurrent?.();
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const row = await table.get(intentId);
  if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(row, handle);
  // Recheck immediately before the write: an async receipt must never land
  // under a later actor/tenant runtime.
  handle?.assertCurrent?.();
  await table.update(intentId, { ...changes, updatedAt: now() });
};

const leaseExpired = (row, currentTime) => !row?.recoveryLeaseUntil || Date.parse(row.recoveryLeaseUntil) <= currentTime;

export const claimFinancialIntentRecovery = async ({ intentId, actorHandle, leaseMs = 30_000, currentTime = Date.now() } = {}) => {
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const safeLeaseMs = Math.min(Math.max(Number(leaseMs) || 30_000, 1_000), 120_000);
  const leaseId = secureKey();
  let claimed = null;
  await db.transaction('rw', table, async () => {
    actorHandle?.assertCurrent?.();
    const row = await table.get(intentId);
    if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
    assertFinancialIntentRecoveryAuthority(row, actorHandle);
    if (row.recoveryLeaseId && !leaseExpired(row, currentTime)) {
      const error = new Error('FINANCIAL_RECOVERY_LEASE_HELD');
      error.code = 'FINANCIAL_RECOVERY_LEASE_HELD';
      throw error;
    }
    actorHandle?.assertCurrent?.();
    const leaseUntil = new Date(currentTime + safeLeaseMs).toISOString();
    await table.update(intentId, {
      recoveryLeaseId: leaseId,
      recoveryLeaseUntil: leaseUntil,
      recoveryAttemptCount: Number(row.recoveryAttemptCount || 0) + 1,
      lastRecoveryAt: new Date(currentTime).toISOString(),
      lastRecoveryCode: null,
      updatedAt: now()
    });
    claimed = { ...row, recoveryLeaseId: leaseId, recoveryLeaseUntil: leaseUntil };
  });
  return Object.freeze(claimed);
};

export const releaseFinancialIntentRecoveryClaim = async ({ intentId, leaseId, actorHandle, code = null } = {}) => {
  const table = db.table(STORES.FINANCIAL_INTENTS);
  await db.transaction('rw', table, async () => {
    actorHandle?.assertCurrent?.();
    const row = await table.get(intentId);
    if (!row) return;
    assertFinancialIntentRecoveryAuthority(row, actorHandle);
    if (row.recoveryLeaseId !== leaseId) return;
    actorHandle?.assertCurrent?.();
    await table.update(intentId, {
      recoveryLeaseId: null,
      recoveryLeaseUntil: null,
      lastRecoveryCode: code || row.lastRecoveryCode || null,
      updatedAt: now()
    });
  });
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

const recordReceipt = async ({ intentId, handle, receipt, status, code = null, preserveFullResponse = false }) => {
  await updateMutable(intentId, {
    status,
    lastReceiptStatus: receipt?.status || status,
    lastProtocolCode: code || receipt?.code || null,
    ...(status === FINANCIAL_INTENT_STATUS.COMPLETED
      ? { responsePayload: preserveFullResponse ? receipt : (receipt?.result || receipt), completedAt: now() }
      : {})
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

export const getFinancialIntentReceiptForRecovery = async ({ intent, licenseKey, actorHandle = null } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  assertFinancialIntentRecoveryAuthority(intent, handle);
  const row = await db.table(STORES.FINANCIAL_INTENTS).get(intent.id);
  if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(row, handle);
  return receiptForCurrentOrigin({ intent: row, licenseKey, handle });
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
    const isAdminCloseReview = isCashAdminCloseReviewResponse(durableIntent.operationType, result);
    if (result?.success === false && !isAdminCloseReview) {
      throw rejectedFinancialResponseError(result);
    }
    await recordReceipt({
      intentId: durableIntent.id,
      handle,
      receipt: result,
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      preserveFullResponse: isAdminCloseReview
    });
    return { intentId: durableIntent.id, response: result };
  } catch (error) {
    const { code, status } = classifyDispatchFailure(error);
    if (status === FINANCIAL_INTENT_STATUS.CONFLICT || status === FINANCIAL_INTENT_STATUS.BLOCKED) {
      await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status, code });
    } else {
      await recordReceipt({ intentId: durableIntent.id, handle, receipt: null, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, code });
      try {
        const receipt = await receiptForCurrentOrigin({ intent: durableIntent, licenseKey, handle });
        if (receipt?.status === 'COMPLETED') await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.COMPLETED });
        else if (receipt?.status === 'CONFLICT') await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.CONFLICT, code: 'IDEMPOTENCY_CONFLICT' });
        else await recordReceipt({ intentId: durableIntent.id, handle, receipt, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
      } catch {
        // The original ambiguous intent remains durable; 5B never resends it.
      }
    }
    throw error;
  }
};

/**
 * The only recovery execution path.  It is intentionally restricted to an
 * immutable PREPARED row that has never crossed the durable dispatch boundary.
 */
export const executePreparedFinancialIntentForRecovery = async ({ intentId, licenseKey, actorHandle = null } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const durableIntent = await table.get(intentId);
  if (!durableIntent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(durableIntent, handle);
  if (durableIntent.status !== FINANCIAL_INTENT_STATUS.PREPARED || Number(durableIntent.dispatchAttemptCount || 0) !== 0) {
    throw new Error('FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE');
  }
  await updateFinancialIntentForRecovery(intentId, {
    status: FINANCIAL_INTENT_STATUS.DISPATCHING,
    dispatchAttemptCount: 1,
    firstDispatchAt: durableIntent.firstDispatchAt || now(),
    lastDispatchAt: now(),
    lastRecoveryCode: 'FINANCIAL_RECOVERY_FIRST_DISPATCH'
  }, handle);
  try {
    const auth = await buildAuth(licenseKey);
    handle.assertCurrent();
    const { data, error } = await supabaseClient.rpc('pos_execute_financial_operation_v1', {
      ...auth,
      p_idempotency_key: durableIntent.idempotencyKey,
      p_request_hash: durableIntent.requestHash,
      p_operation_type: durableIntent.operationType,
      p_request: durableIntent.requestPayload
    });
    if (error) throw error;
    const result = parseRpcPayload(data);
    if (result?.success === false && !isCashAdminCloseReviewResponse(durableIntent.operationType, result)) {
      throw rejectedFinancialResponseError(result);
    }
    await updateFinancialIntentForRecovery(intentId, {
      status: FINANCIAL_INTENT_STATUS.COMPLETED,
      lastReceiptStatus: 'COMPLETED',
      lastProtocolCode: null,
      responsePayload: result,
      completedAt: now()
    }, handle);
    return { intentId, response: result };
  } catch (error) {
    const { code, status } = classifyDispatchFailure(error);
    await updateFinancialIntentForRecovery(intentId, { status, lastProtocolCode: code }, handle);
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

export const listFinancialIntentsForRecovery = async ({ actorHandle = null, limit = 25 } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const rows = await db.table(STORES.FINANCIAL_INTENTS)
    .where('originActorKey').equals(handle.actorKey)
    .toArray();
  handle.assertCurrent();
  return rows
    .filter((row) => [
      FINANCIAL_INTENT_STATUS.PREPARED,
      FINANCIAL_INTENT_STATUS.DISPATCHING,
      FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
      FINANCIAL_INTENT_STATUS.COMPLETED
    ].includes(row.status))
    .filter((row) => row.status !== FINANCIAL_INTENT_STATUS.COMPLETED || [
      FINANCIAL_PROJECTION_STATUS.PENDING,
      FINANCIAL_PROJECTION_STATUS.FAILED
    ].includes(row.projectionStatus))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .slice(0, Math.min(Math.max(Number(limit) || 25, 1), 50));
};

export const financialIntentLedgerInternals = Object.freeze({ canonicalFinancialRequestV1, assertNoSecretPayload, secureKey, updateMutable, resolveStation, hasCapturedOrigin });
