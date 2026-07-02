import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const safe = (value) => String(value || 'x').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export const buildRestaurantCheckoutCloseIdempotencyKey = ({ localOrderId, paidSaleId, paidSaleFolio } = {}) => `restaurant:checkout-close:${safe(localOrderId)}:${safe(paidSaleId || paidSaleFolio || 'sale')}`;

export const closeRestaurantCloudOrderAfterSuccessfulPayment = async ({ localOrderId, saleResult = {}, paymentData = {}, licenseDetails = null, saleTotal = null } = {}) => {
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);

  if (!licenseKey || !localOrderId || licenseDetails?.valid === false || !isRestaurantOrdersCloudEnabled(licenseDetails)) {
    return { success: true, skipped: true };
  }

  if (!isOnline()) {
    return { success: false, retryable: true, code: 'RESTAURANT_CLOUD_CLOSE_OFFLINE' };
  }

  const paidSaleId = saleResult.cloudSaleId || saleResult.saleId || saleResult.id || null;
  const paidSaleFolio = saleResult.cloudFolio || saleResult.folio || saleResult.localFolio || null;

  return restaurantOrdersRepository.closeRestaurantOrderAfterCheckout({
    licenseKey,
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
  });
};

export const retryPendingRestaurantCloudOrderCloses = async () => ({ success: true, skipped: true });

export default { closeRestaurantCloudOrderAfterSuccessfulPayment, retryPendingRestaurantCloudOrderCloses };
