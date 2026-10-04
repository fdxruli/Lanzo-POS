import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError,
  runWithLocalTenantSyncLease
} from '../tenant/localTenantGuard';
import { getTenantStorageItem, setTenantStorageItem } from '../tenant/tenantScopedStorage';
import { classifyActorAuthorityError } from '../auth/actorAuthorityErrors';
import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from '../auth/actorRuntimeController';
import {
  getActorAuthorityRecoverySnapshot,
  reportActorAuthorityError
} from '../auth/actorAuthorityRecovery';

const STORAGE_KEY = 'lanzo:restaurant-order-close-pending:v1';
const MAX_RETRY_COUNT = 5;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);
const safe = (value) => String(value || 'x').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const arrayOf = (value) => (Array.isArray(value) ? value : []);
const sumNumbers = (values = []) => values.reduce((sum, value) => sum + (numeric(value) || 0), 0);

const readPending = () => {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(getTenantStorageItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePending = (rows = []) => {
  if (!canUseStorage()) return;
  // Never evict another tenant's or a legacy unscoped recovery row merely
  // because a different tenant adds a retry entry.
  setTenantStorageItem(STORAGE_KEY, JSON.stringify(rows));
};

const getPendingRowKey = (payload = {}) => safe(payload.idempotencyKey || payload.localOrderId);

const savePending = (payload, error = null) => {
  const rows = readPending();
  const key = getPendingRowKey(payload);
  const existing = rows.find((row) => (
    row.licenseKey === payload.licenseKey && getPendingRowKey(row) === key
  )) || {};
  const next = {
    ...existing,
    ...payload,
    retryCount: Number(payload.retryCount ?? existing.retryCount ?? 0),
    failedAt: new Date().toISOString(),
    lastError: error?.message || error?.code || String(error || 'REST_7_CLOSE_PENDING')
  };
  writePending([
    ...rows.filter((row) => (
      row.licenseKey !== payload.licenseKey || getPendingRowKey(row) !== key
    )),
    next
  ]);
};

const clearPending = (localOrderIdOrKey, licenseKey) => {
  const key = safe(localOrderIdOrKey);
  writePending(readPending().filter((row) => (
    row.licenseKey !== licenseKey || (
      safe(row.idempotencyKey) !== key &&
      safe(row.localOrderId) !== key
    )
  )));
};

const authorityCloseFailure = (error, { pendingSaved = false } = {}) => {
  const classification = classifyActorAuthorityError(error, actorRuntimeController.getState());
  if (!classification) return null;
  reportActorAuthorityError(error, { operation: 'restaurant_checkout_close' });
  return {
    success: false,
    retryable: false,
    pendingSaved,
    manualRetryRequired: true,
    reauthenticationRequired: classification.requiresReauthentication,
    code: 'RESTAURANT_CLOUD_CLOSE_AUTHORITY_REQUIRED',
    message: `La venta quedó registrada. ${classification.message}`
  };
};

const activeRecoveryCloseFailure = () => {
  const recovery = getActorAuthorityRecoverySnapshot();
  const runtime = actorRuntimeController.getState();
  if (!recovery && runtime.status === ACTOR_RUNTIME_STATUS.GRANTED) return null;
  const classification = classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, runtime);
  return {
    success: false,
    retryable: false,
    pendingSaved: false,
    manualRetryRequired: true,
    reauthenticationRequired: Boolean(recovery || classification?.requiresReauthentication),
    code: 'RESTAURANT_CLOUD_CLOSE_AUTHORITY_REQUIRED',
    message: `La venta quedó registrada. ${classification.message}`
  };
};

const capturedCloseFailure = (actorHandle) => {
  try {
    actorHandle.assertCurrent();
    return null;
  } catch {
    // A previous request cannot demand another login or touch recovery rows
    // belonging to a newly granted actor. An existing lock keeps its reason.
    return activeRecoveryCloseFailure() || authorityCloseFailure({ code: 'CLOUD_REQUEST_RESPONSE_STALE' });
  }
};

const markPendingForManualRetry = (row) => {
  const key = getPendingRowKey(row);
  writePending(readPending().map((pending) => (
    pending.licenseKey === row.licenseKey && getPendingRowKey(pending) === key
      ? { ...pending, manualRetryRequired: true } : pending
  )));
  // Storage can fail silently for quota/privacy or a suspended namespace. Do
  // not emit a financial follow-up unless its no-replay marker is durable.
  return readPending().some((pending) => (
    pending.licenseKey === row.licenseKey && getPendingRowKey(pending) === key &&
    pending.manualRetryRequired === true
  ));
};

export const buildRestaurantCheckoutCloseIdempotencyKey = ({ localOrderId, paidSaleId, paidSaleFolio } = {}) => `restaurant:checkout-close:${safe(localOrderId)}:${safe(paidSaleId || paidSaleFolio || 'sale')}`;

export const buildRestaurantSplitCheckoutCloseIdempotencyKey = ({ localOrderId, splitGroupId } = {}) => `restaurant:checkout-close:split:${safe(localOrderId)}:${safe(splitGroupId)}`;

const hasRestaurantRuntime = (features = {}) => {
  const activeRubros = Array.isArray(features?.activeRubros) ? features.activeRubros : [];
  const hasFoodServiceRubro = activeRubros.includes(CANONICAL_BUSINESS_TYPES.FOOD_SERVICE);
  const hasRestaurantSurface = Boolean(
    features?.hasTables === true ||
    features?.hasKDS === true ||
    features?.tables === true ||
    features?.kds === true
  );

  return Boolean(hasFoodServiceRubro && hasRestaurantSurface);
};

const isEnabled = ({ licenseDetails, localOrderId, features }) => {
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const licenseEnabled = Boolean(
    licenseKey &&
    localOrderId &&
    licenseDetails?.valid !== false &&
    isRestaurantOrdersCloudEnabled(licenseDetails)
  );
  const runtimeEnabled = hasRestaurantRuntime(features);

  return {
    licenseKey,
    enabled: Boolean(licenseEnabled && runtimeEnabled),
    reason: licenseEnabled ? (runtimeEnabled ? null : 'restaurant_runtime_disabled') : 'restaurant_cloud_close_not_applicable'
  };
};

const buildPayload = ({ localOrderId, saleResult = {}, paymentData = {}, saleTotal = null }) => {
  const paidSaleId = saleResult.cloudSaleId || saleResult.saleId || saleResult.id || null;
  const paidSaleFolio = saleResult.cloudFolio || saleResult.folio || saleResult.localFolio || null;

  return {
    localOrderId,
    paidSaleId,
    paidSaleFolio,
    paidTotal: numeric(saleTotal ?? saleResult.total ?? paymentData.total ?? paymentData.amountPaid),
    paymentSummary: {
      method: paymentData.paymentMethod || paymentData.method || null,
      amountPaid: numeric(paymentData.amountPaid),
      sourceMode: saleResult.sourceMode || null
    },
    idempotencyKey: buildRestaurantCheckoutCloseIdempotencyKey({ localOrderId, paidSaleId, paidSaleFolio })
  };
};

export const buildSplitPaymentSummary = ({ splitResult = {}, saleTotal = null } = {}) => {
  const childSales = arrayOf(splitResult.childSales);
  const childSaleIds = arrayOf(splitResult.childSaleIds).length > 0
    ? arrayOf(splitResult.childSaleIds)
    : childSales.map((sale) => sale?.id).filter(Boolean);

  const tickets = arrayOf(splitResult.paymentSummary?.tickets).length > 0
    ? arrayOf(splitResult.paymentSummary.tickets)
    : childSales.map((sale) => ({
      label: sale?.splitLabel || null,
      saleId: sale?.id || null,
      paymentMethod: sale?.paymentMethod || null,
      amountPaid: numeric(sale?.abono),
      saldoPendiente: numeric(sale?.saldoPendiente),
      customerId: sale?.customerId || null,
      total: numeric(sale?.total)
    }));

  const methodSet = new Set(tickets.map((ticket) => ticket.paymentMethod).filter(Boolean));
  const amountPaidTotal = sumNumbers(tickets.map((ticket) => ticket.amountPaid));
  const balanceDueTotal = sumNumbers(tickets.map((ticket) => ticket.saldoPendiente));
  const total = numeric(saleTotal ?? splitResult.total) ?? sumNumbers(tickets.map((ticket) => ticket.total));

  return {
    ...(splitResult.paymentSummary || {}),
    source: 'split_bill',
    splitGroupId: splitResult.splitGroupId || splitResult.paymentSummary?.splitGroupId || null,
    parentOrderId: splitResult.parentOrderId || splitResult.paymentSummary?.parentOrderId || null,
    childSaleIds,
    tickets,
    methods: Array.from(methodSet),
    amountPaidTotal,
    balanceDueTotal,
    total,
    sourceMode: splitResult.sourceMode || 'shadow/local_applied'
  };
};

export const buildSplitCheckoutClosePayload = ({ localOrderId, splitResult = {}, saleTotal = null } = {}) => {
  const paymentSummary = buildSplitPaymentSummary({ splitResult, saleTotal });
  const splitGroupId = splitResult.splitGroupId || paymentSummary.splitGroupId;
  const childSaleIds = arrayOf(splitResult.childSaleIds).length > 0
    ? arrayOf(splitResult.childSaleIds)
    : arrayOf(paymentSummary.childSaleIds);

  return {
    localOrderId,
    paidSaleId: splitGroupId || childSaleIds[0] || null,
    paidSaleFolio: splitGroupId ? `SPLIT-${splitGroupId}` : null,
    paidTotal: numeric(saleTotal ?? splitResult.total ?? paymentSummary.total),
    paymentSummary,
    idempotencyKey: buildRestaurantSplitCheckoutCloseIdempotencyKey({ localOrderId, splitGroupId: splitGroupId || childSaleIds[0] })
  };
};

const closeWithPayload = async ({ payload, licenseKey }) => {
  const recoveryFailure = activeRecoveryCloseFailure();
  if (recoveryFailure) return recoveryFailure;
  return runWithLocalTenantSyncLease(
  { license_key: licenseKey },
  { reason: 'restaurant_checkout_close' },
  async () => {
    const scopedPayload = { ...payload, licenseKey };
    const recoveryFailure = activeRecoveryCloseFailure();
    if (recoveryFailure) return recoveryFailure;
    let actorHandle;
    try {
      actorHandle = actorRuntimeController.capture();
    } catch (error) {
      return authorityCloseFailure(error) || activeRecoveryCloseFailure();
    }
    if (!isOnline()) {
      savePending(scopedPayload, new Error('OFFLINE'));
      return { success: false, retryable: true, pendingSaved: true, code: 'RESTAURANT_CLOUD_CLOSE_OFFLINE' };
    }

    const existingPending = readPending().find((row) => (
      row.licenseKey === licenseKey && getPendingRowKey(row) === getPendingRowKey(scopedPayload)
    ));
    if (existingPending && !markPendingForManualRetry(existingPending)) {
      return { success: false, retryable: false, pendingSaved: true, code: 'RESTAURANT_CLOSE_RECOVERY_STORAGE_UNAVAILABLE' };
    }

    try {
      const response = await restaurantOrdersRepository.closeRestaurantOrderAfterCheckout({ licenseKey, ...payload });
      const actorFailure = capturedCloseFailure(actorHandle);
      if (actorFailure) return { ...actorFailure, pendingSaved: Boolean(existingPending) };
      if (response?.success === false) {
        const authorityFailure = authorityCloseFailure(response, { pendingSaved: Boolean(existingPending) });
        if (authorityFailure) return authorityFailure;
      }
      await assertLocalTenantSyncAccess(
        { license_key: licenseKey },
        { reason: 'restaurant_checkout_close_commit' }
      );
      const commitFailure = capturedCloseFailure(actorHandle);
      if (commitFailure) return { ...commitFailure, pendingSaved: Boolean(existingPending) };
      if (response?.success === false) {
        savePending({ ...scopedPayload, manualRetryRequired: existingPending?.manualRetryRequired === true }, response);
        return { ...response, retryable: true, pendingSaved: true };
      }
      clearPending(payload.idempotencyKey || payload.localOrderId, licenseKey);
      return response;
    } catch (error) {
      const authorityFailure = capturedCloseFailure(actorHandle) || authorityCloseFailure(error, { pendingSaved: Boolean(existingPending) }) || activeRecoveryCloseFailure();
      if (authorityFailure) return { ...authorityFailure, pendingSaved: Boolean(existingPending) };
      if (isLocalTenantAccessError(error)) throw error;
      await assertLocalTenantSyncAccess(
        { license_key: licenseKey },
        { reason: 'restaurant_checkout_close_retry_save' }
      );
      const retrySaveFailure = capturedCloseFailure(actorHandle);
      if (retrySaveFailure) return { ...retrySaveFailure, pendingSaved: Boolean(existingPending) };
      savePending({ ...scopedPayload, manualRetryRequired: existingPending?.manualRetryRequired === true }, error);
      return {
        success: false,
        retryable: true,
        pendingSaved: true,
        code: error?.code || 'RESTAURANT_CLOUD_CLOSE_FAILED',
        message: error?.message || 'La venta se cobro, pero no se pudo cerrar cocina cloud.'
      };
    }
  }
  );
};

export const closeRestaurantCloudOrderAfterSuccessfulPayment = async ({ localOrderId, saleResult = {}, paymentData = {}, licenseDetails = null, saleTotal = null, features = null } = {}) => {
  const { licenseKey, enabled, reason } = isEnabled({ licenseDetails, localOrderId, features });

  if (!enabled) {
    return { success: true, skipped: true, reason };
  }

  const payload = buildPayload({ localOrderId, saleResult, paymentData, saleTotal });
  return closeWithPayload({ payload, licenseKey });
};

export const closeRestaurantCloudOrderAfterSuccessfulSplitPayment = async ({ localOrderId, splitResult = {}, licenseDetails = null, saleTotal = null, features = null } = {}) => {
  const { licenseKey, enabled, reason } = isEnabled({ licenseDetails, localOrderId, features });

  if (!enabled) {
    return { success: true, skipped: true, reason };
  }

  const payload = buildSplitCheckoutClosePayload({ localOrderId, splitResult, saleTotal });
  return closeWithPayload({ payload, licenseKey });
};

export const retryPendingRestaurantCloudOrderCloses = async ({ licenseDetails = null, features = null, maxRetries = 3 } = {}) => {
  const { licenseKey, enabled, reason } = isEnabled({ licenseDetails, localOrderId: 'retry', features });
  if (!enabled || !isOnline()) return { success: true, skipped: true, reason };
  const recoveryFailure = activeRecoveryCloseFailure();
  if (recoveryFailure) {
    return { ...recoveryFailure, skipped: true, reason: 'actor_authority_recovery_required' };
  }

  return runWithLocalTenantSyncLease(
    { license_key: licenseKey },
    { reason: 'restaurant_checkout_retry' },
    async () => {
      let actorHandle;
      try {
        actorHandle = actorRuntimeController.capture();
      } catch (error) {
        return authorityCloseFailure(error) || activeRecoveryCloseFailure();
      }
      // Legacy unscoped rows remain untouched until an explicit recovery can
      // identify their owner. They are never reinterpreted under this tenant.
      const rows = readPending()
        .filter((row) => row.licenseKey === licenseKey && row.manualRetryRequired !== true)
        .slice(0, Math.max(1, Number(maxRetries) || 3));
      let closed = 0;
      let failed = 0;

      for (const row of rows) {
        if (!row.localOrderId || Number(row.retryCount || 0) >= MAX_RETRY_COUNT) continue;
        const recoveryFailure = capturedCloseFailure(actorHandle) || activeRecoveryCloseFailure();
        if (recoveryFailure) return { ...recoveryFailure, closed, failed, total: rows.length };
        // Persist before dispatch. An auth rejection may suspend storage before
        // the catch runs, and a later login must never replay that operation.
        if (!markPendingForManualRetry(row)) {
          return { success: false, closed, failed, total: rows.length, code: 'RESTAURANT_CLOSE_RECOVERY_STORAGE_UNAVAILABLE' };
        }
        try {
          const response = await restaurantOrdersRepository.closeRestaurantOrderAfterCheckout({
            licenseKey,
            localOrderId: row.localOrderId,
            paidSaleId: row.paidSaleId || null,
            paidSaleFolio: row.paidSaleFolio || null,
            paidTotal: row.paidTotal ?? null,
            paymentSummary: row.paymentSummary || {},
            idempotencyKey: row.idempotencyKey
          });
          const actorFailure = capturedCloseFailure(actorHandle);
          if (actorFailure) return { ...actorFailure, pendingSaved: true, closed, failed: failed + 1, total: rows.length };
          if (response?.success === false) {
            const authorityFailure = authorityCloseFailure(response, { pendingSaved: true });
            if (authorityFailure) return { ...authorityFailure, closed, failed: failed + 1, total: rows.length };
          }
          await assertLocalTenantSyncAccess(
            { license_key: licenseKey },
            { reason: 'restaurant_checkout_retry_commit' }
          );
          const commitFailure = capturedCloseFailure(actorHandle);
          if (commitFailure) return { ...commitFailure, pendingSaved: true, closed, failed: failed + 1, total: rows.length };
          if (response?.success === false) throw new Error(response.message || response.code || 'RESTAURANT_CLOUD_CLOSE_RETRY_FAILED');
          clearPending(row.idempotencyKey || row.localOrderId, licenseKey);
          closed += 1;
        } catch (error) {
          const authorityFailure = capturedCloseFailure(actorHandle) || authorityCloseFailure(error, { pendingSaved: true }) || activeRecoveryCloseFailure();
          if (authorityFailure) return { ...authorityFailure, pendingSaved: true, closed, failed: failed + 1, total: rows.length };
          if (isLocalTenantAccessError(error)) throw error;
          await assertLocalTenantSyncAccess(
            { license_key: licenseKey },
            { reason: 'restaurant_checkout_retry_save' }
          );
          const retrySaveFailure = capturedCloseFailure(actorHandle);
          if (retrySaveFailure) return { ...retrySaveFailure, pendingSaved: true, closed, failed: failed + 1, total: rows.length };
          failed += 1;
          savePending({ ...row, manualRetryRequired: false, retryCount: Number(row.retryCount || 0) + 1 }, error);
        }
      }

      return { success: failed === 0, closed, failed, total: rows.length };
    }
  );
};

export default {
  closeRestaurantCloudOrderAfterSuccessfulPayment,
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment,
  retryPendingRestaurantCloudOrderCloses
};
