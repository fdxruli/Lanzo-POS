import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';

const STORAGE_KEY = 'lanzo:restaurant-order-close-pending:v1';
const MAX_RETRY_COUNT = 5;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);
const safe = (value) => String(value || 'x').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

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

const savePending = (payload, error = null) => {
  const rows = readPending();
  const key = safe(payload.localOrderId);
  const existing = rows.find((row) => safe(row.localOrderId) === key) || {};
  const next = {
    ...existing,
    ...payload,
    retryCount: Number(existing.retryCount || 0),
    failedAt: new Date().toISOString(),
    lastError: error?.message || error?.code || String(error || 'REST_7_CLOSE_PENDING')
  };
  writePending([...rows.filter((row) => safe(row.localOrderId) !== key), next]);
};

const clearPending = (localOrderId) => {
  const key = safe(localOrderId);
  writePending(readPending().filter((row) => safe(row.localOrderId) !== key));
};

export const buildRestaurantCheckoutCloseIdempotencyKey = ({ localOrderId, paidSaleId, paidSaleFolio } = {}) => `restaurant:checkout-close:${safe(localOrderId)}:${safe(paidSaleId || paidSaleFolio || 'sale')}`;

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

export const closeRestaurantCloudOrderAfterSuccessfulPayment = async ({ localOrderId, saleResult = {}, paymentData = {}, licenseDetails = null, saleTotal = null, features = null } = {}) => {
  const { licenseKey, enabled, reason } = isEnabled({ licenseDetails, localOrderId, features });

  if (!enabled) {
    return { success: true, skipped: true, reason };
  }

  const payload = buildPayload({ localOrderId, saleResult, paymentData, saleTotal });

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
    clearPending(localOrderId);
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
      clearPending(row.localOrderId);
      closed += 1;
    } catch (error) {
      failed += 1;
      savePending({ ...row, retryCount: Number(row.retryCount || 0) + 1 }, error);
    }
  }

  return { success: failed === 0, closed, failed, total: rows.length };
};

export default { closeRestaurantCloudOrderAfterSuccessfulPayment, retryPendingRestaurantCloudOrderCloses };
