import {
  getAvailableBatchStock,
  getBatchExpiryValue,
  getRecommendedFefoBatch,
  isBatchActiveForFefo,
  isBatchExpiredForSale
} from './fefoUtils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';

export const STRICT_EXPIRY_NO_CURRENT_BATCH_MESSAGE = 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.';
export const STRICT_EXPIRY_NO_CURRENT_BATCH_LABEL = 'Sin lote vigente';
export const STRICT_EXPIRY_NO_CURRENT_BATCH_EMPTY_MESSAGE = 'No hay lotes vigentes disponibles.';

export const isStrictExpiryBatchManagedProduct = (product) => {
  const expirationMode = product?.expirationMode ?? product?.expiration_mode ?? 'NONE';
  return expirationMode === 'STRICT' && product?.batchManagement?.enabled === true;
};

export const hasAvailableBatchStock = (batch) => (
  isBatchActiveForFefo(batch) && getAvailableBatchStock(batch) > 0
);

export const getStrictExpirySaleGuard = ({
  product,
  batches = [],
  now = new Date()
} = {}) => {
  if (!isStrictExpiryBatchManagedProduct(product)) {
    return {
      blocked: false,
      reason: 'not_strict_batch_product',
      message: null,
      label: null,
      recommendedBatch: null,
      availableCurrentStock: 0,
      expiredAvailableStock: 0,
      totalAvailableBatchStock: 0
    };
  }

  const batchList = Array.isArray(batches) ? batches : [];
  const availableBatches = batchList.filter(hasAvailableBatchStock);
  const recommendedBatch = getRecommendedFefoBatch(availableBatches, product, { now });

  const availableCurrentStock = availableBatches.reduce((sum, batch) => (
    ['valid', 'expires_today'].includes(getBatchExpiryStatus({ expiryDate: getBatchExpiryValue(batch) }, now))
      ? sum + getAvailableBatchStock(batch)
      : sum
  ), 0);

  const expiredAvailableStock = availableBatches.reduce((sum, batch) => (
    isBatchExpiredForSale(batch, product, now) ? sum + getAvailableBatchStock(batch) : sum
  ), 0);

  const totalAvailableBatchStock = availableBatches.reduce((sum, batch) => (
    sum + getAvailableBatchStock(batch)
  ), 0);

  const blocked = !recommendedBatch;

  return {
    blocked,
    reason: blocked ? 'strict_without_current_batch' : 'strict_with_current_batch',
    message: blocked ? STRICT_EXPIRY_NO_CURRENT_BATCH_MESSAGE : null,
    label: blocked ? STRICT_EXPIRY_NO_CURRENT_BATCH_LABEL : null,
    recommendedBatch,
    availableCurrentStock,
    expiredAvailableStock,
    totalAvailableBatchStock
  };
};

export const getStrictExpirySelectableBatches = ({
  product,
  batches = [],
  now = new Date()
} = {}) => {
  const batchList = Array.isArray(batches) ? batches : [];
  if (!isStrictExpiryBatchManagedProduct(product)) return batchList;
  return batchList.filter((batch) => !isBatchExpiredForSale(batch, product, now));
};
