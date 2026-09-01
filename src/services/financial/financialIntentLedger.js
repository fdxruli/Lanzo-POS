import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import {
  canonicalFinancialRequestV1,
  canonicalJsonV1,
  financialRequestHashV1
} from './financialCanonicalV1';
import { retryExistingFinancialIntentExplicitly } from './financialIntentRecovery';

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

const DEFAULT_RECOVERY_LEASE_MS = 30_000;
const boundedLeaseMs = (leaseMs = DEFAULT_RECOVERY_LEASE_MS) => (
  Math.min(Math.max(Number(leaseMs) || DEFAULT_RECOVERY_LEASE_MS, 1_000), 120_000)
);

const createRecoveryLease = ({ leaseMs = DEFAULT_RECOVERY_LEASE_MS, currentTime = Date.now() } = {}) => {
  const leaseUntil = new Date(currentTime + boundedLeaseMs(leaseMs)).toISOString();
  return Object.freeze({
    leaseId: secureKey(),
    leaseUntil,
    currentTime
  });
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
const EXPLICIT_SALE_RETRY_OPERATION_TYPES = new Set(['sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split', 'sale.layaway_complete']);
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

const normalizeDeviceRef = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

const hasCapturedOrigin = (row, handle) => (
  row?.originActorKey === handle.actorKey
  && row?.originActorSessionId === handle.sessionId
  && row?.originActorGeneration === handle.generation
  && row?.originTenantOpaqueId === handle.tenant.opaqueId
  && row?.originTenantDatabaseName === handle.tenant.databaseName
  && row?.originTenantGeneration === handle.tenant.generation
  && normalizeDeviceRef(row?.originDeviceRef) !== null
  && normalizeDeviceRef(row?.originDeviceRef) === normalizeDeviceRef(handle.deviceRef)
);

const sameNullableIdentity = (left, right) => (
  (left === null || left === undefined) && (right === null || right === undefined)
  || (left !== null && left !== undefined && right !== null && right !== undefined && left === right)
);

const sameCanonicalValue = (left, right) => canonicalJsonV1(left) === canonicalJsonV1(right);

const financialIntentOwnershipError = () => {
  const error = new Error('FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED');
  error.code = 'FINANCIAL_IDEMPOTENCY_KEY_ALREADY_OWNED';
  error.isFinancialIntentOwnershipError = true;
  return error;
};

const isProjectionOnlyIntent = (row) => (
  row?.status === FINANCIAL_INTENT_STATUS.COMPLETED
  && [FINANCIAL_PROJECTION_STATUS.PENDING, FINANCIAL_PROJECTION_STATUS.FAILED].includes(row.projectionStatus)
);

const isProjectionOnlyMutation = (row, changes = {}) => (
  isProjectionOnlyIntent(row)
  && Object.keys(changes || {}).every((key) => ['projectionStatus', 'projectionErrorCode', 'lastRecoveryCode'].includes(key))
);

const leaseExpired = (row, currentTime = Date.now()) => {
  const leaseUntil = Date.parse(row?.recoveryLeaseUntil || '');
  const nowTime = Number(currentTime);
  return !Number.isFinite(leaseUntil) || !Number.isFinite(nowTime) || leaseUntil <= nowTime;
};

const effectiveCurrentTime = (currentTime) => {
  if (currentTime === null || currentTime === undefined) return Date.now();
  const numericTime = Number(currentTime);
  return Number.isFinite(numericTime) ? numericTime : Date.now();
};

const assertFinancialIntentDeviceAuthority = (row, handle, { allowLegacyNullDevice = false } = {}) => {
  const durableDeviceRef = normalizeDeviceRef(row?.originDeviceRef);
  const currentDeviceRef = normalizeDeviceRef(handle?.deviceRef);

  if (!durableDeviceRef) {
    if (allowLegacyNullDevice) return true;
    throw new Error('FINANCIAL_RECOVERY_DEVICE_UNRESOLVED');
  }
  if (!currentDeviceRef) throw new Error('FINANCIAL_RECOVERY_DEVICE_UNRESOLVED');
  if (durableDeviceRef !== currentDeviceRef) throw new Error('FINANCIAL_RECOVERY_DEVICE_MISMATCH');
  return true;
};

const assertFinancialIntentExecutionAuthority = (row, handle) => {
  assertFinancialIntentDeviceAuthority(row, handle);
  if (!hasCapturedOrigin(row, handle)) throw new Error('FINANCIAL_OPERATION_ORIGIN_MISMATCH');
  return true;
};

// Recovery deliberately has a narrower authority rule than normal execution.
// A new login for the *same* actor has a new session/generation, but must never
// be allowed to adopt another actor's durable financial evidence.
export const assertFinancialIntentRecoveryAuthority = (row, handle, { allowLegacyNullDevice = false } = {}) => {
  handle?.assertCurrent?.();
  if (
    !row
    || row.originActorKey !== handle?.actorKey
    || row.originActorType !== handle?.actorType
    || row.originActorId !== handle?.actorId
    || row.originTenantOpaqueId !== handle?.tenant?.opaqueId
    || row.originTenantDatabaseName !== handle?.tenant?.databaseName
  ) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
  assertFinancialIntentDeviceAuthority(row, handle, { allowLegacyNullDevice });
  return true;
};

/**
 * Validate that a newly calculated checkout is allowed to adopt an existing
 * durable owner. Session/generation fields are deliberately excluded here:
 * the recovery authority permits a later session of the same actor to recover
 * the original evidence. The request, tenant, device and cash identity are
 * still exact gates.
 */
export const assertFinancialIntentRetryEquivalence = (existingIntent, retryIntent, handle) => {
  assertFinancialIntentRecoveryAuthority(existingIntent, handle);

  if (!retryIntent || existingIntent?.idempotencyKey !== retryIntent.idempotencyKey) {
    throw new Error('FINANCIAL_REQUEST_HASH_INVALID');
  }

  if (
    existingIntent.operationType !== retryIntent.operationType
    || existingIntent.requestContractVersion !== retryIntent.requestContractVersion
    || existingIntent.requestHash !== retryIntent.requestHash
    || !sameCanonicalValue(existingIntent.canonicalRequest, retryIntent.canonicalRequest)
  ) {
    throw new Error('FINANCIAL_REQUEST_HASH_INVALID');
  }

  let durableCanonicalRequest;
  let retryCanonicalRequest;
  try {
    durableCanonicalRequest = canonicalFinancialRequestV1(existingIntent.operationType, existingIntent.requestPayload);
    retryCanonicalRequest = canonicalFinancialRequestV1(retryIntent.operationType, retryIntent.requestPayload);
  } catch {
    throw new Error('FINANCIAL_REQUEST_HASH_INVALID');
  }
  if (
    !sameCanonicalValue(existingIntent.canonicalRequest, durableCanonicalRequest)
    || !sameCanonicalValue(retryIntent.canonicalRequest, retryCanonicalRequest)
  ) {
    throw new Error('FINANCIAL_REQUEST_HASH_INVALID');
  }

  const exactOriginFields = [
    'originActorKey',
    'originActorType',
    'originActorId',
    'originTenantOpaqueId',
    'originTenantDatabaseName',
    'cashSessionId',
    'cashStationId'
  ];
  if (exactOriginFields.some((field) => !sameNullableIdentity(existingIntent?.[field], retryIntent?.[field]))) {
    throw new Error('FINANCIAL_OPERATION_ORIGIN_MISMATCH');
  }

  if (!normalizeDeviceRef(existingIntent.originDeviceRef) || !normalizeDeviceRef(retryIntent.originDeviceRef)) {
    throw new Error('FINANCIAL_RECOVERY_DEVICE_UNRESOLVED');
  }
  if (!sameNullableIdentity(existingIntent.originDeviceRef, retryIntent.originDeviceRef)) {
    throw new Error('FINANCIAL_RECOVERY_DEVICE_MISMATCH');
  }
  if (!sameNullableIdentity(existingIntent.originDeviceRef, handle?.deviceRef)) {
    throw new Error('FINANCIAL_RECOVERY_DEVICE_MISMATCH');
  }

  return true;
};

/**
 * Cross-boot recovery mutation boundary. Every recovery write is a fenced
 * compare-and-swap inside one Dexie transaction. A lease id is mandatory:
 * neither an expired owner nor a stale owner can overwrite a newer owner.
 */
export const updateFinancialIntentForRecovery = async (
  intentId,
  changes,
  handle,
  { recoveryLeaseId = null, currentTime = null, expectedStatus = null } = {}
) => {
  const keys = Object.keys(changes || {});
  if (keys.some((key) => IMMUTABLE_FIELDS.has(key))) throw new Error('FINANCIAL_INTENT_IMMUTABILITY_VIOLATION');
  if (!recoveryLeaseId) throw new Error('FINANCIAL_RECOVERY_LEASE_REQUIRED');
  handle?.assertCurrent?.();
  const table = db.table(STORES.FINANCIAL_INTENTS);
  await db.transaction('rw', table, async () => {
    handle?.assertCurrent?.();
    const row = await table.get(intentId);
    if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
    assertFinancialIntentRecoveryAuthority(row, handle, {
      allowLegacyNullDevice: isProjectionOnlyMutation(row, changes)
    });
    if (expectedStatus && row.status !== expectedStatus) {
      throw new Error('FINANCIAL_RECOVERY_STATE_CHANGED');
    }
    if (row.recoveryLeaseId !== recoveryLeaseId) {
      throw new Error('FINANCIAL_RECOVERY_LEASE_LOST');
    }
    if (leaseExpired(row, effectiveCurrentTime(currentTime))) {
      throw new Error('FINANCIAL_RECOVERY_LEASE_EXPIRED');
    }
    // Recheck immediately before the write: an async receipt must never land
    // under a later actor/tenant runtime.
    handle?.assertCurrent?.();
    const updated = await table.update(intentId, { ...changes, updatedAt: now() });
    if (updated === 0) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  });
};

export const claimFinancialIntentRecovery = async ({ intentId, actorHandle, leaseMs = 30_000, currentTime = null } = {}) => {
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const safeLeaseMs = Math.min(Math.max(Number(leaseMs) || 30_000, 1_000), 120_000);
  const leaseId = secureKey();
  let claimed = null;
  await db.transaction('rw', table, async () => {
    actorHandle?.assertCurrent?.();
    const row = await table.get(intentId);
    if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
    assertFinancialIntentRecoveryAuthority(row, actorHandle, {
      allowLegacyNullDevice: isProjectionOnlyIntent(row)
    });
    const claimTime = effectiveCurrentTime(currentTime);
    if (row.recoveryLeaseId && !leaseExpired(row, claimTime)) {
      const error = new Error('FINANCIAL_RECOVERY_LEASE_HELD');
      error.code = 'FINANCIAL_RECOVERY_LEASE_HELD';
      throw error;
    }
    actorHandle?.assertCurrent?.();
    const leaseUntil = new Date(claimTime + safeLeaseMs).toISOString();
    const claimedRows = await table.update(intentId, {
      recoveryLeaseId: leaseId,
      recoveryLeaseUntil: leaseUntil,
      recoveryAttemptCount: Number(row.recoveryAttemptCount || 0) + 1,
      lastRecoveryAt: new Date(claimTime).toISOString(),
      lastRecoveryCode: null,
      updatedAt: now()
    });
    if (claimedRows === 0) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
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
    assertFinancialIntentRecoveryAuthority(row, actorHandle, {
      // Clearing a lease is safe for a legacy completed projection even after
      // the projection status has been marked APPLIED. Financial redispatch
      // still requires a durable device below every other mutation boundary.
      allowLegacyNullDevice: isProjectionOnlyIntent(row)
        || (row.status === FINANCIAL_INTENT_STATUS.COMPLETED && !normalizeDeviceRef(row.originDeviceRef))
    });
    if (row.recoveryLeaseId !== leaseId) {
      throw new Error('FINANCIAL_RECOVERY_LEASE_LOST');
    }
    if (leaseExpired(row, Date.now())) throw new Error('FINANCIAL_RECOVERY_LEASE_EXPIRED');
    actorHandle?.assertCurrent?.();
    const released = await table.update(intentId, {
      recoveryLeaseId: null,
      recoveryLeaseUntil: null,
      lastRecoveryCode: code || row.lastRecoveryCode || null,
      updatedAt: now()
    });
    if (released === 0) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  });
};

const projectionStatusNeedsWork = (intent) => (
  intent?.status === FINANCIAL_INTENT_STATUS.COMPLETED
  && [FINANCIAL_PROJECTION_STATUS.PENDING, FINANCIAL_PROJECTION_STATUS.FAILED].includes(intent.projectionStatus)
);

const isRecoveryLeaseFailure = (error) => [
  'FINANCIAL_RECOVERY_LEASE_HELD',
  'FINANCIAL_RECOVERY_LEASE_LOST',
  'FINANCIAL_RECOVERY_LEASE_EXPIRED'
].includes(error?.code || error?.message);

const assertSuppliedProjectionLease = async ({ intentId, actorHandle, recoveryLeaseId, currentTime = null }) => {
  const row = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!row) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(row, actorHandle, {
    allowLegacyNullDevice: projectionStatusNeedsWork(row)
  });
  if (row.recoveryLeaseId !== recoveryLeaseId) {
    const error = new Error(
      row.recoveryLeaseId && !leaseExpired(row, effectiveCurrentTime(currentTime))
        ? 'FINANCIAL_RECOVERY_LEASE_HELD'
        : 'FINANCIAL_RECOVERY_LEASE_LOST'
    );
    error.code = error.message;
    throw error;
  }
  if (leaseExpired(row, effectiveCurrentTime(currentTime))) {
    const error = new Error('FINANCIAL_RECOVERY_LEASE_EXPIRED');
    error.code = error.message;
    throw error;
  }
  return row;
};

/**
 * Shared durable ownership boundary for every completed financial response
 * that still needs local projection. Synchronous checkout and background
 * repair both enter here; the lease remains held through the handler and the
 * fenced lifecycle write.
 */
export const runFinancialProjectionUnderLease = async ({
  intentId,
  actorHandle = null,
  recoveryLeaseId = null,
  project,
  leaseMs,
  currentTime = null
} = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent?.();
  let intent = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(intent, handle, {
    allowLegacyNullDevice: projectionStatusNeedsWork(intent)
  });
  if (intent.status !== FINANCIAL_INTENT_STATUS.COMPLETED) {
    throw new Error('FINANCIAL_PROJECTION_REQUIRES_COMPLETED');
  }
  if (!projectionStatusNeedsWork(intent)) {
    return { intentId, outcome: 'projection_not_required' };
  }
  if (typeof project !== 'function') {
    return { intentId, outcome: 'projection_deferred' };
  }

  let claim = null;
  let ownedLeaseId = recoveryLeaseId;
  if (ownedLeaseId) {
    await assertSuppliedProjectionLease({
      intentId,
      actorHandle: handle,
      recoveryLeaseId: ownedLeaseId,
      currentTime
    });
  } else {
    claim = await claimFinancialIntentRecovery({
      intentId,
      actorHandle: handle,
      leaseMs,
      currentTime
    });
    ownedLeaseId = claim.recoveryLeaseId;
  }

  try {
    intent = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
    if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
    assertFinancialIntentRecoveryAuthority(intent, handle, {
      allowLegacyNullDevice: projectionStatusNeedsWork(intent)
    });
    if (intent.status !== FINANCIAL_INTENT_STATUS.COMPLETED) {
      throw new Error('FINANCIAL_PROJECTION_REQUIRES_COMPLETED');
    }
    if (!projectionStatusNeedsWork(intent)) {
      return { intentId, outcome: 'projection_not_required' };
    }

    try {
      handle.assertCurrent?.();
      const result = await project({ intent, actorHandle: handle });
      handle.assertCurrent?.();
      await updateFinancialIntentForRecovery(intentId, {
        projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
        projectionErrorCode: null,
        lastRecoveryCode: 'FINANCIAL_RECOVERY_PROJECTION_APPLIED'
      }, handle, {
        recoveryLeaseId: ownedLeaseId,
        currentTime,
        expectedStatus: FINANCIAL_INTENT_STATUS.COMPLETED
      });
      return { intentId, outcome: 'projection_applied', result };
    } catch (error) {
      // A lease loss/expiry is a hard fence: the stale owner must not turn
      // another owner's projection into FAILED or otherwise write the row.
      if (isRecoveryLeaseFailure(error)) throw error;
      await updateFinancialIntentForRecovery(intentId, {
        projectionStatus: FINANCIAL_PROJECTION_STATUS.FAILED,
        projectionErrorCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED',
        lastRecoveryCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED'
      }, handle, {
        recoveryLeaseId: ownedLeaseId,
        currentTime,
        expectedStatus: FINANCIAL_INTENT_STATUS.COMPLETED
      });
      return { intentId, outcome: 'projection_failed', error };
    }
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({
          intentId,
          leaseId: claim.recoveryLeaseId,
          actorHandle: handle
        });
      } catch {
        // A stale owner cannot clear a newer lease.
      }
    }
  }
};

const updateProjectionStatusUnderLease = async ({
  intentId,
  actorHandle,
  recoveryLeaseId = null,
  changes
}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  let claim = null;
  let ownedLeaseId = recoveryLeaseId;
  if (ownedLeaseId) {
    await assertSuppliedProjectionLease({
      intentId,
      actorHandle: handle,
      recoveryLeaseId: ownedLeaseId
    });
  } else {
    claim = await claimFinancialIntentRecovery({ intentId, actorHandle: handle });
    ownedLeaseId = claim.recoveryLeaseId;
  }
  try {
    await updateFinancialIntentForRecovery(intentId, changes, handle, {
      recoveryLeaseId: ownedLeaseId,
      expectedStatus: FINANCIAL_INTENT_STATUS.COMPLETED
    });
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({
          intentId,
          leaseId: claim.recoveryLeaseId,
          actorHandle: handle
        });
      } catch {
        // A stale owner cannot clear a newer lease.
      }
    }
  }
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
  originTenantGeneration: handle.tenant.generation, originDeviceRef: normalizeDeviceRef(handle.deviceRef),
  cashSessionId: cashSessionId || null, cashStationId: cashStationId || null,
  status: FINANCIAL_INTENT_STATUS.PREPARED, dispatchAttemptCount: 0, firstDispatchAt: null, lastDispatchAt: null,
  lastReceiptStatus: null, lastProtocolCode: null, responsePayload: null,
  projectionStatus, projectionErrorCode: null, createdAt: now(), updatedAt: now(), completedAt: null
});

const prepareFinancialIntent = async ({ operationType, request, licenseKey, idempotencyKey = null, cashSessionId = null, actorHandle = null, projectionRequired = true }) => {
  assertSupabase();
  const immutableRequest = JSON.parse(JSON.stringify(request));
  assertNoSecretPayload(immutableRequest);
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  if (!normalizeDeviceRef(handle.deviceRef)) throw new Error('FINANCIAL_ORIGIN_DEVICE_REQUIRED');
  const auth = await buildAuth(licenseKey);
  handle.assertCurrent();
  const stationId = await resolveStation({ auth, cashSessionId, operationType });
  handle.assertCurrent();
  const { canonicalRequest, requestHash } = await financialRequestHashV1({ operationType, request: immutableRequest, actorKey: handle.actorKey, cashSessionId, cashStationId: stationId });
  const intent = initialIntent({ operationType, request: immutableRequest, idempotencyKey: idempotencyKey || secureKey(), requestHash, canonicalRequest, handle, cashSessionId, cashStationId: stationId, projectionStatus: projectionRequired ? FINANCIAL_PROJECTION_STATUS.PENDING : FINANCIAL_PROJECTION_STATUS.NOT_REQUIRED });
  handle.assertCurrent();
  return { intent, handle };
};

const persistPreparedFinancialIntent = async (intent) => {
  const table = db.table(STORES.FINANCIAL_INTENTS);
  try {
    await db.transaction('rw', table, async () => {
      await table.add(intent);
    });
  } catch (error) {
    if (error?.name === 'ConstraintError') throw financialIntentOwnershipError();
    throw error;
  }
};

export const createFinancialIntent = async (options) => {
  const { intent } = await prepareFinancialIntent(options);
  await persistPreparedFinancialIntent(intent);
  return Object.freeze(intent);
};

export const getFinancialIntentByIdempotencyKey = async ({ idempotencyKey, actorHandle = null } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  if (!idempotencyKey) return null;
  const intent = await db.table(STORES.FINANCIAL_INTENTS)
    .where('idempotencyKey')
    .equals(idempotencyKey)
    .first();
  handle.assertCurrent();
  return intent || null;
};

export const isExplicitSaleFinancialRetry = (operationType) => EXPLICIT_SALE_RETRY_OPERATION_TYPES.has(operationType);

/*
 * The low-level allocator remains strict. Only the higher-level explicit sale
 * retry path below is allowed to look up an existing owner after this write.
 */
export const executeNewFinancialIntent = async (options) => {
  const prepared = await prepareFinancialIntent(options);
  const initialLease = createRecoveryLease({ leaseMs: options?.leaseMs });
  const leasedIntent = {
    ...prepared.intent,
    recoveryLeaseId: initialLease.leaseId,
    recoveryLeaseUntil: initialLease.leaseUntil,
    recoveryAttemptCount: 1,
    lastRecoveryAt: new Date(initialLease.currentTime).toISOString(),
    lastRecoveryCode: 'FINANCIAL_RECOVERY_INITIAL_CLAIM'
  };

  try {
    // The initial owner is written together with the intent. A duplicate
    // allocator can therefore observe an active lease immediately after the
    // unique-K winner exists; it cannot race the first dispatch.
    await persistPreparedFinancialIntent(leasedIntent);
  } catch (error) {
    if (
      !error?.isFinancialIntentOwnershipError
      || !options?.idempotencyKey
      || !isExplicitSaleFinancialRetry(prepared.intent.operationType)
    ) throw error;

    const existingIntent = await getFinancialIntentByIdempotencyKey({
      idempotencyKey: prepared.intent.idempotencyKey,
      actorHandle: prepared.handle
    });
    if (!existingIntent) throw error;

    const retry = await retryExistingFinancialIntentExplicitly({
      intentId: existingIntent.id,
      candidateIntent: prepared.intent,
      licenseKey: options.licenseKey,
      actorHandle: prepared.handle,
      project: options?.project,
      leaseMs: options.leaseMs
    });
    return {
      intent: retry.intent,
      intentId: retry.intentId,
      response: retry.response,
      projection: retry.projection
    };
  }

  try {
    return {
      intent: prepared.intent,
      ...(await executeDurableFinancialIntentForRecovery({
        intentId: prepared.intent.id,
        licenseKey: options.licenseKey,
        actorHandle: prepared.handle,
        expectedStatus: FINANCIAL_INTENT_STATUS.PREPARED,
        recoveryLeaseId: initialLease.leaseId,
        lastRecoveryCode: 'FINANCIAL_RECOVERY_INITIAL_DISPATCH',
        resolveAmbiguousReceipt: true,
        project: options?.project
      }))
    };
  } finally {
    try {
      await releaseFinancialIntentRecoveryClaim({
        intentId: prepared.intent.id,
        leaseId: initialLease.leaseId,
        actorHandle: prepared.handle
      });
    } catch {
      // A stale actor or expired lease cannot clear a newer owner.
    }
  }
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
  assertFinancialIntentExecutionAuthority(durableIntent, handle);

  const claim = await claimFinancialIntentRecovery({
    intentId: durableIntent.id,
    actorHandle: handle
  });
  try {
    return await executeDurableFinancialIntentForRecovery({
      intentId: durableIntent.id,
      licenseKey,
      actorHandle: handle,
      expectedStatus: FINANCIAL_INTENT_STATUS.PREPARED,
      recoveryLeaseId: claim.recoveryLeaseId,
      lastRecoveryCode: 'FINANCIAL_RECOVERY_FIRST_DISPATCH',
      resolveAmbiguousReceipt: true
    });
  } finally {
    try {
      await releaseFinancialIntentRecoveryClaim({
        intentId: durableIntent.id,
        leaseId: claim.recoveryLeaseId,
        actorHandle: handle
      });
    } catch {
      // A stale actor or expired lease cannot clear a newer owner.
    }
  }
};

const executeDurableFinancialIntentForRecovery = async ({
  intentId,
  licenseKey,
  actorHandle,
  expectedStatus,
  recoveryLeaseId = null,
  lastRecoveryCode,
  resolveAmbiguousReceipt = false,
  project = null
}) => {
  if (!recoveryLeaseId) throw new Error('FINANCIAL_RECOVERY_LEASE_REQUIRED');
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const durableIntent = await table.get(intentId);
  if (!durableIntent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(durableIntent, handle);
  assertFinancialIntentDeviceAuthority(durableIntent, handle);
  if (expectedStatus && durableIntent.status !== expectedStatus) {
    throw new Error(
      expectedStatus === FINANCIAL_INTENT_STATUS.PREPARED
        ? 'FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE'
        : 'FINANCIAL_RECOVERY_BLOCKED_STATE_INVALID'
    );
  }
  if (
    expectedStatus === FINANCIAL_INTENT_STATUS.PREPARED
    && Number(durableIntent.dispatchAttemptCount || 0) !== 0
  ) {
    throw new Error('FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE');
  }
  if (
    expectedStatus === FINANCIAL_INTENT_STATUS.BLOCKED
    && Number(durableIntent.dispatchAttemptCount || 0) < 1
  ) {
    throw new Error('FINANCIAL_RECOVERY_BLOCKED_STATE_INVALID');
  }
  if (durableIntent.recoveryLeaseId !== recoveryLeaseId) {
    throw new Error('FINANCIAL_RECOVERY_LEASE_LOST');
  }

  const dispatchAttemptCount = Number(durableIntent.dispatchAttemptCount || 0) + 1;
  await updateFinancialIntentForRecovery(intentId, {
    status: FINANCIAL_INTENT_STATUS.DISPATCHING,
    dispatchAttemptCount,
    firstDispatchAt: durableIntent.firstDispatchAt || now(),
    lastDispatchAt: now(),
    lastRecoveryCode
  }, handle, { recoveryLeaseId, expectedStatus });
  let result;
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
    result = parseRpcPayload(data);
    if (result?.success === false && !isCashAdminCloseReviewResponse(durableIntent.operationType, result)) {
      throw rejectedFinancialResponseError(result);
    }
  } catch (error) {
    const { code, status } = classifyDispatchFailure(error);
    await updateFinancialIntentForRecovery(intentId, {
      status,
      lastReceiptStatus: status,
      lastProtocolCode: code
    }, handle, { recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.DISPATCHING });

    if (resolveAmbiguousReceipt && status === FINANCIAL_INTENT_STATUS.PENDING_RECEIPT) {
      try {
        const receipt = await receiptForCurrentOrigin({ intent: durableIntent, licenseKey, handle });
        if (receipt?.status === 'COMPLETED') {
          await updateFinancialIntentForRecovery(intentId, {
            status: FINANCIAL_INTENT_STATUS.COMPLETED,
            lastReceiptStatus: 'COMPLETED',
            lastProtocolCode: null,
            responsePayload: receipt?.result || receipt,
            completedAt: now()
          }, handle, { recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
          if (typeof project === 'function') {
            await runFinancialProjectionUnderLease({
              intentId,
              actorHandle: handle,
              recoveryLeaseId,
              project
            });
          }
        } else if (receipt?.status === 'CONFLICT') {
          await updateFinancialIntentForRecovery(intentId, {
            status: FINANCIAL_INTENT_STATUS.CONFLICT,
            lastReceiptStatus: 'CONFLICT',
            lastProtocolCode: 'IDEMPOTENCY_CONFLICT'
          }, handle, { recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
        } else {
          await updateFinancialIntentForRecovery(intentId, {
            lastReceiptStatus: receipt?.status || FINANCIAL_INTENT_STATUS.PENDING_RECEIPT
          }, handle, { recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
        }
      } catch {
        // The original ambiguous intent remains durable; it is never resent.
      }
    }
    throw error;
  }

  await updateFinancialIntentForRecovery(intentId, {
    status: FINANCIAL_INTENT_STATUS.COMPLETED,
    lastReceiptStatus: 'COMPLETED',
    lastProtocolCode: null,
    responsePayload: result,
    completedAt: now()
  }, handle, { recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.DISPATCHING });
  const projection = typeof project === 'function'
    ? await runFinancialProjectionUnderLease({
      intentId,
      actorHandle: handle,
      recoveryLeaseId,
      project
    })
    : null;
  return { intentId, response: result, projection };
};

/**
 * The first-dispatch recovery path is intentionally restricted to an
 * immutable PREPARED row that has never crossed the durable dispatch boundary.
 */
export const executePreparedFinancialIntentForRecovery = async ({ intentId, licenseKey, actorHandle = null, recoveryLeaseId = null, leaseMs } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const durableIntent = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!durableIntent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(durableIntent, handle);
  if (durableIntent.status !== FINANCIAL_INTENT_STATUS.PREPARED || Number(durableIntent.dispatchAttemptCount || 0) !== 0) {
    throw new Error('FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE');
  }
  let claim = null;
  if (!recoveryLeaseId) {
    claim = await claimFinancialIntentRecovery({ intentId, actorHandle: handle, leaseMs });
    recoveryLeaseId = claim.recoveryLeaseId;
  }

  try {
    return await executeDurableFinancialIntentForRecovery({
      intentId,
      licenseKey,
      actorHandle: handle,
      expectedStatus: FINANCIAL_INTENT_STATUS.PREPARED,
      recoveryLeaseId,
      lastRecoveryCode: 'FINANCIAL_RECOVERY_FIRST_DISPATCH'
    });
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({ intentId, leaseId: claim.recoveryLeaseId, actorHandle: handle });
      } catch {
        // A stale actor or expired lease cannot clear a newer owner.
      }
    }
  }
};

/**
 * Controlled redispatch for an explicitly retried sale. The caller must have
 * already validated the immutable retry evidence, acquired the recovery lease
 * and obtained an authoritative NOT_FOUND receipt.
 */
export const executeBlockedFinancialIntentForRecovery = async ({ intentId, licenseKey, actorHandle = null, recoveryLeaseId = null } = {}) => {
  if (!recoveryLeaseId) throw new Error('FINANCIAL_RECOVERY_LEASE_REQUIRED');
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const durableIntent = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!durableIntent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(durableIntent, handle);
  if (durableIntent.status !== FINANCIAL_INTENT_STATUS.BLOCKED || Number(durableIntent.dispatchAttemptCount || 0) < 1) {
    throw new Error('FINANCIAL_RECOVERY_BLOCKED_STATE_INVALID');
  }
  if (durableIntent.recoveryLeaseId !== recoveryLeaseId) throw new Error('FINANCIAL_RECOVERY_LEASE_LOST');
  return executeDurableFinancialIntentForRecovery({
    intentId,
    licenseKey,
    actorHandle: handle,
    expectedStatus: FINANCIAL_INTENT_STATUS.BLOCKED,
    recoveryLeaseId,
    lastRecoveryCode: 'FINANCIAL_RECOVERY_BLOCKED_REDISPATCH'
  });
};

export const markFinancialIntentProjectionApplied = async ({ intentId, actorHandle = null, recoveryLeaseId = null }) => updateProjectionStatusUnderLease({
  intentId,
  actorHandle: actorHandle || actorRuntimeController.capture(),
  recoveryLeaseId,
  changes: { projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED, projectionErrorCode: null }
});
export const markFinancialIntentProjectionFailed = async ({ intentId, errorCode = 'LOCAL_PROJECTION_FAILED', actorHandle = null, recoveryLeaseId = null }) => updateProjectionStatusUnderLease({
  intentId,
  actorHandle: actorHandle || actorRuntimeController.capture(),
  recoveryLeaseId,
  changes: { projectionStatus: FINANCIAL_PROJECTION_STATUS.FAILED, projectionErrorCode: errorCode }
});
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

export const financialIntentLedgerInternals = Object.freeze({ canonicalFinancialRequestV1, assertNoSecretPayload, secureKey, resolveStation, hasCapturedOrigin });
