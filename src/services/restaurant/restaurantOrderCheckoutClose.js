import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';

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
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePending = (rows = []) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-50)));
};

const getPendingRowKey = (payload = {}) => safe(payload.idempotencyKey || payload.localOrderId);

const savePending = (payload, error = null) => {
  const rows = readPending();
  const key = getPendingRowKey(payload);
  const existing = rows.find((row) => getPendingRowKey(row) === key) || {};
  const next = {
    ...existing,
    ...payload,
    retryCount: Number(payload.retryCount ?? existing.retryCount ?? 0),
    failedAt: new Date().toISOString(),
    lastError: error?.message || error?.code || String(error || 'REST_7_CLOSE_PENDING')
  };
  writePending([...rows.filter((row) => getPendingRowKey(row) !== key), next]);
};

const clearPending = (localOrderIdOrKey) => {
  const key = safe(localOrderIdOrKey);
  writePending(readPending().filter((row) => (
    safe(row.idempotencyKey) !== key &&
    safe(row.localOrderId) !== key
  )));
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
  if (!isOnline()) {
    savePending(payload, new Error('OFFLINE'));
    return { success: false, retryable: true, pendingSaved: true, code: 'RESTAURANT_CLOUD_CLOSE_OFFLINE' };
  }

  try {
    const response = await restaurantOrdersRepository.closeRestaurantOrderAfterCheckout({ licenseKey, ...payload });
    if (response?.success === false) {
      savePending(payload, response);
      return { ...response, retryable: true, pendingSaved: true };
    }
    clearPending(payload.idempotencyKey || payload.localOrderId);
    return response;
  } catch (error) {
    savePending(payload, error);
    return {
      success: false,
      retryable: true,
      pendingSaved: true,
      code: error?.code || 'RESTAURANT_CLOUD_CLOSE_FAILED',
      message: error?.message || 'La venta se cobro, pero no se pudo cerrar cocina cloud.'
    };
  }
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

  const rows = readPending().slice(0, Math.max(1, Number(maxRetries) || 3));
  let closed = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.localOrderId || Number(row.retryCount || 0) >= MAX_RETRY_COUNT) continue;
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
      if (response?.success === false) throw new Error(response.message || response.code || 'RESTAURANT_CLOUD_CLOSE_RETRY_FAILED');
      clearPending(row.idempotencyKey || row.localOrderId);
      closed += 1;
    } catch (error) {
      failed += 1;
      savePending({ ...row, retryCount: Number(row.retryCount || 0) + 1 }, error);
    }
  }

  return { success: failed === 0, closed, failed, total: rows.length };
};

export default {
  closeRestaurantCloudOrderAfterSuccessfulPayment,
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment,
  retryPendingRestaurantCloudOrderCloses
};